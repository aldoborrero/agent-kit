# Agent Guidelines for agent-kit

## Project Overview

agent-kit is a toolkit for AI coding agents providing skills, extensions, and specialized agents for pi-coding-agent and Claude Code.

## Directory Structure

```
agent-kit/
├── skills/           # Markdown-based agent instructions
│   ├── ast-grep/     # AST-based structural code search
│   ├── kagi-search/  # Privacy-focused web search
│   ├── pexpect-cli/  # Interactive CLI automation
│   └── superpowers/  # 13 workflow skills (brainstorming, TDD, debugging, etc.)
├── pi/
│   ├── agents/       # Agent definitions (scout, planner, worker, reviewer, debugger, brainstormer)
│   ├── extensions/   # TypeScript extensions (10 tools)
│   └── prompts/      # Workflow templates (brainstorm, debug, full-cycle, review)
└── packages/         # Nix packages (pexpect-cli, pi-sync)
```

## Key Conventions

### Skills (`skills/`)
- Each skill has a `SKILL.md` file with frontmatter (name, description, user-invocable flag)
- Skills teach agents how to use external tools via markdown instructions
- Compatible with both Claude Code and pi-coding-agent
- Superpowers skills define workflows (TDD, debugging, planning) not tool usage

### Pi Extensions (`pi/extensions/`)
- TypeScript files that register tools with pi-coding-agent
- Use event hooks (`session_start`, `tool_result`, etc.) for side effects
- Prefer simple solutions over tool replacement
- Each extension has its own directory with a README.md

### Agents (`pi/agents/`)
- Lean markdown system prompts that load skills at runtime
- Located at `~/.pi/agent/agents/` when deployed
- Reference skills from `~/.pi/agent/skills/`

### Prompts (`pi/prompts/`)
- Workflow templates that orchestrate agent chains via subagent extension
- Define multi-agent pipelines (e.g., scout → planner → worker → reviewer)

## Development

### Nix Environment
```bash
nix develop          # Enter dev shell
nix fmt              # Format code
nix build .#pi-sync  # Build packages
```

### Testing Extensions
```bash
pi -e ./pi/extensions/example/example.ts
```

### Deploying to pi-coding-agent
```bash
pi-sync all          # Sync everything to ~/.pi/agent/
```

## Writing New Components

### New Skill
1. Create `skills/<name>/SKILL.md` with frontmatter
2. Document the tool's CLI interface and usage patterns
3. Include examples the agent can follow

### New Extension
1. Create `pi/extensions/<name>/<name>.ts`
2. Add README.md documenting the extension
3. Register tools via `pi.registerTool()` or use event hooks
4. Add to `package.json` under `pi.extensions`

### New Agent
1. Create `pi/agents/<name>.md`
2. Keep system prompt lean - load skills at runtime
3. Define the agent's role and methodology

---

## Pi Extension Development

### Extension Event Reference

The pi-coding-agent provides 21 events that extensions can hook into. Events are categorized by their lifecycle phase.

### Session Events

| Event | When | Can Cancel | Can Modify |
|-------|------|------------|------------|
| `session_start` | Session loads | No | No |
| `session_before_switch` | Before `/new` or `/resume` | Yes | No |
| `session_switch` | After session switch | No | No |
| `session_before_fork` | Before `/fork` | Yes | skipConversationRestore |
| `session_fork` | After fork | No | No |
| `session_before_compact` | Before compaction | Yes | compaction result |
| `session_compact` | After compaction | No | No |
| `session_before_tree` | Before `/tree` navigation | Yes | summary, instructions |
| `session_tree` | After tree navigation | No | No |
| `session_shutdown` | On exit (Ctrl+C, Ctrl+D) | No | No |

#### session_start
```typescript
pi.on("session_start", async (event, ctx) => {
  // event: { type: "session_start" }
  // Use for: initialization, load environment, set status
});
```

#### session_before_switch
```typescript
pi.on("session_before_switch", async (event, ctx) => {
  // event: { type, reason: "new" | "resume", targetSessionFile? }
  // Return { cancel: true } to prevent switch
});
```

#### session_shutdown
```typescript
pi.on("session_shutdown", async (event, ctx) => {
  // event: { type: "session_shutdown" }
  // Use for: cleanup, save state, close connections
});
```

### Agent Events

| Event | When | Can Modify |
|-------|------|------------|
| `before_agent_start` | After prompt, before agent loop | systemPrompt, inject message |
| `agent_start` | Agent loop begins | No |
| `agent_end` | Agent loop ends | No |
| `turn_start` | Each turn starts | No |
| `turn_end` | Each turn ends | No |
| `context` | Before each LLM call | messages array |

#### before_agent_start
```typescript
pi.on("before_agent_start", async (event, ctx) => {
  // event: { type, prompt, images?, systemPrompt }
  // Return { message?: CustomMessage, systemPrompt?: string }
  // Use for: inject context, modify system instructions per turn
});
```

#### context
```typescript
pi.on("context", async (event, ctx) => {
  // event: { type: "context", messages: AgentMessage[] }
  // messages is a deep copy, safe to modify
  // Return { messages?: AgentMessage[] }
  // Use for: prune conversation, inject context, filter sensitive data
});
```

#### turn_end
```typescript
pi.on("turn_end", async (event, ctx) => {
  // event: { type, turnIndex, message, toolResults }
  // Use for: cleanup after turn, git stash, logging
});
```

### Tool Events

| Event | When | Capabilities |
|-------|------|--------------|
| `tool_call` | Before tool executes | Block only (NOT modify input) |
| `tool_result` | After tool executes | Modify content, details, isError |

#### tool_call
```typescript
pi.on("tool_call", async (event, ctx) => {
  // event: { type, toolName, toolCallId, input }
  // Return { block: true, reason?: string } to block execution
  // IMPORTANT: Cannot modify input parameters
});
```

#### tool_result
```typescript
pi.on("tool_result", async (event, ctx) => {
  // event: { type, toolName, toolCallId, input, content, details, isError }
  // details varies by tool:
  //   bash: { exitCode, outputLines, truncated }
  //   read: { encoding, size }
  //   edit: { linesChanged }
  //   grep: { matchCount, resultType }
  // Return { content?, details?, isError? } to modify result
});
```

### Input Events

| Event | When | Capabilities |
|-------|------|--------------|
| `input` | User input received | Transform, handle, or continue |
| `user_bash` | User runs `!` or `!!` command | Custom operations or result |

#### input
```typescript
pi.on("input", async (event, ctx) => {
  // event: { type, text, images?, source: "interactive" | "rpc" | "extension" }
  // Fires after extension commands, before skill/template expansion
  // Return { action: "continue" | "transform" | "handled", text?, images? }
});
```

#### user_bash
```typescript
pi.on("user_bash", async (event, ctx) => {
  // event: { type, command, excludeFromContext, cwd }
  // Return { operations?: BashOperations } for custom execution (SSH, containers)
  // Return { result?: BashResult } to provide complete result
});
```

### Model Events

| Event | When | Capabilities |
|-------|------|--------------|
| `model_select` | Model changes | Read-only |

#### model_select
```typescript
pi.on("model_select", async (event, ctx) => {
  // event: { type, model, previousModel?, source: "set" | "cycle" | "restore" }
  // Use for: update status bar, model-specific settings
});
```

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

When extending functionality, first consider whether you can achieve the goal without replacing or wrapping existing tools.

**Example: Loading direnv environment variables**

Bad approach (over-engineered):
- Replace the entire bash tool
- Wrap every command with `direnv exec . <cmd>`
- Reimplement streaming, truncation, and error handling

Good approach (simple):
- Hook into `session_start` and `tool_result` events
- Run `direnv export json` to get environment changes
- Modify `process.env` directly

```typescript
// Simple and effective
pi.on("session_start", async (_event, ctx) => {
  loadDirenv(ctx.cwd, ctx);
});

pi.on("tool_result", async (event, ctx) => {
  if (event.toolName !== "bash") return;
  loadDirenv(ctx.cwd, ctx);  // Pick up .envrc changes after cd, git checkout, etc.
});
```

#### 2. `tool_call` Cannot Modify Input

The `tool_call` event can block execution but cannot modify the tool's parameters. If you need to transform input, you must replace the tool entirely.

#### 3. `tool_result` for Reactive Behavior

Use `tool_result` to react after tool execution. This is ideal for:
- Updating environment after directory changes
- Logging or metrics
- Triggering dependent operations
- Showing status updates

#### 4. Replacing Built-in Tools

To replace a built-in tool, register a tool with the same name:

```typescript
pi.registerTool({
  name: "bash",  // Same name replaces built-in
  // ...
});
```

If you need to reuse the built-in logic, import `createBashTool` and provide custom `BashOperations`:

```typescript
import { createBashTool, type BashOperations } from "@mariozechner/pi-coding-agent";

const customOps: Partial<BashOperations> = {
  execute: async (command, options) => {
    // Custom execution logic
  },
};

pi.registerTool(createBashTool(ctx.cwd, { operations: customOps }));
```

#### 5. Status Indicators

Extensions can show status in the UI:

```typescript
if (ctx.hasUI) {
  ctx.ui.setStatus("myext", ctx.ui.theme.fg("success", "myext ✓"));
  // or for errors:
  ctx.ui.setStatus("myext", ctx.ui.theme.fg("error", "myext ✗"));
}
```

---

### Design Principles

1. **Think about the actual goal** - Don't fixate on wrapping/intercepting. Ask: "What am I really trying to achieve?"
2. **Prefer process.env for environment** - Modifying Node's environment affects all child processes
3. **Use events for side effects** - `session_start` for init, `tool_result` for reactions
4. **Only replace tools when necessary** - When you truly need to modify input or change core behavior
5. **Use `before_agent_start` for per-turn context** - Inject messages or modify system prompt dynamically
6. **Use `context` for message manipulation** - Filter, prune, or augment the conversation before LLM calls
