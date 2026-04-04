# sandbox

OS-level sandboxing for bash commands using a sandbox runtime library. Enforces filesystem and network restrictions at the OS level (sandbox-exec on macOS, bubblewrap on Linux).

**Disabled by default.** Enable with `/sandbox on` or set `"enabled": true` in config.

## Commands

| Command | Description |
|---------|-------------|
| `/sandbox` | Show current status and configuration |
| `/sandbox on` | Enable sandboxing for this session |
| `/sandbox off` | Disable sandboxing for this session |

## Configuration

Configs are merged (project overrides global):
- `~/.pi/agent/sandbox.json` (global)
- `<cwd>/.pi/sandbox.json` (project-local)

```json
{
  "enabled": true,
  "network": {
    "allowedDomains": ["github.com", "*.github.com", "registry.npmjs.org"],
    "deniedDomains": []
  },
  "filesystem": {
    "denyRead": ["~/.ssh", "~/.aws", "~/.gnupg"],
    "allowWrite": [".", "/tmp"],
    "denyWrite": [".env", ".env.*", "*.pem", "*.key"]
  }
}
```

Set `"enabled": true` in config to auto-enable on session start.

## Flags

| Flag | Description |
|------|-------------|
| `--no-sandbox` | Force disable sandboxing (overrides config) |

## Dependencies

- sandbox runtime dependency (included in package.json)
- Linux: `bubblewrap`, `socat`, `ripgrep`
- macOS: uses built-in sandbox-exec

## Attribution

Based on [pi-mono example extension](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/examples/extensions/sandbox/).
