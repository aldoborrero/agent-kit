# Bitwarden CLI Extension

Provides secure access to Bitwarden vault items (passwords, notes, cards, identities) through the `bw` CLI.

## Requirements

- [Bitwarden CLI](https://bitwarden.com/help/cli/) (`bw`) installed and in PATH
- Logged in via `bw login` before starting a session

## Security Model

This extension is designed with defense-in-depth:

1. **No credentials in context**: Passwords and sensitive fields are **never** injected into the LLM conversation. The extension returns masked references that the agent can use as opaque handles.

2. **Session token isolation**: The `BW_SESSION` token is kept in `process.env` and never exposed to the agent or logged. The token is cleared on session shutdown.

3. **Read-only vault access**: Only `bw get` and `bw list` are exposed. No write/create/edit/delete operations are available.

4. **Explicit unlock flow**: The vault must be unlocked interactively by the user (via UI prompt). The extension never stores or handles the master password directly.

5. **Field-level access control**: By default, only non-sensitive fields (name, username, URIs, folder, notes metadata) are returned. Passwords and TOTP secrets require explicit `expose: true` parameter with user confirmation.

6. **Auto-lock on shutdown**: The vault is locked when the session ends.

7. **Audit logging**: All vault access is logged to the extension status bar.

## Commands

- `/bw` - Show vault status (locked/unlocked, sync time)
- `/bw unlock` - Unlock vault interactively
- `/bw lock` - Lock vault immediately
- `/bw sync` - Sync vault with server

## Tools

### `bw_get`

Retrieve a single vault item by name, ID, or URI.

Parameters:
- `query` (string, required): Item name, UUID, or URI to search for
- `expose` (boolean, optional, default: false): If true, include password/TOTP fields (requires user confirmation)

Returns item metadata (name, username, URIs). Password fields are masked unless `expose: true` and user confirms.

### `bw_list`

List vault items matching a search query.

Parameters:
- `search` (string, optional): Search term
- `folder` (string, optional): Filter by folder name
- `collection` (string, optional): Filter by collection name

Returns a list of item summaries (name, username, folder) without any sensitive fields.

## Usage

```bash
# Enable the extension
pi -e ./pi/extensions/bitwarden/bitwarden.ts

# Or add to package.json pi.extensions array
```

## Architecture

```
User prompt: "What's my GitHub password?"
    |
    v
Agent calls bw_get(query: "github.com")
    |
    v
Extension runs: bw get item github.com --session $BW_SESSION
    |
    v
Extension returns: { name: "GitHub", username: "user@example.com", password: "********" }
    |
    (if agent needs actual password, calls with expose: true)
    |
    v
Extension prompts user: "Allow exposing password for 'GitHub'?"
    |
    v
User confirms → password returned in tool result (visible to agent for one turn)
```
