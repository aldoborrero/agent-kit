# voice

Toggle-to-record speech-to-text input for pi-coding-agent. Multiple STT backends, configurable language, and project context hints for coding vocabulary recognition.

## Commands

| Command | Description |
|---------|-------------|
| `/voice` | Toggle recording (start/stop) |
| `/voice config` | Open interactive settings panel (provider, language, mode) |
| `/voice cancel` | Cancel recording without transcribing |
| `/voice provider <auto\|groq\|openai\|daemon>` | Switch STT provider |
| `/voice lang <code>` | Set transcription language (default: `en`) |
| `/voice mode <paste\|send>` | Set output mode (`paste` = editor, `send` = auto-submit) |
| `/voice status` | Show current configuration |

All subcommands support tab completion — type `/voice ` and press Tab.

## Keyboard Shortcut

`Ctrl+Alt+V` — toggle recording

## STT Providers

| Provider | Env var | Latency | Cost |
|----------|---------|---------|------|
| Groq Whisper | `GROQ_API_KEY` | ~0.5s | $0.02/hr |
| OpenAI Whisper | `OPENAI_API_KEY` | ~2-5s | $0.006/min |
| Local daemon | `VOICE_DAEMON_URL` | Near-instant | Free |

Auto-detects based on which env var is set. Priority: daemon > Groq > OpenAI.

### Local daemon setup

Any HTTP daemon compatible with:
- `POST /record/start` — begin recording
- `POST /record/stop` — stop and return `{ "text": "transcription" }`
- `GET /health` — health check

Example: [nvrxq/claude-code-voice](https://github.com/nvrxq/claude-code-voice) (faster-whisper daemon).

## Configuration

Settings are persisted to `~/.pi/voice.json` and restored on every session start. Changes made via `/voice config` or the inline subcommands are saved automatically.

Persisted config takes priority over env vars.

| Variable | Default | Description |
|----------|---------|-------------|
| `GROQ_API_KEY` | — | Groq Whisper API key |
| `OPENAI_API_KEY` | — | OpenAI Whisper API key |
| `VOICE_DAEMON_URL` | `http://localhost:8765` | Local whisper daemon URL |
| `VOICE_LANG` | `en` | Transcription language (env var fallback) |
| `VOICE_MODE` | `paste` | Output mode (env var fallback) |

## System Dependencies

**Linux:** `arecord` (from `alsa-utils`), `sox`/`rec`, or `ffmpeg`
**macOS:** `sox`/`rec` or `ffmpeg`

Not needed when using the daemon provider (daemon handles audio capture).

## Footer

| State | Display |
|-------|---------|
| Idle | `voice:groq` (provider shown quietly in status bar) |
| Recording (with level) | `● REC ▁▃▅▇` |
| Recording (daemon) | `● REC` |
| Transcribing | `● transcribing…` |
| Error | `● <message>` (clears after 3s) |

## Features

- **Persistent config** — provider, language, and mode saved to `~/.pi/voice.json`
- **Interactive settings** — `/voice config` opens a navigable settings panel
- **Tab completion** — `/voice [tab]` shows available subcommands
- Auto-stop on 2 seconds of silence
- Max recording duration: 60 seconds
- Project context hints (package name + git branch) improve coding term recognition
- Zero npm dependencies
