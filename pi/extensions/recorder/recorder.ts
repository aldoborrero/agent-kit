/**
 * Recorder Extension
 *
 * Records all session activity to SQLite for recorder, performance tracking,
 * and analytics. Uses sql.js (pure JavaScript SQLite) for portability.
 *
 * Database location: ~/.pi/agent/recorder.db
 *
 * Query with: sqlite3 ~/.pi/agent/recorder.db "SELECT * FROM sessions"
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
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import type { Database as SqlJsDatabase, SqlJsStatic, SqlValue } from "sql.js";

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

// Max result size to store (50KB)
const MAX_RESULT_SIZE = 50 * 1024;

// Schema
const SCHEMA = `
PRAGMA foreign_keys = ON;

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
let db: SqlJsDatabase | null = null;
let SQL: SqlJsStatic | null = null;
let dbPath: string = "";

let state = {
  sessionId: null as string | null,
  currentTurnId: null as number | null,
  currentTurnStartedAt: 0,
  toolCallStarts: new Map<string, number>(),
};

// Track if sql.js is available
let sqlJsAvailable = true;
let sqlJsError: string | null = null;

// Helper: Load sql.js dynamically
async function loadSqlJs(): Promise<SqlJsStatic> {
  if (SQL) return SQL;
  if (!sqlJsAvailable) throw new Error(sqlJsError || "sql.js not available");

  try {
    // Import sql.js and initialize with WASM
    const initSqlJs = (await import("sql.js")).default;
    SQL = await initSqlJs({});
    return SQL;
  } catch (e) {
    sqlJsAvailable = false;
    sqlJsError = `sql.js not installed. Run: cd pi/extensions/recorder && npm install`;
    throw new Error(sqlJsError);
  }
}

// Helper: Initialize database
async function initDatabase(): Promise<void> {
  if (db) return;

  const sqljs = await loadSqlJs();

  const piDir = join(homedir(), ".pi", "agent");
  if (!existsSync(piDir)) {
    mkdirSync(piDir, { recursive: true });
  }

  dbPath = join(piDir, "recorder.db");

  // Load existing database or create new
  if (existsSync(dbPath)) {
    const data = readFileSync(dbPath);
    db = new sqljs.Database(data);
  } else {
    db = new sqljs.Database();
  }

  // Ensure schema exists
  db.exec(SCHEMA);
  persistDatabase();
}

// Helper: Persist database to disk
function persistDatabase(): void {
  if (!db || !dbPath) return;

  try {
    const data = db.export();
    writeFileSync(dbPath, Buffer.from(data));
  } catch (e) {
    console.error("[recorder] Failed to persist database:", e);
  }
}

// Helper: Safe database operation
function safeRun(sql: string, params: SqlValue[] = []): void {
  if (!db) return;

  try {
    db.run(sql, params);
  } catch (e) {
    console.error("[recorder] SQL error:", e);
  }
}

// Helper: Extract text content from content array (messages, tool results)
function extractTextContent(content: Array<{ type: string; text?: string }>): string {
  const texts: string[] = [];

  for (const item of content) {
    if (item.type === "text" && item.text) {
      texts.push(item.text);
    }
  }

  let result = texts.join("\n");

  if (result.length > MAX_RESULT_SIZE) {
    result = result.substring(0, MAX_RESULT_SIZE) + "\n... [truncated at 50KB]";
  }

  return result;
}

// Helper: Get last insert rowid
function getLastInsertId(): number | null {
  if (!db) return null;
  try {
    const result = db.exec("SELECT last_insert_rowid()");
    if (result.length > 0 && result[0].values.length > 0) {
      return result[0].values[0][0] as number;
    }
  } catch {
    // ignore
  }
  return null;
}

export default function (pi: ExtensionAPI) {
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
        `INSERT OR REPLACE INTO sessions (id, session_file, cwd, started_at, model_provider, model_id)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [state.sessionId, sessionFile, ctx.cwd, Date.now(), modelProvider, modelId]
      );

      persistDatabase();

      if (ctx.hasUI) {
        ctx.ui.setStatus("recorder", ctx.ui.theme.fg("success", "recorder ✓"));
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[recorder] session_start error:", msg);
      if (ctx.hasUI) {
        // Show error status with tooltip hint
        ctx.ui.setStatus("recorder", ctx.ui.theme.fg("error", "recorder ✗"));
        if (msg.includes("sql.js")) {
          ctx.ui.notify("Recorder: " + msg, "error");
        }
      }
    }
  });

  // Input: record user message
  pi.on("input", async (event: InputEvent) => {
    if (!db || !state.sessionId) return;

    try {
      let content = event.text;
      if (content.length > MAX_RESULT_SIZE) {
        content = content.substring(0, MAX_RESULT_SIZE) + "\n... [truncated at 50KB]";
      }

      safeRun(
        `INSERT INTO messages (session_id, role, content, timestamp)
         VALUES (?, ?, ?, ?)`,
        [state.sessionId, "user", content, Date.now()]
      );

      persistDatabase();
    } catch (e) {
      console.error("[recorder] input error:", e);
    }
  });

  // Session shutdown: finalize totals and persist
  pi.on("session_shutdown", async () => {
    if (!db || !state.sessionId) return;

    try {
      // Update session with end time (totals are already accumulated)
      safeRun(
        `UPDATE sessions SET ended_at = ? WHERE id = ?`,
        [Date.now(), state.sessionId]
      );

      persistDatabase();

      // Cleanup
      db.close();
      db = null;
      state.sessionId = null;
    } catch (e) {
      console.error("[recorder] session_shutdown error:", e);
    }
  });

  // Turn start: record turn beginning
  pi.on("turn_start", async (event: TurnStartEvent) => {
    if (!db || !state.sessionId) return;

    try {
      state.currentTurnStartedAt = event.timestamp;

      safeRun(
        `INSERT INTO turns (session_id, turn_index, started_at)
         VALUES (?, ?, ?)`,
        [state.sessionId, event.turnIndex, event.timestamp]
      );

      state.currentTurnId = getLastInsertId();
    } catch (e) {
      console.error("[recorder] turn_start error:", e);
    }
  });

  // Turn end: record turn recorder
  pi.on("turn_end", async (event: TurnEndEvent) => {
    if (!db || !state.sessionId || !state.currentTurnId) return;

    try {
      const endedAt = Date.now();
      const durationMs = endedAt - state.currentTurnStartedAt;

      // Extract usage from assistant message
      const msg = event.message as {
        role?: string;
        provider?: string;
        model?: string;
        content?: Array<{ type: string; text?: string }>;
        usage?: { input?: number; output?: number; cost?: { total?: number } };
        stopReason?: string;
      };

      const inputTokens = msg.usage?.input ?? 0;
      const outputTokens = msg.usage?.output ?? 0;
      const cost = msg.usage?.cost?.total ?? 0;

      safeRun(
        `UPDATE turns SET
           ended_at = ?, duration_ms = ?,
           model_provider = ?, model_id = ?,
           input_tokens = ?, output_tokens = ?, cost = ?,
           stop_reason = ?
         WHERE id = ?`,
        [
          endedAt, durationMs,
          msg.provider ?? null, msg.model ?? null,
          inputTokens, outputTokens, cost,
          msg.stopReason ?? null,
          state.currentTurnId
        ]
      );

      // Update session totals
      safeRun(
        `UPDATE sessions SET
           total_input_tokens = total_input_tokens + ?,
           total_output_tokens = total_output_tokens + ?,
           total_cost = total_cost + ?
         WHERE id = ?`,
        [inputTokens, outputTokens, cost, state.sessionId]
      );

      // Record assistant message
      if (msg.content) {
        const assistantText = extractTextContent(msg.content);
        if (assistantText) {
          safeRun(
            `INSERT INTO messages (session_id, role, content, turn_id, timestamp)
             VALUES (?, ?, ?, ?, ?)`,
            [state.sessionId, "assistant", assistantText, state.currentTurnId, endedAt]
          );
        }
      }

      persistDatabase();
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

      safeRun(
        `INSERT INTO tool_calls (id, session_id, turn_id, tool_name, input_json, started_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          event.toolCallId,
          state.sessionId,
          state.currentTurnId,
          event.toolName,
          JSON.stringify(event.input),
          startedAt
        ]
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

      const resultText = extractTextContent(event.content as Array<{ type: string; text?: string }>);

      safeRun(
        `UPDATE tool_calls SET
           ended_at = ?, duration_ms = ?, is_error = ?, result_text = ?
         WHERE id = ?`,
        [endedAt, durationMs, event.isError ? 1 : 0, resultText, event.toolCallId]
      );

      persistDatabase();
    } catch (e) {
      console.error("[recorder] tool_result error:", e);
    }
  });

  // Model select: record model changes
  pi.on("model_select", async (event: ModelSelectEvent, ctx: ExtensionContext) => {
    if (!db || !state.sessionId) return;

    try {
      safeRun(
        `INSERT INTO model_changes (session_id, timestamp, from_provider, from_model_id, to_provider, to_model_id)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          state.sessionId,
          Date.now(),
          event.previousModel?.provider ?? null,
          event.previousModel?.id ?? null,
          event.model.provider,
          event.model.id
        ]
      );

      persistDatabase();
    } catch (e) {
      console.error("[recorder] model_select error:", e);
    }
  });
}
