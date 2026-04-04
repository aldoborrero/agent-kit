import { complete, type Message } from "@mariozechner/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

const EXA_API_URL = "https://api.exa.ai/search";
const BRAVE_SEARCH_URL = "https://api.search.brave.com/res/v1/web/search";
const DEFAULT_FETCH_MAX_CHARS = 20_000;
const MAX_FETCH_MAX_CHARS = 100_000;
const DEFAULT_SEARCH_RESULTS = 8;
const MAX_SEARCH_RESULTS = 20;
const EXTRACT_PROMPT_MAX_CHARS = 40_000;

interface ExaResult {
  title?: string | null;
  url?: string | null;
  text?: string | null;
  highlights?: string[] | null;
  publishedDate?: string | null;
}

interface ExaResponse {
  resolvedSearchType?: string;
  results?: ExaResult[];
}

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

type SearchResult = {
  title: string;
  url: string;
  snippet?: string;
  published?: string;
};

function ok(text: string, details?: Record<string, unknown>) {
  return {
    content: [{ type: "text" as const, text }],
    details: details ?? {},
  };
}

function fail(text: string, details?: Record<string, unknown>) {
  return {
    content: [{ type: "text" as const, text }],
    isError: true,
    details: details ?? {},
  };
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function truncate(text: string, maxChars: number): { text: string; truncated: boolean } {
  if (text.length <= maxChars) return { text, truncated: false };
  return {
    text: `${text.slice(0, Math.max(0, maxChars - 1))}…`,
    truncated: true,
  };
}

function normalizeDomain(domain: string): string {
  return domain.trim().toLowerCase().replace(/^\*\./, "");
}

function hostnameMatches(hostname: string, domain: string): boolean {
  const normalizedHost = hostname.toLowerCase();
  const normalizedDomain = normalizeDomain(domain);
  return normalizedHost === normalizedDomain || normalizedHost.endsWith(`.${normalizedDomain}`);
}

function isPrivateIp(hostname: string): boolean {
  if (/^127\./.test(hostname)) return true;
  if (/^10\./.test(hostname)) return true;
  if (/^192\.168\./.test(hostname)) return true;
  if (/^169\.254\./.test(hostname)) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname)) return true;
  if (hostname === "::1") return true;
  if (hostname.startsWith("fc") || hostname.startsWith("fd")) return true;
  return false;
}

function validatePublicHttpUrl(input: string): URL {
  const url = new URL(input);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only http and https URLs are supported");
  }
  if (url.username || url.password) {
    throw new Error("URLs with embedded credentials are not allowed");
  }

  const hostname = url.hostname.toLowerCase();
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "0.0.0.0" ||
    hostname === "::1" ||
    hostname.endsWith(".local") ||
    isPrivateIp(hostname)
  ) {
    throw new Error("Local, private, or loopback hosts are not allowed");
  }

  return url;
}

function filterByDomains(results: SearchResult[], includeDomains?: string[], excludeDomains?: string[]): SearchResult[] {
  return results.filter((result) => {
    try {
      const hostname = new URL(result.url).hostname;
      if (includeDomains?.length && !includeDomains.some((domain) => hostnameMatches(hostname, domain))) {
        return false;
      }
      if (excludeDomains?.length && excludeDomains.some((domain) => hostnameMatches(hostname, domain))) {
        return false;
      }
      return true;
    } catch {
      return false;
    }
  });
}

function formatSearchResults(query: string, provider: string, results: SearchResult[]): string {
  const lines: string[] = [];
  lines.push(`Found ${results.length} result(s) for "${query}" using ${provider}:`);
  lines.push("");

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    lines.push(`### ${i + 1}. ${result.title}`);
    lines.push(`- URL: ${result.url}`);
    if (result.published) lines.push(`- Published: ${result.published}`);
    if (result.snippet) lines.push(`- Snippet: ${result.snippet}`);
    lines.push("");
  }

  lines.push("Sources:");
  for (const result of results) {
    lines.push(`- ${result.title}: ${result.url}`);
  }

  return lines.join("\n");
}

async function extractFromMarkdown(
  ctx: ExtensionContext,
  url: string,
  markdown: string,
  extractPrompt: string,
  signal?: AbortSignal,
): Promise<string | null> {
  if (!ctx.model) return null;

  const apiKey = await ctx.modelRegistry.getApiKey(ctx.model);
  if (!apiKey) return null;

  const content = truncate(markdown, EXTRACT_PROMPT_MAX_CHARS).text;
  const systemPrompt = [
    "You extract specific information from fetched web content.",
    "Answer using only the provided page content.",
    "Be concise but include the key facts the user asked for.",
    "If the content does not contain the answer, say so clearly.",
    "Include short direct quotes only when helpful.",
    "Do not invent facts not present in the page.",
  ].join(" ");

  const userMessage: Message = {
    role: "user",
    timestamp: Date.now(),
    content: [{
      type: "text",
      text: [
        `URL: ${url}`,
        "",
        "User request:",
        extractPrompt,
        "",
        "Page content:",
        content,
      ].join("\n"),
    }],
  };

  const response = await complete(
    ctx.model,
    { systemPrompt, messages: [userMessage] },
    { apiKey, signal },
  );

  if (response.stopReason === "aborted" || response.stopReason === "error") {
    return null;
  }

  const text = response.content
    .filter((block): block is { type: "text"; text: string } => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();

  return text || null;
}

function buildBraveSnippet(result: BraveResult): string | undefined {
  const parts: string[] = [];
  if (result.description?.trim()) parts.push(result.description.trim());
  for (const snippet of result.extra_snippets ?? []) {
    const trimmed = snippet?.trim();
    if (trimmed && !parts.includes(trimmed)) parts.push(trimmed);
  }
  if (parts.length === 0) return undefined;
  return truncate(parts.join(" "), 320).text;
}

async function runExaSearch(params: {
  query: string;
  numResults: number;
  searchType: "auto" | "neural" | "fast" | "deep";
  includeDomains?: string[];
  excludeDomains?: string[];
  signal: AbortSignal;
}): Promise<{ provider: string; results: SearchResult[] }> {
  const apiKey = process.env.EXA_API_KEY;
  if (!apiKey) {
    throw new Error("EXA_API_KEY not set");
  }

  const response = await fetch(EXA_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
    },
    body: JSON.stringify({
      query: params.query,
      numResults: params.numResults,
      type: params.searchType,
      includeDomains: params.includeDomains,
      excludeDomains: params.excludeDomains,
    }),
    signal: params.signal,
  });

  if (!response.ok) {
    throw new Error(`Exa API error (${response.status}): ${await response.text()}`);
  }

  const data = (await response.json()) as ExaResponse;
  const results: SearchResult[] = (data.results ?? [])
    .filter((result): result is ExaResult & { url: string } => typeof result.url === "string" && result.url.length > 0)
    .map((result) => ({
      title: result.title?.trim() || result.url,
      url: result.url,
      snippet: result.text?.trim()
        ? truncate(result.text.trim().replace(/\s+/g, " "), 320).text
        : (result.highlights?.length ? truncate(result.highlights.join(" ... "), 320).text : undefined),
      published: result.publishedDate ?? undefined,
    }));

  return {
    provider: data.resolvedSearchType ? `exa:${data.resolvedSearchType}` : "exa",
    results,
  };
}

async function runBraveSearch(params: {
  query: string;
  numResults: number;
  signal: AbortSignal;
}): Promise<{ provider: string; results: SearchResult[] }> {
  const apiKey = process.env.BRAVE_API_KEY;
  if (!apiKey) {
    throw new Error("BRAVE_API_KEY not set");
  }

  const url = new URL(BRAVE_SEARCH_URL);
  url.searchParams.set("q", params.query);
  url.searchParams.set("count", String(params.numResults));
  url.searchParams.set("extra_snippets", "true");

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "X-Subscription-Token": apiKey,
    },
    signal: params.signal,
  });

  if (!response.ok) {
    throw new Error(`Brave API error (${response.status}): ${await response.text()}`);
  }

  const data = (await response.json()) as BraveResponse;
  const results: SearchResult[] = (data.web?.results ?? [])
    .filter((result): result is BraveResult & { url: string } => typeof result.url === "string" && result.url.length > 0)
    .map((result) => ({
      title: result.title?.trim() || result.url,
      url: result.url,
      snippet: buildBraveSnippet(result),
      published: result.age ?? undefined,
    }));

  return { provider: "brave", results };
}

export default function webToolsExtension(pi: ExtensionAPI) {
  pi.registerTool({
    name: "web_fetch",
    description:
      "Fetch a specific webpage and return its content as markdown. Use this when you already have an exact URL for docs, articles, release notes, or reference pages.",
    promptSnippet: "Fetch and read a specific webpage as markdown.",
    promptGuidelines: [
      "Use web_fetch when the user already gave you an exact URL or when you need to read a single known page.",
      "Prefer web_search first if you still need to discover the right page or source.",
      "Use max_chars to keep very large pages manageable.",
    ],
    parameters: Type.Object({
      url: Type.String({ description: "The URL to fetch (http/https only)" }),
      extract: Type.Optional(
        Type.String({
          description: "Optional question or extraction request to answer from the fetched page content",
        }),
      ),
      max_chars: Type.Optional(
        Type.Number({
          description: `Maximum number of characters to return (default: ${DEFAULT_FETCH_MAX_CHARS}, max: ${MAX_FETCH_MAX_CHARS})`,
          minimum: 1000,
          maximum: MAX_FETCH_MAX_CHARS,
        }),
      ),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      let url: URL;
      try {
        url = validatePublicHttpUrl(params.url);
      } catch (error) {
        return fail(`Invalid URL: ${error instanceof Error ? error.message : String(error)}`);
      }

      const maxChars = clamp(params.max_chars ?? DEFAULT_FETCH_MAX_CHARS, 1000, MAX_FETCH_MAX_CHARS);
      const jinaUrl = `https://r.jina.ai/${url.toString()}`;

      try {
        const response = await fetch(jinaUrl, {
          headers: { Accept: "text/markdown" },
          signal,
        });

        if (!response.ok) {
          return fail(`Web fetch failed: ${response.status} ${response.statusText}`, {
            url: url.toString(),
            status: response.status,
          });
        }

        const text = await response.text();

        if (params.extract?.trim()) {
          const answer = await extractFromMarkdown(ctx, url.toString(), text, params.extract.trim(), signal);
          if (answer) {
            return ok([
              `Fetched: ${url.toString()}`,
              `Question: ${params.extract.trim()}`,
              "",
              answer,
            ].join("\n"), {
              url: url.toString(),
              extracted: true,
              originalLength: text.length,
            });
          }
        }

        const truncated = truncate(text, maxChars);
        const lines = [
          `Fetched: ${url.toString()}`,
          `Length: ${text.length} chars${truncated.truncated ? ` (truncated to ${maxChars})` : ""}`,
          params.extract?.trim()
            ? `Extract requested but no model was available, so returning raw content instead.`
            : undefined,
          "",
          truncated.text,
        ].filter((line): line is string => typeof line === "string");

        return ok(lines.join("\n"), {
          url: url.toString(),
          originalLength: text.length,
          returnedLength: truncated.text.length,
          truncated: truncated.truncated,
          extracted: false,
        });
      } catch (error) {
        if ((error as Error).name === "AbortError") {
          return fail("Web fetch aborted", { url: url.toString() });
        }
        return fail(`Web fetch failed: ${(error as Error).message}`, { url: url.toString() });
      }
    },
  });

  pi.registerTool({
    name: "web_search",
    description:
      "Search the web and return structured results with titles, URLs, and snippets. Use this for recent info, documentation discovery, articles, and source gathering.",
    promptSnippet: "Search the web and return structured results with sources.",
    promptGuidelines: [
      "Use web_search when you need to discover sources or find recent/external information.",
      "Prefer provider='exa' for documentation and semantic research; use provider='brave' for general web search.",
      "Always cite the returned URLs when answering the user.",
    ],
    parameters: Type.Object({
      query: Type.String({ description: "Search query" }),
      provider: Type.Optional(
        Type.Union([
          Type.Literal("auto"),
          Type.Literal("exa"),
          Type.Literal("brave"),
        ], {
          description: "Search backend to use: auto (default), exa, or brave",
        }),
      ),
      include_domains: Type.Optional(
        Type.Array(Type.String(), {
          description: "Only include results from these domains",
        }),
      ),
      exclude_domains: Type.Optional(
        Type.Array(Type.String(), {
          description: "Exclude results from these domains",
        }),
      ),
      num_results: Type.Optional(
        Type.Number({
          description: `Number of results to return (default: ${DEFAULT_SEARCH_RESULTS}, max: ${MAX_SEARCH_RESULTS})`,
          minimum: 1,
          maximum: MAX_SEARCH_RESULTS,
        }),
      ),
      type: Type.Optional(
        Type.Union([
          Type.Literal("auto"),
          Type.Literal("neural"),
          Type.Literal("fast"),
          Type.Literal("deep"),
        ], {
          description: "Exa search mode when provider is auto/exa",
        }),
      ),
    }),
    async execute(_toolCallId, params, signal) {
      const query = params.query.trim();
      if (!query) {
        return fail("Search query cannot be empty");
      }
      if (params.include_domains?.length && params.exclude_domains?.length) {
        return fail("Use either include_domains or exclude_domains, not both in the same request");
      }

      const provider = params.provider ?? "auto";
      const numResults = clamp(params.num_results ?? DEFAULT_SEARCH_RESULTS, 1, MAX_SEARCH_RESULTS);
      const includeDomains = params.include_domains?.map(normalizeDomain).filter(Boolean);
      const excludeDomains = params.exclude_domains?.map(normalizeDomain).filter(Boolean);

      try {
        let searchResponse: { provider: string; results: SearchResult[] };

        if (provider === "exa") {
          searchResponse = await runExaSearch({
            query,
            numResults,
            searchType: params.type ?? "auto",
            includeDomains,
            excludeDomains,
            signal,
          });
        } else if (provider === "brave") {
          searchResponse = await runBraveSearch({ query, numResults, signal });
          searchResponse.results = filterByDomains(searchResponse.results, includeDomains, excludeDomains);
        } else {
          try {
            searchResponse = await runExaSearch({
              query,
              numResults,
              searchType: params.type ?? "auto",
              includeDomains,
              excludeDomains,
              signal,
            });
          } catch (exaError) {
            if (!process.env.BRAVE_API_KEY) {
              throw exaError;
            }
            searchResponse = await runBraveSearch({ query, numResults, signal });
            searchResponse.results = filterByDomains(searchResponse.results, includeDomains, excludeDomains);
          }
        }

        const results = searchResponse.results.slice(0, numResults);
        if (results.length === 0) {
          return ok(`No results found for: "${query}"`, {
            query,
            provider: searchResponse.provider,
            resultCount: 0,
          });
        }

        return ok(formatSearchResults(query, searchResponse.provider, results), {
          query,
          provider: searchResponse.provider,
          resultCount: results.length,
          includeDomains,
          excludeDomains,
        });
      } catch (error) {
        if ((error as Error).name === "AbortError") {
          return fail("Web search aborted", { query });
        }
        return fail(`Web search failed: ${(error as Error).message}`, {
          query,
          provider,
        });
      }
    },
  });
}
