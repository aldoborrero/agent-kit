# plan-mode

Read-only exploration mode for safe code analysis. Forces the agent to plan before acting, then tracks execution progress.

## Commands

| Command | Description |
|---------|-------------|
| `/plan` | Toggle plan mode |
| `/todos` | Show current plan progress |
| `Ctrl+Alt+P` | Toggle plan mode (shortcut) |

## Flags

| Flag | Description |
|------|-------------|
| `--plan` | Start in plan mode |

## How it works

1. Enable plan mode with `/plan` — only read-only tools are available
2. Agent analyzes code and creates a numbered plan under a `Plan:` header
3. Choose "Execute the plan" when prompted — full tools restored
4. Agent marks steps complete with `[DONE:n]` tags
5. Progress widget shows completion status

## Plan mode restrictions

- Tools: `read`, `bash`, `grep`, `find`, `ls`, `questionnaire`
- Bash: filtered through allowlist (blocks rm, mv, git commit, npm install, etc.)
- Agent cannot modify any files

## Attribution

Based on [pi-mono example extension](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/examples/extensions/plan-mode/).
