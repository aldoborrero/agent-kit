# bitwarden

Secure secret retrieval from Bitwarden vault via the `bw` CLI.

## Prerequisites

1. Install the [Bitwarden CLI](https://bitwarden.com/help/cli/)
2. Log in: `bw login`
3. Unlock and export the session: `export BW_SESSION=$(bw unlock --raw)`

If you use `direnv`, add `BW_SESSION` to your `.envrc` for automatic loading.

## Commands

| Command | Description |
|---------|-------------|
| `/bw` | Show vault status (locked/unlocked/unauthenticated) |

## Tools

| Tool | Description |
|------|-------------|
| `bw_search` | Search vault items by name/URI/folder — returns **metadata only** (never passwords) |
| `bw_get_env` | Retrieve a secret and inject into an environment variable (preferred) |
| `bw_get_note` | Retrieve a Secure Note's contents |

## Security model

- **Master password**: never seen by the agent — user must authenticate externally
- **BW_SESSION**: read from environment, not stored or logged
- **Search results**: metadata only (name, ID, username, URIs) — no secret values
- **Secret retrieval**: always requires explicit user confirmation via UI prompt
- **Preferred flow**: secrets go into env vars (`bw_get_env`), not into conversation text
- **No UI = no secrets**: retrieval is blocked in non-interactive mode

## Example workflow

```
Agent: I need the database password. Let me search Bitwarden.
→ bw_search("production database")
→ Found: "Prod DB" (Login), ID: abc-123, Username: app_user

Agent: I'll inject the password into an env var.
→ bw_get_env(item_id: "abc-123", field: "password", env_var: "DB_PASSWORD")
→ [User confirms in UI]
→ Secret injected into $DB_PASSWORD

Agent: Now I can use it.
→ bash: psql -U app_user -h db.example.com mydb
  (password picked up from $DB_PASSWORD via .pgpass or PGPASSWORD)
```
