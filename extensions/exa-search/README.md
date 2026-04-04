# exa-search

AI-powered web search via [Exa](https://exa.ai). Supports neural (semantic), fast (keyword), and deep (comprehensive) search modes with domain and date filtering.

> [!NOTE]
> This is now considered a backend-specific search tool. Prefer `web_search` from `web-tools` for general agent-facing web search unless you explicitly need Exa-specific behavior.

## Tool

| Tool | Description |
|------|-------------|
| `exa_search` | Search the web with structured results (title, URL, snippet, date) |

## Configuration

| Variable | Required | Description |
|----------|----------|-------------|
| `EXA_API_KEY` | Yes | Get one at [exa.ai](https://exa.ai) |

## Search types

| Type | Best for |
|------|---------|
| `neural` | Natural language queries ("how to implement OAuth in Go") |
| `fast` | Keyword queries ("lodash debounce npm") |
| `deep` | Comprehensive research |
| `auto` | Exa picks the best mode (default) |

## Parameters

- `query` — search query (natural language works best with neural)
- `num_results` — 1-100 (default: 10)
- `type` — neural, fast, deep, auto
- `include_domains` — restrict to specific sites (e.g. `["github.com"]`)
- `exclude_domains` — exclude specific sites
- `start_published_date` / `end_published_date` — ISO 8601 date range

## Attribution

Based on [oh-my-pi](https://github.com/can1357/oh-my-pi) Exa search provider.
