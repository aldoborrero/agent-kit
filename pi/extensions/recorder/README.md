# recorder

Records all session activity to a SQLite database for performance tracking and analytics. Uses [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) for direct file-backed storage.

## Database

**Location**: `~/.pi/agent/recorder.db`

Query directly with:
```bash
sqlite3 ~/.pi/agent/recorder.db "SELECT * FROM v_session_summary LIMIT 10"
```

Or use [Datasette](https://datasette.io) with the auto-generated metadata:
```bash
datasette ~/.pi/agent/recorder.db --metadata ~/.pi/agent/recorder-metadata.yml
```

## Schema

### Tables

| Table | Description |
|-------|-------------|
| `sessions` | One row per session with aggregated token counts and cost |
| `turns` | One row per LLM response iteration within a turn |
| `tool_calls` | One row per tool invocation with timing and error tracking |
| `messages` | User and assistant messages |
| `model_changes` | Records when the model was changed during a session |

### Views

| View | Description |
|------|-------------|
| `v_session_summary` | Enriched session view with human-readable timestamps, duration, and counts |
| `v_tool_stats` | Aggregated tool statistics: call count, error rate, duration min/avg/max |
| `v_daily_cost` | Daily cost and token aggregation across sessions |

## Events Tracked

| Event | What's Recorded |
|-------|-----------------|
| `session_start` | Session ID, working directory, initial model |
| `session_shutdown` | Session end timestamp |
| `input` | User messages |
| `turn_start` / `turn_end` | Turn timing, tokens, cost, model, stop reason |
| `tool_call` / `tool_result` | Tool name, input, duration, error status, result |
| `model_select` | Model changes with source (set/cycle/restore) |

## Useful Queries

Recent sessions with cost:
```sql
SELECT * FROM v_session_summary LIMIT 20;
```

Tool usage stats:
```sql
SELECT * FROM v_tool_stats;
```

Daily cost breakdown:
```sql
SELECT * FROM v_daily_cost;
```

Slowest tool calls:
```sql
SELECT tool_name, duration_ms, is_error
FROM tool_calls
WHERE duration_ms IS NOT NULL
ORDER BY duration_ms DESC
LIMIT 20;
```

## Requirements

- [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) npm package installed
