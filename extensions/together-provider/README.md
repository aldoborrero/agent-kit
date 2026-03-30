# together-provider

Registers [Together AI](https://www.together.ai/) as a model provider, giving access to a wide range of open-source and third-party models through the OpenAI-compatible completions API.

## Provider

**Name**: `together`
**API**: OpenAI Completions (`https://api.together.xyz/v1`)
**API Key env var**: `TOGETHER_API_KEY`

## Available Models

### Llama 4
| Model | Context | Reasoning | Input | Cost ($/M tokens in/out) |
|-------|---------|-----------|-------|--------------------------|
| Llama 4 Maverick 17B | 1M | No | text, image | $0.27 / $0.85 |
| Llama 4 Scout 17B | 1M | No | text, image | $0.18 / $0.59 |

### Llama 3.x
| Model | Context | Cost ($/M tokens in/out) |
|-------|---------|--------------------------|
| Llama 3.3 70B Turbo | 131K | $0.88 / $0.88 |
| Llama 3.1 405B Turbo | 130K | $3.50 / $3.50 |
| Llama 3.1 8B Turbo | 131K | $0.18 / $0.18 |

### DeepSeek
| Model | Context | Reasoning | Cost ($/M tokens in/out) |
|-------|---------|-----------|--------------------------|
| DeepSeek R1 | 164K | Yes | $3.00 / $7.00 |
| DeepSeek R1 0528 (Throughput) | 164K | Yes | $3.00 / $7.00 |
| DeepSeek V3.1 | 128K | No | $0.60 / $1.25 |

### Qwen
| Model | Context | Reasoning | Cost ($/M tokens in/out) |
|-------|---------|-----------|--------------------------|
| Qwen3 235B Thinking | 262K | Yes | $1.50 / $1.50 |
| Qwen3 235B Instruct | 262K | No | $1.50 / $1.50 |
| Qwen3 Coder 480B | 256K | No | $2.00 / $2.00 |
| Qwen3 Next 80B Thinking | 262K | Yes | $0.50 / $0.50 |
| Qwen3 Next 80B Instruct | 262K | No | $0.50 / $0.50 |
| Qwen 2.5 72B Turbo | 33K | No | $0.60 / $0.60 |
| Qwen3 VL 32B | 256K | No | $0.60 / $0.60 |

### Kimi (Moonshot)
| Model | Context | Reasoning | Cost ($/M tokens in/out) |
|-------|---------|-----------|--------------------------|
| Kimi K2 Thinking | 262K | Yes | $1.20 / $4.00 |
| Kimi K2 Instruct | 262K | No | $0.60 / $2.00 |
| Kimi K2.5 | 262K | Yes | $0.50 / $2.80 |

### Others
| Model | Context | Reasoning | Cost ($/M tokens in/out) |
|-------|---------|-----------|--------------------------|
| GLM 4.7 | 203K | No | $0.60 / $0.60 |
| GPT OSS 120B | 128K | No | $0.15 / $0.60 |
| GPT OSS 20B | 128K | No | $0.06 / $0.18 |
| Ministral 3 14B | 262K | No | $0.30 / $0.30 |
| Mistral Small 24B | 33K | No | $0.80 / $0.80 |
| Cogito v2 Llama 405B | 33K | Yes | $5.00 / $5.00 |
| Cogito v2.1 671B | 33K | Yes | $3.00 / $3.00 |
| Nemotron Nano 9B v2 | 131K | No | $0.15 / $0.15 |

## Requirements

- `TOGETHER_API_KEY` environment variable set with a valid Together AI API key
