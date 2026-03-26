/**
 * Cron Loop Extension — periodic polling and monitoring during a session.
 *
 * Mirrors Claude Code's CronCreate/CronList/CronDelete pattern. Schedules
 * recurring or one-shot prompts using standard 5-field cron expressions.
 * Tasks fire between turns (when the agent is idle).
 *
 * Usage:
 *   /cron 5m check if the deployment finished
 *   /cron 2h run the integration tests
 *   /cron check deploy every 30m
 * Management:
 *   /cron-list       — show all scheduled tasks
 *   /cron-delete <id> — cancel a task
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Cron } from "croner";

interface CronTask {
	id: string;
	prompt: string;
	cronExpr: string;
	recurring: boolean;
	humanLabel: string;
	cron: Cron;
	createdAt: number;
	expiresAt: number;
	fireCount: number;
	nextFireAt: number;
	jitterMs: number;
}

const MAX_TASKS = 50;
const RECURRING_EXPIRY_DAYS = 7;
const CHECK_INTERVAL_MS = 1000;

function generateId(): string {
	return Math.random().toString(36).slice(2, 10);
}

/**
 * Deterministic jitter from task ID.
 * Recurring: up to 10% of period late, max 15 minutes.
 * One-shot on :00 or :30: up to 90 seconds early.
 */
function computeJitterMs(id: string, periodMs: number, recurring: boolean): number {
	let hash = 0;
	for (let i = 0; i < id.length; i++) {
		hash = ((hash << 5) - hash + id.charCodeAt(i)) | 0;
	}
	const seed = Math.abs(hash) / 2147483647;

	if (recurring) {
		const maxJitter = Math.min(periodMs * 0.1, 15 * 60_000);
		return Math.floor(seed * maxJitter);
	}
	return -Math.floor(seed * 90_000);
}

/**
 * Estimate period in ms from a cron expression for jitter sizing.
 */
function estimatePeriodMs(expr: string): number {
	const parts = expr.split(/\s+/);
	if (parts.length < 5) return 60_000;
	const [minute, hour, dom] = parts;
	if (minute.startsWith("*/")) return parseInt(minute.slice(2), 10) * 60_000;
	if (hour.startsWith("*/")) return parseInt(hour.slice(2), 10) * 3_600_000;
	if (dom.startsWith("*/")) return parseInt(dom.slice(2), 10) * 86_400_000;
	if (hour === "*" && minute !== "*") return 3_600_000;
	if (hour !== "*") return 86_400_000;
	return 60_000;
}

// ─── Interval parsing ───────────────────────────────────────────────

interface ParsedInterval {
	cronExpr: string;
	humanLabel: string;
	prompt: string;
	rounded?: string; // set if interval was rounded
}

/**
 * Parse "/cron <input>" into a cron expression and prompt.
 *
 * Priority:
 * 1. Leading token: "5m check something"
 * 2. Trailing "every" clause: "check something every 5m"
 * 3. Default: 10m, entire input is the prompt
 */
function parseInput(input: string): ParsedInterval | null {
	const trimmed = input.trim();
	if (!trimmed) return null;

	// Rule 1: leading token like "5m", "2h", "30s"
	const leadingMatch = trimmed.match(/^(\d+)\s*(s|m|h|d)\s+(.+)$/i);
	if (leadingMatch) {
		const [, num, unit, rest] = leadingMatch;
		if (rest.trim()) {
			return intervalToCron(parseInt(num, 10), unit.toLowerCase(), rest.trim());
		}
	}

	// Rule 2: trailing "every N unit" or "every N unit-word"
	const trailingMatch = trimmed.match(
		/^(.+?)\s+every\s+(\d+)\s*(s|sec|seconds?|m|min|minutes?|h|hr|hours?|d|days?)\s*$/i
	);
	if (trailingMatch) {
		const [, rest, num, unit] = trailingMatch;
		if (rest.trim()) {
			return intervalToCron(parseInt(num, 10), normalizeUnit(unit), rest.trim());
		}
	}

	// Rule 3: default 10m
	return {
		cronExpr: "*/10 * * * *",
		humanLabel: "every 10m",
		prompt: trimmed,
	};
}

function normalizeUnit(unit: string): string {
	const u = unit.toLowerCase();
	if (u === "s" || u === "sec" || u === "second" || u === "seconds") return "s";
	if (u === "m" || u === "min" || u === "minute" || u === "minutes") return "m";
	if (u === "h" || u === "hr" || u === "hour" || u === "hours") return "h";
	if (u === "d" || u === "day" || u === "days") return "d";
	return u;
}

function intervalToCron(value: number, unit: string, prompt: string): ParsedInterval {
	let rounded: string | undefined;

	switch (unit) {
		case "s": {
			// Round up to nearest minute (cron minimum granularity)
			const minutes = Math.max(1, Math.ceil(value / 60));
			rounded = value < 60 ? `Rounded ${value}s up to ${minutes}m (cron minimum is 1 minute)` : undefined;
			return minutesToCron(minutes, prompt, rounded);
		}
		case "m":
			return minutesToCron(value, prompt);
		case "h": {
			if (value <= 0) value = 1;
			if (value > 23) value = 24;
			// Pick an off-minute to avoid thundering herd
			const minute = 7;
			if (24 % value !== 0) {
				const nearest = findNearestDivisor(value, 24);
				rounded = `Rounded ${value}h to ${nearest}h (must divide 24 evenly)`;
				return {
					cronExpr: `${minute} */${nearest} * * *`,
					humanLabel: `every ${nearest}h`,
					prompt,
					rounded,
				};
			}
			return {
				cronExpr: `${minute} */${value} * * *`,
				humanLabel: `every ${value}h`,
				prompt,
			};
		}
		case "d": {
			if (value <= 0) value = 1;
			return {
				cronExpr: `0 0 */${value} * *`,
				humanLabel: `every ${value}d`,
				prompt,
			};
		}
		default:
			return {
				cronExpr: "*/10 * * * *",
				humanLabel: "every 10m",
				prompt,
			};
	}
}

function minutesToCron(minutes: number, prompt: string, rounded?: string): ParsedInterval {
	if (minutes <= 0) minutes = 1;

	if (minutes <= 59) {
		// Check if it divides 60 evenly
		if (60 % minutes !== 0) {
			const nearest = findNearestDivisor(minutes, 60);
			rounded = `Rounded ${minutes}m to ${nearest}m (must divide 60 evenly for consistent spacing)`;
			return {
				cronExpr: `*/${nearest} * * * *`,
				humanLabel: `every ${nearest}m`,
				prompt,
				rounded,
			};
		}
		return {
			cronExpr: `*/${minutes} * * * *`,
			humanLabel: `every ${minutes}m`,
			prompt,
			rounded,
		};
	}

	// >= 60 minutes: convert to hours
	const hours = Math.round(minutes / 60);
	const clampedHours = Math.max(1, Math.min(hours, 24));
	const nearestHours = 24 % clampedHours !== 0 ? findNearestDivisor(clampedHours, 24) : clampedHours;
	if (nearestHours !== Math.round(minutes / 60)) {
		rounded = `Rounded ${minutes}m to ${nearestHours}h`;
	}
	const minute = 7; // off-minute
	return {
		cronExpr: `${minute} */${nearestHours} * * *`,
		humanLabel: `every ${nearestHours}h`,
		prompt,
		rounded,
	};
}

function findNearestDivisor(value: number, max: number): number {
	// Find nearest value that divides max evenly
	let best = 1;
	let bestDist = Math.abs(value - 1);
	for (let i = 1; i <= max; i++) {
		if (max % i === 0 && Math.abs(value - i) < bestDist) {
			best = i;
			bestDist = Math.abs(value - i);
		}
	}
	return best;
}

// ─── Extension ──────────────────────────────────────────────────────

export default function cronLoopExtension(pi: ExtensionAPI) {
	const tasks = new Map<string, CronTask>();
	let checkTimer: ReturnType<typeof setInterval> | null = null;
	let agentBusy = false;
	let latestCtx: ExtensionContext | null = null;

	function updateStatus(): void {
		if (!latestCtx?.hasUI) return;
		const ctx = latestCtx;
		if (tasks.size === 0) {
			ctx.ui.setStatus("cron", undefined);
			return;
		}

		ctx.ui.setStatus(
			"cron",
			ctx.ui.theme.fg("success", `cron:${tasks.size}`),
		);
	}

	function fireDueTasks(): void {
		if (agentBusy || !latestCtx) return;

		const now = Date.now();
		const toDelete: string[] = [];

		for (const [id, task] of tasks) {
			// Check expiry
			if (now >= task.expiresAt) {
				task.cron.stop();
				toDelete.push(id);
				if (latestCtx.hasUI) {
					latestCtx.ui.notify(`Cron task ${id} expired (${RECURRING_EXPIRY_DAYS}-day limit)`, "info");
				}
				continue;
			}

			// Simple check: is it past the scheduled fire time?
			if (now >= task.nextFireAt) {
				task.fireCount++;

				// Schedule next fire with jitter
				const nextRun = task.cron.nextRun();
				if (nextRun) {
					task.nextFireAt = nextRun.getTime() + task.jitterMs;
				}

				pi.sendMessage(
					{
						customType: "cron",
						content: `[Scheduled task ${task.id} — ${task.humanLabel}]\n\n${task.prompt}`,
						display: true,
					},
					{ triggerTurn: true },
				);

				// One-shot: delete after firing
				if (!task.recurring) {
					task.cron.stop();
					toDelete.push(id);
				}

				updateStatus();
				return; // One at a time
			}
		}

		for (const id of toDelete) {
			tasks.delete(id);
		}
		if (toDelete.length > 0) updateStatus();
	}

	function startTimer(): void {
		if (checkTimer) return;
		checkTimer = setInterval(() => fireDueTasks(), CHECK_INTERVAL_MS);
	}

	function stopTimer(): void {
		if (checkTimer) {
			clearInterval(checkTimer);
			checkTimer = null;
		}
	}

	function createTask(
		cronExpr: string,
		prompt: string,
		humanLabel: string,
		recurring: boolean,
	): CronTask {
		const id = generateId();
		const now = Date.now();
		const expiresAt = recurring
			? now + RECURRING_EXPIRY_DAYS * 86_400_000
			: now + 86_400_000; // one-shot: 1 day max

		const cron = new Cron(cronExpr, { timezone: Intl.DateTimeFormat().resolvedOptions().timeZone });
		const periodMs = estimatePeriodMs(cronExpr);
		const jitterMs = computeJitterMs(id, periodMs, recurring);
		const nextRun = cron.nextRun();

		const task: CronTask = {
			id,
			prompt,
			cronExpr,
			recurring,
			humanLabel,
			cron,
			createdAt: now,
			expiresAt,
			fireCount: 0,
			nextFireAt: nextRun ? nextRun.getTime() + jitterMs : now + 60_000,
			jitterMs,
		};

		return task;
	}

	// Track agent busy state
	pi.on("agent_start", async () => {
		agentBusy = true;
	});

	pi.on("agent_end", async (_event, ctx) => {
		agentBusy = false;
		latestCtx = ctx;
		fireDueTasks();
	});

	pi.on("session_start", async (_event, ctx) => {
		latestCtx = ctx;
		startTimer();
	});

	pi.on("session_shutdown", async () => {
		stopTimer();
		for (const task of tasks.values()) task.cron.stop();
		tasks.clear();
	});

	// /cron — schedule a recurring prompt
	pi.registerCommand("cron", {
		description: "Schedule a recurring prompt (e.g., /cron 5m check deploy status)",
		handler: async (args, ctx) => {
			latestCtx = ctx;
			const input = args.trim();
			if (!input) {
				ctx.ui.notify(
					"Usage: /cron [interval] <prompt>\n\n" +
					"Examples:\n" +
					"  /cron 5m check if the deployment finished\n" +
					"  /cron 2h run integration tests\n" +
					"  /cron check deploy every 30m\n" +
					"  /cron check the build  (defaults to 10m)\n\n" +
					"Intervals: Ns, Nm, Nh, Nd",
					"info",
				);
				return;
			}

			if (tasks.size >= MAX_TASKS) {
				ctx.ui.notify(`Maximum ${MAX_TASKS} tasks. Delete some with /cron-delete`, "error");
				return;
			}

			const parsed = parseInput(input);
			if (!parsed || !parsed.prompt) {
				ctx.ui.notify("Please provide a prompt. Usage: /cron [interval] <prompt>", "error");
				return;
			}

			const task = createTask(parsed.cronExpr, parsed.prompt, parsed.humanLabel, true);
			tasks.set(task.id, task);
			startTimer();
			updateStatus();

			const nextRun = task.cron.nextRun();
			let msg = `Scheduled recurring task ${task.id}\n` +
				`Cron: ${parsed.cronExpr} (${parsed.humanLabel})\n` +
				`Next fire: ${nextRun ? nextRun.toLocaleTimeString() : "—"}\n` +
				`Auto-expires in ${RECURRING_EXPIRY_DAYS} days. Cancel with /cron-delete ${task.id}`;

			if (parsed.rounded) {
				msg = `${parsed.rounded}\n\n${msg}`;
			}

			ctx.ui.notify(msg, "info");

			// Execute immediately (don't wait for first cron fire)
			pi.sendMessage(
				{
					customType: "cron",
					content: `[Scheduled task ${task.id} — ${parsed.humanLabel} — initial run]\n\n${parsed.prompt}`,
					display: true,
				},
				{ triggerTurn: true },
			);
		},
	});

	// /cron-list
	pi.registerCommand("cron-list", {
		description: "List all scheduled cron tasks",
		handler: async (_args, ctx) => {
			latestCtx = ctx;
			if (tasks.size === 0) {
				ctx.ui.notify("No scheduled tasks", "info");
				return;
			}

			const lines = Array.from(tasks.values()).map((t) => {
				const next = t.cron.nextRun();
				const nextStr = next ? next.toLocaleTimeString() : "—";
				const type = t.recurring ? "recurring" : "one-shot";
				return `${t.id}  ${t.cronExpr.padEnd(15)}  ${type.padEnd(9)}  fired ${String(t.fireCount).padStart(3)}x  next ${nextStr}\n    "${t.prompt}"`;
			});

			ctx.ui.notify(`Scheduled tasks (${tasks.size}):\n\n${lines.join("\n\n")}`, "info");
		},
	});

	// /cron-delete
	pi.registerCommand("cron-delete", {
		description: "Delete a scheduled cron task by ID",
		handler: async (args, ctx) => {
			latestCtx = ctx;
			const id = args.trim();
			if (!id) {
				ctx.ui.notify("Usage: /cron-delete <task-id>", "error");
				return;
			}

			const task = tasks.get(id);
			if (task) {
				task.cron.stop();
				tasks.delete(id);
				updateStatus();
				ctx.ui.notify(`Task ${id} deleted`, "info");

				if (tasks.size === 0) stopTimer();
			} else {
				ctx.ui.notify(`Task ${id} not found. Use /cron-list to see tasks.`, "error");
			}
		},
	});
}

function formatRelative(timestamp: number): string {
	const diff = timestamp - Date.now();
	if (diff <= 0) return "now";
	if (diff < 60_000) return `${Math.round(diff / 1000)}s`;
	if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m`;
	if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)}h`;
	return `${Math.round(diff / 86_400_000)}d`;
}
