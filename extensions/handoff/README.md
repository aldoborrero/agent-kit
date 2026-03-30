# handoff

Transfer context to a new focused session. Instead of compacting (which is lossy), handoff extracts what matters for your next task and creates a new session with a generated prompt.

## Usage

```
/handoff now implement this for teams as well
/handoff execute phase one of the plan
/handoff check other places that need this fix
```

## How it works

1. Gathers conversation history from the current branch
2. Uses the current model to generate a self-contained prompt summarizing relevant context + the new goal
3. Opens an editor so you can review/edit the generated prompt
4. Creates a new session (with parent tracking) and sets the prompt as a draft

## Commands

| Command | Description |
|---------|-------------|
| `/handoff <goal>` | Generate a handoff prompt and start a new session |

## Attribution

Based on [pi-mono example extension](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/examples/extensions/handoff.ts).
