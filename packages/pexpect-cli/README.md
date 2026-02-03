# pexpect-cli

Python CLI tool for managing persistent [pexpect](https://pexpect.readthedocs.io/) sessions via [pueue](https://github.com/Nukesor/pueue). Provides a server/client architecture where sessions run as pueue tasks and can be interacted with through the CLI client.

## Components

| Script | Entry point | Description |
|--------|-------------|-------------|
| `pexpect-server` | `pexpect_cli.server:main` | Backend server managing pexpect sessions as pueue tasks |
| `pexpect-cli` | `pexpect_cli.client:main` | CLI client for creating, interacting with, and stopping sessions |

## Usage

```bash
# Start a new session
pexpect-cli --start [--name <label>]

# Execute code in a session (reads Python/pexpect code from stdin)
echo 'child = pexpect.spawn("ssh user@host")' | pexpect-cli <session_id>

# List active sessions
pexpect-cli --list

# Stop a session
pexpect-cli --stop <session_id>
```

## Installation

### Via Nix Flake

```bash
nix build .#pexpect-cli
nix profile install .#pexpect-cli
```

The Nix package automatically wraps the binaries with `pueue` in PATH.

## Requirements

- Python >= 3.13
- [pexpect](https://pexpect.readthedocs.io/) >= 4.9.0
- [pueue](https://github.com/Nukesor/pueue) daemon running (`pueued -d`)
