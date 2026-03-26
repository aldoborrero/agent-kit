# fresh-reads

Prevents stale file edits by tracking file mtimes. If a file was modified externally since the agent last read it, the edit is blocked and a re-read is triggered.

## Commands

| Command | Description |
|---------|-------------|
| `/fresh-read-status` | Show tracked files and their read age |
| `/fresh-read-clear` | Clear all file tracking |

## How it works

- On `tool_result` for `read`: records file path and mtime
- On `tool_call` for `edit`/`write`: checks if mtime changed since last read
- If stale: blocks the edit, notifies user, triggers auto re-read
- Handles edge cases: new files, re-read loops, concurrent edit locks

## Configuration

Optional config at `~/.pi/agent/extensions/fresh-read.config.json`:

```json
{
  "enabled": true,
  "autoReread": true,
  "protectedPaths": [],
  "ignoredPaths": ["**/node_modules/**", "**/.git/**"]
}
```

## Attribution

Based on [ktappdev/fresh-reads](https://github.com/ktappdev/fresh-reads).
