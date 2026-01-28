---
name: kagi-search
description: Search Kagi search engine using the kagi-search CLI tool. Use when user explicitly requests Kagi search, needs privacy-focused search results, wants Quick Answer instant responses, or requires complementary search results alongside web_search. Kagi provides high-quality, ad-free search results with unique features like Quick Answers for immediate factual responses.
---

# Kagi Search

## Overview

The kagi-search tool provides access to Kagi's privacy-focused search engine via command line. It returns both traditional search results and Kagi's Quick Answer feature for instant factual responses.

## When to Use Kagi Search

Use kagi-search when:

- User explicitly requests "search Kagi" or "use Kagi"
- User needs privacy-focused search results without ads or tracking
- User wants Quick Answer instant responses for factual queries
- User asks questions that benefit from Kagi's curated, high-quality results
- You need to complement web_search with alternative sources

Continue using web_search for:
- General web searches where Kagi wasn't explicitly requested
- Current events and breaking news (web_search is optimized for this)
- Multiple searches in quick succession (web_search has no rate limits)

## Basic Usage

### Standard Search

Search and display formatted results:

```bash
kagi-search "your query here"
```

Limit number of results:

```bash
kagi-search "blockchain development" -n 5
```

### JSON Output

Get structured JSON for programmatic processing:

```bash
kagi-search "ethereum scaling" -j
```

JSON output includes:
- `results[]`: Array of search results with `title`, `url`, `snippet`
- `quick_answer`: Object with `markdown`, `raw_text`, `references[]` (if available)

### Reading from stdin

Pipe queries to kagi-search:

```bash
echo "NixOS configuration" | kagi-search
```

## Quick Answer Feature

Kagi's Quick Answer provides immediate factual responses similar to featured snippets, but often with better quality and references.

Quick Answers appear automatically when available and include:
- Concise answer text
- Source references with links
- Related information

This is particularly useful for:
- Factual questions ("What is X?", "How does Y work?")
- Definitions and explanations
- Quick fact checking
- Technical questions with authoritative sources

## Output Formats

### Terminal Display

Default terminal output includes:
- Quick Answer section (if available) with answer text and up to 5 references
- Numbered search results with:
  - Title (blue, bold, clickable hyperlink)
  - URL (green, clickable hyperlink)
  - Snippet preview (dimmed text)
- Color-coded formatting for better readability

### JSON Output Mode

Use `-j` flag for structured data:

```json
{
  "results": [
    {
      "title": "Result title",
      "url": "https://example.com",
      "snippet": "Description text..."
    }
  ],
  "quick_answer": {
    "markdown": "Formatted answer text",
    "raw_text": "Plain text answer",
    "references": [
      {
        "title": "Source title",
        "url": "https://source.com"
      }
    ]
  }
}
```

## Common Patterns

### Search and Display Results

```bash
kagi-search "rust async programming patterns"
```

### Search with Limited Results

```bash
kagi-search "bitcoin whitepaper" -n 3
```

### Get JSON for Processing

```bash
results=$(kagi-search "web3 development" -j)
# Process JSON with jq or Python
```

### Combine with Other Tools

```bash
# Search and extract URLs
kagi-search "substrate blockchain" -j | jq -r '.results[].url'

# Search and open first result
url=$(kagi-search "solana programs" -j | jq -r '.results[0].url')
# Then use web_fetch to retrieve the page content
```

## Configuration

The tool uses session token authentication configured at `~/.config/kagi/config.json`:

```json
{
  "password_command": "rbw get kagi-session-link",
  "timeout": 30,
  "max_retries": 5
}
```

The password command should return a Kagi session link or token. Default uses `rbw` (Bitwarden CLI), but can be any command that outputs the session token.

## Error Handling

If authentication fails:
- Check that the session token is valid
- Verify the password command in config
- Ensure the token hasn't expired

If no results found:
- Try broader search terms
- Check query spelling
- Verify network connectivity

## Integration with Other Tools

### Complementing web_search

Use both tools for comprehensive research:

```bash
# Use web_search for current events
# Use kagi-search for technical deep dives or when user requests Kagi specifically
```

### Processing Results

Extract and fetch full page content:

```bash
# 1. Search with kagi-search
# 2. Get URLs from results
# 3. Use web_fetch to retrieve full page content
```

### Comparing Sources

Run parallel searches to compare results:

```bash
# Search both web_search and kagi-search
# Compare result quality and sources
# Synthesize information from both
```

## Best Practices

1. **Use Quick Answers** for factual queries that benefit from immediate responses
2. **Limit results** appropriately with `-n` flag to reduce noise
3. **Use JSON mode** when programmatically processing results
4. **Combine with web_fetch** to get full page content from interesting results
5. **Respect rate limits** - Kagi has usage limits on session-based access
6. **Fall back to web_search** if kagi-search fails or is unavailable

## Debug Mode

Enable debug logging to stderr:

```bash
kagi-search "query" -d
```

This shows:
- Request URLs
- Response details
- Authentication status
- Parsing information

Useful for troubleshooting authentication or parsing issues.
