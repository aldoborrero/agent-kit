---
name: searxng-search
description: Search a configured SearXNG instance using the searxng-search CLI. Use when the user wants privacy-oriented meta-search, a self-hosted search backend, or an LLM-friendly alternative to built-in web search.
---

# SearXNG Search

## Overview

The `searxng-search` CLI queries a SearXNG instance and returns normalized, LLM-friendly results.

Use it when:
- the user explicitly wants SearXNG
- a self-hosted or privacy-friendly search backend is preferred
- you want machine-readable search results from a configurable instance

## Configuration

Set the instance URL with either:

```bash
export SEARXNG_API_BASE="https://your-searxng.example"
```

or create `~/.config/searxng-search/config.json`:

```json
{
  "api_base": "https://your-searxng.example",
  "timeout": 20,
  "headers": {
    "User-Agent": "searxng-search/0.1"
  }
}
```

The CLI queries:

```text
<api_base>/search?q=...&format=json
```

## Basic Usage

```bash
searxng-search "rust async tutorial"
```

JSON output:

```bash
searxng-search --json "rust async tutorial"
```

Limit results:

```bash
searxng-search --limit 5 "rust async tutorial"
```

Filter engines or categories:

```bash
searxng-search --engines duckduckgo,startpage --category general "brave api key"
```

## Output

Normalized result objects include:
- `title`
- `url`
- `snippet`
- `engine`
- `engines`
- `score`
- `category`
- `published_date`

## Best Practices

- Prefer `--json` when you need to post-process results.
- Prefer official docs, GitHub, and primary sources when answering technical questions.
- Follow up by fetching top URLs when you need full-page context.
- SearXNG may return duplicate sources across engines, so compare URLs before citing multiple results.

## Troubleshooting

If you get `403 Forbidden`:
- ensure the SearXNG instance has `json` enabled in `search.formats`
- verify your instance allows API requests from your client
- check reverse proxy or limiter settings

If the CLI says no API base is configured:
- set `SEARXNG_API_BASE`
- or write `~/.config/searxng-search/config.json`
