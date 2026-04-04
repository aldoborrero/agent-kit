/**
 * Exa Search Extension — AI-powered web search via Exa API.
 *
 * Supports neural, fast, and deep search modes with domain filtering
 * and date range filtering. Returns structured results with titles,
 * URLs, snippets, and publication dates.
 *
 * Requires: EXA_API_KEY environment variable.
 *
 * Based on: oh-my-pi web search provider (exa.ts)
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

const EXA_API_URL = "https://api.exa.ai/search";

interface ExaResult {
	title?: string | null;
	url?: string | null;
	author?: string | null;
	publishedDate?: string | null;
	text?: string | null;
	highlights?: string[] | null;
}

interface ExaResponse {
	requestId?: string;
	resolvedSearchType?: string;
	results?: ExaResult[];
	costDollars?: { total: number };
}

export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: "exa_search",
		description:
			"Search the web using Exa's AI-powered search engine. Returns structured results with titles, URLs, and snippets. " +
			"Supports neural search (semantic understanding), fast search (keyword-based), and deep search (comprehensive). " +
			"Backend-specific search tool: prefer web_search unless you explicitly need Exa-specific behavior.",
		promptSnippet: "Backend-specific Exa search. Prefer web_search unless you need Exa-specific behavior.",
		promptGuidelines: [
			"Prefer web_search for general agent-facing web research and source gathering.",
			"Use exa_search only when you explicitly want Exa-specific search behavior or tuning.",
			"Use 'neural' type for semantic queries ('how to implement X'), 'fast' for keyword queries ('lodash debounce npm')",
			"Use include_domains to restrict search to specific sites (e.g. ['docs.python.org', 'developer.mozilla.org'])",
		],
		parameters: Type.Object({
			query: Type.String({
				description: "Search query — natural language works best with neural search",
			}),
			num_results: Type.Optional(
				Type.Number({
					description: "Number of results to return (default: 10, max: 100)",
					minimum: 1,
					maximum: 100,
				}),
			),
			type: Type.Optional(
				Type.Union(
					[
						Type.Literal("neural"),
						Type.Literal("fast"),
						Type.Literal("auto"),
						Type.Literal("deep"),
					],
					{
						description:
							"Search type: neural (semantic, best for natural language), fast (keyword-based), deep (comprehensive), auto (default — Exa picks)",
					},
				),
			),
			include_domains: Type.Optional(
				Type.Array(Type.String(), {
					description: "Only search these domains (e.g. ['github.com', 'stackoverflow.com'])",
				}),
			),
			exclude_domains: Type.Optional(
				Type.Array(Type.String(), {
					description: "Exclude these domains from results",
				}),
			),
			start_published_date: Type.Optional(
				Type.String({
					description: "Only results published after this date (ISO 8601, e.g. '2024-01-01')",
				}),
			),
			end_published_date: Type.Optional(
				Type.String({
					description: "Only results published before this date (ISO 8601)",
				}),
			),
		}),

		async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
			const apiKey = process.env.EXA_API_KEY;
			if (!apiKey) {
				return {
					content: [{ type: "text" as const, text: "EXA_API_KEY not set. Get one at https://exa.ai" }],
					isError: true,
				};
			}

			const body: Record<string, unknown> = {
				query: params.query,
				numResults: params.num_results ?? 10,
				type: params.type ?? "auto",
			};

			if (params.include_domains?.length) body.includeDomains = params.include_domains;
			if (params.exclude_domains?.length) body.excludeDomains = params.exclude_domains;
			if (params.start_published_date) body.startPublishedDate = params.start_published_date;
			if (params.end_published_date) body.endPublishedDate = params.end_published_date;

			try {
				const response = await fetch(EXA_API_URL, {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						"x-api-key": apiKey,
					},
					body: JSON.stringify(body),
					signal,
				});

				if (!response.ok) {
					const errorText = await response.text();
					return {
						content: [{ type: "text" as const, text: `Exa API error (${response.status}): ${errorText}` }],
						isError: true,
					};
				}

				const data = (await response.json()) as ExaResponse;

				if (!data.results || data.results.length === 0) {
					return {
						content: [{ type: "text" as const, text: `No results found for: "${params.query}"` }],
						details: { resultCount: 0 },
					};
				}

				// Format results
				const lines: string[] = [];
				lines.push(`Found ${data.results.length} result(s) for "${params.query}":\n`);

				for (let i = 0; i < data.results.length; i++) {
					const r = data.results[i];
					if (!r.url) continue;

					lines.push(`### ${i + 1}. ${r.title ?? r.url}`);
					lines.push(`**URL:** ${r.url}`);

					if (r.author) lines.push(`**Author:** ${r.author}`);
					if (r.publishedDate) lines.push(`**Published:** ${r.publishedDate}`);

					if (r.text) {
						const snippet = r.text.length > 300 ? r.text.slice(0, 300) + "..." : r.text;
						lines.push(`\n${snippet}`);
					} else if (r.highlights?.length) {
						lines.push(`\n${r.highlights.join(" ... ")}`);
					}

					lines.push("");
				}

				return {
					content: [{ type: "text" as const, text: lines.join("\n") }],
					details: {
						resultCount: data.results.length,
						searchType: data.resolvedSearchType,
						requestId: data.requestId,
					},
				};
			} catch (err) {
				if ((err as Error).name === "AbortError") {
					return { content: [{ type: "text" as const, text: "Search aborted" }], isError: true };
				}
				return {
					content: [{ type: "text" as const, text: `Exa search failed: ${(err as Error).message}` }],
					isError: true,
				};
			}
		},
	});
}
