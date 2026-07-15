# Media — Browse (asset marketplace & sourcing)

Working notes + traceable requirements for **Media : Browse** — a searchable repository of third-party web
assets (image / video / audio) an account can **download** (free) or **purchase**, that then land in the
account's **[library](./SPECS.md)** for use in **Studio** (media creation, later). Numbered in the media
register as **media-12.x … media-20.x** (continuing after `media-11.0`); priorities **A** (MVP) · **B** (core /
hardening) · **C** (later). Sibling of the main media spec ([SPECS.md](./SPECS.md)) — Browse acquisitions
become ordinary library `Media.Asset`s, so everything in SPECS.md (storage, variants, delivery, lifecycle,
events) applies once an asset is imported.

---

## Objective

One normalized **discovery + acquisition** surface across **many** asset providers — stock libraries
(Unsplash, Pexels, Pixabay, Artlist) and **AI generators** (OpenAI images, Magnific, ElevenLabs audio) — so a
user searches once, sees results with **clear licenses**, and either downloads a free asset or purchases one;
either way it's imported into the account library with full **provenance** (where it came from, license,
price, when). Providers are pluggable behind a **factory** (the platform's standard pattern), their **API keys
are root-managed secrets**, and each provider declares **which media types** it serves.

## Load-bearing ideas

- **Provider factory, not hard-wired vendors.** Every provider is an adapter behind one interface, chosen at
  runtime — mirrors the platform's existing factories (`@repo/ai` `AiFactory`; print's `AddressVerifier`).
  Adding a provider = registering an adapter, never editing call sites.
- **Normalize everything.** One `BrowseQuery` in, one `BrowseResult` shape out — regardless of which
  provider(s) answered. The UI and Studio never see a provider's raw schema.
- **Fan-out search.** 1..N providers searched **concurrently** for a single query; results merged, deduped,
  and paginated by a normalized cursor.
- **License is first-class.** Every result and every imported asset carries an explicit, typed license +
  attribution — never "unknown". A result with an unresolvable license is not importable.
- **Acquire → library with provenance.** A download/purchase imports the bytes as a normal `Media.Asset`
  (so variants/delivery/lifecycle just work) plus a `provenance` block (provider, source URL, license, price,
  acquired-at, external id, attribution).
- **Keys are secrets, config is not.** Provider **dev/API keys** live in Secrets Manager, writable **only by
  root**. Non-secret per-provider policy (enabled? which types? default page size?) lives in AppConfig
  (`BrowseConfig`, like `MediaConfig`), Console-editable.
- **AI generators are just providers** — and they ride the **platform AI factory** (`@repo/ai`), so their keys
  are centrally managed the same way (KMS-encrypted refs, per-account BYOK). This is the moment to make the AI
  factory a first-class, all-services capability (media-17).

## Where it runs

Browse is a **dedicated role of the media service** — `MediaBrowseService` (`Register.Service.MEDIA`,
`Ports.MEDIA.BROWSE`), separate from `main` so the provider search fan-out scales independently — but it
shares the media plane (S3 + DDB + the import pipeline), so acquisitions become ordinary library assets. The
factory + normalization layer is transport-agnostic. (Per-account BYOK keys are **deferred** — platform-managed
keys only for now.)

---

## The provider abstraction (factory)

Modeled on [`@repo/ai/AiFactory`](../../../../packages/ai/src/AiFactory.ts): a registry `Map<Provider,
AdapterFactory>` seeded with the built-ins and extensible via `register()`; keys resolved lazily via a
pluggable `KeyProvider` ([KmsKeyProvider / EnvKeyProvider](../../../../packages/ai/src/KeyProvider.ts)).

- **`BrowseProvider`** (adapter interface) — `search(query) → BrowseResult[]`, `get(externalId) → BrowseResult`,
  `acquire(externalId, opts) → { bytes | fetchUrl, license, price }`, and a **`capabilities()`** descriptor:
  `{ kinds: MediaKind[], canSearch, canGenerate, canDownloadFree, canPurchase, licenseTypes[] }`.
- **`BrowseFactory`** — `register(provider, make)`, `create({ provider })`, and `enabledFor(accountId) →
  BrowseProvider[]` (the providers turned on for this account/platform, keys resolved).
- **Capability-declared** (like print's `AddressVerifier`): a provider advertises which `Media.Kind`s it can
  serve; a search only fans out to providers that (a) are enabled, (b) declare the requested kind(s), and (c)
  have a resolvable key. Missing key / disabled → silently excluded (logged), never a hard error.

### Normalized search

- **`BrowseQuery`** (one shape): `{ text, kinds: MediaKind[], providers?: Provider[], page/cursor, filters?:
  { orientation, minWidth, minDurationSec, color, licenseType, cost: "free"|"paid"|"any" }, sort? }`.
- **`BrowseResult`** (one shape): `{ provider, externalId, kind, title, thumbnailUrl, previewUrl,
  width?/height?/durationSec?, author?, attribution?, license: License, cost: { free: boolean; price?: Money },
  sourceUrl, tags[] }`. Providers map their native fields into this; the UI/Studio only ever see this.
- **Fan-out + merge**: query the selected enabled providers concurrently; interleave/rank results; a
  **normalized cursor** encodes each provider's continuation token so "load more" resumes all of them.
- **Dedupe**: best-effort across providers (e.g. same source URL / perceptual hint) — accepted imperfect.

### Multi-provider response strategy

- **Now (synchronous):** the search endpoint fans out to the selected providers **concurrently**
  (`Promise.allSettled`) and **waits for all N** (each bounded by a **per-provider timeout**); a slow / failed /
  rate-limited provider is **excluded** from that page (its error surfaced as a per-provider status in the
  response), never fatal to the whole search. Then it normalizes + merges + ranks and returns one page. Simple,
  cacheable, stateless — the right first cut. Downside: the page is only as fast as the **slowest** provider
  (mitigated by the per-provider timeout + result cache, media-13.7).
- **Later (streaming, once websockets land):** stream **each provider's normalized page as it returns** so the
  UI fills progressively instead of blocking on the slowest — the search opens a subscription and the server
  pushes `{ provider, results, cursor, done }` frames (the same `Events.Envelope` push path). The synchronous
  fan-out remains the fallback / non-websocket path. See media-13.8.

---

## Licensing & rights

- Every `BrowseResult` and imported asset carries a typed **`License`**: `{ type: "cc0" | "cc-by" |
  "royalty-free" | "rights-managed" | "editorial" | "commercial" | "custom", requiresAttribution: boolean,
  attributionText?, url?, allowedUses?, restrictions? }`.
- **Clear before acquire**: the UI shows the license + attribution on every result and again at
  download/purchase; an asset whose license can't be resolved is **not** importable (fail-closed).
- **Attribution carried through**: if `requiresAttribution`, the imported asset stores the attribution text so
  Studio/exports can surface/credit it; this is a compliance obligation, not optional metadata.
- **Editorial / rights-managed** assets are flagged and (later) usage-gated in Studio (e.g. no commercial
  export) — spec'd here, enforced when Studio lands.

---

## Acquisition → library import + provenance

Download (free) or purchase both funnel into **one import path**: fetch the licensed bytes → store as a normal
`Media.Asset` (scope ACCOUNT) → run the standard scan → process pipeline (variants, probe, poster) → it's now
an ordinary library asset. The difference is a **provenance** record.

- **`Media.Asset` gains an optional `provenance`** (media-15) — set only on browse-imported assets:
  `{ provider, externalId, sourceUrl, license: License, cost: { free; price?: Money }, acquiredAt,
  acquiredBy, orderId? }`. Absent on uploaded assets (upload provenance = the uploader, already captured).
- **Purchase** records an order (provider, price, currency, external order/receipt id, timestamp) — the audit
  + billing trail; the asset's `provenance.orderId` links to it. (Payment rails reuse the account/billing
  service; a browse purchase is a billable line item.)
- **Re-acquire / dedupe**: if the same provider+externalId is already in the library, offer to reuse rather
  than re-import/re-buy.

---

## Provider configuration, dev keys & access (root)

- **Keys = Secrets Manager, root-only.** Each provider's API/dev key is a secret; a **root** endpoint stores /
  rotates it (`Access.AppRole.ROOT`). The service reads via the [`Secrets`](../../../../packages/services/src/aws/Secrets.ts)
  facade (cached for the connection's lifetime) or a KMS-encrypted `keyRef` resolved through a `KeyProvider`.
  Keys are **never** in AppConfig, env (prod), code, or events.
- **Non-secret policy = AppConfig (`BrowseConfig`).** Like [`MediaConfig`](../../../../packages/api/src/media/model/MediaConfig.ts):
  a `config/settings`-style model with `SCHEMA` + `DEFAULT`, Console-editable without redeploy. Holds
  per-provider `{ enabled, enabledKinds: MediaKind[], defaultPageSize, rank/priority }` and global browse
  limits. **Per-type enablement**: a provider that *can* serve multiple kinds is allowed only the kinds root
  turned on (e.g. enable Pexels images but not its videos).
- **Per-account BYOK (optional)**: an account may supply its own key for a metered/AI provider (KMS-encrypted
  `keyRef`, same mechanism as `@repo/ai` account config) — a marketplace/BYOK category; falls back to the
  platform key when absent.
- **Access**: search/import = `USER`; purchase = `USER` (billing-gated by plan/entitlement); provider key +
  enablement management = `ROOT`.

---

## AI generation providers & the platform AI factory (media-17)

AI generators (text-to-image, upscale, text-to-speech) are **Browse providers with `canGenerate = true`** —
"search" becomes "generate from a prompt", the result imports to the library exactly like a stock download.
They centralize keys through the **existing platform AI factory** ([`@repo/ai`](../../../../packages/ai/)):

- **Reuse `AiFactory`** ([AiFactory.ts](../../../../packages/ai/src/AiFactory.ts)) — today it serves
  `Bedrock` / `Anthropic` / `OpenAI` with `create()` / `forAccount(accountId)` (account provider + model +
  BYOK `keyRef`) and lazy KMS key resolution. Image generation (OpenAI `gpt-image` / Bedrock) routes through
  it directly.
- **All services get the AI factory.** Make `@repo/ai` the one platform AI entry point: services call
  `AiFactory.forAccount()`; keys are centrally managed (KmsKeyProvider over Secrets; per-account BYOK). Spec
  the boot-time `AiFactory.configure({ keyProvider, accountConfig })` wiring so every service shares the same
  key management + usage metering. (This is the "give all services the AI factory" step the user called for —
  the factory exists; this makes its configuration + key custody a platform standard.)
- **Specialized engines** not in the `Ai.Provider` enum (ElevenLabs audio, Magnific upscale) are **Browse
  adapters** that either (a) get added to the AI factory's provider registry, or (b) live as Browse-only
  generation adapters — both resolve keys through the same `KeyProvider`/Secrets path so key custody is
  uniform. Decide per engine; either way keys are root-managed.
- **Generated-asset provenance**: `provider = <engine>`, `license` = the engine's output terms (e.g. OpenAI
  output ownership), `cost` = the metered spend, plus the prompt/parameters retained for reproducibility.

### media-17.1 — Implemented AI platform (as built)

The factory wiring above is now in place — this records the shipped shape:

- **Keys — two tiers, both in Secrets Manager (never AppConfig/env):** platform-shared AI provider keys live
  in `PlatformManifest.secrets` (`ai-openai`, `ai-anthropic`, `ai-fish`, …), provisioned once in
  `PlatformStack` and granted-read + ARN-injected (`SECRET_AI_<PROVIDER>`) into **every** service; service-
  specific keys stay in that service's `owns.secrets` (media's `browse-pexels`, `browse-unsplash`). Resolved by
  `@repo/ai` **`SecretsKeyProvider`**; wired once for all services via `AiFactory.usePlatformSecrets()` in the
  base `Application`.
- **Routing — per-service `config/ai` (`AiRouting`, `@repo/api`):** a modality → `{provider, model?}` table.
  `Modality` = `chat · image · video · text_to_speech · speech_to_text · speech_cloning · sound`. Base
  `Application.aiFor(modality)` reads it (falls back to `AiRouting.DEFAULT`) and returns an `Ai` client with
  the key pre-resolved. Console-editable, no redeploy.
- **Provider ↔ media-type catalog:** `AiRouting.CATALOG` (`ProviderInfo { provider, label, modalities,
  accountOnly? }`) is the single source of **which providers serve which media types**, with
  `providersFor(modality)` / `supports(provider, modality)` for the AI Gen provider pickers + route
  validation. The catalog reflects each provider's PUBLIC API surface (what it *can* do); the generate flow
  gates on the instantiated client's real `Ai.capabilities`, so a catalogued-but-unimplemented modality
  resolves to "unavailable" rather than a broken call. Current: OpenAI (chat/image/tts/stt), Anthropic (chat),
  **AWS Bedrock (chat/image/video)**, ElevenLabs (tts/cloning/sound/stt), fish.audio (tts/cloning), Magnific
  (image).
- **AWS Bedrock** is a first-class provider (the AiFactory default): text (Claude/Llama/Titan/Mistral), image
  (Titan Image/SDXL/Nova Canvas), **video (Nova Reel)** — Bedrock is our first video provider. TTS/STT on AWS
  are **Polly/Transcribe** (separate services, NOT Bedrock) — add as their own providers if wanted. On
  **LocalStack, Bedrock is API-only** (the call path works; real generation runs against real AWS). The
  `BedrockAdapter` implements chat today; image/video methods land with the generate slice.
- **Scope — platform-wide vs account-only** (`AiRouting.Scope` = `platform | account`): a provider or media
  type may be shared across all accounts (`PLATFORM` — one platform key, shareable artifacts) or confined to a
  single account (`ACCOUNT` — its own key and/or **private artifacts that must never reach another account**).
  **Speech cloning is always account-only** (`ACCOUNT_ONLY_MODALITIES`): a cloned voice belongs to the account
  that made it and can never be platform-shared. A provider can be marked `accountOnly` (e.g. BYOK-only
  tenancy), and a `config/ai` route may set `scope`; the **account-only floor always wins** —
  `effectiveScope(provider, modality, route)` never widens an account-only modality/provider to platform.
  (BYOK — media-17.2 — is the mechanism accounts use to run account-scoped providers with their own key.)
- **TTS adapter:** fish.audio (`FishAdapter`, `Ai.speak()` → `Ai.SpeakResponse`); ElevenLabs slot reserved in
  the factory registry.

### media-17.2 — BYOK & plan-based usage limits (LATER — deferred)

- **Per-account BYOK** arrives with the **marketplace** ([../marketplace/SPECS.md](../../marketplace/SPECS.md)):
  an account supplies its own AI provider key (KMS-encrypted `keyRef`, resolved via `AiFactory.forAccount()`),
  overriding the platform key for that account. Platform-managed keys are the default until then.
- **Plan-based usage limits (deferred):** account **plans will cap AI / API request usage** (per-modality
  request quotas + spend caps, checked before dispatch and metered per call via the AI factory's usage sink →
  account entitlements). This is a **later effort** — not built now; noted here so generation endpoints leave
  room for a pre-flight entitlement gate + usage metering when it lands.

---

## Candidate providers (to evaluate — not yet decided)

White-label-friendly, good API, clear licensing. Grouped by role.

**Stock catalogs (image / video / audio)**
- **Unsplash** ([unsplash.com](https://unsplash.com/)) — high-quality **photos**, free (Unsplash License,
  attribution appreciated not required); solid REST API. Note API rate limits + brand guidelines for
  white-label. Images only.
- **Pexels** ([pexels.com](https://www.pexels.com/)) — free **photos + videos**, generous license (no
  attribution required), clean API. Two kinds → good per-type enablement test case.
- **Pixabay** ([pixabay.com](https://pixabay.com/)) — free **images + video + music**, permissive license;
  simple API. Three kinds.
- **Artlist** ([artlist.io](https://artlist.io/)) — licensed **music / SFX / video / templates**; subscription
  licensing (clear commercial rights) — a **purchase/subscription** provider (not free), tests the paid +
  rights-managed path. Confirm API/partner access + white-label terms.

**AI generation**
- **OpenAI** ([openai.com](https://openai.com/)) — **image** generation (`gpt-image`); already a first-class
  `@repo/ai` provider → route via `AiFactory`. Output-ownership license terms.
- **Magnific** ([magnific.ai](https://magnific.ai/)) — AI **upscale / enhance / generate** (image); a
  generation adapter. Confirm API availability + commercial terms.
- **ElevenLabs** ([elevenlabs.io](https://elevenlabs.io/)) — AI **audio / voice / TTS + sound effects**;
  strong API. A generation adapter for the **audio** kind (pairs with Studio voiceover/soundtrack). Keys
  root-managed; per-account BYOK likely (metered). Mind voice-cloning consent + usage licensing.

**Also worth evaluating (later):** Getty / Shutterstock (commercial rights-managed, mature APIs), Freesound
(CC audio), Storyblocks / Envato (subscription stock). Add as adapters when a customer need lands.

---

## Internal (`@repo/*`) & infra

**Internal**
- **`@repo/ai`** ([AiFactory](../../../../packages/ai/src/AiFactory.ts), [KeyProvider](../../../../packages/ai/src/KeyProvider.ts)) —
  the AI factory + KMS key resolution for AI-generation providers (media-17).
- **`@repo/services`** — `Secrets` (provider keys), `Kms` (encrypt BYOK refs), `S3`/`Dynamo` (import into the
  media plane), `Sqs` (import/generation jobs), `AppConfig` (`BrowseConfig`).
- **`@repo/endpoint`** (`Access` — ROOT key mgmt, USER search/import) · **`@repo/api`** (`Media`, the new
  `Browse*` contracts, `BrowseConfig`) · **`@repo/system`** (`Register.Service.MEDIA`, `Events`).

**AWS**
- **Secrets Manager** — provider API/dev keys (root-managed). **KMS** — per-account BYOK ref encryption.
- **S3 + DynamoDB** — imported assets (the existing media plane; media-1). **SQS + Lambda/ECS** — async import
  + AI generation workers (fetch → scan → process). **CloudFront** — delivery of imported assets (media-2).

**Events** (per [EVENTS.md](../../../../packages/system/EVENTS.md)) — a browse import emits the normal
`media.asset.created`; a purchase additionally emits an order/billing event. No new topic for search (reads
aren't lifecycle events).

---

# Requirements (traceable register)

## media-12.0 Browse marketplace — scope & goals — A
- **media-12.1** A **Media : Browse** surface: search a **normalized** catalog of third-party assets
  (image / video / audio) across 1..N configured providers, with results carrying **thumbnail, preview,
  dimensions/duration, author, license, cost** — A
- **media-12.2** Two acquisition paths — **free download** and **purchase** — both **import into the account
  library** as a normal `Media.Asset` (media-15) — A
- **media-12.3** Media kinds at launch: **image, video, audio** (aligned to Studio's needs); documents/other
  out of scope for Browse — A
- **media-12.4** Browse assets are for use in **Studio** (media creation) later; the library is the hand-off
  boundary — B

## media-13.0 Provider factory & normalized search — A
- **media-13.1** **`BrowseProvider` adapter interface** — `search` / `get` / `acquire` + a `capabilities()`
  descriptor (kinds, canSearch, canGenerate, canDownloadFree, canPurchase, licenseTypes); one interface, many
  vendors — A
- **media-13.2** **`BrowseFactory`** — a registry (`Map<Provider, AdapterFactory>`) seeded with built-ins,
  extended via `register()`; a provider is added without editing call sites (mirrors `@repo/ai` `AiFactory`) — A
- **media-13.3** **Normalized `BrowseQuery` → `BrowseResult[]`** — one query shape in, one result shape out;
  the UI/Studio never see a provider's raw schema — A
- **media-13.4** **Concurrent fan-out** to the selected enabled providers for a single query; results merged +
  ranked; a **normalized cursor** resumes each provider's pagination — A
- **media-13.5** **Capability-gated fan-out** — a search only reaches providers that are enabled, declare the
  requested kind(s), and have a resolvable key; excluded ones are logged, never a hard failure — A
- **media-13.6** **Cross-provider dedupe** — best-effort (source URL / perceptual hint); accepted imperfect — C
- **media-13.7** **Result caching** — short-TTL cache of normalized results/cursors (Redis) to cut provider
  calls + honor rate limits — B
- **media-13.8** **Streaming results (later, websockets)** — push each provider's normalized page as it returns
  (`{ provider, results, cursor, done }`) so the UI fills progressively rather than blocking on the slowest;
  the synchronous `allSettled` fan-out (media-13.4) is the interim + non-websocket fallback — C

## media-14.0 Licensing & rights — A
- **media-14.1** Every result + imported asset carries a **typed `License`** (type, requiresAttribution,
  attributionText?, url?, allowedUses?, restrictions?) — never "unknown" — A
- **media-14.2** **License shown before acquire** — on every result and at download/purchase confirm — A
- **media-14.3** **Fail-closed** — an asset with an unresolvable license is not importable — A
- **media-14.4** **Attribution carried through** import so Studio/exports can credit it when required — B
- **media-14.5** **Editorial / rights-managed** flagged and (later) usage-gated in Studio exports — C

## media-15.0 Acquisition, import & provenance — A
- **media-15.1** **One import path** for free + purchased assets: fetch licensed bytes → normal `Media.Asset`
  (scope ACCOUNT) → standard scan/process pipeline (variants, probe, poster) — A
- **media-15.2** **`Media.Asset.source`** (new) — every asset records **where it came from**:
  `{ origin: "upload" | "provider" | "generated", provider?, externalId?, sourceUrl?, license?, cost?,
  acquiredAt?, acquiredBy?, orderId? }`. `upload` = uploaded from a computer (the default); `provider` =
  imported from a Browse provider (carries provider provenance); `generated` = AI-generated. The provider
  fields are set only for `provider`/`generated` origins — A
- **media-15.3** **Purchase → order record** (provider, price, currency, external receipt id, timestamp) as
  the audit/billing trail; `provenance.orderId` links to it; purchase is a billable line item via
  account/billing — B
- **media-15.4** **Re-acquire dedupe** — if provider+externalId already in the library, reuse instead of
  re-import/re-buy — B
- **media-15.5** Imported asset emits the normal **`media.asset.created`** event (EVENTS.md) — A

## media-16.0 Provider config, keys & access (root) — A
- **media-16.1** **Provider API/dev keys in Secrets Manager**, written/rotated **only by root**
  (`Access.AppRole.ROOT`); read via the `Secrets` facade, cached; never in AppConfig/env/code/events — A
- **media-16.2** **`BrowseConfig`** (AppConfig, non-secret) — per-provider `{ enabled, enabledKinds,
  defaultPageSize, priority }` + global limits; `SCHEMA` + `DEFAULT`, Console-editable without redeploy
  (mirrors `MediaConfig`) — A
- **media-16.3** **Per-type enablement** — a multi-kind provider is limited to the kinds root enabled
  (e.g. Pexels images on, videos off) — A
- **media-16.4** **Per-account BYOK** — **DEFERRED (later)**. Platform-managed keys only for now; per-account
  bring-your-own-key (KMS-encrypted `keyRef`, marketplace category) is a later phase — C
- **media-16.5** **Access ladder** — search/import/purchase = `USER` (purchase billing-gated); provider key +
  enablement mgmt = `ROOT` — A

## media-17.0 AI generation providers & the platform AI factory — B
- **media-17.1** AI generators are **Browse providers** (`canGenerate = true`): a prompt "generates" a result
  that imports like a stock download — B
- **media-17.2** **Reuse the platform AI factory** (`@repo/ai` `AiFactory`) for engines it supports
  (OpenAI / Bedrock image gen) via `create()` / `forAccount()` — B
- **media-17.3** **AI factory as an all-services capability** — standardize boot-time
  `AiFactory.configure({ keyProvider, accountConfig })` so every service shares one key-managed AI entry point
  (centralized KMS keys + per-account BYOK + usage metering) — B
- **media-17.4** **Specialized engines** (ElevenLabs audio, Magnific upscale) — either registered into the AI
  factory or as Browse-only generation adapters; **both resolve keys via the same `KeyProvider`/Secrets path** — B
- **media-17.5** **Generated-asset provenance** — engine as `provider`, engine output-license, metered `cost`,
  retained prompt/parameters for reproducibility — B
- **media-17.6** **Consent/usage guards** — voice cloning (ElevenLabs) requires consent; enforce engine usage
  terms — C

## media-18.0 Browse UI (Media : Browse) — B
- **media-18.1** Search bar + **provider multi-select** (which enabled providers to query) + **kind** and
  **cost (free/paid)** + license filters — B
- **media-18.2** Result grid (reuse the library's image/grid tiles) showing thumbnail, kind, dimensions/
  duration, author, **license badge**, and free/price — B
- **media-18.3** Result detail/preview (image/video/audio player) with full license + attribution + an
  **Add to library** (free) / **Purchase** action — B
- **media-18.4** **AI generate** panel (prompt + engine + params) for generation providers — C
- **media-18.5** Imported assets appear in **Library** with a provider/provenance indicator — B

## media-19.0 Endpoints — B
| Method | Path | Purpose | Access | Req |
|---|---|---|---|---|
| GET  | `/media/browse/providers` | List enabled providers + their capabilities (for the UI) | USER | media-13 |
| POST | `/media/browse/search` | Normalized fan-out search across selected providers | USER | media-13 |
| GET  | `/media/browse/asset` | Normalized detail for one provider asset (`provider`, `externalId`) | USER | media-13 |
| POST | `/media/browse/import` | Download (free) → import to library | USER | media-15 |
| POST | `/media/browse/purchase` | Purchase → import to library (billed) | USER | media-15 |
| POST | `/media/browse/generate` | AI generate → import to library | USER | media-17 |
| GET, PUT | `/media/browse/config` | Read/set `BrowseConfig` (enablement, per-type, limits) | ROOT | media-16 |
| PUT, DELETE | `/media/browse/providers/:provider/key` | Set / rotate / remove a provider API key (Secrets) | ROOT | media-16 |

## media-20.0 Infra & topology additions — B
- **media-20.1** Runs as a **dedicated `browse` role of the media service** (`Register.Service.MEDIA`,
  `Ports.MEDIA.BROWSE`) — separate from `main` so provider fan-out scales independently — but shares the media
  plane (S3 + DDB + import pipeline), so imports are ordinary library assets — A
- **media-20.2** **Secrets Manager** entries per provider key; **KMS** for per-account BYOK refs — A
- **media-20.3** **SQS + worker** for async import + AI generation (fetch → scan → process reuses media-5/6) — B
- **media-20.4** **Redis** for normalized result/cursor caching + provider rate-limit accounting — B
