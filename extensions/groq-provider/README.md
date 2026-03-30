# groq-provider

[Groq](https://groq.com) model provider with ultra-fast inference on dedicated LPU hardware.

## Configuration

| Variable | Required | Description |
|----------|----------|-------------|
| `GROQ_API_KEY` | Yes | Get one at [console.groq.com](https://console.groq.com) |

## Models

### Tier 1: Best coding quality

| Model | Context | Speed | Input $/M | Output $/M | Notes |
|-------|---------|-------|-----------|------------|-------|
| GPT-OSS 120B | 128K | ~500 tps | $0.15 | $0.60 | Best open-source coding model. Reasoning. |
| Kimi K2 | 256K | ~200 tps | $1.00 | $3.00 | Strongest agentic model. 200-300 sequential tool calls. |

### Tier 2: Best speed-to-quality

| Model | Context | Speed | Input $/M | Output $/M | Notes |
|-------|---------|-------|-----------|------------|-------|
| Qwen 3 32B | 131K | ~662 tps | $0.29 | $0.59 | Reasoning + parallel tool calling. |
| Llama 4 Scout 17B | 131K | ~594 tps | $0.11 | $0.34 | Vision support. Fast and cheap. |

### Tier 3: Fast and cheap

| Model | Context | Speed | Input $/M | Output $/M | Notes |
|-------|---------|-------|-----------|------------|-------|
| GPT-OSS 20B | 128K | ~1000 tps | $0.075 | $0.30 | Blazing fast. Good for simple tasks. |

## Usage

Switch models with `Ctrl+L` or `/model` in pi.

## Recommended strategy

- **Hard tasks**: GPT-OSS 120B — best quality, very affordable
- **Agentic workflows**: Kimi K2 — 256K context, deep tool use
- **Fast loop**: GPT-OSS 20B or Qwen 3 32B — quick completions, routing
