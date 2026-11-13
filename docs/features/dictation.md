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

The same model transcribes voice notes sent to the chat. **Tap to talk** (a spoken conversation) is separate: it
needs a realtime voice provider, or `talk.realtime.mode: "stt-tts"` with a text-to-speech provider; the composer
still says that no realtime voice provider is configured until one is set.

If the provider is not reachable from your network directly, add its host to the proxy hosts
([Network and proxy](../install/network.md)), for example `api.groq.com`.
