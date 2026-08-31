#
# `@repo/ai` — provider-agnostic AI abstraction
#

# Objective

One thin, typed interface every service and job uses to talk to AI engines — **chat/completion,
structured (JSON) output, embeddings, and image generation** — without knowing or caring which
provider (AWS Bedrock, Anthropic, OpenAI, …) is behind it. A service composes a **prompt**; the
package handles transport, auth, retries, cost metering, and provider selection. Swapping providers
(or letting an account bring their own) is a config change, never a code change.

This is a **library** (`@repo/ai`), used in-process like the `@repo/services` AWS facades — it is
the capability the workflow `ai` node depends on (workflow open decision #8).

# Role & boundaries (read this first)

`@repo/ai` is a **transport + selection facade**, not a prompt library and not a model host. It owns
the uniform interface, provider adapters, key/config resolution, and the cross-cutting concerns
(retries, cost, rate limits, fallback, observability). It does **not** own prompts, business logic,
or "what to ask" — those stay in the calling service (per the original brief: each service composes
its own prompt).

What `@repo/ai` **owns**:
* The **uniform `Ai` interface** (chat / structured / embed / image) — identical across providers.
* **Provider adapters** (Bedrock, Anthropic, OpenAI, …) behind that interface.
* A **factory** + enums so a caller picks a provider/model centrally.
* **Key & config resolution** — platform defaults (Secrets Manager / AppConfig) and per-account
  overrides incl. **BYOK** (bring-your-own-key).
* Cross-cutting: **retries, timeouts, rate limiting, cost/usage metering, optional caching, fallback
  chain, guardrails/PII**, and transaction-id observability.

What `@repo/ai` **delegates / does not do**:
* **Prompts** — the caller builds them (a service knows its task). An optional `PromptTemplate` helper
  is sugar, not a requirement.
* **Vector storage / retrieval (RAG)** — it *produces* embeddings; storage + search is **search**
  (OpenSearch). `@repo/ai` does the `embed`, not the index.
* **Cost dashboards** — it *emits* usage events; aggregation/visualization is **monitor/analytics**.
* **Secrets storage** — keys live in **Secrets Manager**; this package only *resolves* them.
* **A UI endpoint** — a future service may expose AI to the app; the package is consumed server-side.

# Out of scope (deferred)

* **Agentic/multi-step orchestration** — chaining model calls + tools into a workflow is the
  **workflow** service's job; `@repo/ai` is a single call boundary (one request → one response/stream).
* **Fine-tuning / model training / hosting** — use a provider's managed offering if ever needed.
* **A standalone AI-gateway service** — start as an in-process library; promote to a gateway only if
  cross-service rate-limiting/caching/key-isolation demands it (see "Library vs gateway").

# Core concepts

* **Provider** — a backend that serves models (`BEDROCK`, `ANTHROPIC`, `OPENAI`, …).
* **Model** — a specific model id on a provider, tagged with the **capabilities** it supports
  (chat, structured, embed, image, vision, tools, streaming).
* **Capability** — what you're asking for: `chat`, `structured`, `embed`, `image`.
* **Client** — a configured `Ai` instance bound to a provider + resolved keys, from the factory.
* **Request / Response** — uniform, provider-independent shapes (messages, params, usage).
* **Resolution** — how a call picks provider+model+key: explicit arg → account override (incl. BYOK)
  → platform default per capability (from AppConfig). Centralized, so callers don't hard-code.
* **Usage** — tokens in/out (or images), a cost estimate, provider+model — emitted per call for
  metering/billing.

# Capabilities — the interface

```ts
interface Ai {
    /** Chat/completion → a text (or structured) reply. The 80% case. */
    chat( req : Ai.ChatRequest ) : Promise<Ai.ChatResponse>;

    /** Token-streamed chat — for responsive UI / long generations (later). */
    stream( req : Ai.ChatRequest ) : AsyncIterable<Ai.ChatChunk>;

    /** Schema-constrained JSON out — classify / extract / tag. Validated against `schema` (ajv). */
    structured<T>( req : Ai.StructuredRequest<T> ) : Promise<T>;

    /** Text → embedding vector(s) — for semantic search / RAG (stored by the search service). */
    embed( req : Ai.EmbedRequest ) : Promise<Ai.EmbedResponse>;

    /** Prompt → generated image(s). */
    image( req : Ai.ImageRequest ) : Promise<Ai.ImageResponse>;
}
```

* **`structured`** is the most valuable for this platform: classify a reply (`YES`/`NO`/intent),
  extract fields, score sentiment — all returning **typed, validated** data that can safely drive a
  workflow gate. It maps onto each provider's tool-use / JSON mode and validates with the same `ajv`
  the endpoints use.
* **`chat`** powers message tailoring (campaign objective → copy), summaries, the workflow `ai` node.
* **`embed`** feeds the search service's semantic index (the package generates; search stores/queries).
* **`image`** for generated media (campaign creative), routed to the media service for storage.

# Provider selection & factory

```ts
// central default (resolved from config), or pick explicitly:
const ai      = AiFactory.create();                                  // platform default provider/model
const claude  = AiFactory.create( { provider: Ai.Provider.BEDROCK, model: "anthropic.claude-..." } );
const forAcct = AiFactory.forAccount( accountId );                   // honors account override + BYOK

const reply : Ai.ChatResponse = await ai.chat( {
    messages : [ { role: "user", content: prompt } ],
    maxTokens: 512,
} );
```

* `Ai.Provider` enum + a per-provider **model registry** (model id → capabilities) so the factory can
  reject "embed on a chat-only model" at call time, and pick a sensible default model per capability.
* `forAccount(accountId)` resolves the account's configured provider/model and **BYOK** key if set,
  else falls back to the platform default — the "accounts may configure their own engine/keys" rule.

# Configuration & keys

* **Platform defaults** live in **AppConfig**: default provider + default model **per capability**
  (e.g. chat→Claude on Bedrock, embed→Titan/Cohere, image→Stability). Tunable without a deploy.
* **Keys/secrets** live in **Secrets Manager**, resolved at runtime — **never in code or env**.
  Bedrock needs **no key at all** (IAM-authed — a real security win; see Providers).
* **Per-account BYOK** — an account may supply its own provider key (stored as an encrypted,
  per-account secret, KMS-wrapped). Drives both *routing* (use their engine) and *billing* (their
  spend, not ours). Resolution order: explicit call arg → account override → platform default.

# Providers — recommendations

For an AWS-centric platform, the deciding factors are **native AWS auth/data-residency**, **model
quality**, and **breadth of capability**.

| Provider | Use it as | Why |
|---|---|---|
| **AWS Bedrock** ⭐ | **the default** | Native AWS: **IAM auth (no API keys)**, VPC/PrivateLink, data **not** used for training. One API fronts **many** models — **Anthropic Claude**, Meta Llama, Mistral, Amazon Nova/Titan, Cohere (embeddings), **Stability** (images) — plus **Bedrock Guardrails** (PII/safety) and Knowledge Bases. Fits the existing facade + least-privilege IAM pattern exactly. |
| **Anthropic (direct)** | best chat / newest Claude | Top-tier reasoning + the latest Claude features the moment they ship (sometimes ahead of Bedrock parity). Needs an API key (Secrets Manager / BYOK). |
| **OpenAI (direct)** | breadth / specific features | GPT-4o/o-series, DALL·E images, strong embeddings, large ecosystem. Needs an API key. Common BYOK choice for accounts. |
| **Extensible** | as needed | Google Gemini (Vertex), Cohere (rerank/embeddings), Stability (images), ElevenLabs (already built) — each a new adapter behind the same interface. |
| **Piper** (self-hosted) | keyless / offline TTS | Open-source (rhasspy/piper), no API key — talks to a self-hosted `piper --http-server` (`PIPER_URL`, default `http://localhost:5000`). Text-to-speech only, one voice per server process. Good for cost-free/offline synthesis where cloud TTS isn't wanted. |
| **Amazon Polly** | in-infra TTS | IAM-authed (no API key), same posture as Bedrock — no data leaves AWS, no key sprawl. Text-to-speech only; `model` doubles as the Polly synthesis engine (`"neural"` default). No native WAV output (falls back to MP3). |

**Recommendation:** **default to Bedrock** (IAM, no key sprawl, Claude + image + guardrails in one
place, matches "use AWS"), and ship **direct Anthropic + OpenAI** adapters behind the same interface
for newest-model access and **account BYOK**. Default the chat model to **Claude on Bedrock**.

# Cross-cutting concerns (the reason this is a facade, not raw SDK calls)

* **Retries + timeouts** — transient (5xx/throttle) retried with backoff; hard per-call timeout.
* **Rate limiting / concurrency** — per-account + per-provider caps, so one account/feature can't
  exhaust a shared quota (and BYOK accounts are metered against their own limits).
* **Cost & usage metering** — every call emits `{ provider, model, tokensIn/Out (or images), costEst,
  accountId, feature, transactionId }` → **monitor/analytics** for dashboards + billing.
* **Caching (optional)** — cache identical `(model, prompt, params)` results in **Redis** with a TTL
  to cut cost/latency for repeated prompts (off by default; opt-in per call).
* **Fallback chain** — on a provider outage/throttle, fall back to a configured secondary
  (e.g. Bedrock-Claude → Anthropic-direct) so a feature degrades, not dies.
* **Observability** — thread the **transaction id** so an AI call shows up in the request's trace
  (monitor); structured logging of prompts/responses with **PII care** (redact / sample / opt-in).
* **Guardrails / safety** — optional moderation + PII redaction before send (Bedrock Guardrails or a
  provider equivalent). **Treat model output as untrusted** — never let it execute side effects
  directly; prefer `structured` + validation when output drives logic (e.g. a workflow branch).

# Usage (a service wiring it)

```ts
import { AiFactory, Ai } from "@repo/ai";

class TailoringService extends Service {
    private _ai? : Ai;
    protected get ai() : Ai { return this._ai ??= AiFactory.forAccount( this.ctx.accountId ); }

    async tailor( objective : string, contact : Contact ) : Promise<string> {
        const reply : Ai.ChatResponse = await this.ai.chat( {
            messages : [ { role: "system", content: "Write a concise SMS." },
                         { role: "user",   content: `Objective: ${objective}. First name: ${contact.first}` } ],
            maxTokens: 160,
        } );
        // Operational failures are RETURNED, not thrown — check `ok`.
        if( !reply.ok ) { this.log.warn( "tailor failed", reply.error ); return ""; }
        return reply.text;
    }

    // structured classification that can safely drive a workflow gate:
    async classify( message : string ) : Promise<"yes" | "no" | "other"> {
        const result : Ai.Result<{ intent : "yes" | "no" | "other" }> = await this.ai.structured( {
            messages : [ { role: "user", content: message } ],
            schema   : INTENT_SCHEMA,      // ajv-validated; result is typed on `ok`
        } );
        return result.ok ? result.value.intent : "other";   // graceful fallback, no try/catch
    }
}
```

# Security

* **No keys in code/env** — Secrets Manager (platform) + per-account BYOK secrets (KMS-encrypted).
* **Prefer Bedrock's IAM auth** — no long-lived API key to leak for the default path.
* **Data privacy** — choose providers that don't train on customer data (Bedrock by default); redact
  PII before sending where the use case allows; make AI features **account-opt-in**.
* **Prompt injection** — content from contacts / 3rd parties may reach a prompt; never trust model
  output to trigger actions. Use `structured` + schema validation, and keep side effects in the
  caller's curated logic (this mirrors the workflow `code`-node "pure, no side effects" stance).

# Library vs gateway (open)

Start as an **in-process library** — simplest, lowest latency, reuses each service's IAM. If central
**rate-limiting, caching, key isolation, or cross-service cost control** become important, promote the
same interface behind a thin **AI-gateway service** (the library then has a `GATEWAY` "provider" that
calls it). The interface doesn't change either way — that's the point of the abstraction.

# Open decisions

1. **Default models per capability** — confirm chat (Claude-on-Bedrock?), embed (Titan vs Cohere),
   image (Stability vs Titan Image); set in AppConfig.
2. **BYOK scope** — which providers accept account keys; how key validity is checked; billing split.
3. **Library vs gateway** — in-process now; define the trigger to extract a gateway service.
4. **Caching default** — opt-in per call vs on-by-default for idempotent `structured` calls.
5. **Streaming** — when the UI needs it; transport (SSE/WebSocket via the proxy) is a later concern.
6. **Guardrails** — Bedrock Guardrails vs a provider-neutral moderation step; PII-redaction policy.
7. **Package vs `@repo/services`** — standalone `@repo/ai` (heavier provider SDKs, tree-shaken) vs a
   facade under services. Leaning standalone, with provider SDKs marked external by the bundler.
