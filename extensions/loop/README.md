# cron

Periodic polling and monitoring during a session. Mirrors Claude Code's `CronCreate`/`CronList`/`CronDelete` pattern using real cron expressions via [croner](https://github.com/Hexagon/croner).

## Commands

| Command | Description |
|---------|-------------|
| `/cron [interval] <prompt>` | Schedule a recurring prompt (executes immediately + on schedule) |
| `/cron-list` | List all scheduled tasks |
| `/cron-delete <id>` | Cancel a task by ID |

## Usage

```
/cron 5m check if the deployment finished
/cron 2h run the integration tests
/cron check deploy every 30m
/cron check the build                    (defaults to 10m)
```

## Interval syntax

| Unit | Examples | Cron expression |
|------|---------|-----------------|
| Seconds | `30s` | Rounded up to nearest minute (`*/1 * * * *`) |
| Minutes | `5m` | `*/5 * * * *` |
| Hours | `2h` | `7 */2 * * *` (off-minute to avoid thundering herd) |
| Days | `1d` | `0 0 */1 * *` |

Intervals that don't divide their unit evenly are rounded to the nearest clean value (e.g., `7m` → `6m`, `90m` → `2h`). The extension tells you when it rounds.

## Behavior

- **Executes immediately** on `/cron` — doesn't wait for first cron fire
- Tasks fire **between turns** — never interrupts the agent mid-response
- One task fires at a time per check cycle
- **Deterministic jitter**: tasks fire up to 10% of period late (max 15 min). Avoids thundering herd on `:00` and `:30`.
- Tasks auto-expire after **7 days**
- Max **50 tasks** per session
- Session-scoped — cleared on exit
- Footer shows `● N cron` when tasks are active

## Dependencies

- `croner` (cron expression parser/scheduler)

## How it differs from `/loop` (mitsuhiko)

| | `/cron` (this) | `/loop` (mitsuhiko) |
|---|---|---|
| Purpose | Periodic monitoring | Iterate until condition met |
| Timing | Every N minutes (cron) | After every agent turn |
| Stops when | Expiry, manual delete, session end | `signal_loop_success` |
| Use case | "Check deploy every 5m" | "Run tests until they pass" |
