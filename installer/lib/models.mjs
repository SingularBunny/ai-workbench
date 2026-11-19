// Free model providers, dictation and speech models. Part of installer/lib.mjs (pure functions, no I/O).
import path from "node:path";

/**
 * Providers with a free tier (docs/install/free-providers.md): provider id → the .env keys OpenClaw reads for it.
 * A provider whose key is set counts as free for Multi-model (aiwb-compare freeProviders), so its models can be
 * answering models. WORKBENCH_FREE_PROVIDERS overrides the list: ids separated by commas, or "none".
 */
// Only providers whose calls are free with a plain key: in November 2026 Cerebras, NVIDIA and Mistral asked for a
// payment method before issuing a key, and Hugging Face answered 402 "purchase pre-paid credits" for a new account.
// A paid key counted as free would let Multi-model spend money; such models can be marked free with
// WORKBENCH_FREE_PROVIDERS.
export const FREE_TIER_PROVIDERS = {
  google: ["GEMINI_API_KEY", "GOOGLE_API_KEY"], groq: ["GROQ_API_KEY"],
};

export function freeProviderSteps(env) {
  const explicit = String(env.WORKBENCH_FREE_PROVIDERS ?? "").trim();
  const ids = explicit
    ? (explicit === "none" ? [] : explicit.split(",").map((s) => s.trim()).filter(Boolean))
    : Object.entries(FREE_TIER_PROVIDERS).filter(([, keys]) => keys.some((k) => String(env[k] ?? "").trim())).map(([id]) => id);
  if (!explicit && !ids.length) return [];
  return [{ kind: "config", id: "plugins.entries.aiwb-compare.config.freeProviders",
    note: ids.length ? `free model providers: ${ids.join(", ")}` : "no free model providers",
    argv: ["config", "set", "plugins.entries.aiwb-compare.config.freeProviders", JSON.stringify(ids), "--strict-json"] }];
}

/** Providers whose catalog must be refreshed before a step that writes model references (agents.defaults.model):
 *  all but the built-in OpenRouter and Anthropic and the Claude CLI runtime. */
export function modelProvidersToRefresh(step) {
  if (step.kind !== "config" || step.id !== "agents.defaults.model") return [];
  let value;
  try { value = JSON.parse(step.argv[3]); } catch { return []; }
  const refs = [value?.primary, ...(value?.fallbacks ?? [])].filter((r) => typeof r === "string" && r.includes("/"));
  return [...new Set(refs.map((r) => r.split("/")[0]))].filter((p) => !["openrouter", "anthropic", "claude-cli"].includes(p));
}

/**
 * Dictation in the chat (the composer microphone) needs a speech-to-text model: OpenClaw transcribes the recording
 * through tools.media.models when capture ends. WORKBENCH_DICTATION_MODEL picks one (`provider/model`, or `none`);
 * otherwise the first provider with a key: Groq Whisper (free tier), OpenAI, then OpenRouter's Whisper. An authored
 * tools.media.models (current) is kept: it is the user's choice.
 */
export const DICTATION_MODELS = [
  { keys: ["GROQ_API_KEY"], provider: "groq", model: "whisper-large-v3-turbo" },
  { keys: ["OPENAI_API_KEY"], provider: "openai", model: "gpt-4o-mini-transcribe" },
  { keys: ["OPENROUTER_API_KEY"], provider: "openrouter", model: "openai/whisper-large-v3-turbo" },
];

export function dictationSteps(env, current) {
  if (current !== undefined && current !== null) return [];
  const explicit = String(env.WORKBENCH_DICTATION_MODEL ?? "").trim();
  if (explicit === "none") return [];
  let pick = null;
  if (explicit) {
    const [provider, ...rest] = explicit.split("/");
    if (provider && rest.length) pick = { provider, model: rest.join("/") };
  } else {
    pick = DICTATION_MODELS.find((m) => m.keys.some((k) => String(env[k] ?? "").trim())) ?? null;
  }
  if (!pick) return [];
  const models = [{ provider: pick.provider, model: pick.model, capabilities: ["audio"] }];
  return [
    { kind: "config", id: "tools.media.models", note: `dictation: ${pick.provider}/${pick.model}`,
      argv: ["config", "set", "tools.media.models", JSON.stringify(models), "--strict-json"] },
    { kind: "config", id: "tools.media.audio.enabled", argv: ["config", "set", "tools.media.audio.enabled", "true", "--strict-json"] },
  ];
}

/**
 * Spoken replies for Talk (the chat's voice mode) with a local Silero model: no key, no network after install.
 * WORKBENCH_TTS=silero installs it into ~/.openclaw/workbench/tts: a uv virtual environment with CPU PyTorch and
 * num2words, the model (pinned sha256) and installer/tts/silero-tts.py, then points OpenClaw's tts-local-cli
 * provider at it for both tts and talk, with talk.realtime.mode stt-tts (browser Talk: dictation model → chat →
 * speech). An authored tts.provider (current) is kept, as is a missing uv (the reason is printed).
 */
export const SILERO = {
  url: "https://models.silero.ai/models/tts/ru/v5_6_ru.pt",
  sha256: "04cc9b1d08ce38bcaa9d02c488d80d3e6806d17f7eaa7c95982f36a3cbf50b2e",
  speakers: ["xenia", "baya", "kseniya", "aidar", "eugene"],
};

export function ttsSteps(env, { home, script, current, uv, win = process.platform === "win32" }) {
  const pick = String(env.WORKBENCH_TTS ?? "").trim();
  if (!pick || pick === "none") return [];
  if (pick !== "silero") return [{ kind: "skip", id: "tts", reason: `WORKBENCH_TTS=${pick}: only silero is installed by the installer` }];
  if (current) return [{ kind: "keep-config", id: "tts", reason: `tts.provider is ${current}, kept` }];
  if (!uv) return [{ kind: "skip", id: "tts silero", reason: "uv is not installed (https://docs.astral.sh/uv/)" }];
  const dir = path.join(home, ".openclaw", "workbench", "tts");
  const python = path.join(dir, ".venv", win ? "Scripts" : "bin", win ? "python.exe" : "python");
  const model = path.join(dir, path.basename(SILERO.url));
  const speaker = String(env.WORKBENCH_TTS_SPEAKER ?? "").trim() || SILERO.speakers[0];
  const provider = { command: python, args: ["-I", path.join(dir, "silero-tts.py"), "--model", model, "--speaker", speaker, "--out", "{{OutputPath}}"],
    outputFormat: "wav", timeoutMs: 120000 };
  return [
    { kind: "tts-env", id: "tts venv", note: dir, exec: "uv", argv: ["venv", "--allow-existing", "--python", "3.12", path.join(dir, ".venv")] },
    { kind: "tts-env", id: "tts packages", note: "CPU PyTorch, num2words", exec: "uv",
      argv: ["pip", "install", "--python", python, "--torch-backend", "cpu", "torch", "num2words"] },
    { kind: "file-download", id: "silero model", note: path.basename(SILERO.url), url: SILERO.url, sha256: SILERO.sha256, file: model },
    { kind: "file-copy", id: "silero-tts.py", from: script, to: path.join(dir, "silero-tts.py") },
    { kind: "config", id: "tts", note: `tts-local-cli: Silero, ${speaker}`,
      argv: ["config", "set", "tts", JSON.stringify({ auto: "off", provider: "tts-local-cli", providers: { "tts-local-cli": provider } }), "--strict-json"] },
    { kind: "config", id: "talk.provider", argv: ["config", "set", "talk.provider", JSON.stringify("tts-local-cli"), "--strict-json"] },
    { kind: "config", id: "talk.providers", argv: ["config", "set", "talk.providers", JSON.stringify({ "tts-local-cli": provider }), "--strict-json"] },
    { kind: "config", id: "talk.realtime.mode", argv: ["config", "set", "talk.realtime.mode", JSON.stringify("stt-tts"), "--strict-json"] },
  ];
}
