# kagi-search

Privacy-focused web search using [Kagi](https://kagi.com). Returns both standard search results and Kagi's Quick Answer (AI-generated summary with references).

## Tool

**`kagi_search`** -- Search the web using Kagi.

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `query` | `string` | Search query (required) |
| `limit` | `number` | Max results (default: 10) |
| `quick_answer` | `boolean` | Include Quick Answer summary (default: true) |

## Example

```json
{ "query": "rust async trait implementation", "limit": 5 }
```

## Authentication

The extension authenticates via a session token retrieved by a configurable password command. Configuration is stored at `~/.config/kagi/config.json`:

```json
{
  "password_command": "rbw get kagi-session-link",
  "timeout": 30
}
```

The `password_command` should return a Kagi session link URL or token. The default uses [rbw](https://github.com/doy/rbw) (Bitwarden CLI) to retrieve the token.

## Output

- **Quick Answer**: AI-generated markdown summary with source references and contribution percentages
- **Search Results**: Numbered list of results with title, URL, and snippet

## Requirements

- Active [Kagi](https://kagi.com) subscription
- Password manager command configured to provide the session token
