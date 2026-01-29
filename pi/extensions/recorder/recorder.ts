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
import { existsSync, mkdirSync } from "node:fs";

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
}

type BetterSqlite3Constructor = new (
  filename: string,
  options?: Record<string, unknown>,
) => BetterSqlite3Database;

// Max result size to store (50KB)
const MAX_RESULT_SIZE = 50 * 1024;

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
    started_at INTEGER NOT NULL,
    ended_at INTEGER,
    duration_ms INTEGER,
    model_provider TEXT,
    model_id TEXT,
    input_tokens INTEGER DEFAULT 0,
    output_tokens INTEGER DEFAULT 0,
    cost REAL DEFAULT 0,
    stop_reason TEXT,
    UNIQUE(session_id, turn_index),
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
`;

// State
let db: BetterSqlite3Database | null = null;
let moduleAvailable = true;
let moduleError: string | null = null;

let state = {
  sessionId: null as string | null,
  currentTurnId: null as number | null,
  currentTurnStartedAt: null as number | null,
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
    moduleError = "better-sqlite3 not installed. Run: cd pi/extensions/recorder && npm install";
    throw new Error(moduleError);
  }
}

// Helper: Initialize database
async function initDatabase(): Promise<void> {
  if (db) return;

  const Database = await loadBetterSqlite3();

  const piDir = join(homedir(), ".pi", "agent");
  if (!existsSync(piDir)) {
    mkdirSync(piDir, { recursive: true });
  }

  const dbPath = join(piDir, "recorder.db");
  db = new Database(dbPath);

  // Enable WAL mode for better concurrent read performance
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  // Ensure schema exists (idempotent via IF NOT EXISTS)
  db.exec(SCHEMA);
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
    console.error("[recorder] SQL error:", e);
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
    result = result.substring(0, MAX_RESULT_SIZE) + "\n... [truncated at 50KB]";
  }

  return result;
}

// Helper: Truncate string to MAX_RESULT_SIZE
function truncate(text: string): string {
  if (text.length > MAX_RESULT_SIZE) {
    return text.substring(0, MAX_RESULT_SIZE) + "... [truncated at 50KB]";
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
        ctx.ui.setStatus("recorder", ctx.ui.theme.fg("success", "recorder ✓"));
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[recorder] session_start error:", msg);
      if (ctx.hasUI) {
        ctx.ui.setStatus("recorder", ctx.ui.theme.fg("error", "recorder ✗"));
        if (msg.includes("better-sqlite3")) {
          ctx.ui.notify("Recorder: " + msg, "error");
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
      console.error("[recorder] session_shutdown error:", e);
    } finally {
      state.toolCallStarts.clear();
      state.sessionId = null;
      if (db) {
        try {
          db.close();
        } catch (e) {
          console.error("[recorder] db.close() error:", e);
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

      const result = safeRun(
        `INSERT INTO turns (session_id, turn_index, started_at)
         VALUES (?, ?, ?)`,
        [state.sessionId, event.turnIndex, state.currentTurnStartedAt],
      );

      state.currentTurnId = result ? Number(result.lastInsertRowid) : null;
    } catch (e) {
      console.error("[recorder] turn_start error:", e);
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
      console.error("[recorder] turn_end error:", e);
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
        inputJson = inputJson.substring(0, MAX_RESULT_SIZE) + "... [truncated at 50KB]";
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
      console.error("[recorder] tool_call error:", e);
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
      console.error("[recorder] tool_result error:", e);
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
      console.error("[recorder] model_select error:", e);
    }
  });
}
