/**
 * OpenRouter Provider Extension
 *
 * Access to frontier models from multiple providers through a single API key.
 * Curated selection of models not easily available elsewhere — Chinese-origin
 * models (Kimi, ByteDance, MiniMax), Google Gemini (no GCP setup), and xAI Grok.
 *
 * Requires: OPENROUTER_API_KEY environment variable.
 * Get one at: https://openrouter.ai/keys
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { createUiColors } from "../_shared/ui-colors.js";

const API_KEY_ENV = "OPENROUTER_API_KEY";

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx) => {
		if (process.env[API_KEY_ENV]) {
			if (ctx.hasUI) ctx.ui.setStatus("openrouter", undefined);
			return;
		}
		if (ctx.hasUI) {
			const colors = createUiColors(ctx.ui.theme);
			ctx.ui.setStatus("openrouter", colors.warning("or:no-key"));
			ctx.ui.notify(`OpenRouter provider loaded, but ${API_KEY_ENV} is not set`, "warning");
		}
	});

	pi.registerProvider("openrouter", {
		baseUrl: "https://openrouter.ai/api/v1",
		apiKey: API_KEY_ENV,
		api: "openai-completions",
		models: [
			// ── Moonshot AI ──────────────────────────────────────────

			{
				id: "moonshotai/kimi-k2.5",
				name: "Kimi K2.5",
				reasoning: true,
				input: ["text", "image"],
				cost: { input: 0.42, output: 2.20, cacheRead: 0.21, cacheWrite: 0 },
				contextWindow: 262144,
				maxTokens: 65535,
			},

			// ── Google Gemini (no GCP/OAuth needed) ──────────────────

			{
				id: "google/gemini-3.1-pro-preview",
				name: "Gemini 3.1 Pro",
				reasoning: true,
				input: ["text", "image"],
				cost: { input: 2.00, output: 12.00, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 1048576,
				maxTokens: 65536,
			},
			{
				id: "google/gemini-2.5-pro",
				name: "Gemini 2.5 Pro",
				reasoning: true,
				input: ["text", "image"],
				cost: { input: 1.25, output: 10.00, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 1048576,
				maxTokens: 65536,
			},
			{
				id: "google/gemini-3-flash-preview",
				name: "Gemini 3 Flash",
				reasoning: true,
				input: ["text", "image"],
				cost: { input: 0.50, output: 3.00, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 1048576,
				maxTokens: 65536,
			},

			// ── xAI Grok ─────────────────────────────────────────────

			{
				id: "x-ai/grok-4.20-beta",
				name: "Grok 4.20 Beta",
				reasoning: true,
				input: ["text", "image"],
				cost: { input: 2.00, output: 6.00, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 2000000,
				maxTokens: 65536,
			},
			{
				id: "x-ai/grok-4-fast",
				name: "Grok 4 Fast",
				reasoning: true,
				input: ["text", "image"],
				cost: { input: 0.20, output: 0.50, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 2000000,
				maxTokens: 30000,
			},

			// ── Coding specialists ───────────────────────────────────

			{
				id: "x-ai/grok-code-fast-1",
				name: "Grok Code Fast",
				reasoning: true,
				input: ["text"],
				cost: { input: 0.20, output: 1.50, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 256000,
				maxTokens: 10000,
			},
			{
				id: "mistralai/devstral-medium",
				name: "Devstral Medium",
				reasoning: false,
				input: ["text"],
				cost: { input: 0.40, output: 2.00, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 131072,
				maxTokens: 65536,
			},

			// ── Budget powerhouses ───────────────────────────────────

			{
				id: "bytedance-seed/seed-2.0-mini",
				name: "ByteDance Seed 2.0 Mini",
				reasoning: true,
				input: ["text", "image"],
				cost: { input: 0.10, output: 0.40, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 262144,
				maxTokens: 131072,
			},
			{
				id: "inception/mercury-2",
				name: "Inception Mercury 2",
				reasoning: true,
				input: ["text"],
				cost: { input: 0.25, output: 0.75, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 128000,
				maxTokens: 50000,
			},
		],
	});
}
