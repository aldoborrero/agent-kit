# Skillz

A collection of skills and extensions for AI coding agents, including Claude Code skills and pi-coding-agent extensions.

## Overview

This repository contains:

- **Skills** - Markdown-based instructions that teach AI agents how to use CLI tools (compatible with both Claude Code and pi-coding-agent)
- **Pi Extensions** - TypeScript extensions that add tools directly to pi-coding-agent
- **Packages** - Nix-packaged CLI tools

## Repository Structure

```
skillz/
├── skills/                   # Skills (Claude Code + pi-coding-agent)
│   ├── ast-grep/             # AST-based structural code search
│   ├── kagi-search/          # Privacy-focused search
│   ├── pexpect-cli/          # Interactive CLI automation
│   └── superpowers/          # Advanced agent workflow skills
│       ├── brainstorming/
│       ├── writing-plans/
│       ├── executing-plans/
│       ├── subagent-driven-development/
│       ├── dispatching-parallel-agents/
│       ├── test-driven-development/
│       ├── systematic-debugging/
│       ├── verification-before-completion/
│       ├── requesting-code-review/
│       ├── receiving-code-review/
│       ├── using-git-worktrees/
│       ├── finishing-a-development-branch/
│       └── writing-skills/
├── pi/
│   ├── agents/               # Agent definitions for pi-coding-agent
│   │   ├── brainstormer.md   # Design dialogue (uses brainstorming skill)
│   │   ├── debugger.md       # Systematic debugging specialist
│   │   ├── planner.md        # Implementation planning (uses writing-plans skill)
│   │   ├── reviewer.md       # Code review (uses requesting-code-review skill)
│   │   ├── scout.md          # Fast codebase reconnaissance
│   │   └── worker.md         # General-purpose implementation (uses TDD + verification skills)
│   ├── extensions/           # Pi-coding-agent extensions
│   │   ├── ast-grep/         # AST-based code search
│   │   ├── direnv/           # Load direnv environment
│   │   ├── github-search/    # GitHub code search
│   │   ├── jina/             # Web content fetching
│   │   ├── kagi-search/      # Kagi search integration
│   │   ├── pexpect-cli/      # Interactive CLI automation
│   │   ├── recorder/         # SQLite session recorder
│   │   ├── subagent/         # Task delegation to subagents
│   │   └── together-provider/ # Together AI model provider
│   └── prompts/              # Workflow prompt templates
│       ├── brainstorm.md     # Collaborative design dialogue
│       ├── debug.md          # Scout → debugger chain
│       ├── full-cycle.md     # Scout → planner → worker → reviewer → worker
│       └── review.md         # Standalone code review
└── packages/                 # Nix packages
    ├── pexpect-cli/          # pexpect-cli CLI tool
    └── pi-sync/              # Sync tool for pi extensions/skills
```

## Skills

Skills are markdown files with a `SKILL.md` that instruct AI agents on how to use external CLI tools. They follow the [Agent Skills](https://agentskills.io) standard and are compatible with:

- **Claude Code** - Loaded via skills configuration
- **pi-coding-agent** - Loaded from `~/.pi/agent/skills/` or `.pi/skills/`

### Tool Skills

- [`/pexpect-cli`](skills/pexpect-cli/SKILL.md): Automate interactive CLI programs (SSH, databases, editors) with persistent sessions using pexpect and pueue
- [`/ast-grep`](skills/ast-grep/SKILL.md): Structural code search using AST patterns — find code by structure, not text
- [`/kagi-search`](skills/kagi-search/SKILL.md): Privacy-focused web search via Kagi with Quick Answer support

### Superpowers Skills

- [`/superpowers-brainstorming`](skills/superpowers/brainstorming/SKILL.md): Explore user intent, requirements, and design before any creative or implementation work
- [`/superpowers-writing-plans`](skills/superpowers/writing-plans/SKILL.md): Create detailed implementation plans with bite-sized tasks from specs or requirements
- [`/superpowers-executing-plans`](skills/superpowers/executing-plans/SKILL.md): Execute implementation plans task-by-task in a separate session with review checkpoints
- [`/superpowers-subagent-driven-development`](skills/superpowers/subagent-driven-development/SKILL.md): Execute implementation plans by delegating independent tasks to subagents
- [`/superpowers-dispatching-parallel-agents`](skills/superpowers/dispatching-parallel-agents/SKILL.md): Run 2+ independent tasks in parallel without shared state
- [`/superpowers-test-driven-development`](skills/superpowers/test-driven-development/SKILL.md): Write tests before implementation code for any feature or bugfix
- [`/superpowers-systematic-debugging`](skills/superpowers/systematic-debugging/SKILL.md): Structured debugging with root cause analysis before proposing fixes
- [`/superpowers-verification-before-completion`](skills/superpowers/verification-before-completion/SKILL.md): Run verification commands and confirm output before claiming work is complete
- [`/superpowers-requesting-code-review`](skills/superpowers/requesting-code-review/SKILL.md): Request formal code review before merging to verify work meets requirements
- [`/superpowers-receiving-code-review`](skills/superpowers/receiving-code-review/SKILL.md): Process code review feedback with technical rigor — verify before implementing
- [`/superpowers-using-git-worktrees`](skills/superpowers/using-git-worktrees/SKILL.md): Create isolated git worktrees for feature work with smart directory selection
- [`/superpowers-finishing-a-development-branch`](skills/superpowers/finishing-a-development-branch/SKILL.md): Guide completion of development work with structured options for merge, PR, or cleanup
- [`/superpowers-writing-skills`](skills/superpowers/writing-skills/SKILL.md): Create new skills, edit existing skills, or verify skills work before deployment

## Pi Extensions

TypeScript extensions that register tools directly in [pi-coding-agent](https://github.com/niclas-ppr/pi-mono).

- [`ast-grep`](pi/extensions/ast-grep/README.md): Structural code search using AST patterns with pattern, rule, and inspect modes
- [`direnv`](pi/extensions/direnv/README.md): Auto-load direnv environment variables on session start and after bash commands
- [`github-search`](pi/extensions/github-search/README.md): Search code across GitHub repositories via the `gh` CLI
- [`jina`](pi/extensions/jina/README.md): Fetch webpages and return clean markdown via Jina AI's Reader API
- [`kagi-search`](pi/extensions/kagi-search/README.md): Privacy-focused Kagi web search with Quick Answer summaries
- [`pexpect-cli`](pi/extensions/pexpect-cli/README.md): Automate interactive CLI programs with persistent pexpect sessions managed by pueue
- [`recorder`](pi/extensions/recorder/README.md): Record all session activity to SQLite for performance tracking and analytics
- [`subagent`](pi/extensions/subagent/README.md): Delegate tasks to specialized subagents with isolated context (single, parallel, chain modes)
- [`together-provider`](pi/extensions/together-provider/README.md): Together AI model provider with 25+ open-source models (Llama, DeepSeek, Qwen, etc.)

## Agents

Agent definitions for [pi-coding-agent](https://github.com/niclas-ppr/pi-mono). Each agent is a lean system prompt that loads superpowers skills at runtime from `~/.pi/agent/skills/superpowers/`.

- [`brainstormer`](pi/agents/brainstormer.md): Collaborative design dialogue — explores ideas before implementation (uses brainstorming skill)
- [`debugger`](pi/agents/debugger.md): Systematic debugging specialist with root cause analysis (uses systematic-debugging skill)
- [`planner`](pi/agents/planner.md): Creates bite-sized implementation plans from context and requirements (uses writing-plans skill)
- [`reviewer`](pi/agents/reviewer.md): Code review for quality, security, and maintainability (uses requesting-code-review skill)
- [`scout`](pi/agents/scout.md): Fast codebase reconnaissance that returns compressed context for handoff
- [`worker`](pi/agents/worker.md): General-purpose implementation with TDD, verification, debugging, and code review methodologies

## Prompts

Workflow prompt templates that orchestrate agents into chains via the subagent extension.

- [`/brainstorm`](pi/prompts/brainstorm.md): Collaborative design dialogue — brainstormer agent explores ideas
- [`/debug`](pi/prompts/debug.md): Systematic debugging — scout gathers context, debugger investigates
- [`/full-cycle`](pi/prompts/full-cycle.md): Full lifecycle — scout → planner → worker → reviewer → worker
- [`/review`](pi/prompts/review.md): Standalone code review of recent changes or specified files

## Packages

Nix-packaged CLI tools.

- [`pexpect-cli`](packages/pexpect-cli/README.md): Persistent pexpect sessions via pueue -- server/client CLI for interactive automation
- [`pi-sync`](packages/pi-sync/README.md): Sync extensions, skills, agents, prompts, and themes to `~/.pi/agent/` for pi-coding-agent

## Installation

### Using Nix Flake

```bash
# Run pi-sync directly
nix run .#pi-sync -- list
nix run .#pi-sync -- all

# Install to profile
nix profile install .#pi-sync
```

### Setup for pi-coding-agent

Use `pi-sync` to symlink extensions and skills to `~/.pi/agent/`:

```bash
# Sync everything
pi-sync all

# Or sync separately
pi-sync extensions
pi-sync skills

# Manual alternative
ln -s /path/to/skillz/pi/extensions/github-search/github-search.ts ~/.pi/agent/extensions/
ln -s /path/to/skillz/skills/pexpect-cli ~/.pi/agent/skills/
```

## Development

### Building with Nix

```bash
# Enter dev shell
nix develop

# Build all packages
nix build .#pi-sync
nix build .#pexpect-cli

# Format code
nix fmt
```

### Testing Extensions

```bash
# Run pi with a specific extension
pi -e ./pi/extensions/github-search/github-search.ts
```

## Contributing

When adding new skills or extensions:

1. **Skills**: Create `skills/<name>/SKILL.md` with frontmatter (`name`, `description`)
2. **Extensions**: Create `pi/extensions/<name>/<name>.ts` exporting a default function
3. Update this README
4. Run `pi-sync list` to verify detection

## License

[MIT](LICENSE)
