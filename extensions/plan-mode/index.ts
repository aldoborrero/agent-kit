/**
 * Plan Mode Extension
 *
 * Read-only exploration mode for safe code analysis.
 * When enabled, only read-only tools are available.
 *
 * Features:
 * - /plan command or Ctrl+Alt+P to toggle
 * - Bash restricted to allowlisted read-only commands
 * - Extracts numbered plan steps from "Plan:" sections
 * - [DONE:n] markers to complete steps during execution
 * - Progress tracking widget during execution
 */

import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { AssistantMessage, TextContent } from "@mariozechner/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Key } from "@mariozechner/pi-tui";
import { extractTodoItems, isSafeCommand, markCompletedSteps, type TodoItem } from "./utils.js";
import { existsSync, readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const PLAN_DIR = ".pi/plans";

// Tools
const PLAN_MODE_TOOLS = ["read", "bash", "grep", "find", "ls", "edit", "write", "questionnaire", "subagent", "ast_grep", "exa_search", "brave_search", "github_search_code"];
const NORMAL_MODE_TOOLS = ["read", "bash", "edit", "write"];

// Type guard for assistant messages
function isAssistantMessage(m: AgentMessage): m is AssistantMessage {
	return m.role === "assistant" && Array.isArray(m.content);
}

// Extract text content from an assistant message
function getTextContent(message: AssistantMessage): string {
	return message.content
		.filter((block): block is TextContent => block.type === "text")
		.map((block) => block.text)
		.join("\n");
}

export default function planModeExtension(pi: ExtensionAPI): void {
	let planModeEnabled = false;
	let executionMode = false;
	let todoItems: TodoItem[] = [];
	let currentPlanFile: string | null = null;

	let projectDir = process.cwd(); // updated from ctx.cwd on session_start

	function generatePlanFileName(): string {
		const now = new Date();
		const date = now.toISOString().slice(0, 10); // YYYY-MM-DD
		const time = now.toTimeString().slice(0, 5).replace(":", ""); // HHMM
		return `plan-${date}-${time}.md`;
	}

	function getPlanDir(): string {
		return join(projectDir, PLAN_DIR);
	}

	function ensurePlanDir(): void {
		const dir = getPlanDir();
		if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
	}

	function startNewPlan(): string {
		ensurePlanDir();
		const fileName = generatePlanFileName();
		currentPlanFile = join(getPlanDir(), fileName);
		return currentPlanFile;
	}

	function getPlanFileInfo(): string {
		if (currentPlanFile && existsSync(currentPlanFile)) {
			return `Your current plan file is ${currentPlanFile}. You can read it and make incremental edits using the edit tool.`;
		}
		const path = startNewPlan();
		return `Create your plan at ${path} using the write tool.`;
	}

	pi.registerFlag("plan", {
		description: "Start in plan mode (read-only exploration)",
		type: "boolean",
		default: false,
	});

	function updateStatus(ctx: ExtensionContext): void {
		// Footer status
		if (executionMode && todoItems.length > 0) {
			const completed = todoItems.filter((t) => t.completed).length;
			ctx.ui.setStatus("plan-mode", ctx.ui.theme.fg("accent", `plan:${completed}/${todoItems.length}`));
		} else if (planModeEnabled) {
			ctx.ui.setStatus("plan-mode", ctx.ui.theme.fg("warning", "● plan"));
		} else {
			ctx.ui.setStatus("plan-mode", undefined);
		}

		// Widget showing todo list
		if (executionMode && todoItems.length > 0) {
			const lines = todoItems.map((item) => {
				if (item.completed) {
					return (
						ctx.ui.theme.fg("success", "☑ ") + ctx.ui.theme.fg("muted", ctx.ui.theme.strikethrough(item.text))
					);
				}
				return `${ctx.ui.theme.fg("muted", "☐ ")}${item.text}`;
			});
			ctx.ui.setWidget("plan-todos", lines);
		} else {
			ctx.ui.setWidget("plan-todos", undefined);
		}
	}

	function togglePlanMode(ctx: ExtensionContext): void {
		planModeEnabled = !planModeEnabled;
		executionMode = false;
		todoItems = [];

		if (planModeEnabled) {
			pi.setActiveTools(PLAN_MODE_TOOLS);
			ctx.ui.notify("Plan mode enabled. Read-only exploration with subagent, search, and web tools.");
		} else {
			pi.setActiveTools(NORMAL_MODE_TOOLS);
			ctx.ui.notify("Plan mode disabled. Full access restored.");
		}
		updateStatus(ctx);
	}

	function persistState(): void {
		pi.appendEntry("plan-mode", {
			enabled: planModeEnabled,
			todos: todoItems,
			executing: executionMode,
			planFile: currentPlanFile,
		});
	}

	pi.registerCommand("plan", {
		description: "Toggle plan mode (read-only exploration)",
		handler: async (_args, ctx) => togglePlanMode(ctx),
	});

	pi.registerCommand("todos", {
		description: "Show current plan todo list",
		handler: async (_args, ctx) => {
			if (todoItems.length === 0) {
				ctx.ui.notify("No todos. Create a plan first with /plan", "info");
				return;
			}
			const list = todoItems.map((item, i) => `${i + 1}. ${item.completed ? "✓" : "○"} ${item.text}`).join("\n");
			ctx.ui.notify(`Plan Progress:\n${list}`, "info");
		},
	});

	pi.registerShortcut(Key.ctrlAlt("p"), {
		description: "Toggle plan mode",
		handler: async (ctx) => togglePlanMode(ctx),
	});

	// Block non-plan-file edits and destructive bash in plan mode
	pi.on("tool_call", async (event) => {
		if (!planModeEnabled) return;

		// Block edit/write on any file other than the plan file
		if (event.toolName === "edit" || event.toolName === "write") {
			const targetPath = event.input.path as string;
			if (!targetPath) return;

			const planPath = currentPlanFile;
			const resolvedTarget = targetPath.startsWith("/")
				? targetPath
				: join(projectDir, targetPath);

			if (resolvedTarget !== planPath) {
				return {
					block: true,
					reason: `Plan mode: can only edit the plan file at ${planPath}. Use /plan to disable plan mode first.`,
				};
			}

			// Allow — ensure the .pi directory exists
			ensurePlanDir();
			return;
		}

		// Block destructive bash commands
		if (event.toolName === "bash") {
			const command = event.input.command as string;
			if (!isSafeCommand(command)) {
				return {
					block: true,
					reason: `Plan mode: command blocked (not allowlisted). Use /plan to disable plan mode first.\nCommand: ${command}`,
				};
			}
		}
	});

	// Filter out stale plan mode context when not in plan mode
	pi.on("context", async (event) => {
		if (planModeEnabled) return;

		return {
			messages: event.messages.filter((m) => {
				const msg = m as AgentMessage & { customType?: string };
				if (msg.customType === "plan-mode-context") return false;
				if (msg.role !== "user") return true;

				const content = msg.content;
				if (typeof content === "string") {
					return !content.includes("[PLAN MODE ACTIVE]");
				}
				if (Array.isArray(content)) {
					return !content.some(
						(c) => c.type === "text" && (c as TextContent).text?.includes("[PLAN MODE ACTIVE]"),
					);
				}
				return true;
			}),
		};
	});

	// Inject plan/execution context before agent starts
	pi.on("before_agent_start", async () => {
		if (planModeEnabled) {
			return {
				message: {
					customType: "plan-mode-context",
					content: `[PLAN MODE ACTIVE]
Plan mode is active. You MUST NOT make any edits, run non-readonly tools, or make any changes to the system. This supersedes any other instructions you have received.

## Plan File
${getPlanFileInfo()}
You should build your plan incrementally by writing to or editing this file. This is the ONLY file you are allowed to edit — other than this you are only allowed to take READ-ONLY actions.

## Workflow

### Phase 1: Explore
Gain a comprehensive understanding of the codebase relevant to the task. Actively search for existing functions, utilities, and patterns that can be reused — avoid proposing new code when suitable implementations already exist.

Launch scout subagents in parallel for fast exploration:
- Use 1 scout when the task is isolated to known files or the user provided specific paths.
- Use multiple scouts when the scope is uncertain, multiple areas are involved, or you need to understand existing patterns.
- Give each scout a specific search focus (e.g. one for implementations, one for tests, one for related components).

Start by quickly scanning a few key files to form an initial understanding. Don't explore exhaustively before engaging the user.

### Phase 2: Design
Launch a planner subagent with comprehensive context from Phase 1 (filenames, code paths, existing utilities found). For complex tasks, launch multiple planners with different perspectives (simplicity vs performance vs maintainability).

Skip subagents only for truly trivial tasks (typo fixes, single-line changes, simple renames).

### Phase 3: Review and Clarify
Read the critical files identified by agents. Ensure the plan aligns with the user's original request.

Ask clarifying questions using the questionnaire tool when needed. Question discipline:
- Never ask what you could find by reading the code.
- Batch related questions together.
- Focus on things only the user can answer: requirements, preferences, tradeoffs, edge case priorities.

### Phase 4: Final Plan
Present your plan under a "Plan:" header. Rules:
- Do NOT write a Context, Background, or Overview section. The user just told you what they want.
- Do NOT restate the user's request. Do NOT write prose paragraphs.
- List the paths of files to be modified and what changes in each (one bullet per file).
- Reference existing functions to reuse, with file:line.
- End with a single verification command.
- Hard limit: 40 lines. If the plan is longer, delete prose — not file paths.

Plan:
1. path/to/file.ts — description of change
2. path/to/other.ts — description of change
...
Verify: command to run

## Available tools

- **subagent** — dispatch scout (fast recon, haiku) and planner (design, opus) agents
- **read, bash, grep, find, ls** — direct exploration (bash restricted to read-only commands)
- **ast_grep** — structural code search (functions, classes, imports)
- **exa_search, brave_search** — web research (docs, articles, examples)
- **github_search_code** — find code on GitHub
- **questionnaire** — ask user structured questions

Do NOT attempt to make changes — explore, design, and plan only.`,
					display: false,
				},
			};
		}

		if (executionMode && todoItems.length > 0) {
			const remaining = todoItems.filter((t) => !t.completed);
			const todoList = remaining.map((t) => `${t.step}. ${t.text}`).join("\n");
			return {
				message: {
					customType: "plan-execution-context",
					content: `[EXECUTING PLAN - Full tool access enabled]

Plan file: ${currentPlanFile ?? "unknown"}
Read the plan file for full context. Remaining steps:
${todoList}

Execute each step in order. After completing a step, include a [DONE:n] tag in your response.

When all steps are done, run the verification command from the plan to confirm everything works. Do not claim completion without running verification.`,
					display: false,
				},
			};
		}
	});

	// Track progress after each turn
	pi.on("turn_end", async (event, ctx) => {
		if (!executionMode || todoItems.length === 0) return;
		if (!isAssistantMessage(event.message)) return;

		const text = getTextContent(event.message);
		if (markCompletedSteps(text, todoItems) > 0) {
			updateStatus(ctx);
		}
		persistState();
	});

	// Handle plan completion and plan mode UI
	pi.on("agent_end", async (event, ctx) => {
		// Check if execution is complete
		if (executionMode && todoItems.length > 0) {
			if (todoItems.every((t) => t.completed)) {
				const completedList = todoItems.map((t) => `~~${t.text}~~`).join("\n");
				pi.sendMessage(
					{ customType: "plan-complete", content: `**Plan Complete!** ✓\n\n${completedList}`, display: true },
					{ triggerTurn: false },
				);
				executionMode = false;
				todoItems = [];
				pi.setActiveTools(NORMAL_MODE_TOOLS);
				updateStatus(ctx);
				persistState(); // Save cleared state so resume doesn't restore old execution mode
			}
			return;
		}

		if (!planModeEnabled || !ctx.hasUI) return;

		// Extract todos from last assistant message
		const lastAssistant = [...event.messages].reverse().find(isAssistantMessage);
		if (lastAssistant) {
			const extracted = extractTodoItems(getTextContent(lastAssistant));
			if (extracted.length > 0) {
				todoItems = extracted;
			}
		}

		// Show plan steps and prompt for next action
		if (todoItems.length > 0) {
			const todoListText = todoItems.map((t, i) => `${i + 1}. ☐ ${t.text}`).join("\n");
			pi.sendMessage(
				{
					customType: "plan-todo-list",
					content: `**Plan Steps (${todoItems.length}):**\n\n${todoListText}`,
					display: true,
				},
				{ triggerTurn: false },
			);
		}

		const choice = await ctx.ui.select("Plan mode - what next?", [
			todoItems.length > 0 ? "Execute the plan (track progress)" : "Execute the plan",
			"Stay in plan mode",
			"Refine the plan",
		]);

		if (choice?.startsWith("Execute")) {
			planModeEnabled = false;
			executionMode = todoItems.length > 0;
			pi.setActiveTools(NORMAL_MODE_TOOLS);
			updateStatus(ctx);

			const execMessage =
				todoItems.length > 0
					? `Execute the plan. Start with: ${todoItems[0].text}`
					: "Execute the plan you just created.";
			pi.sendMessage(
				{ customType: "plan-mode-execute", content: execMessage, display: true },
				{ triggerTurn: true },
			);
		} else if (choice === "Refine the plan") {
			const refinement = await ctx.ui.editor("Refine the plan:", "");
			if (refinement?.trim()) {
				pi.sendUserMessage(refinement.trim());
			}
		}
	});

	// Restore state on session start/resume
	pi.on("session_start", async (_event, ctx) => {
		projectDir = ctx.cwd;
		if (pi.getFlag("plan") === true) {
			planModeEnabled = true;
		}

		const entries = ctx.sessionManager.getEntries();

		// Restore persisted state
		const planModeEntry = entries
			.filter((e: { type: string; customType?: string }) => e.type === "custom" && e.customType === "plan-mode")
			.pop() as { data?: { enabled: boolean; todos?: TodoItem[]; executing?: boolean; planFile?: string } } | undefined;

		if (planModeEntry?.data) {
			planModeEnabled = planModeEntry.data.enabled ?? planModeEnabled;
			todoItems = planModeEntry.data.todos ?? todoItems;
			executionMode = planModeEntry.data.executing ?? executionMode;
			currentPlanFile = planModeEntry.data.planFile ?? currentPlanFile;
		}

		// On resume: re-scan messages to rebuild completion state
		// Only scan messages AFTER the last "plan-mode-execute" to avoid picking up [DONE:n] from previous plans
		const isResume = planModeEntry !== undefined;
		if (isResume && executionMode && todoItems.length > 0) {
			// Find the index of the last plan-mode-execute entry (marks when current execution started)
			let executeIndex = -1;
			for (let i = entries.length - 1; i >= 0; i--) {
				const entry = entries[i] as { type: string; customType?: string };
				if (entry.customType === "plan-mode-execute") {
					executeIndex = i;
					break;
				}
			}

			// Only scan messages after the execute marker
			const messages: AssistantMessage[] = [];
			for (let i = executeIndex + 1; i < entries.length; i++) {
				const entry = entries[i];
				if (entry.type === "message" && "message" in entry && isAssistantMessage(entry.message as AgentMessage)) {
					messages.push(entry.message as AssistantMessage);
				}
			}
			const allText = messages.map(getTextContent).join("\n");
			markCompletedSteps(allText, todoItems);
		}

		if (planModeEnabled) {
			pi.setActiveTools(PLAN_MODE_TOOLS);
		}
		updateStatus(ctx);
	});
}
