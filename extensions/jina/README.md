# jina

Fetch webpages and return their content as clean markdown using [Jina AI's Reader API](https://jina.ai/reader/).

## Tool

**`jina`** -- Fetch a webpage and return its content as markdown.

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `url` | `string` | The URL to fetch (required) |

## Example

```json
{ "url": "https://docs.python.org/3/library/asyncio.html" }
```

## How It Works

Proxies the request through `https://r.jina.ai/{url}` with `Accept: text/markdown`, which strips navigation, ads, and boilerplate from the page and returns a clean markdown representation of the content.

## Use Cases

- Reading documentation pages
- Fetching article content
- Converting web pages to agent-readable markdown
