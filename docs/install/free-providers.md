# Free model providers

Several providers give API access to their models for free, with rate limits. Add a key to `~/.openclaw/.env` and
run the installer again: the provider's models appear in OpenClaw, and [Multi-model](../features/multi-model.md)
counts them as free, so they can be answering models. Keys are created by you on each provider's site; nothing
here creates accounts.

| Provider | Key in `.env` | Where | Free tier (as published by mid-2026) |
|---|---|---|---|
| OpenRouter | `OPENROUTER_API_KEY` | openrouter.ai | `:free` models: about 20 requests a minute, 50 a day (1,000 a day after a $10 top-up) |
| Google AI Studio | `GEMINI_API_KEY` | aistudio.google.com | Gemini and Gemma models, 5–15 requests a minute; free only while billing is off for the project |
| Groq | `GROQ_API_KEY` | console.groq.com | open models (Llama, Qwen, GPT OSS and others), about 30 requests a minute, 1,000 a day |

The numbers come from OpenRouter's comparison of free LLM APIs (updated September 2026, checked against the
community list cheahjs/free-llm-api-resources); providers change them without notice, so treat them as a guide
and check the provider's own page. Groq (and the paid Cerebras and Mistral) are separate OpenClaw packages: the installer
installs them when their key is set. Google, Hugging Face and NVIDIA are built into OpenClaw.

**Cerebras, NVIDIA, Mistral and Hugging Face** were listed with free tiers in mid-2026, but in November 2026 the
first three asked for a payment method before issuing an API key, and Hugging Face answered every call of a new
account with 402 "purchase pre-paid credits". Their keys still work in OpenClaw (`CEREBRAS_API_KEY`,
`NVIDIA_API_KEY`, `MISTRAL_API_KEY`, `HF_TOKEN`; the installer installs the Cerebras and Mistral packages), but they
are not counted as free.

**Which providers count as free.** By default, Google AI Studio and Groq when their key is in `.env`. To choose yourself, set
`WORKBENCH_FREE_PROVIDERS` (provider ids, comma-separated, for example `groq,cerebras,ollama`), or `none`. A
provider counted as free has all its models offered as answering models; a model that is not actually free
there (a Google Pro model with billing off, say) fails and Multi-model replaces it with the next one.

**Region and proxy.** Some free models are not available in every region: a request that leaves through a proxy
in another country may get "not available in your region". Free tiers also use your requests to improve models
at some providers (Google outside the EU/UK, Mistral's Experiment plan); keep private data away from them.
