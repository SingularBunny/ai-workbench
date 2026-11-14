# Dictation

The microphone button in the chat composer turns speech into text: press it, speak, press **Stop**, and the text
lands in the composer. OpenClaw records in the browser and transcribes the recording on the Gateway when capture
ends, with a speech-to-text model from `tools.media.models`. Without one the button says that no transcription
provider is configured.

The installer sets that model from the keys in `~/.openclaw/.env`, the first that is there:

| Key | Model | Note |
|---|---|---|
| `GROQ_API_KEY` | `groq/whisper-large-v3-turbo` | free tier ([Free model providers](../install/free-providers.md)) |
| `OPENAI_API_KEY` | `openai/gpt-4o-mini-transcribe` | paid |
| `OPENROUTER_API_KEY` | `openrouter/openai/whisper-large-v3-turbo` | paid |

`WORKBENCH_DICTATION_MODEL=<provider>/<model>` picks another one, `none` leaves dictation off. A `tools.media.models`
you set yourself is kept. Whisper detects the language by itself. Check the model from the command line:

```bash
openclaw infer audio transcribe --file note.wav --model groq/whisper-large-v3-turbo
```

The same model transcribes voice notes sent to the chat.

## Tap to talk

**Tap to talk** is a spoken conversation: you speak, the chat's model answers, and the answer is read aloud. It
needs a realtime voice provider, or `talk.realtime.mode: "stt-tts"` — the dictation model above, then the chat,
then a text-to-speech provider. Until one is set the composer says that no realtime voice provider is configured.

`WORKBENCH_TTS=silero` sets up the second way with a local [Silero](https://github.com/snakers4/silero-models)
model: no key, and no network once installed. The installer puts into `~/.openclaw/workbench/tts` a
[uv](https://docs.astral.sh/uv/) environment with PyTorch for the CPU and `num2words` (about 0.9 GB), the Russian
model `v5_6_ru` (150 MB, checked by sha256) and `installer/tts/silero-tts.py`. It then points OpenClaw's
`tts-local-cli` provider at it for `tts` and `talk`, with automatic spoken replies off. Numbers are read as words and
Latin letters in Russian sounds. `WORKBENCH_TTS_SPEAKER` picks the voice: `xenia` (default), `baya`, `kseniya`,
`aidar`, `eugene`. A reply takes about 4 seconds on a laptop CPU. A speech provider you set yourself (`tts.provider`)
is kept. Check it from the command line:

```bash
openclaw gateway call talk.speak --params '{"text":"Проверка связи"}' --json
```

The Silero models are free for personal and non-commercial use
([license](https://github.com/snakers4/silero-models/blob/master/LICENSE)).

If the provider is not reachable from your network directly, add its host to the proxy hosts
([Network and proxy](../install/network.md)), for example `api.groq.com`.
