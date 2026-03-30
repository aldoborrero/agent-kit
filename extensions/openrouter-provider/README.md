# openrouter-provider

Access frontier models from multiple providers through a single [OpenRouter](https://openrouter.ai) API key. Curated selection of models not easily available elsewhere.

## Configuration

| Variable | Required | Description |
|----------|----------|-------------|
| `OPENROUTER_API_KEY` | Yes | Get one at [openrouter.ai/keys](https://openrouter.ai/keys) |

## Why OpenRouter?

- **Chinese-origin models** (Kimi, ByteDance) — no international API, OpenRouter is the access path
- **Google Gemini** — no GCP project or OAuth needed, just an API key
- **xAI Grok** — unified access alongside other providers
- **Single API key** — one key for all providers, OpenAI-compatible

## Models

### Frontier

| Model | Context | Input $/M | Output $/M | Reasoning | Vision |
|-------|---------|-----------|------------|-----------|--------|
| Kimi K2.5 | 262K | $0.42 | $2.20 | Yes | Yes |
| Gemini 3.1 Pro | 1M | $2.00 | $12.00 | Yes | Yes |
| Gemini 2.5 Pro | 1M | $1.25 | $10.00 | Yes | Yes |
| Grok 4.20 Beta | 2M | $2.00 | $6.00 | Yes | Yes |

### Fast & Efficient

| Model | Context | Input $/M | Output $/M | Reasoning | Vision |
|-------|---------|-----------|------------|-----------|--------|
| Gemini 3 Flash | 1M | $0.50 | $3.00 | Yes | Yes |
| Grok 4 Fast | 2M | $0.20 | $0.50 | Yes | Yes |
| Grok Code Fast | 256K | $0.20 | $1.50 | Yes | No |
| Devstral Medium | 131K | $0.40 | $2.00 | No | No |

### Budget

| Model | Context | Input $/M | Output $/M | Reasoning | Vision |
|-------|---------|-----------|------------|-----------|--------|
| ByteDance Seed 2.0 Mini | 262K | $0.10 | $0.40 | Yes | Yes |
| Inception Mercury 2 | 128K | $0.25 | $0.75 | Yes | No |

## Usage

Switch models with `Ctrl+L` or `/model` in pi.
