# web-tools

High-level web tools for pi-coding-agent.

This extension provides the preferred agent-facing interface for web access:

- `web_search` — search the web and return structured results with titles, URLs, and snippets
- `web_fetch` — fetch a specific webpage as markdown, with optional extraction from the fetched content

These tools are intended to replace direct agent use of backend-specific tools such as `exa_search`, `brave_search`, and `jina` in most cases.

## Tools

### `web_search`
Search the web with a unified interface.

#### Parameters
- `query` — search query
- `provider` — `auto` (default), `exa`, or `brave`
- `include_domains` — optional allowlist of domains
- `exclude_domains` — optional denylist of domains
- `num_results` — optional result count
- `type` — optional Exa mode: `auto`, `neural`, `fast`, `deep`

#### Behavior
- Defaults to Exa when available
- Falls back to Brave in `auto` mode if Exa fails and Brave is configured
- Normalizes output into a single structured result format
- Always includes a `Sources:` section

### `web_fetch`
Fetch a specific URL and return markdown.

#### Parameters
- `url` — the URL to fetch
- `extract` — optional question or extraction request answered from the fetched page content
- `max_chars` — optional maximum size of returned raw markdown

#### Behavior
- Validates that the URL is public and uses `http` or `https`
- Rejects local/private/loopback hosts and embedded credentials
- Fetches markdown via Jina Reader (`r.jina.ai`)
- If `extract` is provided and a model is available, answers the extraction request from the fetched content
- Otherwise returns raw markdown, truncated if necessary

## Usage guidance

Prefer:
- `web_search` when you need to discover sources, documentation, articles, or recent information
- `web_fetch` when you already have an exact URL and want to read that page

Use backend-specific tools only when you explicitly need their provider-specific behavior.
