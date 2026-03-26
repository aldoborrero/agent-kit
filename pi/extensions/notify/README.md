# notify

Sends a native terminal notification when the agent finishes and is waiting for input.

## Supported terminals

- **OSC 777**: Ghostty, iTerm2, WezTerm, rxvt-unicode
- **OSC 99**: Kitty
- **Windows toast**: Windows Terminal (WSL)

## Events

| Event | Action |
|-------|--------|
| `agent_end` | Send desktop notification |

## Attribution

Based on [pi-mono example extension](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/examples/extensions/notify.ts).
