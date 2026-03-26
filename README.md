# Agent Kit

A collection of skills and extensions for AI coding agents, compatible with [pi-coding-agent](https://github.com/badlogic/pi-mono) and [Claude Code](https://claude.com/claude-code).

## Installation

```bash
# Install from git
pi install git:github.com/aldoborrero/agent-kit

# Or from local clone
pi install ./agent-kit

# Test a single extension
pi -e ./pi/extensions/notify/notify.ts
```

## Repository Structure

```
agent-kit/
├── skills/           # Markdown skills (Claude Code + pi-coding-agent)
│   ├── ast-grep/     # AST-based structural code search
│   ├── kagi-search/  # Privacy-focused search
│   ├── pexpect-cli/  # Interactive CLI automation
│   └── superpowers/  # 13 advanced workflow skills
├── pi/
│   ├── agents/       # Agent definitions (6 agents)
│   ├── extensions/   # TypeScript extensions (24 local + 3 npm)
│   └── prompts/      # Workflow templates (4 prompts)
└── packages/         # Nix packages (pexpect-cli)
```

## Pi Extensions

TypeScript extensions for [pi-coding-agent](https://github.com/badlogic/pi-mono). 24 local extensions + 3 external npm packages.

### Code Intelligence

| Extension | Description |
|-----------|-------------|
| [`ast-grep`](pi/extensions/ast-grep/README.md) | Structural code search using AST patterns with pattern, rule, and inspect modes |
| [`pi-lsp-extension`](https://github.com/samfoy/pi-lsp-extension) | LSP integration — diagnostics, hover, go-to-definition, references, symbols, rename, completions |
| [`fresh-reads`](pi/extensions/fresh-reads/README.md) | Blocks stale edits — if a file changed externally since last read, forces re-read first |

### Safety & Guardrails

| Extension | Description |
|-----------|-------------|
| [`sandbox`](pi/extensions/sandbox/README.md) | OS-level sandboxing for bash — filesystem and network restrictions via bubblewrap/sandbox-exec |
| [`permission-gate`](pi/extensions/permission-gate/README.md) | Confirms before dangerous bash commands (rm -rf, git push --force, sudo, etc.) |
| [`git-checkpoint`](pi/extensions/git-checkpoint/README.md) | Git stash checkpoints at each turn so `/fork` can restore code state |

### Session & Context Management

| Extension | Description |
|-----------|-------------|
| [`context`](pi/extensions/context/README.md) | `/context` TUI dashboard — token usage bar, loaded extensions/skills, session cost |
| [`handoff`](pi/extensions/handoff/README.md) | Transfer context to a new focused session — generates a self-contained prompt |
| [`recorder`](pi/extensions/recorder/README.md) | Record all session activity to SQLite for performance tracking and analytics |

### Workflow & Automation

| Extension | Description |
|-----------|-------------|
| [`plan-mode`](pi/extensions/plan-mode/README.md) | Read-only exploration mode — forces planning before execution with progress tracking |
| [`cron`](pi/extensions/cron/README.md) | `/cron 5m <prompt>` — periodic polling and monitoring on a schedule |
| [`loop`](pi/extensions/loop/README.md) | `/loop` — repeat until tests pass, custom condition, or agent decides done |
| [`subagent`](pi/extensions/subagent/README.md) | Delegate tasks to specialized subagents with isolated context (single, parallel, chain) |
| [`pi-interactive-shell`](https://github.com/nicobailon/pi-interactive-shell) | Full PTY emulation for interactive CLIs — user can observe and take over anytime |

### Search & Web

| Extension | Description |
|-----------|-------------|
| [`github-search`](pi/extensions/github-search/README.md) | Search code across GitHub repositories via the `gh` CLI |
| [`jina`](pi/extensions/jina/README.md) | Fetch webpages and return clean markdown via Jina AI's Reader API |

### Environment & Integration

| Extension | Description |
|-----------|-------------|
| [`direnv`](pi/extensions/direnv/README.md) | Auto-load direnv environment variables on session start and after bash commands |
| [`pi-mcp-adapter`](https://github.com/nicobailon/pi-mcp-adapter) | Token-efficient MCP (Model Context Protocol) adapter — use any MCP server from pi |
| [`together-provider`](pi/extensions/together-provider/README.md) | Together AI model provider with 25+ open-source models (Llama, DeepSeek, Qwen, etc.) |

### Input & Voice

| Extension | Description |
|-----------|-------------|
| [`voice`](pi/extensions/voice/README.md) | Toggle-to-record speech-to-text — Groq, OpenAI, or local Whisper daemon. `Ctrl+Alt+V` or `/voice` |
| [`inline-bash`](pi/extensions/inline-bash/README.md) | Expand `!{command}` patterns in prompts — e.g. `The branch is !{git branch --show-current}` |
| [`questionnaire`](pi/extensions/questionnaire/README.md) | Structured multi-question UI with options and free-text input |

### UI & Commands

| Extension | Description |
|-----------|-------------|
| [`notify`](pi/extensions/notify/README.md) | Desktop notifications when the agent finishes (Ghostty, iTerm2, Kitty, WezTerm, WSL) |
| [`footer`](pi/extensions/footer/README.md) | Custom footer with git branch, context usage, and extension statuses |
| [`exit`](pi/extensions/exit/exit.ts) | `/exit` command — alias for `/quit` |
| [`git-commit-context`](pi/extensions/git-commit-context/README.md) | `/commit` command with git status/log context injection |

## Skills

Markdown-based instructions that teach AI agents how to use external tools. Compatible with both Claude Code and pi-coding-agent via the [Agent Skills](https://agentskills.io) standard.

### Tool Skills

| Skill | Description |
|-------|-------------|
| [`/ast-grep`](skills/ast-grep/SKILL.md) | Structural code search using AST patterns — find code by structure, not text |
| [`/pexpect-cli`](skills/pexpect-cli/SKILL.md) | Automate interactive CLI programs (SSH, databases, editors) with pexpect and pueue |
| [`/kagi-search`](skills/kagi-search/SKILL.md) | Privacy-focused web search via Kagi with Quick Answer support |

### Superpowers Skills

| Skill | Description |
|-------|-------------|
| [`/superpowers-brainstorming`](skills/superpowers/brainstorming/SKILL.md) | Explore intent, requirements, and design before implementation |
| [`/superpowers-writing-plans`](skills/superpowers/writing-plans/SKILL.md) | Create detailed implementation plans with bite-sized tasks |
| [`/superpowers-executing-plans`](skills/superpowers/executing-plans/SKILL.md) | Execute plans task-by-task with review checkpoints |
| [`/superpowers-subagent-driven-development`](skills/superpowers/subagent-driven-development/SKILL.md) | Execute plans by delegating independent tasks to subagents |
| [`/superpowers-dispatching-parallel-agents`](skills/superpowers/dispatching-parallel-agents/SKILL.md) | Run 2+ independent tasks in parallel without shared state |
| [`/superpowers-test-driven-development`](skills/superpowers/test-driven-development/SKILL.md) | Write tests before implementation code |
| [`/superpowers-systematic-debugging`](skills/superpowers/systematic-debugging/SKILL.md) | Structured debugging with root cause analysis |
| [`/superpowers-verification-before-completion`](skills/superpowers/verification-before-completion/SKILL.md) | Run verification commands before claiming work is complete |
| [`/superpowers-requesting-code-review`](skills/superpowers/requesting-code-review/SKILL.md) | Request formal code review before merging |
| [`/superpowers-receiving-code-review`](skills/superpowers/receiving-code-review/SKILL.md) | Process code review feedback with technical rigor |
| [`/superpowers-using-git-worktrees`](skills/superpowers/using-git-worktrees/SKILL.md) | Create isolated git worktrees for feature work |
| [`/superpowers-finishing-a-development-branch`](skills/superpowers/finishing-a-development-branch/SKILL.md) | Guide completion of development work (merge, PR, or cleanup) |
| [`/superpowers-writing-skills`](skills/superpowers/writing-skills/SKILL.md) | Create, edit, or verify skills before deployment |

## Agents

Agent definitions for pi-coding-agent. Each agent is a lean system prompt that loads skills at runtime.

| Agent | Description |
|-------|-------------|
| [`brainstormer`](pi/agents/brainstormer.md) | Collaborative design dialogue — explores ideas before implementation |
| [`debugger`](pi/agents/debugger.md) | Systematic debugging specialist with root cause analysis |
| [`planner`](pi/agents/planner.md) | Creates bite-sized implementation plans from context and requirements |
| [`reviewer`](pi/agents/reviewer.md) | Code review for quality, security, and maintainability |
| [`scout`](pi/agents/scout.md) | Fast codebase reconnaissance that returns compressed context for handoff |
| [`worker`](pi/agents/worker.md) | General-purpose implementation with TDD, verification, and debugging |

## Prompts

Workflow templates that orchestrate agents into chains via the subagent extension.

| Prompt | Description |
|--------|-------------|
| [`/brainstorm`](pi/prompts/brainstorm.md) | Collaborative design dialogue |
| [`/debug`](pi/prompts/debug.md) | Systematic debugging — scout gathers context, debugger investigates |
| [`/full-cycle`](pi/prompts/full-cycle.md) | Full lifecycle — scout → planner → worker → reviewer → worker |
| [`/review`](pi/prompts/review.md) | Standalone code review of recent changes or specified files |

## Packages

| Package | Description |
|---------|-------------|
| [`pexpect-cli`](packages/pexpect-cli/README.md) | Persistent pexpect sessions via pueue — server/client CLI for interactive automation |

## Development

```bash
nix develop          # Enter dev shell
nix fmt              # Format code
nix build .#pexpect-cli  # Build packages
```

## License

[MIT](LICENSE)
