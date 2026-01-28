# Pi Recorder Extension Design

**Date:** 2026-01-28

## Overview

Pi extension that records all session activity to SQLite for metrics, performance tracking, and analytics.

## Key Decisions

- **sql.js**: Pure JavaScript SQLite, no native dependencies
- **Global database**: `~/.pi/agent/recorder.db` aggregates all sessions
- **Full tool results**: Store complete results up to 50KB
- **Query via SQL CLI**: Use sqlite3 or any SQL client for analysis

## Database Schema

```sql
CREATE TABLE sessions (
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

CREATE TABLE turns (
    id INTEGER PRIMARY KEY,
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
    FOREIGN KEY (session_id) REFERENCES sessions(id)
);

CREATE TABLE tool_calls (
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
    FOREIGN KEY (session_id) REFERENCES sessions(id)
);

CREATE TABLE model_changes (
    id INTEGER PRIMARY KEY,
    session_id TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    from_provider TEXT,
    from_model_id TEXT,
    to_provider TEXT NOT NULL,
    to_model_id TEXT NOT NULL,
    FOREIGN KEY (session_id) REFERENCES sessions(id)
);

CREATE INDEX idx_turns_session ON turns(session_id);
CREATE INDEX idx_tool_calls_session ON tool_calls(session_id);
CREATE INDEX idx_tool_calls_name ON tool_calls(tool_name);
```

## Events Hooked

| Event | Action |
|-------|--------|
| `session_start` | Init db, INSERT session |
| `session_shutdown` | UPDATE session with totals, persist db |
| `turn_start` | INSERT turn with timestamp |
| `turn_end` | UPDATE turn with tokens, cost, duration |
| `tool_call` | INSERT tool_call, track start time |
| `tool_result` | UPDATE tool_call with result, duration |
| `model_select` | INSERT model_changes record |

## File Location

```
pi/extensions/recorder/recorder.ts
```

## Example Queries

```sql
-- Total cost by session
SELECT id, cwd, total_cost,
       datetime(started_at/1000, 'unixepoch') as started
FROM sessions ORDER BY total_cost DESC;

-- Most used tools
SELECT tool_name, COUNT(*) as calls,
       AVG(duration_ms) as avg_ms,
       SUM(is_error) as errors
FROM tool_calls GROUP BY tool_name ORDER BY calls DESC;

-- Slowest tool calls
SELECT tool_name, duration_ms, input_json
FROM tool_calls ORDER BY duration_ms DESC LIMIT 20;

-- Daily token usage
SELECT date(started_at/1000, 'unixepoch') as day,
       SUM(total_input_tokens) as input,
       SUM(total_output_tokens) as output,
       SUM(total_cost) as cost
FROM sessions GROUP BY day ORDER BY day DESC;
```
