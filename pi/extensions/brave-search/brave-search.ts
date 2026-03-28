/**
 * Brave Search Extension — privacy-focused web search via Brave Search API.
 *
 * Returns structured results with titles, URLs, snippets, and extra snippets.
 * Supports recency filtering (day, week, month, year).
 *
 * Requires: BRAVE_API_KEY environment variable.
 * Free tier: https://brave.com/search/api/
 *
 * Based on: oh-my-pi web search provider (brave.ts)
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

const BRAVE_SEARCH_URL = "https://api.search.brave.com/res/v1/web/search";
const MAX_NUM_RESULTS = 20;

const RECENCY_MAP: Record<string, string> = {
	day: "pd",
	week: "pw",
	month: "pm",
	year: "py",
};

interface BraveResult {
	title?: string | null;
	url?: string | null;
	description?: string | null;
	age?: string | null;
	extra_snippets?: string[] | null;
}

interface BraveResponse {
	web?: {
		results?: BraveResult[];
	};
}

function buildSnippet(result: BraveResult): string | undefined {
	const snippets: string[] = [];
	if (result.description?.trim()) snippets.push(result.description.trim());
	if (Array.isArray(result.extra_snippets)) {
		for (const s of result.extra_snippets) {
			if (s?.trim() && !snippets.includes(s.trim())) snippets.push(s.trim());
		}
	}
	return snippets.length > 0 ? snippets.join("\n") : undefined;
}

export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: "brave_search",
		description:
			"Search the web using Brave Search. Returns structured results with titles, URLs, and snippets. " +
			"Good for recent news, forum discussions, general web queries, and privacy-focused search. Free tier available.",
		promptSnippet: "Privacy-focused web search via Brave. Good for news, forums, and general queries.",
		promptGuidelines: [
			"Use brave_search for general web queries, recent news, forum discussions, and when privacy matters",
			"Use recency filter to find recent content: 'day' for breaking news, 'week' for recent discussions",
			"Max 20 results per query",
		],
		parameters: Type.Object({
			query: Type.String({
				description: "Search query",
			}),
			num_results: Type.Optional(
				Type.Number({
					description: "Number of results (default: 10, max: 20)",
					minimum: 1,
					maximum: 20,
				}),
			),
			recency: Type.Optional(
				Type.Union(
					[
						Type.Literal("day"),
						Type.Literal("week"),
						Type.Literal("month"),
						Type.Literal("year"),
					],
					{
						description: "Filter by freshness: day, week, month, year",
					},
				),
			),
		}),

		async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
			const apiKey = process.env.BRAVE_API_KEY;
			if (!apiKey) {
				return {
					content: [{ type: "text" as const, text: "BRAVE_API_KEY not set. Get a free key at https://brave.com/search/api/" }],
					isError: true,
				};
			}

			const numResults = Math.min(MAX_NUM_RESULTS, Math.max(1, params.num_results ?? 10));

			const url = new URL(BRAVE_SEARCH_URL);
			url.searchParams.set("q", params.query);
			url.searchParams.set("count", String(numResults));
			url.searchParams.set("extra_snippets", "true");
			if (params.recency && RECENCY_MAP[params.recency]) {
				url.searchParams.set("freshness", RECENCY_MAP[params.recency]);
			}

			try {
				const response = await fetch(url, {
					headers: {
						Accept: "application/json",
						"X-Subscription-Token": apiKey,
					},
					signal,
				});

				if (!response.ok) {
					const errorText = await response.text();
					return {
						content: [{ type: "text" as const, text: `Brave API error (${response.status}): ${errorText}` }],
						isError: true,
					};
				}

				const data = (await response.json()) as BraveResponse;
				const results = data.web?.results ?? [];

				if (results.length === 0) {
					return {
						content: [{ type: "text" as const, text: `No results found for: "${params.query}"` }],
						details: { resultCount: 0 },
					};
				}

				const lines: string[] = [];
				lines.push(`Found ${results.length} result(s) for "${params.query}":\n`);

				for (let i = 0; i < results.length; i++) {
					const r = results[i];
					if (!r.url) continue;

					lines.push(`### ${i + 1}. ${r.title ?? r.url}`);
					lines.push(`**URL:** ${r.url}`);
					if (r.age) lines.push(`**Age:** ${r.age}`);

					const snippet = buildSnippet(r);
					if (snippet) {
						const truncated = snippet.length > 400 ? snippet.slice(0, 400) + "..." : snippet;
						lines.push(`\n${truncated}`);
					}

					lines.push("");
				}

				return {
					content: [{ type: "text" as const, text: lines.join("\n") }],
					details: { resultCount: results.length },
				};
			} catch (err) {
				if ((err as Error).name === "AbortError") {
					return { content: [{ type: "text" as const, text: "Search aborted" }], isError: true };
				}
				return {
					content: [{ type: "text" as const, text: `Brave search failed: ${(err as Error).message}` }],
					isError: true,
				};
			}
		},
	});
}
