/**
 * Recorder Extension
 *
 * Records all session activity to SQLite for performance tracking and analytics.
 * Uses better-sqlite3 (native SQLite bindings) for direct file-backed storage.
 *
 * Database location: ~/.pi/agent/recorder.db
 *
 * Query with: sqlite3 ~/.pi/agent/recorder.db "SELECT * FROM sessions"
 *
 * NOTE: This extension assumes single-session-per-process semantics. Module-level
 * state (db handle, session ID, turn tracking) is shared. If pi-coding-agent ever
 * supports concurrent sessions in a single process, this must be refactored to
 * scope state per session.
 */

import type {
  ExtensionAPI,
  ExtensionContext,
  TurnStartEvent,
  TurnEndEvent,
  ToolCallEvent,
  ToolResultEvent,
} from "@mariozechner/pi-coding-agent";
import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";

// Events not exported from pi-coding-agent, define inline
interface ModelSelectEvent {
  type: "model_select";
  model: { provider: string; id: string };
  previousModel?: { provider: string; id: string };
  source: "set" | "cycle" | "restore";
}

interface InputEvent {
  type: "input";
  text: string;
  images?: Array<{ type: "image"; data: string; mimeType: string }>;
  source: "interactive" | "rpc" | "extension";
}

// Minimal better-sqlite3 types for the subset of API we use.
// Defined inline because the module is loaded dynamically via import() and
// @types/better-sqlite3 cannot provide types for a dynamic default export.
interface BetterSqlite3Database {
  exec(sql: string): this;
  prepare(sql: string): BetterSqlite3Statement;
  transaction<F extends (...args: unknown[]) => unknown>(fn: F): F;
  pragma(pragma: string, options?: { simple?: boolean }): unknown;
  close(): void;
}

interface BetterSqlite3Statement {
  run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint };
  get(...params: unknown[]): unknown;
}

type BetterSqlite3Constructor = new (
  filename: string,
  options?: Record<string, unknown>,
) => BetterSqlite3Database;

// Extension identity
const EXT_NAME = "recorder";
const LOG_PREFIX = `[${EXT_NAME}]`;

// Database location
const DB_DIR = ".pi/agent"; // relative to homedir()
const DB_FILENAME = "recorder.db";
const METADATA_FILENAME = "recorder-metadata.yml";

// Max result size to store (50KB)
const MAX_RESULT_SIZE = 50 * 1024;
const TRUNCATION_SUFFIX = "... [truncated at 50KB]";

// Schema (PRAGMA set separately via db.pragma())
const SCHEMA = `
CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    session_file TEXT,
    cwd TEXT NOT NULL,
    started_at INTEGER NOT NULL,
    ended_at INTEGER,
    model_provider TEXT,
    model_id TEXT,
    total_input_tokens INTEGER DEFAULT 0,
    total_output_tokens INTEGER DEFAULT 0,
    total_cost REAL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS turns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    turn_index INTEGER NOT NULL,
    iteration_number INTEGER DEFAULT 0,
    started_at INTEGER NOT NULL,
    ended_at INTEGER,
    duration_ms INTEGER,
    model_provider TEXT,
    model_id TEXT,
    input_tokens INTEGER DEFAULT 0,
    output_tokens INTEGER DEFAULT 0,
    cost REAL DEFAULT 0,
    stop_reason TEXT,
    UNIQUE(session_id, turn_index, iteration_number),
    FOREIGN KEY (session_id) REFERENCES sessions(id)
);

CREATE TABLE IF NOT EXISTS tool_calls (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    turn_id INTEGER,
    tool_name TEXT NOT NULL,
    input_json TEXT,
    started_at INTEGER NOT NULL,
    ended_at INTEGER,
    duration_ms INTEGER,
    is_error INTEGER DEFAULT 0,
    result_text TEXT,
    FOREIGN KEY (session_id) REFERENCES sessions(id),
    FOREIGN KEY (turn_id) REFERENCES turns(id)
);

CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
    content TEXT,
    turn_id INTEGER,
    timestamp INTEGER NOT NULL,
    FOREIGN KEY (session_id) REFERENCES sessions(id),
    FOREIGN KEY (turn_id) REFERENCES turns(id)
);

CREATE TABLE IF NOT EXISTS model_changes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    source TEXT,
    from_provider TEXT,
    from_model_id TEXT,
    to_provider TEXT NOT NULL,
    to_model_id TEXT NOT NULL,
    FOREIGN KEY (session_id) REFERENCES sessions(id)
);

CREATE INDEX IF NOT EXISTS idx_turns_session ON turns(session_id);
CREATE INDEX IF NOT EXISTS idx_tool_calls_session ON tool_calls(session_id);
CREATE INDEX IF NOT EXISTS idx_tool_calls_name ON tool_calls(tool_name);
CREATE INDEX IF NOT EXISTS idx_tool_calls_turn ON tool_calls(turn_id);
CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);
CREATE INDEX IF NOT EXISTS idx_sessions_started ON sessions(started_at);
CREATE INDEX IF NOT EXISTS idx_turns_started ON turns(started_at);

-- Views for analytics (also used by datasette)
CREATE VIEW IF NOT EXISTS v_session_summary AS
SELECT
    s.id,
    datetime(s.started_at / 1000, 'unixepoch', 'localtime') AS started,
    datetime(s.ended_at / 1000, 'unixepoch', 'localtime') AS ended,
    CASE WHEN s.ended_at IS NOT NULL
        THEN round((s.ended_at - s.started_at) / 1000.0 / 60, 1)
        ELSE NULL
    END AS duration_min,
    s.model_provider,
    s.model_id,
    s.total_input_tokens,
    s.total_output_tokens,
    round(s.total_cost, 4) AS total_cost,
    (SELECT count(*) FROM turns t WHERE t.session_id = s.id) AS turn_count,
    (SELECT count(*) FROM tool_calls tc WHERE tc.session_id = s.id) AS tool_call_count,
    s.cwd
FROM sessions s
ORDER BY s.started_at DESC;

CREATE VIEW IF NOT EXISTS v_tool_stats AS
SELECT
    tool_name,
    count(*) AS total_calls,
    sum(is_error) AS error_count,
    round(100.0 * sum(is_error) / count(*), 1) AS error_pct,
    round(avg(duration_ms)) AS avg_duration_ms,
    min(duration_ms) AS min_duration_ms,
    max(duration_ms) AS max_duration_ms
FROM tool_calls
WHERE duration_ms IS NOT NULL
GROUP BY tool_name
ORDER BY total_calls DESC;

CREATE VIEW IF NOT EXISTS v_daily_cost AS
SELECT
    date(started_at / 1000, 'unixepoch', 'localtime') AS day,
    count(*) AS session_count,
    sum(total_input_tokens) AS input_tokens,
    sum(total_output_tokens) AS output_tokens,
    round(sum(total_cost), 4) AS total_cost
FROM sessions
GROUP BY day
ORDER BY day DESC;
`;

// Datasette metadata (written to ~/.pi/agent/ alongside the database)
const DATASETTE_METADATA = `title: Pi Recorder
description: Session activity recorded by the pi-coding-agent recorder extension.

databases:
  recorder:
    description: >
      All pi-coding-agent session activity: sessions, turns, tool calls,
      messages, and model changes. Timestamps are Unix milliseconds.

    tables:
      sessions:
        description: One row per pi session. Aggregates token counts and cost.
        facets:
          - model_provider
          - model_id
        sort_desc: started_at
        columns:
          id: Session UUID
          session_file: Path to the .jsonl session file
          cwd: Working directory when the session started
          started_at: Session start time (Unix ms)
          ended_at: Session end time (Unix ms)
          model_provider: Initial model provider (e.g. anthropic)
          model_id: Initial model ID (e.g. claude-sonnet-4-20250514)
          total_input_tokens: Sum of input tokens across all turns
          total_output_tokens: Sum of output tokens across all turns
          total_cost: Sum of cost across all turns (USD)

      turns:
        description: One row per LLM response iteration within a conversational turn. A single turn may have multiple iterations when tools are used.
        facets:
          - model_provider
          - model_id
          - stop_reason
        sort_desc: started_at
        columns:
          id: Auto-incremented turn ID
          session_id: FK to sessions.id
          turn_index: Zero-based conversational turn number within the session
          iteration_number: Zero-based iteration within this turn (increments when tools require follow-up calls)
          started_at: Turn start time (Unix ms)
          ended_at: Turn end time (Unix ms)
          duration_ms: Turn duration in milliseconds
          model_provider: Model provider for this turn
          model_id: Model ID for this turn
          input_tokens: Input tokens consumed
          output_tokens: Output tokens produced
          cost: Cost of this turn (USD)
          stop_reason: Why the turn ended (e.g. end_turn, tool_use)

      tool_calls:
        description: One row per tool invocation. Tracks timing and errors.
        facets:
          - tool_name
          - is_error
        sort_desc: started_at
        columns:
          id: Tool call UUID
          session_id: FK to sessions.id
          turn_id: FK to turns.id
          tool_name: Name of the tool invoked
          input_json: JSON-serialized tool input (truncated at 50KB)
          started_at: Tool call start time (Unix ms)
          ended_at: Tool call end time (Unix ms)
          duration_ms: Tool call duration in milliseconds
          is_error: 1 if the tool returned an error, 0 otherwise
          result_text: Tool result text (truncated at 50KB)

      messages:
        description: User and assistant messages recorded during sessions.
        facets:
          - role
        sort_desc: timestamp
        columns:
          id: Auto-incremented message ID
          session_id: FK to sessions.id
          role: "'user' or 'assistant'"
          content: Message text (truncated at 50KB)
          turn_id: FK to turns.id (null for user messages)
          timestamp: Message timestamp (Unix ms)

      model_changes:
        description: Records when the model was changed during a session.
        facets:
          - source
          - to_provider
          - to_model_id
        sort_desc: timestamp
        columns:
          id: Auto-incremented change ID
          session_id: FK to sessions.id
          timestamp: Change timestamp (Unix ms)
          source: How the model was changed (set, cycle, restore)
          from_provider: Previous model provider
          from_model_id: Previous model ID
          to_provider: New model provider
          to_model_id: New model ID

      v_session_summary:
        description: >
          Enriched session view with human-readable timestamps, duration in
          minutes, and turn/tool call counts.

      v_tool_stats:
        description: >
          Aggregated tool statistics: call count, error count/rate, and
          duration min/avg/max per tool name.

      v_daily_cost:
        description: >
          Daily cost and token aggregation across all sessions.

    queries:
      recent-sessions:
        title: Recent Sessions
        description: Last 50 sessions with duration, cost, and token counts.
        sql: |
          SELECT
              id,
              datetime(started_at / 1000, 'unixepoch', 'localtime') AS started,
              CASE WHEN ended_at IS NOT NULL
                  THEN round((ended_at - started_at) / 1000.0 / 60, 1)
                  ELSE NULL
              END AS duration_min,
              model_id,
              total_input_tokens,
              total_output_tokens,
              round(total_cost, 4) AS cost,
              cwd
          FROM sessions
          ORDER BY started_at DESC
          LIMIT 50

      daily-cost:
        title: Daily Cost
        description: Cost and token usage aggregated by day.
        sql: |
          SELECT
              date(started_at / 1000, 'unixepoch', 'localtime') AS day,
              count(*) AS sessions,
              sum(total_input_tokens) AS input_tokens,
              sum(total_output_tokens) AS output_tokens,
              round(sum(total_cost), 4) AS total_cost
          FROM sessions
          GROUP BY day
          ORDER BY day DESC

      tool-usage:
        title: Tool Usage Stats
        description: Call count, error rate, and average duration per tool.
        sql: |
          SELECT
              tool_name,
              count(*) AS calls,
              sum(is_error) AS errors,
              round(100.0 * sum(is_error) / count(*), 1) AS error_pct,
              round(avg(duration_ms)) AS avg_ms,
              max(duration_ms) AS max_ms
          FROM tool_calls
          GROUP BY tool_name
          ORDER BY calls DESC

      slowest-tools:
        title: Slowest Tool Calls
        description: Top 50 tool calls by duration.
        sql: |
          SELECT
              tc.tool_name,
              tc.duration_ms,
              datetime(tc.started_at / 1000, 'unixepoch', 'localtime') AS started,
              tc.is_error,
              s.cwd,
              substr(tc.input_json, 1, 200) AS input_preview
          FROM tool_calls tc
          JOIN sessions s ON tc.session_id = s.id
          WHERE tc.duration_ms IS NOT NULL
          ORDER BY tc.duration_ms DESC
          LIMIT 50

      model-comparison:
        title: Model Comparison
        description: Token usage and cost breakdown per model.
        sql: |
          SELECT
              model_provider,
              model_id,
              count(*) AS turns,
              sum(input_tokens) AS input_tokens,
              sum(output_tokens) AS output_tokens,
              round(sum(cost), 4) AS total_cost,
              round(avg(duration_ms)) AS avg_turn_ms
          FROM turns
          WHERE model_id IS NOT NULL
          GROUP BY model_provider, model_id
          ORDER BY total_cost DESC

      failed-tools:
        title: Failed Tool Calls
        description: All tool calls that returned an error.
        sql: |
          SELECT
              tc.tool_name,
              datetime(tc.started_at / 1000, 'unixepoch', 'localtime') AS timestamp,
              tc.duration_ms,
              substr(tc.result_text, 1, 500) AS error_text,
              s.cwd
          FROM tool_calls tc
          JOIN sessions s ON tc.session_id = s.id
          WHERE tc.is_error = 1
          ORDER BY tc.started_at DESC
          LIMIT 100

      session-turns:
        title: Session Turns
        description: All turns for a specific session. Enter a session ID.
        sql: |
          SELECT
              t.turn_index,
              datetime(t.started_at / 1000, 'unixepoch', 'localtime') AS started,
              t.duration_ms,
              t.model_id,
              t.input_tokens,
              t.output_tokens,
              round(t.cost, 6) AS cost,
              t.stop_reason
          FROM turns t
          WHERE t.session_id = :session_id
          ORDER BY t.turn_index

      session-tools:
        title: Session Tool Calls
        description: All tool calls for a specific session. Enter a session ID.
        sql: |
          SELECT
              tc.tool_name,
              datetime(tc.started_at / 1000, 'unixepoch', 'localtime') AS started,
              tc.duration_ms,
              tc.is_error,
              substr(tc.input_json, 1, 200) AS input_preview
          FROM tool_calls tc
          WHERE tc.session_id = :session_id
          ORDER BY tc.started_at

      hourly-activity:
        title: Hourly Activity
        description: Session count and cost by hour of day.
        sql: |
          SELECT
              strftime('%H', datetime(started_at / 1000, 'unixepoch', 'localtime')) AS hour,
              count(*) AS sessions,
              round(sum(total_cost), 4) AS cost
          FROM sessions
          GROUP BY hour
          ORDER BY hour

      token-efficiency:
        title: Token Efficiency
        description: Cost per million tokens by model.
        sql: |
          SELECT
              model_id,
              round(sum(cost) / nullif(sum(output_tokens), 0) * 1000000, 2) AS cost_per_m_output,
              round(sum(cost) / nullif(sum(input_tokens), 0) * 1000000, 2) AS cost_per_m_input,
              sum(output_tokens) AS total_output,
              round(sum(cost), 4) AS total_cost
          FROM turns
          WHERE model_id IS NOT NULL AND cost > 0
          GROUP BY model_id
          ORDER BY total_cost DESC
`;

// State
let db: BetterSqlite3Database | null = null;
let moduleAvailable = true;
let moduleError: string | null = null;

let state = {
  sessionId: null as string | null,
  currentTurnId: null as number | null,
  currentTurnStartedAt: null as number | null,
  currentTurnIndex: null as number | null,
  currentIteration: 0,
  toolCallStarts: new Map<string, number>(),
};

// Cached constructor
let DatabaseCtor: BetterSqlite3Constructor | null = null;

// Helper: Load better-sqlite3 dynamically (caches constructor on first successful import)
async function loadBetterSqlite3(): Promise<BetterSqlite3Constructor> {
  if (DatabaseCtor) return DatabaseCtor;
  if (!moduleAvailable) throw new Error(moduleError || "better-sqlite3 not available");

  try {
    const mod = await import("better-sqlite3");
    DatabaseCtor = mod.default as BetterSqlite3Constructor;
    return DatabaseCtor;
  } catch {
    moduleAvailable = false;
    moduleError = `better-sqlite3 not installed. Run: cd pi/extensions/${EXT_NAME} && npm install`;
    throw new Error(moduleError);
  }
}

// Helper: Initialize database
async function initDatabase(): Promise<void> {
  if (db) return;

  const Database = await loadBetterSqlite3();

  const piDir = join(homedir(), DB_DIR);
  if (!existsSync(piDir)) {
    mkdirSync(piDir, { recursive: true });
  }

  const dbPath = join(piDir, DB_FILENAME);
  db = new Database(dbPath);

  // Enable WAL mode for better concurrent read performance
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  // Ensure schema exists (idempotent via IF NOT EXISTS)
  db.exec(SCHEMA);

  // Write datasette metadata alongside the database
  try {
    writeFileSync(join(piDir, METADATA_FILENAME), DATASETTE_METADATA);
  } catch (e) {
    console.error(LOG_PREFIX, "failed to write datasette metadata:", e);
  }
}

// Helper: Safe database operation (returns result or null on error)
function safeRun(
  sql: string,
  params: unknown[] = [],
): { changes: number; lastInsertRowid: number | bigint } | null {
  if (!db) return null;

  try {
    return db.prepare(sql).run(...params);
  } catch (e) {
    console.error(LOG_PREFIX, "SQL error:", e);
    return null;
  }
}

// Helper: Extract text content from content array (messages, tool results)
function extractTextContent(
  content: ReadonlyArray<{ type: string; [k: string]: unknown }>,
): string {
  const texts: string[] = [];

  for (const item of content) {
    if (item.type === "text" && typeof item.text === "string") {
      texts.push(item.text);
    }
  }

  let result = texts.join("\n");

  if (result.length > MAX_RESULT_SIZE) {
    result = result.substring(0, MAX_RESULT_SIZE) + "\n" + TRUNCATION_SUFFIX;
  }

  return result;
}

// Helper: Truncate string to MAX_RESULT_SIZE
function truncate(text: string): string {
  if (text.length > MAX_RESULT_SIZE) {
    return text.substring(0, MAX_RESULT_SIZE) + TRUNCATION_SUFFIX;
  }
  return text;
}

export default function recorderExtension(pi: ExtensionAPI) {
  // Session start: initialize database and record session
  pi.on("session_start", async (_event, ctx: ExtensionContext) => {
    try {
      await initDatabase();

      state.sessionId = ctx.sessionManager.getSessionId();
      state.currentTurnId = null;
      state.currentTurnIndex = null;
      state.currentIteration = 0;
      state.toolCallStarts.clear();

      const sessionFile = ctx.sessionManager.getSessionFile();
      const modelProvider = ctx.model?.provider ?? null;
      const modelId = ctx.model?.id ?? null;

      safeRun(
        `INSERT INTO sessions (id, session_file, cwd, started_at, model_provider, model_id)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           session_file = excluded.session_file,
           model_provider = excluded.model_provider,
           model_id = excluded.model_id`,
        [state.sessionId, sessionFile, ctx.cwd, Date.now(), modelProvider, modelId],
      );

      if (ctx.hasUI) {
        ctx.ui.setStatus(EXT_NAME, ctx.ui.theme.fg("success", `${EXT_NAME} ✓`));
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(LOG_PREFIX, "session_start error:", msg);
      if (ctx.hasUI) {
        ctx.ui.setStatus(EXT_NAME, ctx.ui.theme.fg("error", `${EXT_NAME} ✗`));
        if (msg.includes("better-sqlite3")) {
          ctx.ui.notify(`${EXT_NAME}: ${msg}`, "error");
        }
      }
    }
  });

  // Input: record user message
  pi.on("input", async (event: InputEvent) => {
    if (!db || !state.sessionId) return;

    const content = truncate(event.text);

    safeRun(
      `INSERT INTO messages (session_id, role, content, timestamp)
       VALUES (?, ?, ?, ?)`,
      [state.sessionId, "user", content, Date.now()],
    );
  });

  // Session shutdown: finalize and close
  pi.on("session_shutdown", async () => {
    if (!db || !state.sessionId) return;

    try {
      safeRun(
        `UPDATE sessions SET ended_at = ? WHERE id = ?`,
        [Date.now(), state.sessionId],
      );
    } catch (e) {
      console.error(LOG_PREFIX, "session_shutdown error:", e);
    } finally {
      state.toolCallStarts.clear();
      state.sessionId = null;
      if (db) {
        try {
          db.close();
        } catch (e) {
          console.error(LOG_PREFIX, "db.close() error:", e);
        }
        db = null;
      }
    }
  });

  // Turn start: record turn beginning
  pi.on("turn_start", async (event: TurnStartEvent) => {
    if (!db || !state.sessionId) return;

    try {
      state.currentTurnStartedAt = Date.now();

      // Track iteration number within this conversational turn
      // When turn_index changes, reset iteration counter
      if (state.currentTurnIndex !== event.turnIndex) {
        state.currentTurnIndex = event.turnIndex;
        state.currentIteration = 0;
      } else {
        state.currentIteration++;
      }

      // Use INSERT with RETURNING to get the turn ID in a single query
      // Each iteration gets its own row with unique (session_id, turn_index, iteration_number)
      const turnRow = db.prepare(
        `INSERT INTO turns (session_id, turn_index, iteration_number, started_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(session_id, turn_index, iteration_number) DO UPDATE SET
           started_at = excluded.started_at,
           ended_at = NULL,
           duration_ms = NULL,
           model_provider = NULL,
           model_id = NULL,
           input_tokens = 0,
           output_tokens = 0,
           cost = 0,
           stop_reason = NULL
         RETURNING id`
      ).get(state.sessionId, event.turnIndex, state.currentIteration, state.currentTurnStartedAt) as { id: number } | undefined;

      state.currentTurnId = turnRow ? turnRow.id : null;
    } catch (e) {
      console.error(LOG_PREFIX, "turn_start error:", e);
    }
  });

  // Turn end: record turn completion
  pi.on("turn_end", async (event: TurnEndEvent) => {
    if (!db || !state.sessionId || !state.currentTurnId) return;

    try {
      const endedAt = Date.now();
      const durationMs = state.currentTurnStartedAt !== null
        ? endedAt - state.currentTurnStartedAt
        : null;

      const msg = event.message as Record<string, unknown>;

      // Only extract usage/content from assistant messages
      let inputTokens = 0;
      let outputTokens = 0;
      let cost = 0;
      let provider: string | null = null;
      let model: string | null = null;
      let stopReason: string | null = null;
      let assistantText: string | null = null;

      if (msg.role === "assistant") {
        const usage = msg.usage as {
          input: number;
          output: number;
          cost: { total: number };
        } | undefined;

        inputTokens = usage?.input ?? 0;
        outputTokens = usage?.output ?? 0;
        cost = usage?.cost?.total ?? 0;
        provider = (msg.provider as string) ?? null;
        model = (msg.model as string) ?? null;
        stopReason = (msg.stopReason as string) ?? null;

        const content = msg.content as ReadonlyArray<{ type: string; [k: string]: unknown }> | undefined;
        if (content) {
          assistantText = extractTextContent(content);
        }
      }

      // Atomic: update turn, accumulate session totals, and insert message
      const commitTurn = db.transaction(() => {
        db!.prepare(
          `UPDATE turns SET
             ended_at = ?, duration_ms = ?,
             model_provider = ?, model_id = ?,
             input_tokens = ?, output_tokens = ?, cost = ?,
             stop_reason = ?
           WHERE id = ?`,
        ).run(
          endedAt, durationMs,
          provider, model,
          inputTokens, outputTokens, cost,
          stopReason,
          state.currentTurnId,
        );

        db!.prepare(
          `UPDATE sessions SET
             total_input_tokens = total_input_tokens + ?,
             total_output_tokens = total_output_tokens + ?,
             total_cost = total_cost + ?
           WHERE id = ?`,
        ).run(inputTokens, outputTokens, cost, state.sessionId);

        if (assistantText) {
          db!.prepare(
            `INSERT INTO messages (session_id, role, content, turn_id, timestamp)
             VALUES (?, ?, ?, ?, ?)`,
          ).run(state.sessionId, "assistant", assistantText, state.currentTurnId, endedAt);
        }
      });
      commitTurn();
    } catch (e) {
      console.error(LOG_PREFIX, "turn_end error:", e);
    }
  });

  // Tool call: record tool invocation start
  pi.on("tool_call", async (event: ToolCallEvent) => {
    if (!db || !state.sessionId) return;

    try {
      const startedAt = Date.now();
      state.toolCallStarts.set(event.toolCallId, startedAt);

      let inputJson = JSON.stringify(event.input);
      if (inputJson.length > MAX_RESULT_SIZE) {
        inputJson = inputJson.substring(0, MAX_RESULT_SIZE) + TRUNCATION_SUFFIX;
      }

      safeRun(
        `INSERT INTO tool_calls (id, session_id, turn_id, tool_name, input_json, started_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          event.toolCallId,
          state.sessionId,
          state.currentTurnId,
          event.toolName,
          inputJson,
          startedAt,
        ],
      );
    } catch (e) {
      console.error(LOG_PREFIX, "tool_call error:", e);
    }
  });

  // Tool result: record tool completion
  pi.on("tool_result", async (event: ToolResultEvent) => {
    if (!db || !state.sessionId) return;

    try {
      const endedAt = Date.now();
      const startedAt = state.toolCallStarts.get(event.toolCallId) ?? endedAt;
      const durationMs = endedAt - startedAt;

      state.toolCallStarts.delete(event.toolCallId);

      const resultText = extractTextContent(
        event.content as ReadonlyArray<{ type: string; [k: string]: unknown }>,
      );

      safeRun(
        `UPDATE tool_calls SET
           ended_at = ?, duration_ms = ?, is_error = ?, result_text = ?
         WHERE id = ?`,
        [endedAt, durationMs, event.isError ? 1 : 0, resultText, event.toolCallId],
      );
    } catch (e) {
      console.error(LOG_PREFIX, "tool_result error:", e);
    }
  });

  // Model select: record model changes
  pi.on("model_select", async (event: ModelSelectEvent) => {
    if (!db || !state.sessionId) return;

    try {
      safeRun(
        `INSERT INTO model_changes (session_id, timestamp, source, from_provider, from_model_id, to_provider, to_model_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          state.sessionId,
          Date.now(),
          event.source,
          event.previousModel?.provider ?? null,
          event.previousModel?.id ?? null,
          event.model.provider,
          event.model.id,
        ],
      );
    } catch (e) {
      console.error(LOG_PREFIX, "model_select error:", e);
    }
  });
}
