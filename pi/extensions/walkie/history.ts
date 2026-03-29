/**
 * Persistent message history for walkie extension.
 *
 * Append-only JSONL log of all Telegram messages (inbound + outbound).
 * Survives restarts, searchable via grep.
 *
 * File: <projectDir>/.pi/walkie-history.jsonl
 * Fallback: ~/.pi/agent/walkie-history.jsonl
 */

import { appendFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";

export interface HistoryEntry {
	date: string;
	direction: "in" | "out";
	role: "user" | "assistant" | "system";
	text: string;
	messageId?: number;
	/** Telegram file IDs for photos/voice (not the full data) */
	attachments?: string[];
}

export class MessageHistory {
	private filePath: string;
	private writeQueue: Promise<void> = Promise.resolve();

	constructor(projectDir: string, fallbackDir: string) {
		const projectPath = join(projectDir, ".pi", "walkie-history.jsonl");
		const fallbackPath = join(fallbackDir, "walkie-history.jsonl");

		// Use project dir if .pi/ exists or can be created; otherwise global
		const piDir = join(projectDir, ".pi");
		this.filePath = existsSync(piDir) || existsSync(projectDir)
			? projectPath
			: fallbackPath;
	}

	/** Append a message to the history log. Never throws. */
	log(entry: Omit<HistoryEntry, "date">): void {
		const line = JSON.stringify({
			date: new Date().toISOString(),
			...entry,
		});

		// Sequential writes to avoid interleaving
		this.writeQueue = this.writeQueue.then(async () => {
			try {
				const dir = dirname(this.filePath);
				if (!existsSync(dir)) await mkdir(dir, { recursive: true });
				await appendFile(this.filePath, line + "\n", "utf-8");
			} catch {
				// Non-fatal — don't crash the bot for history writes
			}
		});
	}

	/** Log an inbound user message. */
	userMessage(text: string, messageId: number, attachments?: string[]): void {
		this.log({ direction: "in", role: "user", text, messageId, attachments });
	}

	/** Log an outbound assistant message. */
	assistantMessage(text: string, messageId?: number): void {
		this.log({ direction: "out", role: "assistant", text, messageId });
	}

	/** Log a system event (setup, error, etc). */
	systemEvent(text: string): void {
		this.log({ direction: "out", role: "system", text });
	}

	/** Path to the history file. */
	get path(): string {
		return this.filePath;
	}
}
