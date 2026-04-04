# oracle

Generates a short “likely next user prompt” after each completed agent run and shows it in a widget.

## Features

- Generates up to 3 brief next-step suggestions after `agent_end`
- Freely returns fewer than 3 when extra candidates would be too similar
- Shows the selected suggestion as ghost text in the editor
- Shows the next available suggestion in a widget with a counter:
  - `oracle next[2/3]: check the logs`
- Lets you cycle through multiple suggestions with:
  - `Alt+Up`
  - `Alt+Down`
- Lets you insert the selected suggestion into the editor with:
  - `Tab`
  - `Right Arrow`
- Lets you dismiss the suggestion (restoring native Up/Down history scroll) with:
  - `Escape`
- Toggle or inspect status with:
  - `/oracle`
  - `/oracle on`
  - `/oracle off`
  - `/oracle status`
- Configure the oracle model with:
  - `/oracle model` (opens TUI selector)
  - `/oracle model select` (opens TUI selector)
  - `/oracle model status`
  - `/oracle model current`
  - `/oracle model clear`
  - `/oracle model provider/model-id`

## Model selection

Oracle model selection can be configured via JSON or environment variables.

Typed command selection and TUI selection write project-local config to `<cwd>/.pi/oracle.json`.

## JSON configuration

Supported files (project overrides global):

- `~/.pi/oracle.json`
- `<cwd>/.pi/oracle.json`

Example:

```json
{
  "model": "provider/model-id"
}
```

Also accepted:

```json
{
  "defaultModel": "provider/model-id"
}
```

## Environment variables

Uses this environment variable if set:

```bash
PI_ORACLE_MODEL=provider/model-id
```

Example:

```bash
PI_ORACLE_MODEL=provider/model-id
```

Default:

```bash
current
```

Meaning:
- first try the environment variable if set
- otherwise use JSON config (`<cwd>/.pi/oracle.json` overrides `~/.pi/oracle.json`)
- otherwise try the current session model
- if the configured model is unavailable, fall back to the current session model (if usable), then to the first available model

Legacy compatibility:
- `PI_PROMPT_SUGGESTION_MODEL` is still accepted as a fallback env var

## UX

This is a v1 implementation:
- the first suggestion is shown inline in the editor as ghost text when the editor is empty
- the next suggestion is shown in the oracle widget above the editor with a counter
- the widget also tells you which suggestion is currently in the editor
- the model returns a JSON array of candidate suggestions
- it may return 1, 2, or 3 suggestions depending on how distinct the options are
- `Alt+Up` / `Alt+Down` cycles between available suggestions when there are multiple
- `Up Arrow` / `Down Arrow` always scroll native message history (unblocked)
- `Escape` dismisses the current suggestion
- accepting the selected suggestion inserts it into the editor with `Tab` or `Right Arrow`
- it does **not** auto-send the suggestion

## Notes

- Suggestions are filtered and deduplicated to avoid assistant-voice, filler, long text, or meta output
- Generation uses a separate in-memory agent session with no tools/extensions loaded
- Speculation (precomputing the next response) is intentionally omitted in v1
