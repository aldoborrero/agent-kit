/**
 * Groq Provider Extension
 *
 * Registers Groq as a model provider with ultra-fast inference on LPU hardware.
 * Uses OpenAI-compatible API at api.groq.com.
 *
 * Requires: GROQ_API_KEY environment variable.
 * Get one at: https://console.groq.com
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function (pi: ExtensionAPI) {
	pi.registerProvider("groq", {
		baseUrl: "https://api.groq.com/openai/v1",
		apiKey: "GROQ_API_KEY",
		api: "openai-completions",
		models: [
			// ── Tier 1: Best coding quality ──────────────────────────

			{
				id: "openai/gpt-oss-120b",
				name: "GPT-OSS 120B",
				reasoning: true,
				input: ["text"],
				cost: { input: 0.15, output: 0.60, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 131072,
				maxTokens: 65536,
			},
			{
				id: "moonshotai/kimi-k2-instruct-0905",
				name: "Kimi K2",
				reasoning: false,
				input: ["text"],
				cost: { input: 1.00, output: 3.00, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 262144,
				maxTokens: 65536,
			},

			// ── Tier 2: Best speed-to-quality ────────────────────────

			{
				id: "qwen/qwen3-32b",
				name: "Qwen 3 32B",
				reasoning: true,
				input: ["text"],
				cost: { input: 0.29, output: 0.59, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 131072,
				maxTokens: 40960,
			},
			{
				id: "meta-llama/llama-4-scout-17b-16e-instruct",
				name: "Llama 4 Scout 17B",
				reasoning: false,
				input: ["text", "image"],
				cost: { input: 0.11, output: 0.34, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 131072,
				maxTokens: 8192,
			},

			// ── Tier 3: Fast and cheap ───────────────────────────────

			{
				id: "openai/gpt-oss-20b",
				name: "GPT-OSS 20B",
				reasoning: true,
				input: ["text"],
				cost: { input: 0.075, output: 0.30, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 131072,
				maxTokens: 65536,
			},
		],
	});
}
