/**
 * Codex Extension — use OpenAI Codex from pi to review code or delegate tasks.
 *
 * Wraps the upstream codex-plugin-cc scripts (codex-companion.mjs) which
 * communicate with Codex via its app-server JSON-RPC protocol for native
 * reviews, structured output, thread management, and job tracking.
 *
 * Commands:
 *   /codex:setup              — check Codex CLI readiness and auth
 *   /codex:review             — run a native code review via Codex
 *   /codex:adversarial-review — adversarial review questioning design choices
 *   /codex:rescue             — delegate a task to Codex
 *   /codex:status             — show running and recent Codex jobs
 *   /codex:result             — display output from a completed job
 *   /codex:cancel             — cancel an active background job
 *
 * Requires: `codex` CLI installed globally (`npm i -g @openai/codex`).
 */

import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const COMPANION_SCRIPT = path.join(
	__dirname,
	"node_modules",
	"codex-plugin-cc",
	"plugins",
	"codex",
	"scripts",
	"codex-companion.mjs",
);

const EXEC_TIMEOUT = 10 * 60 * 1000; // 10 minutes

async function runCompanion(
	pi: ExtensionAPI,
	subcommand: string,
	args: string,
	timeout = EXEC_TIMEOUT,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
	// Build the full command: node <script> <subcommand> <args>
	const shellCmd = args.trim()
		? `node "${COMPANION_SCRIPT}" ${subcommand} ${args}`
		: `node "${COMPANION_SCRIPT}" ${subcommand}`;

	const result = await pi.exec("bash", ["-c", shellCmd], { timeout });
	return {
		stdout: result.stdout ?? "",
		stderr: result.stderr ?? "",
		exitCode: result.exitCode ?? 1,
	};
}

function formatOutput(result: {
	stdout: string;
	stderr: string;
	exitCode: number;
}): string {
	if (result.exitCode === 0 && result.stdout.trim()) {
		return result.stdout.trim();
	}
	if (result.stderr.trim()) {
		return `Error:\n\`\`\`\n${result.stderr.trim()}\n\`\`\``;
	}
	if (result.stdout.trim()) {
		return result.stdout.trim();
	}
	return "Codex returned no output.";
}

export default function (pi: ExtensionAPI) {
	// ── /codex:setup ──────────────────────────────────────────────────────
	pi.registerCommand("codex:setup", {
		description:
			"Check whether the local Codex CLI is installed and authenticated",
		handler: async (args, ctx) => {
			const result = await runCompanion(pi, "setup", args, 30000);
			pi.sendUserMessage(formatOutput(result), { deliverAs: "followUp" });
		},
	});

	// ── /codex:review ─────────────────────────────────────────────────────
	pi.registerCommand("codex:review", {
		description:
			"Run a Codex code review on uncommitted changes or a branch diff. Flags: --base <ref>, --scope <auto|working-tree|branch>",
		handler: async (args, ctx) => {
			ctx.ui.notify("Running Codex review…", "info");
			const result = await runCompanion(pi, "review", args);
			pi.sendUserMessage(formatOutput(result), { deliverAs: "followUp" });
		},
	});

	// ── /codex:adversarial-review ─────────────────────────────────────────
	pi.registerCommand("codex:adversarial-review", {
		description:
			"Adversarial review that challenges design decisions. Flags: --base <ref>, --scope <auto|working-tree|branch>. Pass focus text as positional args.",
		handler: async (args, ctx) => {
			ctx.ui.notify("Running Codex adversarial review…", "info");
			const result = await runCompanion(pi, "adversarial-review", args);
			pi.sendUserMessage(formatOutput(result), { deliverAs: "followUp" });
		},
	});

	// ── /codex:rescue ─────────────────────────────────────────────────────
	pi.registerCommand("codex:rescue", {
		description:
			"Delegate a task to Codex. Flags: --model <model>, --effort <level>, --write (allow edits). Pass task as positional args.",
		handler: async (args, ctx) => {
			if (!args.trim()) {
				pi.sendUserMessage(
					"Usage: `/codex:rescue <task description>` — describe what you want Codex to do.",
					{ deliverAs: "followUp" },
				);
				return;
			}
			ctx.ui.notify("Delegating task to Codex…", "info");
			const result = await runCompanion(pi, "task", args);
			pi.sendUserMessage(formatOutput(result), { deliverAs: "followUp" });
		},
	});

	// ── /codex:status ─────────────────────────────────────────────────────
	pi.registerCommand("codex:status", {
		description: "Show running and recent Codex jobs for this repository",
		handler: async (args, ctx) => {
			const result = await runCompanion(pi, "status", args, 30000);
			pi.sendUserMessage(formatOutput(result), { deliverAs: "followUp" });
		},
	});

	// ── /codex:result ─────────────────────────────────────────────────────
	pi.registerCommand("codex:result", {
		description: "Display the full output from a completed Codex job",
		handler: async (args, ctx) => {
			const result = await runCompanion(pi, "result", args, 30000);
			pi.sendUserMessage(formatOutput(result), { deliverAs: "followUp" });
		},
	});

	// ── /codex:cancel ─────────────────────────────────────────────────────
	pi.registerCommand("codex:cancel", {
		description: "Cancel an active background Codex job",
		handler: async (args, ctx) => {
			const result = await runCompanion(pi, "cancel", args, 30000);
			pi.sendUserMessage(formatOutput(result), { deliverAs: "followUp" });
		},
	});
}
