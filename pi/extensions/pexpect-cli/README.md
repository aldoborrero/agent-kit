# pexpect-cli

Automate interactive CLI programs (SSH, databases, editors, interactive shells) with persistent [pexpect](https://pexpect.readthedocs.io/) sessions managed by [pueue](https://github.com/Nukesor/pueue).

## Tools

### `pexpect_start`

Create a new pexpect session. Returns an 8-character hex session ID.

| Parameter | Type | Description |
|-----------|------|-------------|
| `name` | `string` | Optional label (e.g. `ssh-prod`, `db-session`) |

### `pexpect_exec`

Execute Python/pexpect code in an existing session. The `pexpect` module is pre-imported and a `child` variable persists across executions within the same session. Use `print()` to return output.

| Parameter | Type | Description |
|-----------|------|-------------|
| `session_id` | `string` | 8-character hex session ID (required) |
| `code` | `string` | Python code to execute (required) |
| `timeout` | `number` | Execution timeout in milliseconds |

### `pexpect_stop`

Terminate a session and clean up resources.

| Parameter | Type | Description |
|-----------|------|-------------|
| `session_id` | `string` | 8-character hex session ID (required) |

### `pexpect_list`

List all active pexpect sessions with their IDs, status, and names.

## Example Workflow

```
1. pexpect_start { "name": "ssh-prod" }        -> returns session ID "a1b2c3d4"
2. pexpect_exec  { "session_id": "a1b2c3d4", "code": "child = pexpect.spawn('ssh user@host')" }
3. pexpect_exec  { "session_id": "a1b2c3d4", "code": "child.expect('password:'); child.sendline('...')" }
4. pexpect_exec  { "session_id": "a1b2c3d4", "code": "child.sendline('ls -la'); child.expect('\\$'); print(child.before.decode())" }
5. pexpect_stop  { "session_id": "a1b2c3d4" }
```

## Requirements

- `pexpect-cli` installed (from the `packages/pexpect-cli` package)
- [pueue](https://github.com/Nukesor/pueue) daemon running (`pueued -d`)
