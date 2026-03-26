# multi-edit

Replaces the built-in `edit` tool with a version supporting batch edits across multiple files in a single tool call. Includes preflight validation on a virtual filesystem before touching real files.

## Tools

| Tool | Description |
|------|-------------|
| `edit` (override) | Edit with `multi` array and `patch` support |

## Features

- **Multi mode**: Array of `{path, oldText, newText}` edits applied atomically
- **Patch mode**: Codex-style `apply_patch` payloads (Add/Delete/Update File operations)
- **Preflight**: All edits validated on a virtual filesystem before mutating real files
- **Positional ordering**: Same-file edits sorted by position, forward cursor prevents conflicts
- **Redundant edit dedup**: Gracefully skips duplicate replacements
- **Fuzzy matching**: Handles whitespace and unicode variations in patch mode

## Dependencies

- `diff` npm package

## Attribution

Based on [mitsuhiko/agent-stuff](https://github.com/mitsuhiko/agent-stuff/blob/main/pi-extensions/multi-edit.ts) by Armin Ronacher.
