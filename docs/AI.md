# AI providers — platform spec

How the platform does AI, every provider wired today (what it consumes/produces, licensing/pricing shape),
and the providers worth adding next. Companion to [SECURITY_COMPLIANCE.md](SECURITY_COMPLIANCE.md) (§ platform
AI keys) and the endpoint/media specs.

> **Pricing note:** figures below are the *pricing MODEL* (per-token / per-image / per-second / per-character /
> credits / subscription) and rough tier, not live rates — always confirm current pricing on the provider's
> page before committing. **Content licensing:** for every generative provider here, the customer owns/根may use
> the generated output commercially under that provider's terms; a few carry attribution/asset-license nuances
> (noted per provider). Verify each provider's ToS for your use.

## How it works (architecture)

- **One provider-agnostic interface** — [`Ai`](../packages/ai/src/AiModel.ts): `chat` / `structured` / `image`
  / `speak` / `transcribe` / `sound` / `video` / `cloneVoice`, each guarded by a **capability** the adapter
  declares. Calls to an unsupported capability throw; operational failures (provider 4xx/5xx, bad output) are
  **returned** (`ok:false`), never thrown.
- **Adapters** — one per provider in [`packages/ai/src/adapters`](../packages/ai/src/adapters); shared
  machinery (key resolution, retry/backoff, usage metering) lives in `BaseAdapter`.
- **Factory + registry** — [`AiFactory`](../packages/ai/src/AiFactory.ts) instantiates a client by provider;
  add an engine with `register()` (open/closed).
- **Routing (non-secret config)** — [`AiRouting`](../packages/api/src/ai/model/AiRouting.ts): each service's
  `config/ai` profile maps a **modality** (chat/image/video/tts/stt/sound/speech-cloning) → a provider (+
  optional model). The `CATALOG` declares each provider's *public* capabilities (what it CAN do) and drives
  the AI-Gen provider pickers; the actual call gates on the instantiated client's real `capabilities`, so a
  catalogued-but-unimplemented modality resolves to "unavailable" rather than a broken call.
- **Keys** — never in code/config. Platform-shared provider keys live in Secrets Manager as `ai-<provider>`
  (`<env>-platform-secret-ai-<provider>`), read-granted to every service and injected as `SECRET_AI_<PROVIDER>`;
  `AiFactory.usePlatformSecrets()` resolves them. AWS Bedrock uses IAM (no key).

### Modalities (the "media types" of AI work)

`chat` (text ± vision → text/JSON) · `image` (prompt → image) · `video` (prompt/image → video) ·
`text_to_speech` (text → audio) · `speech_to_text` (audio → transcript) · `speech_cloning` (reference audio →
reusable voice) · `sound` (prompt → sound effects / music).

---

## Providers wired today

| Provider | Auth | Consumes | Produces | Implemented capabilities | Default model(s) |
|---|---|---|---|---|---|
| **AWS Bedrock** | AWS IAM | text, image (vision) | text, image, video | chat, structured, image, video | Claude 3.5 Sonnet · Titan Image v1 · Nova Reel v1 |
| **OpenAI** | key `ai-openai` | text, image (vision), audio | text, image, transcript | chat, structured, image, transcribe | gpt-4o-mini · gpt-image-1 · whisper-1 |
| **Google Gemini** | key `ai-gemini` | text, image (vision), audio | text, image, video, audio (speech), transcript | chat, structured, image, video, speech, transcribe | gemini-2.5-flash · imagen-3.0 · veo-3.0 · gemini-2.5-flash-tts |
| **Anthropic** | key `ai-anthropic` | text, image (vision) | text | chat, structured | claude-3-5-sonnet-latest |
| **ElevenLabs** | key `ai-elevenlabs` | text, reference audio, audio | audio (speech + sound FX), cloned voice, transcript | speech, sound, voice_clone, transcribe | eleven_multilingual_v2 · scribe_v1 |
| **fish.audio** | key `ai-fish` | text | audio (speech) | speech | speech-1.6 |
| **Magnific / Freepik** | key `ai-magnific` | text (prompt) | image | image | mystic |
| **Amazon Transcribe** | AWS IAM | audio | transcript (timed) | transcribe | (service; no model knob) |

### AWS Bedrock — the default, IAM-authed multi-model
- **Consumes/produces:** text (Claude) → text; prompt → image (Amazon Titan Image); prompt → video (Amazon
  Nova Reel, async → S3). Vision on Claude models.
- **Auth/pricing:** AWS IAM (no key); billed through AWS — **per input/output token** (text), **per image**,
  **per output-second** (video). Commercial; enterprise data terms via AWS. On LocalStack the call path works
  but real generation runs against real AWS.
- **Notes:** the AiFactory default. Also the home for Llama / Mistral / Titan text if routed there.

### OpenAI
- **Consumes/produces:** text (± vision images) → text/JSON; prompt → image (`gpt-image-1`); audio → transcript
  (`whisper-1`).
- **Auth/pricing:** API key; **per-token** (text), **per-image** (billed by size/quality; image gen requires a
  verified org + can hit a **billing hard limit** — see the surfaced errors), **per-minute** (Whisper).
- **Gap:** OpenAI **TTS** (`tts-1` / `gpt-4o-mini-tts`) is catalogued (`text_to_speech`) but `speak()` isn't
  implemented on the adapter yet — easy add.

### Google Gemini
- **Consumes/produces:** text (± vision) → text/JSON (also powers **image auto-tagging**); prompt → image
  (**Imagen 3**); prompt → video (**Veo 3**, async long-running + file download); text → speech (**Gemini TTS**,
  PCM→WAV); audio → transcript (best-effort timed segments for captions).
- **Auth/pricing:** API key; **per-token** (text/vision), **per-image** (Imagen), **per-second** (Veo — preview,
  premium), **per-character** (TTS). `GEMINI_PROJECT` is only for Vertex AI; the key path here is the Generative
  Language API.
- **Not wired:** **music** (Lyria is realtime/streaming — needs a WebSocket path, not request/response); image
  **editing** ("Nano Banana" `gemini-2.5-flash-image`) — no image-edit method on the `Ai` interface yet.

### Anthropic (Claude)
- **Consumes/produces:** text (± vision) → text/JSON. Strongest for chat/structured reasoning.
- **Auth/pricing:** API key; **per-token** (input/output, with prompt-cache discounts). No image/audio/video
  generation.

### ElevenLabs
- **Consumes/produces:** text → speech (high-quality TTS); prompt → **sound effects**; reference audio →
  **cloned voice**; audio → **transcript** (**Scribe**, `scribe_v1`, with word-level timings folded into
  caption-sized segments for SRT/VTT).
- **Auth/pricing:** API key; **character-based subscription** (monthly character quota + tiers). STT (Scribe)
  is billed per minute of audio. Voice cloning requires consent per their terms; cloned voices are account-private.

### fish.audio
- **Consumes/produces:** text → speech; **sound effects** (prompt → audio); supports **voice cloning** (a
  model/voice id).
- **Catalogued modalities:** `text_to_speech`, `speech_cloning`, `sound`. **Wired today:** `speak()` only.
- **Gap:** `sound()` is **not yet implemented** — fish.audio is now listed as a SOUND provider (selectable /
  routable), but the sound-effect generation call still needs its endpoint/params confirmed; until then a SOUND
  route to fish falls back to `speak()`. (ElevenLabs' `sound()` is the wired SOUND path.)
- **Auth/pricing:** API key; **credit / per-character** pricing — **API credit is separate from website/platform
  credit** (a 402 "Insufficient API credit" means top up the *API* balance at fish.audio/app/developers, not the
  site wallet). Good low-cost TTS + open voice library.

### Magnific / Freepik
- **Consumes/produces:** prompt → image (generation) + upscale/enhance (`mystic`), async task + poll.
- **Auth/pricing:** Freepik API key; **credit-based**. Note Freepik/Magnific asset-license terms for commercial
  use of enhanced/generated assets.

### Amazon Transcribe
- **Consumes/produces:** audio → **transcript** with timed segments. IAM-authed (no API key) — same AWS account
  as the rest of the platform.
- **How it runs (async, S3-backed):** unlike the OpenAI/ElevenLabs adapters (which upload the audio inline over
  HTTP), Transcribe reads its input from **S3**. The adapter stages the audio in the service's staging bucket,
  starts a transcription job, polls it to completion, fetches the transcript JSON, then deletes the staged audio.
  It prefers Transcribe's `audio_segments` for captions and falls back to grouping the word-level `items` into
  sentences. Requires the `transcribeBucket` adapter option — the media service passes its staging bucket for the
  `speech_to_text` modality (via `aiFor( SPEECH_TO_TEXT, { transcribeBucket } )`).
- **Auth/pricing:** AWS IAM; billed through AWS **per second of audio** (with a **free tier**: 60 min/month for
  the first 12 months). No `model` knob — the `model` field reports `aws-transcribe`. Language is auto-identified
  when the caller doesn't pin a full BCP-47 code (a bare `en` maps to `en-US`). On LocalStack the API path works;
  real transcription runs against real AWS.

## Configuring transcription (speech-to-text)

Video captioning and the "transcribe" media action route through the **`speech_to_text`** modality. Three
providers implement it today — **OpenAI** (`whisper-1`), **Google Gemini** (`gemini-2.5-flash`), **ElevenLabs**
(`scribe_v1`), and **Amazon Transcribe** (IAM, no model). Pick one per service in that service's `config/ai`
routing profile (managed in the **Console → AI settings**, validated against `AiRouting.SCHEMA`):

```jsonc
// AppConfig  config/ai  (the media service's profile)
{
  "routes": {
    "speech_to_text": { "provider": "aws-transcribe" }        // or "openai" | "gemini" | "elevenlabs"
    // "model" is optional — omit to use the per-(provider,modality) default in AiRouting.MODELS
  }
}
```

The default seeded route is **OpenAI `whisper-1`** (`AiRouting.DEFAULT`). To switch providers you only change
this route — no code change. Then make sure that provider's credential/permissions are in place:

| Provider | Route value | Credential / setup | Notes |
|---|---|---|---|
| OpenAI | `openai` | Secret `ai-openai` (Console → Secrets) | Whisper; per-minute billing. Watch for 429 `insufficient_quota`. |
| Google Gemini | `gemini` | Secret `ai-gemini` | Generative Language API key (not Vertex). |
| ElevenLabs | `elevenlabs` | Secret `ai-elevenlabs` | Scribe (`scribe_v1`); returns word timings → good captions. |
| Amazon Transcribe | `aws-transcribe` | **No key** — AWS IAM | Needs the service's **staging S3 bucket** (auto-passed by the media service) and IAM perms for `transcribe:StartTranscriptionJob` / `GetTranscriptionJob` + `s3:PutObject`/`GetObject`/`DeleteObject` on the staging bucket. Free tier: 60 min/mo for 12 months. |

Keys follow the standard `ai-<provider>` Secrets Manager pattern (§ *Keys* above); Amazon Transcribe is the only
STT provider with no key (it's IAM-authed like Bedrock). If a route names a provider whose adapter/credential
isn't available, the modality resolves to "unavailable" and the transcribe job fails cleanly with a message.

## Capability × provider matrix

| Capability | Bedrock | OpenAI | Gemini | Anthropic | ElevenLabs | fish | Magnific | Transcribe |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| chat / structured (± vision) | ✅ | ✅ | ✅ | ✅ | — | — | — | — |
| image generation | ✅ | ✅ | ✅ | — | — | — | ✅ | — |
| video generation | ✅ | — | ✅ | — | — | — | — | — |
| text-to-speech | — | ▲ | ✅ | — | ✅ | ✅ | — | — |
| speech-to-text | — | ✅ | ✅ | — | ✅ | — | — | ✅ |
| sound / music | — | — | ▲(music) | — | ✅(SFX) | — | — | — |
| voice cloning | — | — | — | — | ✅ | ▲ | — | — |

✅ implemented · ▲ provider supports it but the adapter path isn't wired yet · — n/a.

### Wiring gaps to close (provider supports it; adapter doesn't yet)
- **OpenAI `speak()`** — TTS (`gpt-4o-mini-tts`).
- **fish.audio `cloneVoice()`** — voice cloning.
- **Gemini music** (Lyria realtime) + **image editing** (needs an `editImage` capability on the interface).

---

## Providers to add later (recommended)

Grouped by what they'd unlock. All are API-key adapters (same `ai-<provider>` secret pattern) unless noted.

### Image
- **Black Forest Labs — FLUX** (`flux-pro`/`dev`) — top-tier quality + prompt adherence; via BFL API, or through
  fal.ai / Replicate. Per-image.
- **Stability AI — Stable Diffusion 3 / SD3.5** — image gen + also **Stable Video Diffusion**. API key, per-image.
- **Ideogram** — best-in-class **text rendering in images** (posters, signage). Per-image.
- **Recraft** — brand/design + **vector/SVG** output. Per-image.
- **Topaz / Magnific-style upscalers** — dedicated enhance/upscale if Freepik isn't enough.

### Video
- **Runway (Gen-3/Gen-4)** — leading text/image→video. Credit-based.
- **Luma — Dream Machine** — fast, cheap text/image→video. Credit-based.
- **Pika**, **Kling** — additional video styles/lengths.
- (Veo is already covered via Gemini; Nova Reel via Bedrock.)

### Speech / audio
- **Amazon Transcribe** (STT) — ✅ **wired** (see above). AWS-native, IAM-authed, cheap, region-local.
- **Amazon Polly** (TTS) — AWS-native, IAM-authed (no key), cheap, region-local; the TTS counterpart to
  Transcribe. Not wired yet.
- **Deepgram** / **AssemblyAI** — best-in-class **STT with word-level timestamps + diarization** → ideal for
  captions/subtitles (better than the LLM-transcription fallback). Per-minute.
- **Cartesia (Sonic)** / **Play.ht** / **Rime** — ultra-low-latency, natural TTS; strong for realtime voice.

### Music / sound
- **Suno** / **Udio** — full **music generation** (song + vocals). Credit-based. (Fills the Lyria gap.)
- **ElevenLabs** already covers sound effects.

### Text / reasoning / embeddings
- **Mistral** (also on Bedrock), **Cohere** (great **embeddings** + rerank), **DeepSeek** — cost/latency options.
- **Voyage / OpenAI / Cohere embeddings** — needed once we add semantic search / RAG (there's an `embed`
  capability + `EMBED` modality slot but no consumer wired yet).

### Aggregators (fastest way to breadth)
- **Replicate** / **fal.ai** — host hundreds of open models (image/video/audio/music) behind one key + one
  billing relationship (per-second/compute). A single "replicate" adapter with a `model` route unlocks many
  models at once — a pragmatic way to trial providers before a first-party integration.

## Adding a provider (checklist)
1. Add the value to `Ai.Provider` ([AiModel.ts](../packages/ai/src/AiModel.ts)) + `AiRouting.Provider` +
   a `CATALOG` entry with its modalities ([AiRouting.ts](../packages/api/src/ai/model/AiRouting.ts)).
2. Write the adapter in [`packages/ai/src/adapters`](../packages/ai/src/adapters) (extend `BaseAdapter`,
   declare `capabilities`, implement the supported methods) and `register()` it in `AiFactory`.
3. Declare the platform secret `ai-<provider>` in [cloud/src/app.ts](../cloud/src/app.ts) `platform.secrets`
   (and seed it locally in [cloud/local/put-secrets.mjs](../cloud/local/put-secrets.mjs)).
4. Add it to the Console's declared-secret catalog ([catalog.ts](../tools/console/src/shared/catalog.ts))
   so its key is manageable in the Secrets tab.
