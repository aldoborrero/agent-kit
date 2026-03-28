# brave-search

Privacy-focused web search via [Brave Search API](https://brave.com/search/api/). Free tier available.

## Tool

| Tool | Description |
|------|-------------|
| `brave_search` | Web search with structured results (title, URL, snippet, age) |

## Configuration

| Variable | Required | Description |
|----------|----------|-------------|
| `BRAVE_API_KEY` | Yes | Free key at [brave.com/search/api](https://brave.com/search/api/) |

## Parameters

- `query` — search query
- `num_results` — 1-20 (default: 10)
- `recency` — filter by freshness: `day`, `week`, `month`, `year`

## When to use

- General web queries
- Recent news and forum discussions
- Privacy-focused search (no tracking)
- Free tier (2,000 queries/month)

## Attribution

Based on [oh-my-pi](https://github.com/can1357/oh-my-pi) Brave search provider.
