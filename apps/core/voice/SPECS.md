#
# Voice (automated calls — robocalls · IVR survey calls) — the voice `send` channel
#

> **Status: SCAFFOLD BUILT — engineering only, not launch-ready.** The full compliance/product decision (gap #1
> below) is still open, but a working code scaffold now exists: `VoiceService`/`VoiceMainService`, the
> `voice_calls`/`voice_suppression`/`voice_numbers` tables, the `voice-send`/`voice-status` SQS queues, the
> `fake` + **Twilio** provider adapters (single-step TwiML IVR: say/play + "press 1" opt-out), and **TTS via
> `@repo/ai`'s `AiRouting.Modality.TEXT_TO_SPEECH`** (the same provider-agnostic speech abstraction `media` uses
> — synthesized once, cached content-hash-keyed in a `voice`-owned S3 bucket, played back as a recording).
> **Not built yet** (tracked in *Gaps & open decisions* below): the full IVR flow CRUD/branching engine, AMD,
> STIR/SHAKEN attestation + caller-ID reputation, abandoned-call rate pacing, recording/transcript capture +
> PII TTL, DLQ requeue, and every provider besides Twilio. This spec captures the full target shape: voice is
> **texting's cousin** — it **reuses** the channel architecture (provider factory · L1/L2 queues · `canSend()` ·
> number records · dispatch pacing · analytics) almost wholesale, and adds a **stricter compliance surface**
> (STIR/SHAKEN · abandoned-call · in-call opt-out · AMD) + **IVR**. *(Design overview, not legal advice — consent
> / DNC / state-law specifics need counsel before launch.)*

# Objective

The **voice `send` channel** — **automated outbound calls**: prerecorded / TTS **announcements** and
**IVR survey / polling** calls, the 1:1 voice counterpart to [texting](../texting/SPECS.md) and
[email](../email/SPECS.md). Like the others it is **not a raw telephony wrapper**: the hard part of voice is
**reaching the callee without being labeled "Spam Likely" and staying inside TCPA** — so this service owns the
**call mechanics, provider abstraction, caller-ID authentication, and the compliance gating** that keep the
platform a trusted caller.

It **owns:**
* **Outbound calling** — single + batch, **prerecorded audio** or **TTS** (Amazon Polly), **scheduled**, with
  per-call **cost accounting**; **answering-machine detection (AMD)** → voicemail-drop vs hang-up.
* **IVR** — interactive flows (play prompt → collect **DTMF / speech** → branch), the engine the **voice survey
  runner** uses (delegated from [survey](../survey/SPECS.md)).
* **Provider abstraction (factory)** — Twilio / Telnyx / Vonage / Bandwidth / SignalWire / Sinch / Infobip /
  `fake`, **plus AWS-native** (Amazon Connect / Pinpoint Voice); one adapter, failover within constraints.
* **Caller-ID authentication & reputation** — **STIR/SHAKEN** attestation + caller-ID / branded-calling
  reputation (the **voice analog of 10DLC/TCR**, via [registration](../registration/SPECS.md)).
* **Compliance gating** — TCPA consent, **DNC** scrub, **quiet-hours** (8am–9pm local), **abandoned-call** rate
  control, **in-call identification + opt-out** — all via the shared **`canSend()`** gate + the call flow.
* **Outcomes + recording** — answered / no-answer / busy / voicemail / DTMF / completion; optional **recording**
  (media/S3) + **transcription** (Amazon Transcribe) → analytics.

It **delegates:** recipients + **consent / suppression** → [contact](../contact/SPECS.md) (`canSend`);
**orchestration** (audience, drip, approvals) → [campaign](../campaign/SPECS.md) / workflow; **fair-share +
concurrency pacing** → the **`WorkQueue`** governor ([dispatch](../../../packages/services/DISPATCH.md));
**numbers + STIR/SHAKEN registration** → [registration](../registration/SPECS.md); **recordings / audio assets**
→ [media](../media/SPECS.md); **survey definition + scoring** → [survey](../survey/SPECS.md) (voice = its IVR
runner); **attribution / outcomes** → [analytics](../analytics/SPECS.md); the **budget cap** →
[campaign → channel cost management](../campaign/SPECS.md); **billing** → [account](../account/specs/SPECS.md).
**Voice places + controls the call — it doesn't own the audience, the journey, or the survey.**

See [`apps/CHANNELS.md`](../../CHANNELS.md). Voice is a `send` channel (1:1 addressed, consent-bound).

# Regulatory & compliance (the voice deltas — stricter than SMS)

Same **TCPA** spine as texting (consent · DNC · quiet-hours) **plus** voice-only rules. **The consent/DNC/
quiet-hours machinery is reused; the voice-specific items below are the new surface.**

* **Consent.** Autodialed / **prerecorded / artificial-voice** calls to **wireless** numbers need **prior express
  consent**; **prerecorded *marketing*** needs **prior express *written* consent (PEWC)**. **Survey / polling /
  political** calls have **content latitude** (DNC + PEWC exemptions on *landlines*) — **but a prerecorded /
  AI-voice survey or robo call to a *cell* still needs prior express consent**, regardless of content.
* **AI voice (2024 FCC).** AI-generated voices = "artificial voice" under TCPA → same consent rules.
* **STIR/SHAKEN.** Every call is **attested / signed** (combat spoofing); unsigned/low-attestation calls get
  **"Spam Likely"** labeled or blocked. **Caller-ID reputation** management (First Orion / Hiya / TNS, branded
  calling / Rich Call Data) = the **voice analog of 10DLC/TCR trust score** → [registration](../registration/SPECS.md).
* **Abandoned-call rule (FTC TSR).** Predictive dialing must connect a live agent within ~2s or play an
  abandoned-call message; **≤ 3% abandonment**. A **concurrency + connect-rate** constraint on dispatch pacing.
* **In-call identification + opt-out.** Announce caller name + callback number at the start; prerecorded calls
  must offer an **interactive opt-out** ("press 1 to stop") → routes to suppression.
* **AMD (answering-machine detection).** Voicemail-drop vs hang-up; carries the abandoned-call / dead-air nuance.
* **Quiet hours.** 8am–9pm recipient-local — the existing `canSend()` quiet-hours machinery.
* **DNC.** National DNC + internal DNC (telemarketing); survey/political exempt from National DNC but **always
  honor opt-outs** + the account block-list.
* **State mini-TCPAs** (FL FTSA, OK, WA, …) — several stricter than federal on auto-dialing / robocalls.
* **No PHI** by [AUP](../account/specs/SPECS.md); recordings + transcripts are **PII** (encrypted, TTL'd, forget-able).

# Providers

A **provider factory / adapter** (the texting `SmsAdapter` pattern — one adapter per provider, the **single
dialect boundary**: `initiate` · `ivrInstructions` · `statusNormalize` · `verifySignature`):
* **Twilio** (Programmable Voice, TwiML `<Gather>`) · **Telnyx** · **Vonage** · **Bandwidth** · **SignalWire** ·
  **Sinch** · **Infobip** · **Plivo** — **most are already SMS providers**, so the vendor relationships + number
  records extend.
* **AWS-native:** **Amazon Connect** (IVR / contact flows) · **Pinpoint** voice messages · **Polly** (TTS
  prompts) · **Transcribe** (spoken-answer → text). Fits the AWS-first posture.
* **`fake`** — simulate answered / no-answer / voicemail / DTMF at scale (config thresholds).

## Each provider has its own API + dialect → the adapter normalizes it

There is **no shared application-layer standard** for programmable voice — every vendor ships a proprietary API,
and they differ on **four axes that all leak into code**, which is exactly what the adapter absorbs:

| Provider | Call-control style | Inbound webhooks | Signature / auth |
|---|---|---|---|
| **Twilio** | **TwiML** (XML verbs: `<Say>` `<Gather>` `<Record>`) or Voice SDK | form-encoded callbacks | `X-Twilio-Signature` HMAC-SHA1; SID + token |
| **Telnyx** | **Call Control** (JSON commands: `answer` · `gather_using_speak` · `hangup`) or TeXML | JSON webhooks | Ed25519 signature; API key (bearer) |
| **Vonage** | **NCCO** (JSON action array) | JSON webhooks | JWT signature; API key/secret or JWT |
| **Bandwidth** | **BXML** (own XML) | JSON callbacks | basic-auth / HMAC; account creds |
| **SignalWire** | **LaML** (TwiML-compatible) + RELAY | TwiML-style callbacks | project / token |
| **Plivo** | **Plivo XML** | form callbacks | auth ID / token |

The **four axes**: ① **call-control format** — XML (Twilio/Bandwidth/SignalWire) vs JSON command API
(Telnyx/Vonage) → an IVR flow authored as TwiML is *not* portable to Telnyx Call Control without translation;
② **webhook payload shape + event names** (`call.answered` vs `CallStatus=in-progress`); ③ **signature
verification** (HMAC-SHA1 vs Ed25519 vs JWT); ④ **status / error vocab**. The IVR runner emits an **abstract
flow** (prompt → gather → branch) and the adapter renders it to TwiML *or* Telnyx Call Control *or* NCCO.
*Near-standard caveat:* several vendors offer a **Twilio-compatible** mode (Telnyx TeXML, SignalWire LaML) — handy
as a migration shim, but auth / webhooks / edge cases still differ, so each still gets its own adapter rather than
relying on drop-in compatibility. **Adding a provider = a new adapter + a queue mapping, not a new worker.**

## Adapter instantiation & topology — same as texting (one registry, N call-sites)

**Identical mechanism to [texting](../texting/SPECS.md#adapter-instantiation--topology--one-registry-four-call-sites)** — only the methods differ.
* **Typed, self-registering, one registry on the domain base.** Each `VoiceAdapter` (the typed interface —
  `initiate` · `ivrInstructions` · `statusNormalize` · `verifySignature`) lives in `src/providers/<provider>` and
  **self-registers on import**. `VoiceService` / `VoiceJob` build the typed `providers: Map<Provider, VoiceAdapter>`
  **once at cold-start**; every role inherits the *same* registry — no per-role wiring, no edge/worker drift.
* **Stateless dialect logic — credentials passed in, not baked in.** One stateless adapter instance **per
  provider** (not per account); tenancy rides the **resolved credentials + number record** (per-number overrides
  allowed), exactly as in texting.
* **One registry, four call-sites** — each role resolves the *same* adapter and calls only the method it needs:

| Role (topology) | Resolves provider from | Adapter method |
|---|---|---|
| **`VoiceCallWorker`** | queued job (`message.provider`) | **`initiate`** (place the call) |
| **`VoiceMainService`** — IVR call-control webhook *(synchronous)* | the call's number/route record | **`ivrInstructions`** (render next step → TwiML/Call-Control/NCCO) + **`verifySignature`** |
| **`VoiceMainService`** — status webhook ingress | the webhook source | **`verifySignature`** → ACK-fast → enqueue |
| **`VoiceStatusJob`** | queued status event | **`statusNormalize`** (provider status/vocab → canonical outcome) |

# Make vs buy — AWS backbone vs 3rd-party (Twilio et al.)

The **provider factory** makes this **swappable**, but the *default* matters. Two stacks (and they **compose** —
TTS/STT is AWS regardless of the carrier):

**Option A — 3rd-party programmable voice (Twilio / Telnyx / Bandwidth / SignalWire / Vonage …)** *(recommended default)*
* **Pros:** **fastest to build** (TwiML `<Gather>` / call-control APIs are turnkey IVR + AMD + recording);
  **mature STIR/SHAKEN + branded-calling + answer-rate** tooling; **global** reach; **we already use these
  vendors for SMS** → same factory, **same number records**, same relationships; **multi-provider failover**
  built into the factory.
* **Cons:** **per-minute + per-feature cost** at scale; **data leaves our infra** (call media / recordings are a
  sub-processor concern — DPA, residency); some **vendor lock-in** per adapter (mitigated by the factory).

**Option B — AWS-native (Amazon Connect / Chime SDK / Pinpoint-EUM Voice)**
* **Amazon Connect** — a **full cloud contact center** (IVR contact flows, outbound campaigns, AMD, recording,
  Contact Lens). **Pros:** in-infra (compliance/residency), deep AWS integration, **best if a *live-agent* contact
  center** is also wanted. **Cons:** **overkill for automated robo/IVR-survey** (it's a CC product, not a
  call-API), heavier to wire, per-minute can be **≥ 3rd-party**, its own learning curve.
* **Amazon Chime SDK (PSTN / SIP media app)** — low-level programmable media. **Pros:** **cheapest raw audio**,
  fully in-infra, build exactly what you want. **Cons:** **you build everything** (IVR, AMD, retries) — most ops.
* **Pinpoint / End-User-Messaging Voice** — simple **transactional TTS** voice messages. **Pros:** trivial for
  one-shot announcements. **Cons:** **no real IVR** (no rich `<Gather>` branching) → not enough for surveys.
* **Polly (TTS) + Transcribe (STT) + Lex (NLU)** — useful **with *either* stack** for prompts + spoken-answer
  capture; not a carrier.

## At-a-glance

| | 3rd-party (Twilio / Telnyx …) | Amazon Connect | Amazon Chime SDK |
|---|---|---|---|
| Time-to-build IVR/AMD | **turnkey** | medium (contact flows) | **build it all** |
| Best fit | **automated robo / IVR survey** (our case) | **live-agent contact center** | custom/low-level |
| STIR/SHAKEN + branded calling | **mature** | yes | DIY-ish |
| Data in our infra | no (sub-processor) | **yes** | **yes** |
| Reuse of SMS vendors / number records | **yes** | no | no |
| Ops burden | **low** | medium | **high** |
| Cost shape | per-min + per-feature | per-min (service + telephony) — **often ≥** | **cheapest raw min**, + your build |
| Multi-provider failover | **factory** | single | DIY |

## Cost — indicative only (US, per-minute; **verify current rates + volume discounts**)

> Pricing changes and is region/volume-dependent — treat as **ballpark for sizing**, not quotes.

* **3rd-party outbound voice:** **~$0.007–$0.014 / min** (Telnyx cheaper end, Twilio higher); **AMD ~$0.0075 / call**;
  **recording ~$0.0025 / min** (+ storage); **DID number ~$1–2 / mo**. → a **~30 s** automated call ≈
  **$0.01–$0.02 all-in** (voice + AMD), number amortized.
* **Amazon Connect:** **service ~$0.018 / min** **+ telephony ~$0.0024–$0.013 / min** + DID (~$0.03 / day);
  High-Volume **Outbound Campaigns** add cost. → typically **≥ 3rd-party** for plain automated calls.
* **Amazon Chime SDK PSTN:** **~$0.003 / min** audio + outbound usage — **cheapest carrier minutes**, but you
  fund the build.
* **AWS add-ons (either stack):** **Polly** ~$4 / 1M chars (Standard) · ~$16 / 1M (Neural); **Transcribe**
  ~$0.024 / min; **Lex** ~$0.004 / request.

## Recommendation

**3rd-party programmable voice behind the factory (Twilio / Telnyx-first), with AWS Polly / Transcribe for
TTS/STT** — it **mirrors the SMS stance**, reuses our existing vendors + `voiceCapable` number records, is
**fastest to ship**, and keeps mature STIR/SHAKEN + AMD + answer-rate tooling. **Amazon Connect only if a
*live-agent contact center* is on the roadmap** (a different product than automated robo/IVR). **Chime SDK** only
if raw-minute cost or full in-infra residency dominates and we're willing to own the build. The factory means
this isn't a one-way door — start 3rd-party, swap/add later by config.

# Reuse — voice is texting's cousin

Almost the entire channel stack is **reused**, not rebuilt:

| Concern | Reused from |
|---|---|
| **Provider factory + adapter** (single dialect boundary) | the texting `SmsAdapter` pattern |
| **Two-level queueing** — **L1** account fair-share → **L2 per-provider** | `texting-1.7` / `email-1.7` |
| **`canSend()`** — consent · suppression · quiet-hours · block-list | shared `Application` gate |
| **Pacing** — fair-share + **concurrency** (voice's added axis: concurrent-call + connect-rate caps) | `WorkQueue` / [dispatch](../../../packages/services/DISPATCH.md) |
| **Number records** (already `voiceCapable`) + provisioning + reputation registration | [registration](../registration/SPECS.md) |
| **Cost cap** (cross-channel, incl. follow-on) | [campaign → channel cost management](../campaign/SPECS.md) |
| **Outcomes / engagement** → events | [analytics](../analytics/SPECS.md) |
| **Recordings / audio assets** | [media](../media/SPECS.md) |

**Genuinely new (the voice work):** STIR/SHAKEN attestation + caller-ID reputation, AMD + voicemail-drop,
abandoned-call rate control, the **IVR engine** + in-call opt-out, TTS prompts.

# Survey calls (IVR — delegated, not a second engine)

Phone surveys / polling are **[survey](../survey/SPECS.md)'s voice runner**: survey owns the **definition +
scoring**; voice **runs the IVR** — play question (Polly TTS) → **`<Gather>` DTMF / speech** → (Transcribe for
speech) → normalize to survey's `Response`. Mirrors how the SMS survey runner compiles to workflow
`collect-input` — **voice never owns survey state**.

# Service & Job topology

**Convention (platform-wide).** Framework base → domain base → concrete role. **`VoiceService extends Service`**
and **`VoiceJob extends Job`** hold the shared domain code — the **provider adapter factory**, **IVR engine**,
**AMD**, **TTS (Polly)**, **STIR/SHAKEN** attestation, the **`canSend()`** client, the **`WorkQueue`** pacing,
and the **call-log / recording** store. Same shape as [texting](../texting/SPECS.md) / [email](../email/SPECS.md).

**Services (HTTP, ECS Fargate)**

| Class | Extends | Role |
|---|---|---|
| **`VoiceService`** | `Service` | **Domain base** — provider factory · IVR engine · AMD · TTS · STIR/SHAKEN · `canSend` · call-log/recording store; **not deployed alone**. |
| **`VoiceMainService`** | `VoiceService` | The **`/voice/*` API** (initiate call / batch · IVR-flow config · caller-ID / number mgmt · status reads) **+ the provider call-control webhooks** — note these are **synchronous** ("what do I play next?" → returns the IVR step / TwiML), unlike email's fire-and-forget; **+ async status webhook** ingress (ACK-fast → enqueue). |

**Jobs (Lambda, event-driven)** — each `extends VoiceJob`:

| Class | Extends | Trigger | Role | Req |
|---|---|---|---|---|
| **`VoiceCallWorker`** | `VoiceJob` | SQS (**L2 per-provider**) | **Provider-agnostic** — `canSend` + **DNC** + **STIR/SHAKEN** + **AMD**; `provider.initiate`; **abandoned-call / concurrency** paced (`WorkQueue`); call-log; retry → DLQ | voice-1.0 / 4.0 |
| **`VoiceStatusJob`** | `VoiceJob` | SQS ← status webhook | Normalize call **outcome** (answered / no-answer / busy / voicemail / DTMF / duration) → call-log + emit to [analytics](../analytics/SPECS.md); **opt-out → suppression** | voice-8.0 |
| **`VoiceScheduleJob`** | `VoiceJob` | EventBridge | Release **scheduled** call windows (campaign-driven), within quiet-hours | voice-6.0 |

> **Notes.** `VoiceCallWorker` is **provider-agnostic** (dispatch by `provider` via the factory; per-provider
> queues = HoL isolation, not capability) — exactly like texting/email. **Recordings + transcripts are PII**
> (encrypted, TTL'd, in the [contact](../contact/SPECS.md) forget fan-out). The **IVR call-control webhook is
> synchronous** (the one shape-delta from the other channels).

# Endpoints (first cut)

A first pass at the endpoint surface, in [`@repo/endpoint`](../../../packages/endpoint/SPECS.md) style — all
service-prefixed **`/voice/*`**, mirroring [texting](../texting/SPECS.md#endpoints-first-cut) /
[email](../email/SPECS.md#endpoints-first-cut). **Placing calls is S2S** ([campaign](../campaign/SPECS.md) /
workflow / transactional callers enqueue; no user-facing "dial" route). **Provider call-control + status arrive on
signed webhooks** — the **call-control webhook is *synchronous*** (returns the next IVR step), the one shape-delta
from text/email. **Survey state is [survey](../survey/SPECS.md)'s** (voice only runs the IVR); **numbers +
STIR/SHAKEN are provisioned in [registration](../registration/SPECS.md)** (voice reads them).

**Access column:** **`minAccess`** — **`-`** public · account ladder **`SENDER`<`USER`<`BILLING`<`ACCOUNT`** ·
staff **`SUPPORT`<`APPLICATION`<`ROOT`** · **`⬆`** = step-up · **`Internal`** = VPC-only S2S ·
**`Provider-sig`** = signature-verified provider webhook.

### Place calls (S2S — campaign / workflow / transactional) (voice-1)
| Method | URI | Purpose | Access | Req |
|---|---|---|---|---|
| POST | `/voice/calls` | Enqueue a **single** call (job-id pointer → SQS; prerecorded or TTS + optional IVR flow) | Internal | voice-1.1/1.3 |
| POST | `/voice/calls/bulk` | Enqueue a **bulk** call from a contact segment | Internal | voice-1.1 |
| POST | `/voice/calls/test` | Place a **test** call to the composer's own verified number — render + dial one | USER | voice-1.1/2.2 |
| POST | `/voice/campaigns/{campaignId}/test` | **Pre-launch test** — call selected **test numbers** | USER | voice-1.1 |

### IVR flows (voice-2)
| Method | URI | Purpose | Access | Req |
|---|---|---|---|---|
| GET, POST | `/voice/flows` | List / create an **IVR flow** (abstract prompt → gather → branch; rendered per-provider by the adapter) | USER | voice-2.1 |
| GET, PATCH, DELETE | `/voice/flows/{id}` | Get / update / archive a flow | USER | voice-2.1 |
| POST | `/voice/flows/{id}/preview` | Render with merge data + **TTS preview** (Polly) | USER | voice-2.2 |

### Calls — call-log & outcomes (voice-7)
| Method | URI | Purpose | Access | Req |
|---|---|---|---|---|
| GET | `/voice/calls/log` | Query the call-log (by campaign / account / outcome) | USER | voice-7.1 |
| GET | `/voice/calls/{id}` | Single call status + **normalized outcome** (answered / no-answer / busy / voicemail / DTMF / duration) + raw code | USER | voice-7.1/8.0 |
| GET | `/voice/calls/{id}/recording` | Recording playback (signed media URL; **PII** — audited, TTL'd) | USER ⬆ | voice-7.0 |
| GET | `/voice/calls/{id}/transcript` | Transcript (Transcribe; **PII**) | USER ⬆ | voice-2.3 |

### Numbers / caller-ID (voice-8) — *provisioning lives in [registration](../registration/SPECS.md)*
| Method | URI | Purpose | Access | Req |
|---|---|---|---|---|
| GET | `/voice/numbers` | List the account's **`voiceCapable`** numbers + caller-ID / STIR-SHAKEN attestation status (**read** — provisioned in registration) | USER | voice-8.0 |

### Pause / halt / cancel (voice-6)
| Method | URI | Purpose | Access | Req |
|---|---|---|---|---|
| POST | `/voice/campaigns/{campaignId}/pause` | Set the Redis pause flag — stop further calls | ACCOUNT | voice-6.0 |
| POST | `/voice/campaigns/{campaignId}/resume` | Resume a paused campaign | ACCOUNT | voice-6.0 |
| POST | `/voice/campaigns/{campaignId}/cancel` | Cancel remaining calls | ACCOUNT | voice-6.0 |
| POST | `/voice/accounts/{accountId}/pause` | **Account-wide** pause (ops / compliance hold) | APPLICATION ⬆ | voice-6.0 |

### Retry / DLQ (voice-5)
| Method | URI | Purpose | Access | Req |
|---|---|---|---|---|
| GET | `/voice/dlq` | List DLQ items (by account / type) | APPLICATION | voice-5.0 |
| POST | `/voice/dlq/requeue` | Requeue DLQ items — by batch / accountId | APPLICATION ⬆ | voice-5.0 |

### Providers — platform config (voice-3)
| Method | URI | Purpose | Access | Req |
|---|---|---|---|---|
| GET | `/voice/providers` | List configured providers + status | APPLICATION | voice-3.1 |
| PUT | `/voice/providers/{id}` | Configure a provider (factory: Twilio / Telnyx / … / `fake`) | APPLICATION ⬆ | voice-3.1 |

### Webhooks & internal / ops
| Method | URI | Purpose | Access | Req |
|---|---|---|---|---|
| POST | `/voice/webhook/{provider}/control` | **Synchronous** provider **call-control** — verify → return next **IVR step** (TwiML / Call-Control / NCCO via the adapter) | Provider-sig | voice-2.1/3.2 |
| POST | `/voice/webhook/{provider}/status` | Async **call-status / outcome** (answered / AMD / DTMF / hangup) → verify → ACK-fast → enqueue → normalize / **opt-out suppress** | Provider-sig | voice-8.0/3.2 |
| POST | `/voice/internal/erase` | S2S forget hook — obfuscate `to`-number + purge recording / transcript (`contact-forget` fan-out) | Internal | voice-9.0 |
| GET, PUT | `/voice/config` | Read / set runtime config (quiet-hours policy, abandoned-call rate cap, concurrency, recording TTL) | ROOT | voice-4.0/10.0 |
| GET | `/voice/health` | Liveness / readiness of the worker fleet | - | voice-10.0 |

# AWS Services and Other Dependencies

**AWS services**
* **SQS** (+ **DLQ**) — **two-level** (L1 fair-share → L2 per-provider) call queue; **Lambda** workers + retries.
* **DynamoDB** — the call-log + IVR-flow + caller-ID records.
* **EventBridge (Scheduler)** — scheduled call windows.
* **S3** — recordings + prerecorded audio assets (via [media](../media/SPECS.md)).
* **Amazon Polly** (TTS prompts) · **Amazon Transcribe** (spoken-answer → text) · *(optional)* **Amazon Connect**.
* **Redis (ElastiCache)** — pause flags · rate / **concurrency** counters · STIR/SHAKEN attestation cache.
* **KMS** — encryption at rest (recordings, transcripts = PII).

**Third-party libraries / services**
* **Voice providers (factory):** Twilio · Telnyx · Vonage · Bandwidth · SignalWire · Sinch · Infobip · Plivo · `fake`.
* **Caller-ID reputation / branded calling** — First Orion / Hiya / TNS (the 10DLC analog).

**Internal (`@repo/*`)**
* `@repo/services` (Sqs, Dynamo, Cache, S3, Kms, the **`WorkQueue`** governor + **`canSend()`**), `@repo/endpoint` (`Access`), `@repo/common` (`Type`).
* Composes **contact** (consent/suppression) · **dispatch** (pacing/concurrency) · **registration** (numbers + STIR/SHAKEN) · **survey** (IVR runner) · **campaign** (orchestration + cost cap) · **media** (recordings) · **analytics** (outcomes) · **account** (billing).

# Gaps & open decisions

*The one review list.* ✅ = decided · ⚠️ = **open**.

1. ⚠️ **Build-or-not — a product / marketing decision.** Voice is **captured, not committed**; reuse is high
   (texting's cousin), but the compliance surface (STIR/SHAKEN, abandoned-call, in-call opt-out, AMD) is real.
2. ✅ **Channel model — DECIDED: a `send` channel reusing the texting/email stack** (factory · L1/L2 queues ·
   `canSend` · number records · dispatch · analytics).
3. ✅ **Survey calls = survey's IVR runner — DECIDED** (voice runs the IVR; survey owns definition + scoring).
4. ⚠️ **Caller-ID reputation home** — STIR/SHAKEN attestation + branded-calling registration belongs in
   [registration](../registration/SPECS.md) (the 10DLC analog); confirm the contract.
5. ✅ **Live-agent scope — DECIDED: out.** This is **automated** voice only (robo / IVR survey). A **live-agent
   dialer** (predictive/power dialing + agent desktop + Amazon Connect-class contact center) is a much larger,
   different product and is **not a requirement**. If it's ever prioritized it's a separate effort — the factory
   default (3rd-party + Polly/Transcribe) does not block it.
6. ⚠️ **State-law + counsel review — required before launch (the legal sign-off checklist).** Counsel must
   confirm, in writing, before the first production call:
   * **Prior express (written) consent** — prerecorded / AI-voice marketing to **cells** needs **PEWC**; to
     **landlines**, prerecorded marketing needs prior express consent. Confirm consent **capture, proof, and
     audit trail** meet the standard, and that **survey / political** calls (often exempt from PEWC but **not**
     from the prerecorded-to-cell rule) are classified correctly per call.
   * **Abandoned-call rate** — FTC TSR **≤ 3%** per campaign per 30 days, with the **2-second connect + recorded
     ID message** on abandonment. Confirm measurement window + enforcement.
   * **In-call identification + opt-out** — required automated **caller identity** at start and an **interactive
     opt-out** (DTMF/voice) honored in real time → suppression. Confirm script + mechanism.
   * **Calling-time windows** — **8am–9pm** *called-party local time*; confirm timezone source + state overrides.
   * **DNC** — federal + state DNC scrub and internal-DNC honoring; confirm cadence + provider responsibilities.
   * **AI-voice** — 2024 FCC ruling treats AI-generated voices as "artificial"; confirm any synthetic-voice
     (Polly/clone) prompts are covered by the same consent + disclosure posture.
   * **STIR/SHAKEN + caller-ID** — attestation level and branded-calling registration are accurate / not
     misleading (ties to gap #4 / [registration](../registration/SPECS.md)).
   * **State mini-TCPAs** — FL, OK, WA, etc. (stricter consent, curfews, per-call penalties); confirm
     per-jurisdiction rules and whether any states are excluded at launch.
   * **Recording consent** — two-party-consent states for any recorded call legs; confirm disclosure.
   *Output:* a counsel-signed checklist attached to the build decision (gap #1) — **no launch without it.** This
   is a **design overview, not legal advice.**
7. ✅ **Provider stack — DECIDED (default): 3rd-party-first behind the factory + TTS/STT via a routed AI
   abstraction.** Mirrors the SMS stance — reuse the existing vendors + `voiceCapable` number records, fastest to
   ship, mature STIR/SHAKEN + AMD + answer-rate. **Amazon Connect** only if a **live-agent contact center** is
   added; **Chime SDK** only if raw-minute cost / full in-infra residency dominates (own the build). Swappable by
   config — not a one-way door. See *Make vs buy*. **Implementation note:** TTS is NOT a bespoke Polly
   integration — it's `@repo/ai`'s existing `AiRouting.Modality.TEXT_TO_SPEECH` (the same provider-agnostic
   speech capability `media` already uses for voice cloning/narration; today routes to whichever provider
   `AiRouting` is configured for: fish.audio (the default) / ElevenLabs / OpenAI / **Piper** / **Polly**.
   **Piper** (open-source, self-hosted, keyless — `packages/ai/src/adapters/PiperAdapter.ts`, 2026-08-29) is a
   selectable `TEXT_TO_SPEECH` provider for cost-free/offline synthesis; select it via a `config/ai` route
   (`AiRouting.Provider.PIPER`), pointed at a `piper --http-server` process via `PIPER_URL`. **Polly** (Amazon
   Polly, IAM-authed/keyless — `packages/ai/src/adapters/PollyAdapter.ts`, 2026-08-29, mirrors `BedrockAdapter`'s
   keyless pattern) is now ALSO a selectable `TEXT_TO_SPEECH` provider — `AiRouting.Provider.POLLY`, `model`
   doubles as the Polly synthesis ENGINE ("neural" default); no native WAV output (falls back to MP3).
   STT (speech-to-text, for spoken IVR answers) is not wired at all yet — `@repo/ai` has a `SPEECH_TO_TEXT`
   modality slot, but voice doesn't call it (see gap #8).
8. ⚠️ **Next build queue (engineering, roughly priority order):**
   * ✅ **Full IVR flow engine — BUILT (2026-08-29).** `/voice/flows` CRUD + `/voice/flows/:id/preview`
     (merge + TTS synthesis, no call placed), a `Voice.IvrFlow`/`IvrStep`/`IvrGather` model (DTMF-only branch
     graph — no speech/NLU gather yet, a narrower gap now), a `voice_flows` DDB table, and multi-step branching
     in both adapters (`VoiceProvider.ivrInstructions` now takes a resolved `IvrRender` spec VoiceService builds
     by walking the flow graph one step per call-control webhook hit; `collectedInput` isolates each provider's
     own digit-field name). `Voice.SendRequest.flowId` + `mergeData` let a call run a saved flow instead of a
     single message, with `{{ dotted.path }}` merge tags (promoted to the shared `StringUtils.mergeTags`, which
     `MjmlRenderer.merge` now also delegates to — one merge-tag implementation for every channel, not a
     per-service copy). Per-step TTS is resolved LAZILY (at call-control-webhook time, cached by content hash)
     rather than eagerly at dial time, unlike the legacy single-message path — a deliberate difference since a
     flow's later steps may never be reached. STILL A GAP: speech/NLU gather (DTMF-only today), and the
     `/voice/flows` CRUD has no Console UI (out of scope — flows are account-authored content, like email
     templates, not an AppConfig-backed Config model; a future composer UI is a `web` app concern, not Console).
   * ✅ **AMD (answering-machine detection) — BUILT (2026-08-29).** `VoiceConfig.amdEnabled` (opt-in, default
     false) toggles Twilio's SYNCHRONOUS `machineDetection: "DetectMessageEnd"` on `calls.create` — Twilio holds
     the call until it knows human-vs-machine, then delivers `AnsweredBy` on the FIRST request to the existing
     call-control webhook (no new webhook route). `VoiceProvider.answeredBy` normalizes each provider's signal
     to `"human"`/`"machine"`/undefined; on `"machine"`, `VoiceService.ivrStep` marks the call `Voice.Status.
     VOICEMAIL` and either plays the request's `SendRequest.voicemailMessage` (lazily TTS'd + cached, same path
     as any other step) then hangs up, or hangs up SILENTLY if no voicemail message was given (`IvrRender.
     message` is now optional for exactly this case). The IVR flow engine and the legacy single-message path
     both go through this same AMD check before ever entering their own branching — `fake` doesn't need it
     (its weighted-outcome table already simulates VOICEMAIL synchronously in `initiate`). Console: a new AMD
     switch in `voiceConfig/GeneralSection.tsx`.
   * **STIR/SHAKEN attestation + caller-ID reputation** — belongs in [registration](../registration/SPECS.md)
     (gap #4); `voice_numbers` today is a bare, voice-owned stand-in with no attestation field.
   * ✅ **`WorkQueue` governor — BUILT + ADOPTED (2026-08-29).** `packages/services/src/WorkQueue.ts` now
     implements the full contract (DynamoDB durable job store + Redis fairness ZSET/token-bucket/per-minute
     bins — dispatch gap #8's hybrid, prototyping the `gsi_status_account` GSI access pattern the gap
     called for), and **voice composes it** (`VoiceService.workQueue`, queue `"voice"`, per-account rate
     seeded from `VoiceConfig.limits.defaultRatePerMinute` — a field that existed since the Console form
     was built but was never enforced until now). `dialOne`/`dialFlow` no longer call `adapter.initiate`
     inline — they gate (quiet-hours/suppression), write the call-log row as `QUEUED`, and hand the job to
     `workQueue.enqueue()` (job `meta` carries the built `VoiceCall` + `providerId` + flow/campaign context,
     but deliberately NEVER a resolved `VoiceContext` credential — that's re-resolved fresh at dispatch time
     so a Twilio auth token never lands at rest in the governor's job store). `VoiceMainService.
     startDispatchLoop` is the coordinator: a self-scheduled `Consumer`-style loop (no separate `Consumer`
     class stood up — the loop lives directly on `VoiceMainService`, since voice has no other reason for a
     second execution shape yet) that calls `dispatchPending()` each round and sleeps until
     `workQueue.nextWakeAt()` says something could change, per DISPATCH.md's "self-scheduled precise
     wake-ups" rather than fixed-interval polling. `dispatchOne` resolves the adapter + a fresh
     `providerContext`, dials, updates the call-log to whatever status the adapter returns, and always
     calls `workQueue.complete()` — a settled dial ATTEMPT (success OR provider-reported failure) closes the
     governed job; only an unresolvable provider/adapter is a governor-level `fail()` (a config problem, not
     a call outcome). Required new voice CloudManifest resources: `wq_jobs` (+ its `gsi_status_account`
     GSI), `wq_queue_config`, `wq_account_config`, `wq_account_queue_config` tables, and a `cache`
     (ElastiCache Serverless) resource — voice is the FIRST service in the platform to declare a `caches`
     resource at all (the `Cache`/Redis facade existed in `@repo/services` but had zero adopters before
     this). ✅ **Single-flight / leader-election — BUILT (2026-08-29)**, closing DISPATCH.md gap #13 at the
     COORDINATOR layer (per the doc's own layering — the governor library itself stays leader-election-free;
     each adopting channel's coordinator handles it): `VoiceMainService.startDispatchLoop` wraps each round in
     a Redis single-flight lock (`SET wq:voice:dispatch:lock <instance id> PX 10000 NX`) so only one MAIN
     replica actually dispatches per window; a replica that loses the race just skips the round (harmless —
     `dispatch()`'s conditional job-claim already made a double-dispatch a no-op, this just stops every
     replica in the autoscaled fleet from redundantly racing the same round). Release checks the lock still
     names this instance before clearing it (never clears a lock a DIFFERENT replica re-acquired after this
     one's TTL lapsed); a crash mid-round self-heals via the TTL, never holds the lock forever. `wq_queue_
     config`'s operator-tunable batch/low-water-mark/lease values are left at the governor's ctor-time
     `Rules` defaults (batchSize 20, lowWaterMark 50, leaseSeconds 120) — no Console control for these yet
     (they're WorkQueue's OWN admin surface, orthogonal to `VoiceConfig`).
     ✅ **Operator visibility (API) — BUILT (2026-08-29).** `WorkQueue.snapshot()` (+ its `listActiveAccounts()`
     helper) aggregates queue depth/defaults + every currently-active account's `accountState` into one
     `WorkQueue.QueueSnapshot`. Voice serializes it over a NEW shared wire shape, `Dispatch.QueueSnapshot`
     (`packages/api/src/dispatch/model/Dispatch.ts`) — deliberately NOT a voice-specific model, so any future
     `WorkQueue` adopter (email/SMS) can expose the SAME shape from their own endpoint. Three new endpoints:
     `GET /voice/dispatch/state` (`GetVoiceDispatchStateImpl` → `workQueue.snapshot()`), `POST /voice/dispatch/
     suspend` + `POST /voice/dispatch/resume` (`{ accountId }` → `workQueue.suspend`/`resume`) — all
     `Access.AppRole.APPLICATION`, `Audience.APP`. **Still open: no Console panel.** Building it exposed that
     Console has **no existing pattern for calling a normal authorizer-protected endpoint** — the only
     precedent (`tools/console/src/main/authActions.ts`) bypasses auth via a dev-only unauthenticated
     `_control` route, not real ROOT/session auth. Solving that is a bigger, cross-cutting Console change
     (affects any future admin panel, not just this one) — deliberately deferred; per user decision
     (2026-08-29), operator visibility ships API-only for now (curl/API-tooling-reachable), not Console-UI-
     reachable. Revisit once Console's real-auth-calling gap is solved, or a second `WorkQueue` adopter makes
     the generic-panel shape worth building.
   * ✅ **Recordings + transcripts — BUILT (2026-08-29).** `VoiceConfig.recordingEnabled` turns on Twilio
     whole-call recording (`record: true` + `recordingStatusCallback` → a NEW async webhook,
     `POST /voice/webhook/:provider/recording/:accountId/:callId`, mirroring the status webhook's shape); on
     completion the `voice-recording` worker downloads the audio (`VoiceProvider.fetchRecording`, Basic-Auth'd
     against the Twilio REST API) and stores it in the `voice` bucket's `recordings/` prefix (`CallLog.
     recordingKey` — an S3 key, never a durable URL; `GetVoiceCallRecording` presigns fresh on every read).
     `VoiceConfig.transcriptionEnabled` (requires recording) additionally transcribes the downloaded audio via
     `@repo/ai`'s `AiRouting.Modality.SPEECH_TO_TEXT` (the SAME provider-agnostic pattern TTS uses — no
     voice-specific STT client), storing the text on `CallLog.transcript` (`GetVoiceCallTranscript`). **PII TTL
     is enforced at the S3-bucket-lifecycle level** (90-day expiry on `recordings/`), not a per-row DynamoDB TTL
     — DynamoDB TTL deletes the WHOLE item, which would destroy the operational call-log row, not just its PII.
     `POST /voice/internal/erase` (S2S forget hook) purges a destination's recordings/transcripts + obfuscates
     `to` on those rows ahead of that TTL, for the `contact` forget fan-out to call once wired. `fake` never
     records (no real media exists to capture). Console: `recordingEnabled`/`transcriptionEnabled` switches in
     `voiceConfig/GeneralSection.tsx` (transcription disabled unless recording is on).
   * ✅ **DLQ list + requeue — BUILT (2026-08-29).** `GET /voice/dlq` (optionally filtered to one queue) +
     `POST /voice/dlq/requeue` (resend + delete, by the exact items a prior list call returned — never
     re-received server-side, so receipt handles stay valid). **Found + fixed a platform-wide gap along the
     way:** `cloud/src/lib/ServiceStack.ts`'s `makeQueue` created each `dlq: true` queue's dead-letter
     companion but never registered it as its own resource (`this.queues.set`) or exposed its URL
     (`envVars[...]`) — so `CloudResolver.queueUrl("<key>-dlq")` would've thrown for EVERY service with a DLQ,
     not just voice, and the service's IAM role had no grant on it either. Fixed generically (register the
     `<key>-dlq` queue under its own key, same as the source queue) — every service with `dlq: true` queues
     benefits, not just voice.
   * **More providers** — Telnyx / Vonage / Bandwidth / SignalWire / Sinch / Infobip / Plivo / AWS Connect —
     each is "a new adapter, not a new worker" per the factory design (voice-3.1), same shape as
     `TwilioVoiceAdapter`.
   * ✅ **TTS registration in `media`'s asset library — BUILT (2026-08-29), scoped as an ADDITION not a
     replacement.** Voice's own `tts/` S3 cache stays (it's fast, proven, and on the call's critical path —
     nothing should make a `media` outage block a call). On a fresh synthesis (cache miss), voice now ALSO
     best-effort registers the clip in `media`'s library via a NEW S2S endpoint, `POST /media/v1/internal/
     assets` (`Audience.INTERNAL`, `MediaService.storeInternalAsset` — mirrors `promoteBatch`'s write shape:
     `Media.Status.SCANNING` → `media`/`media-scan` → immediately presigned so the caller doesn't wait on the
     async scan pipeline). **This required real cross-service plumbing, not just a voice change:** media had
     NO S2S "store bytes as an asset" path before this (`promoteBatch` is in-process-only + user-authed;
     `PostUpload`/`PostUploadComplete` are user-authed too) — so a new INTERNAL contract + `MediaService`
     method were added. Voice reaches it via `apps/core/voice/src/clients/MediaClient.ts`, the SAME S2S
     pattern `social`'s `MarketplaceClient` already uses (a CloudManifest `uses: [{ service: "media", kind:
     ResourceKind.SERVICE, ... }]` entry → `MEDIA_INTERNAL_URL` env var → `RestfulService.fetch`). Registration
     failure is logged + swallowed — never surfaces to the call. **Not done:** true dedup with `media`'s
     voice-cloning feature (matching voice-cloned models/IDs) — out of scope, a deeper design question for
     later; today's registration is "log the clip," not "reuse an existing one across services."
9. ✅ **Console config editor — DONE.** `VoiceConfig` is registered in `ConfigSchema.ts` (JSON-editor linting)
   and has a full smart-form editor at `tools/console/src/renderer/components/voiceConfig/` (General/Limits/
   Quiet hours/Provider registry/Logging sections), registered in `ConfigPanel.tsx`'s `SMART_EDITORS` — the
   two-views-of-one-contract rule (CLAUDE.md) is satisfied for every `VoiceConfig.Config` field that exists
   today. Any NEW field added to the model needs a matching control added to that folder in the same change.

# Requirements (traceable register)

The traceable register for the **voice channel** (IDs **`voice-N.M`**). **Status: the whole service is PLANNED**
— priorities are *relative within voice* for when/if it's built. **Boundary:** voice owns **call mechanics +
IVR + caller-ID auth + compliance gating**; sending eligibility = `canSend()`, pacing = dispatch, numbers +
STIR/SHAKEN = registration, survey state = survey, orchestration + cost cap = campaign.

## voice-1.0 Calling — A
- **voice-1.1** Single + **batch** outbound calls — A
- **voice-1.2** **Prerecorded audio or TTS** (Polly) message; per-call cost accounting — A
- **voice-1.3** **SQS-queued** → **Lambda** workers — A
- **voice-1.4** **Scheduled** calls via EventBridge (within quiet-hours) — A
- **voice-1.5** Recipient + merge data from [contact](../contact/SPECS.md) — A
- **voice-1.6** **Pre-launch test call** to a test-number library (verify prompt / IVR / opt-out) — B
- **voice-1.7** **Two-level queueing (L1 fair-share → L2 per-provider)** — provider-agnostic worker; per-provider queues = HoL isolation (mirrors `texting-1.7` / `email-1.7`) — A

## voice-2.0 Content & IVR — A
- **voice-2.1** **IVR engine** — play prompt → collect **DTMF / speech** → branch; the survey voice runner — A
- **voice-2.2** **TTS (Polly)** + **prerecorded audio** (media); merge fields — A
- **voice-2.3** **Speech → text** (Transcribe) for spoken survey answers — B
- **voice-2.4** **AMD** — answering-machine detection → **voicemail drop** vs hang-up — A

## voice-3.0 Provider abstraction (factory) — A
- **voice-3.1** Provider **factory** — Twilio / Telnyx / Vonage / Bandwidth / SignalWire / Sinch / Infobip / Plivo / **`fake`** + **AWS Connect/Pinpoint** — A
- **voice-3.2** **Single dialect boundary** per provider — `initiate` · `ivrInstructions` · `statusNormalize` · `verifySignature` (the `SmsAdapter` pattern) — A
- **voice-3.3** **Typed, self-registering registry on the domain base** — adapters self-register on import; `VoiceService`/`VoiceJob` build `Map<Provider, VoiceAdapter>` once at cold-start; all roles resolve the *same* registry (no per-role wiring) — A
- **voice-3.4** **Stateless adapters** — one instance per provider; **credentials + number record passed in** (per-number overrides), not baked in — A
- **voice-3.5** **`fake`** provider — simulate answered/no-answer/voicemail/DTMF at scale — B
- **voice-3.4** **Failover** to a **pre-authenticated + reputable** provider only; idempotency key prevents a double-dial — B

## voice-4.0 Compliance & regulatory — A
- **voice-4.1** **Pre-call `canSend()` gate** — consent (TCPA / **PEWC** for prerecorded marketing) · suppression · **quiet-hours (8am–9pm local)** · block-list · **DNC** — A
- **voice-4.2** **STIR/SHAKEN attestation** on every call (via [registration](../registration/SPECS.md)) — unsigned → "Spam Likely" — A
- **voice-4.3** **Caller-ID reputation / branded calling** (First Orion / Hiya / TNS) — the 10DLC analog — B
- **voice-4.4** **Abandoned-call control** — predictive connect ≤ ~2s or abandoned-message; **≤ 3% abandonment** (a dispatch concurrency/connect-rate constraint) — A
- **voice-4.5** **In-call identification + interactive opt-out** ("press 1 to stop" → suppression) — A
- **voice-4.6** **Prerecorded/AI-voice to a cell requires prior express consent** regardless of content (survey/political latitude is landline-only) — A
- **voice-4.7** **State mini-TCPA** awareness (FL FTSA / OK / WA / …) — B

## voice-5.0 Retry, failure & DLQ — A
- **voice-5.1** Retry (no-answer / busy → config attempts, backoff) → DLQ; **legit failures not retried** — A
- **voice-5.2** **DLQ → requeue** manual API (batch / accountId) — B

## voice-6.0 Pause / halt / cancel — A
- **voice-6.1** **Redis pause flag** (account / campaign); the worker checks before each call — A

## voice-7.0 Outcomes & analytics — A
- **voice-7.1** **Operational call-log** (answered / no-answer / busy / voicemail / DTMF / duration / opt-out) — A
- **voice-7.2** Outcomes/engagement **emitted to [analytics](../analytics/SPECS.md)** (Kafka) — not a voice-owned lake — B
- **voice-7.3** **Per-call cost accounting** → billing; **meter against the campaign budget cap** ([campaign → channel cost management](../campaign/SPECS.md)) — A
- **voice-7.4** **No PII** in events/logs — opaque `contactId` — A

## voice-8.0 Numbers, caller-ID & STIR/SHAKEN — A
- **voice-8.1** **Voice-capable numbers** consumed from [registration](../registration/SPECS.md) (numbers are already `voiceCapable`) — A
- **voice-8.2** **STIR/SHAKEN** attestation + **caller-ID registration** (the 10DLC analog) owned by registration — A

## voice-9.0 Privacy & compliance — A
- **voice-9.1** **Recordings + transcripts are PII** — encrypted (KMS), **TTL'd**, in the [contact](../contact/SPECS.md) **forget fan-out** (obfuscate/purge) — A
- **voice-9.2** **No PHI** by [AUP](../account/specs/SPECS.md) — A
- **voice-9.3** **Tenant isolation** + per-account rate / concurrency — A

## voice-10.0 Infra footprint — A
- **voice-10.1** **SQS** (L1/L2 + DLQ) · **Lambda** workers · **DynamoDB** (call-log) · **EventBridge** (schedule) · **Redis** (pause / concurrency) · **S3 + Polly + Transcribe** · **KMS** — A

## voice-11.0 Service & Job topology — B
- **voice-11.1** **Domain bases** — `VoiceService extends Service` + `VoiceJob extends Job` hold the shared code (provider factory · IVR engine · AMD · TTS · STIR/SHAKEN · `canSend` · `WorkQueue` · call-log/recording store) — B
- **voice-11.2** **`VoiceMainService`** — the `/voice/*` API + **synchronous IVR call-control webhooks** + async status ingress — A
- **voice-11.3** **Jobs extend `VoiceJob`** — `VoiceCallWorker` (L2 per-provider, provider-agnostic) / `VoiceStatusJob` / `VoiceScheduleJob` — A
- **voice-11.4** **`VoiceCallWorker`** — `canSend` + DNC + STIR/SHAKEN + AMD → `provider.initiate`; abandoned-call / concurrency paced via `WorkQueue`; retry → DLQ — A

# eof
