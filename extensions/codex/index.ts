/**
 * Codex Extension — use OpenAI Codex from pi to review code or delegate tasks.
 *
 * Commands:
 *   /codex:setup              — check Codex CLI readiness
 *   /codex:review             — run a code review via Codex
 *   /codex:adversarial-review — adversarial review questioning design choices
 *   /codex:rescue             — delegate a task to Codex
 *
 * Requires: `codex` CLI installed globally (`npm i -g @openai/codex`).
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const CODEX_BIN = "codex";
const EXEC_TIMEOUT = 10 * 60 * 1000; // 10 minutes

async function codexAvailable(pi: ExtensionAPI): Promise<boolean> {
	try {
		const result = await pi.exec(CODEX_BIN, ["--version"], { timeout: 5000 });
		return result.exitCode === 0;
	} catch {
		return false;
	}
}

async function runCodex(
	pi: ExtensionAPI,
	args: string[],
	timeout = EXEC_TIMEOUT,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
	const result = await pi.exec(CODEX_BIN, args, { timeout });
	return {
		stdout: result.stdout ?? "",
		stderr: result.stderr ?? "",
		exitCode: result.exitCode ?? 1,
	};
}

function buildGitDiffArgs(flags: { base?: string; scope?: string }): string[] {
	if (flags.base) return ["diff", `${flags.base}...HEAD`];
	if (flags.scope === "working-tree") return ["diff"];
	return ["diff"];
}

async function getGitContext(
	pi: ExtensionAPI,
	flags: { base?: string; scope?: string },
): Promise<string> {
	const diffArgs = buildGitDiffArgs(flags);
	const [status, diff, log] = await Promise.all([
		pi.exec("git", ["status", "--short"], { timeout: 5000 }),
		pi.exec("git", [...diffArgs], { timeout: 10000 }),
		pi.exec("git", ["log", "--oneline", "-10"], { timeout: 5000 }),
	]);

	const sections: string[] = [];

	if (status.stdout?.trim()) {
		sections.push("## git status\n```\n" + status.stdout.trim() + "\n```");
	}
	if (log.stdout?.trim()) {
		sections.push(
			"## git log --oneline -10\n```\n" + log.stdout.trim() + "\n```",
		);
	}
	if (diff.stdout?.trim()) {
		sections.push("## diff\n```diff\n" + diff.stdout.trim() + "\n```");
	} else {
		// fallback: staged diff
		const staged = await pi.exec("git", ["diff", "--cached"], {
			timeout: 10000,
		});
		if (staged.stdout?.trim()) {
			sections.push(
				"## staged diff\n```diff\n" + staged.stdout.trim() + "\n```",
			);
		}
	}

	return sections.join("\n\n");
}

function parseFlags(args: string): {
	positional: string;
	base?: string;
	scope?: string;
	model?: string;
	effort?: string;
	write: boolean;
} {
	const tokens = args.split(/\s+/);
	const result: ReturnType<typeof parseFlags> = { positional: "", write: false };
	const positionals: string[] = [];

	for (let i = 0; i < tokens.length; i++) {
		const t = tokens[i];
		if (t === "--base" && tokens[i + 1]) {
			result.base = tokens[++i];
		} else if (t === "--scope" && tokens[i + 1]) {
			result.scope = tokens[++i];
		} else if ((t === "--model" || t === "-m") && tokens[i + 1]) {
			result.model = tokens[++i];
		} else if (t === "--effort" && tokens[i + 1]) {
			result.effort = tokens[++i];
		} else if (t === "--write") {
			result.write = true;
		} else {
			positionals.push(t);
		}
	}

	result.positional = positionals.join(" ").trim();
	return result;
}

export default function (pi: ExtensionAPI) {
	// ── /codex:setup ──────────────────────────────────────────────────────
	pi.registerCommand("codex:setup", {
		description: "Check whether the local Codex CLI is installed and authenticated",
		handler: async (_args, ctx) => {
			const available = await codexAvailable(pi);
			if (!available) {
				pi.sendUserMessage(
					[
						"Codex CLI is **not installed**.",
						"",
						"Install it with:",
						"```bash",
						"npm install -g @openai/codex",
						"```",
						"Then authenticate: `!codex login`",
					].join("\n"),
					{ deliverAs: "followUp" },
				);
				return;
			}

			const loginCheck = await pi.exec(CODEX_BIN, ["login", "status"], {
				timeout: 10000,
			});
			const loggedIn = loginCheck.exitCode === 0;

			const lines = [
				"# Codex Setup",
				"",
				`- CLI: installed (\`${CODEX_BIN} --version\` ok)`,
				`- Auth: ${loggedIn ? "authenticated" : "**not authenticated** — run `!codex login`"}`,
			];

			pi.sendUserMessage(lines.join("\n"), { deliverAs: "followUp" });
		},
	});

	// ── /codex:review ─────────────────────────────────────────────────────
	pi.registerCommand("codex:review", {
		description:
			"Run a Codex code review on uncommitted changes or a branch diff. Flags: --base <ref>, --scope <auto|working-tree|branch>",
		handler: async (args, ctx) => {
			const flags = parseFlags(args);
			const gitContext = await getGitContext(pi, flags);

			if (!gitContext.trim()) {
				pi.sendUserMessage(
					"No changes detected to review. Stage or commit some work first.",
					{ deliverAs: "followUp" },
				);
				return;
			}

			const prompt = [
				"You are a meticulous code reviewer. Review the following changes.",
				"Focus on bugs, security issues, performance problems, and design concerns.",
				"Present findings ordered by severity (critical > high > medium > low).",
				"For each finding include: severity, file, line range, description, recommendation.",
				"End with a verdict: approve or needs-attention.",
				"",
				gitContext,
			].join("\n");

			const codexArgs = ["-q", "--json"];
			if (flags.model) codexArgs.push("-m", flags.model);
			codexArgs.push(prompt);

			ctx.ui.notify("Running Codex review…", "info");
			const result = await runCodex(pi, codexArgs);

			if (result.exitCode !== 0) {
				pi.sendUserMessage(
					`Codex review failed:\n\`\`\`\n${result.stderr || result.stdout}\n\`\`\``,
					{ deliverAs: "followUp" },
				);
				return;
			}

			pi.sendUserMessage(
				`# Codex Review\n\n${result.stdout}`,
				{ deliverAs: "followUp" },
			);
		},
	});

	// ── /codex:adversarial-review ─────────────────────────────────────────
	pi.registerCommand("codex:adversarial-review", {
		description:
			"Adversarial review that challenges design decisions. Flags: --base <ref>, --scope <auto|working-tree|branch>. Pass focus text as positional args.",
		handler: async (args, ctx) => {
			const flags = parseFlags(args);
			const gitContext = await getGitContext(pi, flags);

			if (!gitContext.trim()) {
				pi.sendUserMessage(
					"No changes detected to review. Stage or commit some work first.",
					{ deliverAs: "followUp" },
				);
				return;
			}

			const focusClause = flags.positional
				? `Pay special attention to: ${flags.positional}\n`
				: "";

			const prompt = [
				"You are an adversarial code reviewer. Your job is to challenge the implementation,",
				"question design choices, surface hidden assumptions, and find real-world failure modes.",
				"Focus on: auth/permissions, data loss, race conditions, rollback safety, reliability.",
				focusClause,
				"Do NOT suggest fixes — only identify issues. Be concrete and evidence-based.",
				"Present findings ordered by severity with file paths and line numbers.",
				"End with a verdict: approve or needs-attention.",
				"",
				gitContext,
			].join("\n");

			const codexArgs = ["-q", "--json"];
			if (flags.model) codexArgs.push("-m", flags.model);
			codexArgs.push(prompt);

			ctx.ui.notify("Running Codex adversarial review…", "info");
			const result = await runCodex(pi, codexArgs);

			if (result.exitCode !== 0) {
				pi.sendUserMessage(
					`Codex adversarial review failed:\n\`\`\`\n${result.stderr || result.stdout}\n\`\`\``,
					{ deliverAs: "followUp" },
				);
				return;
			}

			pi.sendUserMessage(
				`# Codex Adversarial Review\n\n${result.stdout}`,
				{ deliverAs: "followUp" },
			);
		},
	});

	// ── /codex:rescue ─────────────────────────────────────────────────────
	pi.registerCommand("codex:rescue", {
		description:
			"Delegate a task to Codex. Flags: --model <model>, --effort <level>, --write (allow edits). Pass task as positional args.",
		handler: async (args, ctx) => {
			const flags = parseFlags(args);

			if (!flags.positional) {
				pi.sendUserMessage(
					"Usage: `/codex:rescue <task description>` — describe what you want Codex to do.",
					{ deliverAs: "followUp" },
				);
				return;
			}

			const codexArgs = ["-q"];
			if (flags.model) codexArgs.push("-m", flags.model);
			if (flags.write) codexArgs.push("-a", "auto-edit");
			codexArgs.push(flags.positional);

			ctx.ui.notify("Delegating task to Codex…", "info");
			const result = await runCodex(pi, codexArgs);

			if (result.exitCode !== 0) {
				pi.sendUserMessage(
					`Codex task failed:\n\`\`\`\n${result.stderr || result.stdout}\n\`\`\``,
					{ deliverAs: "followUp" },
				);
				return;
			}

			pi.sendUserMessage(
				`# Codex Result\n\n${result.stdout}`,
				{ deliverAs: "followUp" },
			);
		},
	});
}
