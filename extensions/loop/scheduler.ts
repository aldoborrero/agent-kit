import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { releaseLoopSchedulerLock, tryAcquireLoopSchedulerLock } from "./loop-lock";
import type { RuntimeCronTask } from "./types";
import { computeTaskNextFireAt, type TaskStore } from "./task-store";

const CHECK_INTERVAL_MS = 1000;
const LOCK_PROBE_INTERVAL_MS = 5000;

export interface LoopSchedulerCallbacks {
	onStatusChange?: () => void;
	onTaskExpired?: (task: RuntimeCronTask) => void;
	onOwnershipAcquired?: () => Promise<void> | void;
}

export class LoopScheduler {
	private checkTimer: ReturnType<typeof setInterval> | null = null;
	private lockProbeTimer: ReturnType<typeof setInterval> | null = null;
	private agentBusy = false;
	private latestCtx: ExtensionContext | null = null;
	private isOwner = false;
	private readonly sessionId = `${process.pid}-${Math.random().toString(36).slice(2, 10)}`;

	constructor(
		private readonly pi: ExtensionAPI,
		private readonly store: TaskStore,
		private readonly callbacks: LoopSchedulerCallbacks = {},
	) {}

	setContext(ctx: ExtensionContext): void {
		this.latestCtx = ctx;
	}

	setAgentBusy(busy: boolean): void {
		this.agentBusy = busy;
	}

	async start(): Promise<void> {
		if (this.checkTimer || this.lockProbeTimer || this.isOwner) return;
		this.isOwner = await tryAcquireLoopSchedulerLock(this.sessionId).catch(() => false);
		if (this.isOwner) {
			this.startCheckTimer();
			await this.callbacks.onOwnershipAcquired?.();
			return;
		}

		this.lockProbeTimer = setInterval(() => {
			void tryAcquireLoopSchedulerLock(this.sessionId)
				.then(async (owned) => {
					if (!owned || this.isOwner) return;
					this.isOwner = true;
					if (this.lockProbeTimer) {
						clearInterval(this.lockProbeTimer);
						this.lockProbeTimer = null;
					}
					this.startCheckTimer();
					await this.callbacks.onOwnershipAcquired?.();
				})
				.catch(() => undefined);
		}, LOCK_PROBE_INTERVAL_MS);
	}

	async stop(): Promise<void> {
		if (this.checkTimer) {
			clearInterval(this.checkTimer);
			this.checkTimer = null;
		}
		if (this.lockProbeTimer) {
			clearInterval(this.lockProbeTimer);
			this.lockProbeTimer = null;
		}
		const wasOwner = this.isOwner;
		this.isOwner = false;
		if (wasOwner) {
			await releaseLoopSchedulerLock(this.sessionId).catch(() => undefined);
		}
	}

	isSchedulerOwner(): boolean {
		return this.isOwner;
	}

	clearAll(): number {
		this.stop();
		const count = this.store.clear();
		this.callbacks.onStatusChange?.();
		return count;
	}

	deleteTask(id: string): boolean {
		const deleted = this.store.delete(id);
		if (deleted && this.store.size() === 0) {
			this.stop();
		}
		if (deleted) {
			this.callbacks.onStatusChange?.();
		}
		return deleted;
	}

	fireDueTasks(): void {
		if (!this.isOwner || this.agentBusy || !this.latestCtx) return;

		const now = Date.now();
		for (const task of this.store.list()) {
			const isDue = now >= task.nextFireAt;
			if (!isDue) continue;

			task.fireCount++;
			task.lastFiredAt = now;
			const isExpired = now >= task.expiresAt;

			this.sendScheduledMessage(task);

			if (!task.recurring || isExpired) {
				this.store.delete(task.id);
				if (isExpired) {
					this.callbacks.onTaskExpired?.(task);
				}
			} else {
				task.nextFireAt = computeTaskNextFireAt(task, now, task.jitterMs, task.cron) ?? now + 60_000;
			}

			if (this.store.size() === 0) {
				this.stop();
			}
			this.callbacks.onStatusChange?.();
			return;
		}
	}

	sendInitialRun(task: RuntimeCronTask): void {
		this.sendScheduledMessage(task, true);
	}

	private startCheckTimer(): void {
		if (this.checkTimer) return;
		this.checkTimer = setInterval(() => this.fireDueTasks(), CHECK_INTERVAL_MS);
	}

	private sendScheduledMessage(task: RuntimeCronTask, initial = false): void {
		this.pi.sendMessage(
			{
				customType: "loop",
				content: initial
					? `[Scheduled task ${task.id} — ${task.humanLabel} — initial run]\n\n${task.prompt}`
					: `[Scheduled task ${task.id} — ${task.humanLabel}]\n\n${task.prompt}`,
				display: true,
			},
			{ triggerTurn: true },
		);
	}
}
