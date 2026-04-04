# Agent Guidelines for pi-agent-kit

## Project Overview

pi-agent-kit is a toolkit for AI coding agents providing skills, extensions, themes, and specialized agents for pi-coding-agent and related agent runtimes.

## Directory Structure

```
pi-agent-kit/
├── agents/           # Agent definitions (scout, planner, worker, reviewer, debugger, brainstormer)
├── extensions/       # TypeScript extensions (32 local + 3 external npm packages)
├── prompts/          # Workflow templates (brainstorm, debug, full-cycle, review)
├── skills/           # Markdown-based agent instructions
│   ├── ast-grep/     # AST-based structural code search
│   ├── kagi-search/  # Privacy-focused web search
│   ├── pexpect-cli/  # Interactive CLI automation
│   └── superpowers/  # 13 workflow skills (brainstorming, TDD, debugging, etc.)
├── themes/           # Color themes (lavender)
└── packages/         # Nix packages (pexpect-cli)
```

## Extensions Quick Reference

### Commands

| Command | Extension | Description |
|---------|-----------|-------------|
| `/plan` | plan-mode | Read-only exploration → plan → tracked execution |
| `/until tests` | until | Repeat until condition met (TDD, iterative fixes) |
| `/loop 5m <prompt>` | loop | Periodic polling on a schedule |
| `/diff` | diff | Interactive diff viewer (tuicr/delta/git) |
| `/voice` | voice | Toggle-to-record speech-to-text |
| `/walkie setup` | walkie | Telegram bridge for mobile use |
| `/commit` | git-commit-context | Commit with git status/log context |
| `/context` | context | Token usage dashboard |
| `/handoff <goal>` | handoff | Transfer context to new session |
| `/btw <question>` | btw | Ephemeral side question (no tools, no context pollution) |
| `/exit` | exit | Alias for /quit |
| `/sandbox on/off` | sandbox | Toggle OS-level bash sandboxing |
| `/superpowers:*` | skill-namespaces | Namespaced skill commands |

### Tools (LLM-callable)

| Tool | Extension | Description |
|------|-----------|-------------|
| `ast_grep` | ast-grep | Structural code search via AST patterns |
| `web_search` | web-tools | Preferred high-level web search with structured results and source URLs |
| `web_fetch` | web-tools | Preferred high-level webpage fetcher with markdown output and optional extraction |
| `github_search_code` | github-search | Search code on GitHub |
| `github_search_issues` | github-search | Search GitHub issues |
| `github_search_prs` | github-search | Search GitHub PRs |
| `subagent` | subagent | Delegate tasks to specialized agents |
| `questionnaire` | questionnaire | Ask structured questions |
| `tuicr` | tuicr | Interactive code review with feedback capture |
| `bw_get` / `bw_list` | bitwarden | Secure vault access via rbw |
| `signal_loop_success` | until | Break out of an /until loop |

### Providers

| Provider | Extension | Models |
|----------|-----------|--------|
| Groq | groq-provider | GPT-OSS 120B/20B, Kimi K2, Qwen3 32B, Llama 4 Scout |
| OpenRouter | openrouter-provider | Kimi K2.5, Gemini 3.1/2.5 Pro, Grok 4, Devstral, ByteDance Seed |
| Together AI | together-provider | Llama, DeepSeek, Qwen, Kimi, GLM, Mistral |

### Background/Automatic

| Extension | Description |
|-----------|-------------|
| direnv | Auto-load .envrc environment variables |
| git-checkpoint | Git stash per turn for /fork restore |
| notify | Desktop notification when agent finishes |
| inline-bash | Expand `!{command}` in prompts |
| recorder | Session analytics to SQLite |
| permission-gate | Confirm before dangerous bash commands |
| footer | Git branch, context usage in footer |
| lsp-guidelines | Steer agent toward LSP tools |
| skill-namespaces | Register /superpowers:* commands |

### External (npm)

| Package | Description |
|---------|-------------|
| pi-lsp-extension | LSP integration (diagnostics, hover, definition, references) |
| pi-mcp-adapter | MCP server bridge |
| pi-interactive-shell | Full PTY emulation |

## Key Conventions

### Skills (`skills/`)
- Each skill has a `SKILL.md` file with frontmatter (name, description)
- Frontmatter `name` MUST match the parent directory name (pi validates this)
- Skills under `superpowers/` get `/superpowers:*` namespace commands via skill-namespaces extension
- Compatible with pi-coding-agent and related agent runtimes

### Pi Extensions (`extensions/`)
- TypeScript files that register tools with pi-coding-agent
- Use event hooks (`session_start`, `tool_result`, etc.) for side effects
- Prefer simple solutions over tool replacement
- Prefer high-level web tools (`web_search`, `web_fetch`) over backend-specific tools (`exa_search`, `brave_search`, `jina`) in agent-facing guidance
- Each extension has its own directory with a README.md
- Extensions with npm dependencies have their own `package.json`
- If an extension has multiple `.ts` files, add a `package.json` with `pi.extensions` pointing to the entry file
- npm package extensions go in `node_modules/` and are referenced as `node_modules/<pkg>` in package.json

### Agents (`pi/agents/`)
- Lean markdown system prompts that load skills at runtime
- Scout (haiku) for fast exploration, Planner (opus) for design
- Located at `~/.pi/agent/agents/` when deployed

### Prompts (`pi/prompts/`)
- Workflow templates that orchestrate agent chains via subagent extension
- Define multi-agent pipelines (e.g., scout → planner → worker → reviewer)

## Development

### Nix Environment
```bash
nix develop          # Enter dev shell
nix fmt              # Format code
```

### Testing Extensions
```bash
pi -e ./extensions/example/example.ts
```

### Installing to pi-coding-agent
```bash
pi install git:github.com/aldoborrero/pi-agent-kit
```

## Writing New Components

### New Skill
1. Create `skills/<name>/SKILL.md` with frontmatter
2. Frontmatter `name` must match the directory name
3. Document the tool's CLI interface and usage patterns
4. Include examples the agent can follow

### New Extension
1. Create `extensions/<name>/<name>.ts`
2. Add README.md documenting the extension
3. Register tools via `pi.registerTool()` or use event hooks
4. Add to `package.json` under `pi.extensions`
5. If the extension has npm dependencies, add a `package.json` in the extension directory

### New Agent
1. Create `pi/agents/<name>.md`
2. Keep system prompt lean - load skills at runtime
3. Define the agent's role and methodology

---

## Pi Extension Development

### Tool Execute Signature

**CRITICAL**: The correct parameter order for tool execute functions is:

```typescript
async execute(toolCallId, params, signal, onUpdate, ctx) {
  // toolCallId: string — unique ID for this tool call
  // params: object — parsed parameters from the LLM
  // signal: AbortSignal — for cancellation
  // onUpdate: function — for streaming progress updates
  // ctx: ExtensionContext — session context (cwd, ui, etc.)
}
```

**Common mistake**: swapping `signal` and `onUpdate`. This causes "onUpdate is not a function" errors and broken abort handling.

### Using ctx.cwd

Always use `ctx.cwd` from pi's API for the project directory, never `process.cwd()`:

```typescript
// Good — uses pi's API
pi.on("session_start", async (_event, ctx) => {
  const projectDir = ctx.cwd;
});

// Bad — may differ from pi's working directory
const dir = process.cwd();
```

If you need `cwd` outside of an event handler, capture it from `session_start` into a module-level variable.

### Extension pi.extensions Resolution

Entries in `pi.extensions` are resolved as **relative paths from the package root**, not npm package names:

```json
{
  "pi": {
    "extensions": [
      "extensions/my-ext",              // local directory
      "node_modules/pi-lsp-extension"      // npm package (must use node_modules/ path)
    ]
  }
}
```

### Extension Event Reference

The pi-coding-agent provides 21 events. See the Event Lifecycle diagram below for the full flow.

### Event Lifecycle

```
session_start
    │
user sends prompt
    ├─► input (can intercept/transform)
    ├─► before_agent_start (can inject message, modify systemPrompt)
    ├─► agent_start
    │   ┌─── turn loop ───┐
    │   ├─► turn_start    │
    │   ├─► context       │ (can modify messages)
    │   │   LLM responds  │
    │   │   ├─► tool_call │ (can block)
    │   │   └─► tool_result (can modify)
    │   └─► turn_end      │
    │   └──────────────────┘
    └─► agent_end

/new or /resume  → session_before_switch → session_switch
/fork            → session_before_fork → session_fork
/compact         → session_before_compact → session_compact
/tree            → session_before_tree → session_tree
/model or Ctrl+P → model_select
exit             → session_shutdown
```

---

### Key Learnings

#### 1. Prefer Simple Solutions Over Tool Replacement

Hook into events instead of replacing tools. Example: direnv loads env vars via `session_start` + `tool_result` hooks, not by wrapping bash.

#### 2. Don't Replace Built-in Tools

Replacing built-in tools (edit, bash, grep) bypasses pi's safeguards: file mutation queue, fuzzy matching, BOM handling, line ending normalization, multiple occurrence detection. Only do this when absolutely necessary.

#### 3. Status Indicators

Use `name:state` format. Don't show status for the expected state — only for noteworthy states:

```typescript
ctx.ui.setStatus("myext", ctx.ui.theme.fg("accent", "myext:on"));  // noteworthy
ctx.ui.setStatus("myext", undefined);                                // normal = clear
```

#### 4. Guiding Tool Selection

Use `promptSnippet` and `promptGuidelines` to steer the LLM:

```typescript
pi.registerTool({
  name: "my_tool",
  promptSnippet: "Short summary for tool listing",
  promptGuidelines: ["Use my_tool when X", "Use grep instead when Y"],
});
```

#### 5. Multi-file Extensions

Add a `package.json` with `pi.extensions` pointing to the entry file. Without this, pi loads every `.ts` as a separate extension.

#### 6. Message Injection

Prefer `{ message: { content: "...", display: false } }` over `{ systemPrompt: "..." }` in `before_agent_start` to append context without replacing the system prompt.

#### 7. Walkie Extension Architecture

Walkie bridges pi to Telegram. Pi owns session state — walkie just shuttles messages. Don't duplicate pi's session management (no persistent history needed). Use `MessageQueue` for messages arriving while agent is busy.

---

### Design Principles

1. **Think about the actual goal** - Don't fixate on wrapping/intercepting
2. **Use `ctx.cwd` for paths** - Never `process.cwd()`
3. **Use events for side effects** - `session_start` for init, `tool_result` for reactions
4. **Only replace tools when necessary** - Safeguards are lost
5. **Inject messages, don't replace systemPrompt** - Append via `before_agent_start` message
6. **Use `context` for message manipulation** - Filter, prune, augment before LLM calls
7. **Clean up on shutdown** - Kill child processes, clear intervals, close connections
8. **Correct execute signature** - `(toolCallId, params, signal, onUpdate, ctx)`
9. **Pi owns state, extensions bridge** - Don't duplicate session management in extensions
