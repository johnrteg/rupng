#
# Texting: SMS/MMS messaging service
#

# Objective

The platform's **bread-and-butter channel** — send and receive **SMS / MMS** at scale, end to end:
outbound send (single · bulk · scheduled), the **provider abstraction** (Twilio / Bandwidth / …) with
retry / DLQ / idempotency, **carrier-compliant delivery** (10DLC / TFN / short code, quiet hours,
STOP/HELP, SHAFT), **delivery-receipt (DLR) + status** normalization, and the **two-way conversation /
inbox** that email doesn't have. Architecturally a **sibling of [email](../email/SPECS.md)** — same
outbound-queue + factory-adapter + dispatch-governor shape — but with SMS-specific realities email never
faces: **carrier-enforced throughput**, **per-recipient quiet hours**, **silent content filtering**,
**flaky async DLRs**, **sticky-number routing**, and a **real-time inbound thread model**.

The internal name for the normalized send/receive/status layer is the **"Unified Delivery Framework" (UDF)** —
each provider's many unique status/error codes map back to one normalized vocabulary.

> **What this *really* is — not an SMS gateway.** SMS/MMS *delivery* is the **substrate**; the platform is a
> **multi-tenant, compliance-heavy, human-agent P2P texting operations platform.** The **load-bearing**
> requirements — the ones a "just send an SMS" rewrite would miss — are the **texter workflow** (`texting-21`),
> **roles / teams / reseller tenancy**, **10DLC/TCR + consent governance**, **inline billing**, and the
> **config-driven provider / rate / queue flexibility**. Many span services; the *Cross-service load-bearing
> requirements* section enumerates them so none is lost. **⚠️ = easy to miss in a rewrite.**

# Role & boundaries

**Owns:**
* **Send execution** — SMS + MMS, single / bulk / scheduled; the **provider factory** (Twilio, Bandwidth, …,
  `fake`); retry / DLQ; **idempotency** (no double-send).
* The **conversation / thread model** — `contact ↔ your-number ↔ account` with **message history** (the data
  behind the inbox; [web](../web/SPECS.md) renders the UX).
* The **inbound + DLR pipeline** — `webhook/texting/<provider> → verify → react → enrich → emit`; **DLR/status
  normalization** (the UDF code map).
* **Number routing** — pool selection at send time, **sticky-per-contact** for conversation continuity.
* **STOP/START/HELP** keyword handling (the platform layer) → suppression write-back.
* The **operational send-log** + **per-segment / per-MMS cost accounting** (the counter billing consumes).

**Delegates / does NOT do:**

| Concern | Owner |
|---|---|
| **Consent / suppression** SoT (the `canSend()` truth) | **[contact](../contact/SPECS.md)** (texting *runs* the gate + writes STOP-suppression back) |
| **Fair-share ordering + per-number carrier MPS pacing + number warming** | **[dispatch](../../../packages/services/DISPATCH.md)** (SMS is the original noisy-neighbor case) |
| **Number provisioning + lifecycle** (buy / register 10DLC / TFN / SC), **10DLC / brand / campaign registration**, trust-score → MPS | **[registration](../registration/SPECS.md)** — numbers are **provisioned there + tied to the account**; texting **consumes** them (routing) + the published MPS |
| **Branded short domain / tracked links** (shared with email) | **[links](../links/SPECS.md)** |
| **MMS media** storage + the carrier's public-signed fetch | **[media](../media/SPECS.md)** |
| The **engagement / event lake** + trends | **[analytics](../analytics/SPECS.md)** (texting emits normalized events) |
| **Real-time push** of inbound to the web inbox | **[realtime](../realtime/SPECS.md)** (texting publishes; realtime fans out) |
| **Survey conversation** state machine | **[survey](../survey/SPECS.md)** (SMS survey = a definition compiled to workflow `collect-input` — *not* a second engine here) |
| **Audience** selection | **[contact](../contact/SPECS.md)** segments / **[campaign](../campaign/SPECS.md)** |
| **Cost / invoicing** | **billing** (texting emits segment / MMS counts) |
| **Identity / RBAC** | **[auth](../auth/specs/SPECS.md)** (texting enforces, doesn't define) |

# Similar to email — and the SMS-specific deltas

**Same as email** (reuse, don't reinvent): outbound `text/<provider>` queues with **factory adapters**,
retry / DLQ / idempotency, the **[dispatch](../../../packages/services/DISPATCH.md)** fairness governor in front; inbound
via the **unified webhook pipeline** (verify → react → enrich → emit → analytics); **consent / suppression**
from [contact](../contact/SPECS.md); the shared **branded shortener** ([links](../links/SPECS.md)); normalized
events to [analytics](../analytics/SPECS.md).

**What SMS adds that email never faces:**
* **Carrier-enforced throughput** — not just your policy (below).
* **Per-recipient-timezone quiet hours** (TCPA) — email has no equivalent.
* **Silent content filtering** (SHAFT + public-shortener blocking) — failures are often vague or invisible.
* **Flaky async DLRs** — "delivered" is best-effort; some never arrive.
* **Sticky-number routing** — pick a number per send, same number per contact.
* **A real-time two-way inbox** — the biggest product surface email lacks.

# Design principles & divergences from the legacy system

**The legacy system is the reference for *what* this platform must do — the rules, compliance, and flows — not
always *how*.** We fold in its hard-won domain logic and its genuinely good instincts (**config-driven topology**,
**normalized vocabulary**, **two-stage gating**, **typed attributes**). But much of its *mechanism* is an
artifact of a **monolith / stringly-typed JS / poll-era** design; where that hurts **coding, maintenance,
scalability, extensibility, reliability, or performance**, we **deliberately diverge** (full register:
`texting-20`).

**Coding & maintenance**
* **Typed, not stringly-dispatched** — provider adapters implement a **typed `SmsAdapter` interface** via a
  **typed registry**, not the legacy runtime `modules[name][cmd]` string dispatch. A new adapter is a class the
  compiler *forces* to be complete *(supersedes the convention-only `texting-3.7`)*.
* **No magic status integers** — the legacy `600/601/602` codes become a **typed result**
  `{ outcome, reason, retryAfter? }` (`texting-17.1`). Magic numbers are exactly the anti-pattern the
  *typed-field lesson* names; the `6xx` codes survive only as a **legacy-mapping footnote**.

**Scalability (horizontal + vertical)**
* **Stateless workers** — all state in Redis / DynamoDB, so the pool scales **out** by adding consumers; vertical
  scale = per-queue prefetch / concurrency (`texting-1.3.3`).
* **Partition-aware keys** — DynamoDB keys avoid **hot partitions** (a high-volume account must not be one hot
  key); send-log / conversation keys are composite / sharded.
* **Token-bucket leasing** — a worker **leases a batch of tokens** + refills periodically, instead of a Redis
  round-trip **per message** (the legacy per-send limiter call doesn't scale).

**Extensibility**
* **Config, not code** for new provider / carrier / queue isolation / code-maps (kept from legacy — good).
* The **typed adapter interface** makes adding a provider a bounded, type-checked task.

**Reliability**
* **Durable billing ≠ best-effort stats** — billing-critical **segment / MMS counts are durable** (with the
  send-log / a durable stream), **not** the in-memory-merge-then-flush counters (which lose up to a flush
  interval on crash). Stats stay best-effort merge *(refines `texting-19.1`)*.
* **Bench state = Redis SoT + pub/sub invalidation** — not the legacy in-memory `ipc.broadcast` a restarted /
  newly-joined worker would miss *(refines `texting-5.7`)*.
* **Idempotency + DLQ discipline** (kept) — uniqueKey on enqueue, msgid dedup inbound, maxReceives → DLQ.

**Performance**
* **Computed-delay backpressure, not blind visibility-timeout polling** — a throttled message is re-scheduled
  with a **delay ≈ token-bucket refill** (SQS delay-seconds) so it wakes when budget is likely free, instead of
  waking on a fixed timeout to re-check and re-sleep (retry churn + wasted dequeues). A breaker-open message
  waits on the **breaker signal**, not a poll loop *(refines `texting-1.3.2` / `9.4`)*.

> **Stance:** keep the legacy system's *domain rules and config-driven instincts*; replace its *monolith / JS /
> poll-era mechanics* with **typed, stateless, horizontally-scalable** ones. "Production does it this way" is
> evidence it **works**, not evidence it's **best**.

# Throughput & number routing

* **Limits are carrier-enforced**, not just policy: **10DLC MPS by trust score**, **TFN caps**, **short-code
  high throughput**. Exceed them and carriers **filter / queue silently**. The MPS ceiling is published by
  **[registration](../registration/SPECS.md)** (trust score → MPS); texting consumes it.
* **Supported carriers (destination MNOs): AT&T · Verizon · T-Mobile · US Cellular.** Each has its **own MPS
  profile, content-filtering behavior, and DLR/error codes** — so per-carrier handling matters for pacing
  (dispatch), filtering awareness, and the UDF code map. **Providers ≠ carriers**: a *provider* (Twilio,
  Bandwidth, …) is the path we send through; a *carrier* is the network that delivers to the handset.
* The **[dispatch](../../../packages/services/DISPATCH.md)** governor for SMS paces on **three axes**: **per-account
  fairness × per-number carrier MPS × per-provider account send limit** (each provider caps our account's
  overall send-rate / concurrency — see the provider integration table).
* **Number pooling / rotation** — accounts use a **pool** for throughput / deliverability; an **account and a
  campaign may offer multiple numbers** to send on. Texting **selects a number at send time** with a preference
  order: **sticky-first** (the number we last used for this contact — continuity), else **area-code match**
  (local-presence: pick a pool number matching the contact's area code), else **pool-balance**; **failover** may
  pick a number on another provider when the primary is down.
* **TCR campaign number group + selection mode (the "parent number").** The **1+ numbers registered under a
  10DLC / TCR campaign** form that campaign's **number group**. A campaign picks a **selection mode** over the
  group — the UI "parent number" selector — and **all modes are the same round-robin over an eligible set**:
  * **`all`** *(the parent / whole group)* — round-robin across **every** number in the group;
  * **`area_code`** — round-robin across **only the subset of the group in a specified area code** — a **subset
    of `all`** (local presence, when the group spans multiple NPAs);
  * **`single`** — one specific number.
  A set (or subset) of **one number just routes there** (round-robin of one). The mode chooses the **eligible set
  for an *initial* send**; **whichever number is picked becomes the contact / campaign's *stuck* number** — from
  then on **replies are pinned** to it (above), **regardless of mode**. (For an already-engaged contact,
  **sticky-first short-circuits** selection — the existing stuck number wins.) The group is **registered in
  [registration](../registration/SPECS.md)**; texting **routes over it**.
* **Stickiness is recorded.** Every send **records `(account/campaign, contact) → number used`**, and **reply
  routing resolves across any recorded number** — inbound keys off `(from contact, to number)` against that map
  → the right conversation, **regardless of which number** it came in on. *(That's about **receiving**.)*
* **Once engaged, the number is "stuck" — replies are PINNED, no failover.** The **first** send to a contact
  **pins** the conversation's number. From then on, a **conversational reply MUST go out on that same stuck
  number** — it is **never failover-eligible**: switching numbers mid-conversation **fragments the thread** on
  the contact's device (they'd see a reply from a stranger). If the stuck number's provider is **down /
  blocking, the reply waits in that provider's queue** (circuit-breaker keep-in-queue) **until it accepts
  again** — it does **not** reroute. **Failover / area-code / multi-number selection applies to *initial* sends
  only** (no live conversation to preserve); the chosen number then becomes the stuck one.
* **Provisioning is NOT texting's** — numbers are **provisioned + registered (10DLC / TFN / SC) in
  [registration](../registration/SPECS.md), tied to the account**; texting **consumes** the resulting pool (it
  routes + sticky-selects, it doesn't buy / register / release numbers).

# Provider adapters & number binding

*Proven in the current production platform — folded in here.*

**Self-registering adapters (convention, not a central registry).** A provider is **any adapter that implements
the standard method set** — no switch statement to edit, no hardcoded list to maintain. Dispatch is dynamic
(`providers[name].send(...)`). Adding a provider = drop in an adapter; **scalability win we keep**. Each adapter
(the typed **`SmsAdapter`** interface) implements:
* **`send`** — build + POST the provider's send request.
* **`verifySignature`** — verify this provider's webhook signature / HMAC — called at the edge by
  `TextingWebhookService` before it ACKs.
* **status / inbound normalize** (the **UDF** map — the current platform's `ucSmsStatusWebhook`) — parse *this*
  provider's **DLR** *and* **inbound (MO)** format → our normalized vocabulary (the 3-layer `<provider>-codes-map`).
* **delivery-report apply** — write the normalized status to the send-log + bump per-contact **err_count**.
* **number-ordering hooks** — the provider-side number-order/provision calls (invoked by
  [registration](../registration/SPECS.md), which owns provisioning).

> **One adapter per provider = one place for dialect.** The adapter is the **single boundary** that speaks a
> provider's dialect — `send`, signature, DLR, and inbound all live in it (there is **no separate inbound
> adapter**). Adapters live in the texting codebase (`src/providers/<provider>`), **self-register** into the
> dynamic `providers[name]` set, and are a **shared module on the `TextingService` / `TextingJob` bases** — so
> the *same* adapter is loaded by `TextingWebhookService` (verify), `TextingInboundJob` / `TextingDlrJob`
> (normalize), and `TextingSendWorker` (send): **one implementation, no divergence**. `bandwidth3` / `telnyx3`
> reuse the vendor's dialect code under a **distinct registration** (separate credentials + number pool).

## Adapter instantiation & topology — one registry, four call-sites

**The registry lives on the domain base.** `TextingService` (and `TextingJob`) build a typed
`providers: Map<Provider, SmsAdapter>` **once at cold-start** (each adapter module **self-registers on import**;
warm-reused across invocations — the `Application` cold-start-once pattern). It is the **same shared module** in
every role, so the API service, the webhook ingress, and the workers all resolve adapters identically — there is
**no per-role adapter wiring** and no place for the edge and a worker to disagree.

**Resolution is a typed lookup, never a switch** — `providers.get(provider)`; an unknown provider is a
registration/config error, not a code path. Each role resolves the provider differently but lands on the **same
adapter instance** and calls only the method it needs:

| Role (topology) | Resolves the provider from | Adapter method it calls |
|---|---|---|
| **`TextingWebhookService`** | the **route** (`/texting/webhook/{provider}`) | `verifySignature(headers, rawBody)` |
| **`TextingSendWorker`** | the **number record** at send-resolve (`getProxy`) → `message.provider` | `send(req, creds)` |
| **`TextingDlrJob`** | the **`provider` tag** on the queued DLR message | `normalizeStatus(payload)` |
| **`TextingInboundJob`** | the **`provider` tag** on the queued inbound message | `normalizeInbound(payload)` |

**Adapters are stateless dialect logic — credentials are passed in, not baked in.** A single adapter instance per
provider serves **all accounts / numbers**; the **3-tier config** (global cred-set → per-number override →
per-campaign) is resolved from the **number record** at the call site and handed to `send(req, creds)`. So the
registry holds **one stateless adapter per provider**, not one-per-account — tenancy rides the resolved
credentials + number record, not the adapter.

**The phone number is the pivot — the *number record*.** A number record (the current platform's `sms_proxy`,
keyed by phone) **binds `number → provider → credentials → config-set → TCR identity`** (`tcr_cid` / `tcr_brand`
/ `tcr_csp`). *Whoever owns the from-number determines which provider adapter sends it* — resolved at send time
(the `getProxy` step). This is the concrete form of our "a number lives on one provider" rule. **Provisioning +
the record live in [registration](../registration/SPECS.md)**; texting **resolves** it at send to pick the
adapter + credentials + TCR identity. Credentials may be **per-number** (overrides on the record), not only
global.

**Three-tier config resolution** (most-specific wins), proven in production:
* **(A) Global per-provider credentials** — with **named config sets** (e.g. `twilio-…-prod` vs `-staging`),
  selected by the number record's `config` field. Lets one provider run multiple credential sets / environments.
* **(B) Per-number overrides** — provider / config / `sid` / `apikey` / TCR fields on the number record, copied
  into the send at resolve time.
* **(C) Per-campaign** — `provider` / `mmsprovider` / `tcrmmsprovider` + account defaults, plus an optional
  **provider-map** that remaps specific from-numbers.

**Carrier identification is config-driven** — a `carrier` regex map (att / verizon / tmobile / …) resolves a
**`carrierId`** from the destination number; that `carrierId` is what feeds the **per-carrier** rate / pause /
discard lookups below.

**Endpoints live in the adapter code, not config (proven pattern, kept).** Each adapter **hardcodes its
provider's API host(s) + paths**; there is **no generic per-provider "base URL" config arg**. **Config supplies
only credentials + account-scoped identifiers** (`sid` / `token` / `account-id` / `project` / `apikey` / …),
**interpolated into the otherwise-fixed URLs**. Interpolation styles:
* **`@token@` placeholders** filled from config at request time (e.g. Bandwidth `@account-id@`, Sinch
  `@project@`) — the **host is still hardcoded**, only account bits come from config.
* **Host *fragment* from config** (the only host-from-config cases, and still **never a full URL**) — **Infobip**
  subdomain (`{host}.infobip.com`), **SignalWire** space (`{space}.signalwire.com`).
* **Per-call host override** — some adapters' send accepts an optional `host` that **defaults to the hardcoded
  value** (Twilio, Vonage), but it's set **in code per operation, not from config**.

> **Why:** endpoints are **code — versioned, reviewed, tested** — so a provider's URL surface **can't be
> accidentally mis-set in prod**; only the safe, account-scoped pieces are runtime config.

# Sending pipeline — two-level queueing

Two queue levels separate **whose turn it is** (fairness) from **how fast we may push to a provider** (throttle):

* **Level 1 — account fair-share (owned by [dispatch](../../../packages/services/DISPATCH.md)).** The governor picks across
  accounts **fairly** (no noisy neighbor) and **routes each message to the right provider queue**. Answers
  *"which account's message sends next."*
* **Level 2 — physical queue + throttling worker (owned by texting).** L1 emits a **logical queue name** (built
  from the send's provider × carrier × MMS × TCR); that **resolves to a physical queue via config** —
  **per-provider is the common mapping**, but ops can isolate any slice for rate-isolation by config (see
  *Logical vs physical queues*). A **worker pulls + throttles to the configured rate** (Redis token-bucket).
  Answers *"how fast may we push right now."* It holds the **two send-side ceilings** — **per-provider account
  send limit** + **per-number carrier MPS** — and a send that would breach one **stays on the queue** (visibility
  timeout), draining as budget frees: **backpressure, not drop**.

```
 send ─► [ L1: account FAIR-SHARE governor ]  ──route──►  [ L2: per-provider QUEUE (SQS) ]
          dispatch — whose turn, no noisy neighbor                      │
                                                                        ▼
                                                              [ provider WORKER ]
                                                        throttle via Redis token-bucket:
                                                         • per-provider account send limit
                                                         • per-number carrier MPS
                                                                        │ within budget
                                                                        ▼
                                                                   provider API
```

> **Why two levels:** fairness and provider-rate are **different problems**. L1 keeps one account from starving
> others; L2 keeps us under each provider's (and carrier's) hard limits. Each provider's worker enforces its own
> budget from **Redis**, so adding / retuning a provider is a config change, not a governor rewrite.

## Logical vs physical queues (config-driven topology)

> **Pragmatic baseline (start here) — queue-per-provider + a factory worker.** Providers are a **bounded,
> code-managed set** (each adapter is written + tested — *not* "dropped in"), so the **provider dimension is
> static and ~1:1**: **one physical queue per provider** + **one factory worker per provider queue** (the
> provider-agnostic adapter factory `texting-20.1`, as an **SQS event-source-mapping per queue** — one codebase,
> N mappings). This needs **no logical-name / fallthrough machinery** — the provider *is* the queue key — and it
> already gives what matters: **per-provider HoL + failure isolation** + **independent per-queue concurrency**.
> **Throttle sub-dimensions (carrier / MMS / TCR / line) live in the Redis token bucket** (`texting-1.3.2`),
> **not** extra queues. *By our own rule — a static forever-1:1 map is dead weight — the elaborate logical→physical
> mapping is **NOT** justified for the provider dimension.* (The legacy system shipped the full ~30-name taxonomy
> but ran **2** physical queues — evidence it was over-built.)
>
> **The taxonomy + fallthrough below is an OPTIONAL escape hatch — deferred (YAGNI) until proven.** Its only
> residual value is carving a **sub-provider** slice onto its **own queue** when token-bucket throttling can't
> prevent **head-of-line blocking *within* a provider** (e.g. a paused carrier stalling other carriers on the
> Twilio queue) — **rare + operational**, and an **infra change** anyway. **Start without it.**

*Folded from production (kept as the escape hatch above).* Separate **logical queue names** (code-defined
purposes) from **physical queues** (the real SQS backends). The code defines the logical taxonomy; **config maps
logical → physical**; an **unmapped** name falls through to a **shared default**. This is the *mechanism* behind
"carve out a queue by config" — useful only for the sub-provider isolation case noted above.

* **Most-specific-first resolution.** A send's logical name is built from its attributes and resolved
  **most-specific → least-specific**, dropping segments right-to-left until a **mapped** physical queue exists,
  else `default`:
  ```
   out{Provider}{Carrier}{Mms}{Tcr} → out{Provider}{Carrier} → … → out → default
   reply → reply → out → default        testing → testing → out → default
  ```
  So mapping just `out-sinch-mms → its own queue` peels **Sinch MMS** onto a dedicated queue for **rate
  isolation** while everything else stays on the shared queue — config only.
* **Queue name = `physical#channel@group`** — the **`group`** is an **ordering key** (e.g. per-conversation or
  per-campaign `cid`), so messages within a group stay **ordered** even on a shared physical queue.
* **Per-queue tuning** — each physical queue has its own **visibility timeout** (retry delay), **prefetch**, and
  **concurrency**; a long-job queue (e.g. media transcode, 30-min VT) is isolated from the fast send queue.
* **Split load (sub-provider) = pure config** — add a physical queue + map the logical name + add it to the
  worker pool. *(Per-provider queues are the **static baseline** — a direct `provider → queue` rule, **not** this
  fallthrough; the fallthrough exists only for **sub-provider** carve-outs.)*

> **When you *do* reach for the optional mapping — why it isn't pointless 1:1.** It's scoped to the
> **sub-provider** level (carrier / MMS / TCR), which **is** many-to-one + mutable: many logical names
> (`out.twilio.mms`, `out.twilio.att.sms`, …) collapse onto the Twilio queue until you peel one off. The map lets
> that **collapse ratio change at runtime, by config** — so splitting a hot slice is **config, not a redeploy at
> every call site**. The logical name also stays a **stable, env-portable contract** while the physical ARN
> differs per env (`texting-local` ↔ `…-prod`) and is infra-owned. **The *provider* dimension does NOT use
> this** — it's static ~1:1, so queue-per-provider is a direct rule (a static forever-1:1 map *would* be dead
> weight). The escape hatch is justified **only** where the relationship is **many-to-one + mutable** —
> sub-provider.

### What a physical queue *is*, and how it's mapped — by example

A **physical queue is a real queue resource** — a deployed **SQS queue** (with a URL/ARN, its own **DLQ**,
**visibility timeout**, **prefetch + concurrency**); locally it's a **LocalStack SQS** queue (or a Redis-backed
one). A **logical name** is just a **string the router builds from the send's attributes** (`out.twilio.mms`) —
**application code only ever emits the logical name; it never names a physical queue.** Config maps the two.

**Local example — the default (one queue, "just works"):**
```jsonc
// config/local.json  (a developer's machine; backend = LocalStack SQS or Redis)
{
  "physical": ["texting-local"],          // ONE real queue resource
  "workers":  ["texting-local"],          // the worker pool consumes it
  "mappings": {}                          // nothing mapped → every logical name falls through to default
}
// → every send / inbound / status job runs on texting-local. No mapping needed to start.
```

**Local example — carving out a queue (reproduce Twilio-MMS rate isolation locally):**
```jsonc
// config/local.json — add a physical queue + ONE mapping. No application-code change.
{
  "physical": ["texting-local", "texting-local-twilio-mms"],
  "workers":  ["texting-local", "texting-local-twilio-mms"],   // pool must consume the new one
  "mappings": { "out.twilio.mms": "texting-local-twilio-mms" }
}
// → a Twilio-MMS send resolves  out.twilio.mms → texting-local-twilio-mms;
//   a Twilio-SMS send finds no  out.twilio.mms / out.twilio  mapping → falls through → texting-local.
```

**Example — many *different* logical names → the *same* physical queue (the common case):**
```jsonc
// config/<env>.json — map the BASE level + carve ONE hot slice off it
{
  "physical": ["texting-send", "texting-twilio-mms"],
  "workers":  ["texting-send", "texting-twilio-mms"],
  "mappings": {
    "out":            "texting-send",        // the base level → one shared queue
    "out.twilio.mms": "texting-twilio-mms"   // ONE hot slice pulled out
  }
}
```
Resolution (most-specific-first) — watch three unrelated logical names land on the **same** `texting-send`:
```
 out.twilio.mms      → "out.twilio.mms" mapped                         → texting-twilio-mms   (isolated)
 out.twilio.sms      → out.twilio.sms? no → out.twilio? no → out? YES  → texting-send
 out.bandwidth.sms   → out.bandwidth.sms? no → out.bandwidth? no → out? YES → texting-send
 out.vonage.verizon  → …none… → out? YES                              → texting-send
```
`twilio.sms`, `bandwidth.sms`, and `vonage.verizon` **share `texting-send`** — **not** because any is mapped to
another, but because they all **fall through to the mapped `out` level**. Only `out.twilio.mms` is pulled out.

> **You map a *level*, never name-to-name.** A mapping is always **logical → physical** (`out.twilio.mms →
> texting-twilio-mms`); there is **no `logical → logical`** — `twilio.mms` is never "mapped to `bandwidth.sms`."
> Two logical names share a queue **only by both resolving (via fallthrough) to the same mapped level** (here
> `out`). Delete the `out` mapping and all of them fall through one more step to the built-in **`default`** queue
> — still sharing, just the catch-all. *Sharing is an outcome of fallthrough, not a mapping you write.*

> **"But our worker is per-provider — how can a shared queue mix providers?"** Because **the worker is
> provider-*agnostic code***. It pulls a message, reads **`message.provider`**, checks that provider's token
> bucket, and dispatches to **`registry[message.provider].send()`** (the typed `SmsAdapter`, `texting-20.1`) —
> provider logic lives in the **adapter**, not the worker. So one pool *can* drain a mixed-provider queue.
> **Per-provider queues exist for *isolation*, not capability** — **head-of-line blocking:** if Twilio is
> throttled / its breaker is open, Twilio messages at the head of a *shared* queue get requeued repeatedly
> **while Bandwidth waits behind them**; a per-provider queue keeps a stalled provider's backlog **off**
> everyone else's path. So: **same-provider** collapse (`out.twilio.sms` + `out.twilio.mms` → one Twilio queue)
> is always safe; **cross-provider** collapse (→ `default`) is a **dev / low-volume** convenience — **production
> carves a queue per active provider.** The worker *code* is identical; only *which queue a pool consumes*
> differs (that runtime dedication is your "one job per provider" — config, not code).

**Who defines what:**
* **The physical queue (the resource)** → **infra.** The **cloud-manifest / CDK** provisions the SQS queue (+ DLQ,
  VT) per deployed env (dev / staging / prod); **locally, the developer** declares it in their **local config**
  (a LocalStack SQS or Redis queue). Either way it's **infrastructure config, not app code.**
* **The logical→physical mapping + worker-pool membership** → **config**, owned by **ops / platform** per env
  (AppConfig); **a developer edits their own `config/local.json`** to carve out a queue for testing — the same
  knob ops turn in prod, just on the dev's machine.
* **Application code** → emits **only the logical name** (`out.twilio.mms`). It **never** references a physical
  queue — so adding / splitting / merging queues is **purely infra + config**, never a code deploy.

So "who defines the local queue?" — **the developer**, in `config/local.json`: declare a physical queue
(pointing at a LocalStack/Redis backend), add it to the worker pool, and map the logical name(s) onto it. That
mirrors exactly how **ops** would do it per-environment (CDK provisions the SQS queue, AppConfig holds the
mapping) — the dev is just doing the local-scale version of the same two steps.

## Sending limits — defense in depth

*Folded in from the production platform — its layered limits are proven; we keep L1 fair-share on top.* **A
message must clear *every* layer.** Most are **backpressure** (requeue / hold), not failure. *(These are the
**Stage B** layers; the full two-stage model + outcome classes is in [Rate limiting & gating](#rate-limiting--gating-two-stages).)*

1. **Token-bucket rate (the core control)** — one **Redis** limiter keyed `SMSRATE:<provider>:<name>` with a
   **prefix hierarchy** so a single mechanism covers every dimension: **base** (per-provider) · **`<carrierId>-`**
   (per-carrier) · **`tcr`** (per-TCR-campaign) · **`<carrierId>-tcr`** · and **`tf` / `sc`** (toll-free /
   short-code) variants — plus a **per-line (`lrate`)** = per-number rate. *(This subsumes + enriches the
   earlier "per-provider × per-number-carrier-MPS" axes.)* Over → **`OverCapacity`** → requeue.
2. **Send window** — outside allowed hours (incl. **TCPA quiet-hours per recipient TZ**) → **hold/requeue**.
3. **Invalid-number suppression** — a **Redis invalid-number map (24h TTL)**, populated when **per-contact
   `err_count`** crosses a threshold; bad / no-carrier numbers are **skipped** (`invalid` / `nocarrier`).
4. **Carrier pause** — per-carrier pause with precedence **`carrierId → tcr_cid → cid → *`** → **requeue**.
5. **Carrier discard** — per-carrier hard drop (when a carrier is rejecting outright) → **drop**.
6. **TPM / LTPM throttle** — per-TCR-campaign (`tpm`) / per-line (`ltpm`) per-minute caps, enforced via **SQS
   visibility timeout** (requeue, not block).
7. **Daily / TCR caps** — `brandDailyCap` + quota hooks (10DLC, via [registration](../registration/SPECS.md)).
8. **Account hard stop** — **balance / `max_out`** (billing) → **403 / OverCapacity**, no send.

**Backpressure via a typed result (not magic codes).** Transient / hold conditions return a **typed result**
`{ outcome: REQUEUE, reason, retryAfter? }` that keeps the message **invisible + re-scheduled** instead of
failing — pacing, not drops. **`retryAfter` drives a computed-delay re-schedule** (`texting-20.7`), so a message
wakes when budget is likely free — not on a blind fixed timeout. Reasons *(legacy `6xx` shown for traceability
only — we don't propagate magic integers, `texting-20.2`)*:
* **`provider_unavailable`** — provider 429 / 5xx / DB lag *(legacy 600)* → backoff retry
* **`out_of_window`** — outside the send window *(legacy 601)* → hold until window opens
* **`carrier_paused`** — carrier pause active *(legacy 602)* → wait for pause expiry
* **Permanent failures + successes leave the queue.** *(The per-provider **circuit breaker** sits alongside this:
  repeated `provider_unavailable` is exactly what opens it — see below.)*

> **Backpressure is monitored + alerted (`texting-9.4.2`).** Held messages don't fail loudly, so backpressure
> conditions (open breaker, carrier pause, elevated 600/602) emit **system alerts** via
> **[monitor](../monitor/SPECS.md)** → **devops can contact the provider** to find out what's up. This is what
> makes "keep-in-queue, not drop" *safe* — the wait is **visible and actionable**, not silent.
>
> **Message age is the universal "stuck" signal — across *every* queue** (not just on outage). We carry
> **delivery SLAs**, and a held message that keeps **aging** is the honest indicator that something has stalled.
> **`texting-12.3`** tracks **oldest-message age per queue** against SLA and **alerts before messages get old** —
> depth alone false-alarms on a busy blast; **age is what means stuck**.

## Provider failure → retry → failover → DLQ

**Classify the failure, then act** — a provider *outage* is not a *bad message*:

* **Transient** (provider **5xx / timeout / 429**) — **retry on the same provider/number**, exponential backoff,
  up to **N attempts** (config per provider). Most blips resolve here.
* **Provider-wide outage** — a **per-provider circuit breaker** (state in **Redis**, off the same throttle
  metrics): when the error rate crosses a threshold the breaker **opens** and the worker **stops pulling that
  provider's queue**. Messages **wait in the queue** — they are **not** consumed, so they **don't burn
  `maxReceiveCount`** toward DLQ. The breaker **half-opens** to probe; on recovery it **closes** and the queue
  **drains**. **→ For an outage, keep messages in the provider queue (pause consumption) — do *not* DLQ +
  repopulate.** Pausing is cleaner: no manual requeue, order preserved, no spurious DLQ churn.
* **Failover — *initial sends only*** — for an **initial** send still unsendable (breaker open past a bound, or
  retries exhausted), **re-route to a number on another provider** *if the account has one provisioned +
  10DLC-registered*; that number then becomes the contact's **stuck** number. **Conversational replies are
  PINNED and NEVER failover** — a reply to an established contact **stays in the queue (backpressure) until the
  stuck number's provider recovers** (switching mid-conversation fragments the thread). See *Provider
  abstraction & failover*.
* **Permanent / per-message** (bad number, unregistered, content rejected) — **DLQ immediately, no retry, no
  failover** (it fails identically on any provider).
* **DLQ = poison + last resort**, *not* the outage tool — exhausted retries with no failover path + permanent
  per-message failures. **Manual requeue API** (`texting-9.6`) repopulates once the underlying issue is fixed.

> **Caveats while a breaker is open:** SQS **max retention (≤14 days)** bounds how long a paused queue can hold
> during a very long outage; **monitor queue depth**; and **alert** (an open breaker still burns delivery SLAs).

# Rate limiting & gating (two stages)

*Folded from production — the precise gating ladder.* Throttling splits into **two stages with different
outcome classes**: **fail fast** before a job exists, then **pace** once it's queued.

**Outcome classes:**

| Outcome | Meaning | Effect |
|---|---|---|
| **BLOCK** | hard error to the API caller | nothing queued; **403 / 429** |
| **SKIP** | suppressed but **logged with a reason** | reason flag on contact / log; **terminal** |
| **DROP** | discarded mid-send | marked `discarded` / `invalid` / `nocarrier`; **terminal** |
| **REQUEUE** | transient — stays in SQS, retried after visibility timeout | status **600 / 601 / 602**; **no failure recorded** |
| **SEND** | passed all gates → hits the provider | — |

```
 STAGE A — pre-enqueue (once, at build)        STAGE B — send-time (per dequeue / retry, L2 worker)
  balance/max_out ── BLOCK 403/429              queue-time (out of window) ── REQUEUE 601
  send window     ── SKIP timerange             benched sending number     ── DROP
  unreachable     ── SKIP                        carrier pause             ── REQUEUE 602
  landline/carrier── SKIP nocarrier              carrier discard           ── DROP
  daily/TCR cap   ── SKIP dailycap               TPM/LTPM + token bucket   ── REQUEUE 600
  DND/suppression ── SKIP (compliance)           provider 429/5xx          ── REQUEUE 600
        └─ pass → idempotent enqueue ──► L1 fair-share ──► L2 worker ──────► SEND ✓
```

**Stage A — pre-enqueue gating** (build/validate, **before a job exists**, runs **once**) — decides **money ·
eligibility · compliance**; **terminal BLOCK/SKIP** so they **never churn the queue**:
**balance/`max_out` (BLOCK, `texting-11.5`)** → **window (SKIP `timerange`)** → **unreachable (SKIP)** →
**landline/bad-carrier (SKIP `nocarrier`)** → **daily/TCR cap (SKIP `dailycap`, `texting-5.9`)** →
**DND/suppression (SKIP `dnd`, `texting-5.3`/`5.10`)** → pass → **idempotent enqueue** (`texting-1.6`).

**Stage B — send-time gating** (per dequeue at the **L2 provider worker**, **every retry**) — rate/carrier →
**REQUEUE (pace)** or **DROP**:
**queue-time (REQUEUE 601)** → **benched number (DROP, `texting-5.7`)** → **carrier pause (REQUEUE 602,
`texting-5.8`)** → **carrier discard (DROP, `texting-5.8`)** → **TPM/LTPM + token bucket (REQUEUE 600,
`texting-1.3.2`)** → **provider 429/5xx (REQUEUE 600, `texting-9.x`)** → **SEND**.

**Two principles:**
* **Fail fast vs pace** — Stage A is **terminal** (money/compliance/eligibility decided *before* a job exists,
  so they never churn the queue); Stage B is **REQUEUE** (the SQS visibility timeout turns a "limit hit" into
  **smooth pacing**, never a dropped message or a hammered provider).
* **Compliance and rate-limiting gate via the same `suppression` attribute** — a `dnd` opt-out (Stage A) and a
  `landline`/`unreachable` deliverability block are the **same typed field, different `reason`**. **No separate
  compliance engine** — but **not** a conflated flags bag either (see *Tags & state*).

# Status, metrics & the feedback loop

The **same normalized values** (`errcode` / `status` / `provider` / `carrier` / flags) that drive send, receive,
suppression, and the inbox are **fanned out into counters** — and those counters are the **sensor** that tells
operators (and the breaker) when to pull a gating lever. **One mechanism, many consumers.**

**Two-tier aggregation (no write contention).** High-volume events would hammer shared counter rows, so:
**in-memory merge** (coalesce events locally) → **periodic flush** (~3–5s; web = direct, worker = via SQS) →
**atomic increment / upsert** (one `incr` per field). Events coalesce *before* they ever touch the row.

**Multi-dimensional keying — typed dimensions, not prefixed column names.** *(Here we apply the typed-field
lesson to stats too — the production system encodes dimensions as column-name prefixes; we key by fields.)* A
counter is keyed by a **dimension tuple** `{ scope (campaign / provider / account), id, period (lifetime /
day / month), carrier?, tcr?, broadcast?, errcode? }` and **queried by dimension directly** — no
`att_spam` / `<carrier>_<errcode>` column-name parsing.
* **campaign** lifetime · **campaign × day** · **campaign × group × day** · **provider × day / month** · per-account
* dimensions: **`carrier`** (att / verizon / …) · **`tcr`** (TCR-registered) · **`broadcast`** (1-click) · **`errcode`**
* time buckets use **account-local day / month**, with an **after-midnight correction** (early-hours sends
  attributed back to the prior day).

**Declared headline metrics.** Which outcomes are **first-class headline metrics** vs. only a **dimensional
breakdown** is **declared** — a **registry** of headline `errcode`s (e.g. `unreachable`·`nocarrier`·`landline`·
`spam`·`invalid`·`dailycap`), not implied by which string columns happen to exist. *Adding a headline metric =
a registry entry*; human labels come from a **stats label map** (e.g. `invalid → "Invalid Proxy"`).

**Headline rates** — derived from the counters: **delivery % = 100 − (err / total_sent)**, plus per-provider /
per-carrier / per-errcode breakdowns + TCR variants — each a **typed dimension queried directly** (not
reconstructed from `<carrier>_<metric>` column-name prefixes).

**The feedback loop — stats are the sensor for gating.** Failure signals don't just get counted; they **change
send behavior** (this closes the circle back to *Rate limiting & gating*):

```
 provider error → errcode ──┬─ invalid       → bench the sending number (fleet-wide, instant broadcast)
                            └─ nocarrier/spam → bench it for that carrier
   per-carrier err / spam counters ── inform ──► pauseCarrier / discardCarrier (manual ops levers, texting-5.8)
                                             ──► circuit breaker (auto, texting-9.4) + monitor alert
```
* A benched number is **broadcast fleet-wide** so every worker benches it **instantly** (no wait for cache-TTL
  propagation).
* The **per-carrier `err` / `spam` counts** (the `carrier` × `errcode` dimension) are exactly what tells ops when
  to pull `pauseCarrier` — the sensor behind the manual lever and the auto breaker, surfaced via
  **[monitor](../monitor/SPECS.md)**.

> **Ownership split (our architecture):** these **operational counters + the feedback loop are texting's** (they
> sit next to the gating they inform; alerts via [monitor](../monitor/SPECS.md)). The **business / marketing
> analytics lake** (engagement trends, cross-campaign, attribution) is **[analytics](../analytics/SPECS.md)** —
> texting **emits events** (`texting-11.2`). The two-tier counter technique applies to both.

# Send-window reservation & capacity scheduling (the CS "tetris" view)

Accounts define **send windows** for their batches; the same account or **different accounts** can have
**overlapping windows** with very different volumes. Capacity is **finite** (provider send limits × per-number
carrier MPS × pool size, across the relevant providers/carriers), so we **reserve + schedule** batches against a
**capacity-over-time curve** rather than letting everyone dump at once. This is **planning** that sits *above*
the runtime two-level queue — it decides the *intended* ordering; the fair-share governor then *executes* it
under live limits.

> **Posture — a soft ops tool, NOT a hard SLA.** We're **at the mercy of the provider + carrier** for actual
> delivery timing, so a window is a **best-effort target, not a guarantee**. The real value is **protecting
> shared provider/carrier capacity from overload** — an instantaneous flood has **cross-account blast radius**
> (one account's dump degrades *everyone* on that provider/carrier). Reservation **smooths the intake to soften
> the blow**; batches may **pile up a bit** and the **execution layer (backpressure + fair-share) absorbs it**.
> Over-subscription **alerts** ops + the account — it does **not** hard-reject.

* **Send window + volume** — a campaign declares `[start, end]` (account TZ) + a message count.
* **Capacity-aware reservation (admission control)** — when a batch is scheduled, check whether the **projected
  deliverable capacity** in that window (minus already-reserved batches) can clear the volume **by window-end**.
  Fits → **confirm** (a **best-effort projection**, not a guarantee). Doesn't fit → **flag** (still accepted —
  it just won't be assured; the execution layer absorbs the pile-up).
* **First-come + priority** — reservations are **FCFS**, but **priority tiers** (certain accounts) reorder under
  contention — the guaranteed capacity goes to higher priority + earlier reservations first.
* **"Tetris" load-smoothing** — pack batches into the capacity-vs-time grid so load is **spread across the
  window** (no instantaneous overload) while still hitting deadlines. **Packing inputs:** **account priority
  (1–5)** × **message count + size** (segment / MMS load = the throughput actually consumed, not just a count) ×
  **desired window** × **outbound send rate** (achievable msgs/sec across the campaign's numbers / providers /
  carriers). The packed plan feeds the L1 governor's ordering.
* **Over-subscription → soft alert (not reject)** — when committed batches exceed window capacity, the
  **marginal** reservation (later / lower-priority) **can't be assured** → **notify** ops + that account (extend
  the window, pick another time, reduce volume, or upgrade priority). The batch **still queues** — the alert is
  the heads-up; the execution layer paces it. The point is **protecting the provider/carrier**, not gating sends.
* **CS visualization** — a **gantt / "tetris" view** of reserved batches vs capacity over time, so CS can **see
  contention**, spot over-subscription early, and intervene (re-prioritize, extend, contact accounts).
* **Manual provider switch (ops lever)** — when a campaign spans **multiple providers**, **message-ops / CS can
  switch its default provider** to **level sending** off a congested one (rebalances load *across providers*,
  where the packer smooths *over time*). Applies to **new** sends; **pinned replies stay on their stuck number**
  (`texting-4.9` / `4.3.3`).

```
 capacity ┌──────────────────────────────────────────── ceiling (provider×carrier×pool)
   /sec   │  ░░acctA░░ ▓▓acctB▓▓ ░░A░░                          ← packed to smooth load,
          │  ▓▓▓B▓▓▓ ░░░░A░░░░ ▓▓▓▓B▓▓▓  ██C(late, at risk)██   ← C reserved last, may not fit
          └────────────────────────────────────────────► time (overlapping windows)
```

**Ownership:** the **cross-account capacity model + reservation scheduler + CS gantt belong to
[dispatch](../../../packages/services/DISPATCH.md)** (it's the cross-account/cross-channel arbiter that owns the throughput
model — this is the planning side of the same governor). **Texting defines the windows, submits reservations,
and relays the per-account assurance / over-subscription alerts.** The window-end is the **delivery SLA** that
`texting-12.3` then monitors at runtime. *(This warrants a matching section in the dispatch spec.)*

# Compliance is stricter than email

* **Quiet hours (TCPA)** — no texts **before 8am / after 9pm in the recipient's local time**. SMS-specific; the
  **scheduler / dispatcher enforces it per-recipient-timezone** (part of `canSend()`). **Applies to the two-way
  inbox too — a texter cannot reply to a contact during that contact's quiet hours** (a reply runs `canSend()`
  like any send; conversational replies are **not** exempt). The inbox blocks the send with the reason and can
  **offer to schedule it for the next allowed window**.
* **STOP / START / HELP** — **mandated**, honored **instantly**, and often enforced at **both** the provider
  **and** our layer — **verify the double-layer, don't assume**. Feeds **suppression** back to
  [contact](../contact/SPECS.md).
* **Content filtering (SHAFT + URL)** — carriers silently filter **S**ex / **H**ate / **A**lcohol /
  **F**irearms / **T**obacco + spam, and **block public shorteners** (bit.ly) — exactly why we need our **own
  branded short domain** (shared with email, via [links](../links/SPECS.md)). **Filtered messages often return
  vague / no error.**

# Opt-out (STOP / START / HELP)

The **single most important compliance path in SMS** — mandated, **instant**, and **double-layered** (provider +
platform). Get it wrong → TCPA liability + carrier blocking.

**Recognized keywords** (case-insensitive, trimmed; CTIA standard + configurable per account):
* **Opt-out:** `STOP` · `STOPALL` · `UNSUBSCRIBE` · `CANCEL` · `END` · `QUIT`
* **Help:** `HELP` · `INFO`
* **Opt-in / resume:** `START` · `UNSTOP` · `YES`

**Flow — inbound → suppression → confirm:**
```
 inbound SMS ─► webhook pipeline (verify sig) ─► keyword match
    ├─ STOP  ─► write SUPPRESSION to contact (channel=sms, source=recipient-STOP, at=now; HARD block)
    │          ─► send the ONE mandated opt-out confirmation (exempt from quiet hours)
    │          ─► thread marked opted-out; future canSend() fails for this contact × account
    ├─ HELP  ─► reply with mandated help text (brand · support · "reply STOP to cancel")
    └─ START ─► remove the SMS suppression (opt back in) — contact-initiated only
```

**Double-layer — verify, don't assume:**
* **Provider / carrier layer** — most providers (Twilio, …) **auto-honor** standard STOP: they block further
  messages on that number-pair and may **auto-send a confirmation**. A **backstop**, *not* our source of truth.
* **Platform layer** — we **also** detect STOP on inbound and write **suppression to
  [contact](../contact/SPECS.md)** (the consent/suppression **SoT**). Our **`canSend()`** gate then blocks future
  sends **before** they reach a provider.
* **Reconcile the two** — **don't double-send** the confirmation (if the provider already replied), and
  **ingest provider opt-out signals** (a provider STOP webhook / a "recipient unsubscribed" error code) into our
  suppression so both layers agree. *(This is the "verify the double-layer" warning made concrete.)*

**Scope & persistence:**
* **Scope = a structured field, not a suffix string** — `STOP` records a **scoped** suppression (per number /
  brand / TCR campaign); `STOPALL` records a **global** one. See *Scoped suppression* below — we model scope as
  typed data, **not** the production `dnd:<channel>` tag-suffix.
* **Sticky** — persists across campaigns until the contact **opts back in** (`START`); the opt-out record is
  kept under **full retention (no TTL)** so we can **prove** we honored it (`texting-13.5`).
* Recorded with **source + keyword + timestamp** ([contact](../contact/SPECS.md)'s suppression `source` + `at`);
  **latest-state-wins**, STOP is a **hard block** — a later `START` can lift it, but **only contact-initiated**.

**Confirmation & quiet hours** — the mandated **opt-out / HELP confirmation is sent even during quiet hours**
(required compliance response, exempt — `texting-5.2.1`); ordinary conversational replies are **not**.

**Audit** — every opt-out / opt-in is **audit-logged** (keyword · channel · number · timestamp) — the proof we
honored it. **Manual** opt-out / opt-in (CS on a contact's behalf) routes through the same
[contact](../contact/SPECS.md) suppression path.

## Scoped suppression (our take on "split DND")

The problem is real: in **multi-brand / 10DLC / agency** setups, one contact is texted by multiple **brands /
TCR campaigns / numbers**, and an opt-out must be honored **per sender** — STOP to Brand A shouldn't kill Brand
B. **But the production fix — `dnd:<channel>` suffix strings crammed into the shared flags array, matched by
string-scan — is the conflation we're avoiding.** We model scope as **structured data**.

**Before (production)** — scope baked into a parsed suffix inside the shared flags array:
```
flags: ["dnd:+18885551234", "optin:+18885551234", "bad:brand_A"]   // scope = a string suffix; matched by scan
```
**After (ours)** — a contact's **`suppression`** ([contact](../contact/SPECS.md) owns it) is a **list of typed
records**, scope is a field:
```
suppression: [
  { channel:"sms", reason:"opt_out",     scope:{level:"global"},               source:"recipient_stop", at, keyword:"STOP" },
  { channel:"sms", reason:"opt_out",     scope:{level:"brand",  id:"brand_A"},  source:"recipient_stop", at, keyword:"STOP" },
  { channel:"sms", reason:"unreachable", scope:{level:"number", id:"+1888…"},   source:"provider",       at },
]
```
* **`scope.level` ∈ `global | number | brand | campaign`** — *what* the opt-out covers. **`global` suppresses
  everywhere**; a scoped record only blocks sends matching that number / brand / campaign.
* **Check (at send):** texting resolves the send's **channel context** `{ number, brand, campaign }`, then
  `canSend()` blocks if **any** record matches `channel == sms AND (scope.level == global OR scope.id ∈
  {thisNumber, thisBrand, thisCampaign})` — a **structured query**, not a suffix scan.
* **Granularity = one config field** — the campaign's **`optOutScope`** (`global | number | brand | campaign`)
  decides at *what level* a STOP is recorded. *(Replaces the production `splitdnd` / `splitdnd-cid` /
  `no-splitdnd` flag soup with a single enum.)*
* **Stats roll up globally** — aggregate by **`reason`** (a typed field), **ignoring scope** → one global
  DND / opt-in metric, **no suffix-stripping**.

**Why this beats the suffix convention:**
* **Structured + queryable** — "is this contact opted out for brand A?" is a query on `scope`, not a `dnd:brand_A`
  string scan (and no ambiguity if an id contains a `:`).
* **Carries provenance** — each record holds **`source` + `at` + `keyword`** = the **compliance proof** of when /
  how / on which channel they opted out. A suffix string can't.
* **One concern, one typed field** — suppression doesn't share an array with lifecycle / labels / audit; a new
  scope kind is **a new enum value**, not a new string convention.
* **Backwards compatible** — `optOutScope: global` is exactly the legacy "everything global" behavior.

Keeps the *good* part of split-DND — **per-sender opt-out from one shared contact record, no parallel table** —
while dropping the **string-mangling**: scope is data, not a parsed suffix.

# Autoresponders (keyword auto-replies)

Beyond the mandated STOP/HELP, accounts configure **keyword-triggered auto-replies** to inbound — e.g. `INFO` →
details, `HOURS` → store hours, `YES` → confirm. Same keyword-match path as opt-out, but **marketing/engagement**,
configured **by account** and **by campaign**.

* **Compliance first — always.** **STOP / HELP / START are matched first and are authoritative**; a compliance
  keyword **never** triggers a marketing autoresponder. Custom autoresponders fire only on **non-compliance**
  inbound.
* **Config scope (campaign > account)** — **account-level** auto-replies (defaults across campaigns) +
  **campaign-level** (specific, override / extend). Mirrors the 3-tier config resolution.
* **The reply is a normal outbound** — it goes on the contact's **stuck / pinned number** (`texting-4.3.3`) and
  **runs `canSend()`**: an **opted-out contact gets NO autoresponse** (suppression always wins), and **quiet
  hours apply** (an autoresponder is **not** quiet-hours-exempt — unlike STOP/HELP; `texting-5.2.1`).
* **Loop / abuse guards** — **don't auto-reply to an auto-reply**; **one autoresponse per inbound trigger**;
  **per-contact rate-limit** (no infinite ping-pong).
* **Tag / route too** — an autoresponder can also **tag or route** the thread (e.g. `SALES` → tag + route in the
  inbox) instead of / in addition to replying.
* **Multi-step ≠ autoresponder.** A branching keyword conversation is a **[survey](../survey/SPECS.md)** (compiled
  to workflow) — autoresponders are **single trigger → single reply**; don't rebuild the survey state machine.

# DLRs & status (the UDF)

* DLRs are **async, out-of-order, late, and sometimes never arrive** — carriers don't all report reliably. So
  **"delivered" is best-effort**: design a **timeout → `unknown` state**; **don't block** on a DLR that never
  comes.
* **Unknown codes → treat conservatively** — **don't blindly retry** (a carrier *rejection* retried wastes
  throughput and looks like spam).
* Each provider has **many unique codes**; the **UDF normalizes** them back to one status vocabulary
  (`queued` / `sent` / `delivered` / `undelivered` / `failed` / `unknown`) with the raw code retained.

## Error classification (raw → normalized → flag)

*Folded from production — its standout subsystem.* Provider errors flow through **three layers** so business
logic **never reasons about raw provider codes**:

```
 provider error (Twilio 21610, Bandwidth 4770)
   → msgcode   raw provider code — kept for audit / stats
   → errcode   normalized category: invalid · spam · nocarrier · dnd · bad · landline ·
   │           unreachable · deact · temp · ignore · OverCapacity
   → applied   to the right TYPED attribute: a deliverability block (unreachable/landline/
               deactivated) → contact `suppression.reason`; `invalid` → sending-number `health`
```

* **Specificity cascade** — classify most-specific-first:
  **`provider.type.carrier → provider.type → provider.carrier → provider`** — so a Verizon-specific Twilio MMS
  spam code can map differently from the generic one.
* **Config-driven map, no code change** — a `<provider>-codes-map` (e.g.
  `sinch-codes-map = spam:10,20 | bad:20,30 | invalid:50`) classifies codes; **new provider codes are mapped by
  editing config**, not code.
* **Category side effects:**
  * **`ignore`** → flip status to **delivered** (swallow benign provider errors).
  * **`invalid`** → **bench the *sending* number** (markInvalidProxy — Redis 24h TTL; `texting-5.7`).
  * **`nocarrier` / `spam`** (carrier-scoped) → bench the sending number **for that carrier only**.
  * **`temp`** → note + **leave retryable**.
* **Per-adapter normalization** — each adapter maps its native response to a common shape: success `{ id,
  segments }`, error `{ code, message, status }`.

> Two different **typed targets** (not one flags bag): **`invalid` → the *sending number's* `health`** (bench),
> while **deliverability errcodes (`unreachable`/`landline`/`deactivated`) → the *contact's* `suppression`**. See
> *Tags & state*.

## Tags & state — typed attributes, NOT one bag

**We deliberately reject the production system's single `flags[]` array.** Stuffing suppression, lifecycle,
agent labels, and audit markers into one list — interpreted differently by each consumer — is a conflation that
makes the data ambiguous (is `bad` a wrong-number suppression or an agent's "bad lead" label?). Instead, each
concern is a **separate, typed attribute** with **one mission, one type, on the right entity**. Tags are fine —
**conflated** tags are not.

| Attribute | Mission (what it answers) | Type | Lives on | Examples |
|---|---|---|---|---|
| **`suppression`** | *Can we send?* (consent / deliverability block) | **list** of typed records `{ channel, reason, scope{level,id}, source, at, keyword }` | **contact** | reason: `opt_out` · `hard_block` · `unreachable` · `landline` · `deactivated`; scope.level: `global` \| `number` \| `brand` \| `campaign` |
| **`lifecycle`** | *Where is this contact / conversation?* | **enum** | contact / conversation | `new` · `active` · `replied` · `opted_in` · `opted_out` |
| **`labels`** | *Human triage / categorization* (agent-set) | **label set** (account-defined) | contact / conversation / message | `good` · `bad` · `rude` · `interested` · `callback` · `vip` |
| **`outcome`** | *Why did this message do what it did?* (audit) | **enum** (+ raw `msgcode`) | **message / send-log** | `timerange` · `dailycap` · `nocarrier` · `testing` · `resent` · `skipped` · `delivered` · `undelivered` |
| **`health`** | *Is this SENDING number usable?* | **enum** (+ carrier scope) | **number record** | `ok` · `benched:invalid` · `benched:carrier=verizon` |

**Each consumer reads the *specific* attribute it needs** — nothing parses a generic bag:
* **`canSend()`** reads **`suppression`** (recipient) + **`health`** (sending number) — `texting-5.x`.
* The **inbox** renders **`lifecycle`** + **`labels`** + per-message **`outcome`** — `texting-7.5`.
* **stats** aggregate by **`outcome` / `errcode` / `suppression.reason` / `label`** as **distinct dimensions** —
  `texting-19`.

**Principle:** *one attribute = one mission, one type, on the right entity.* Adding a new meaning is **a new
typed field**, never another overloaded string in a shared list. **Opt-out scope** rides a structured
**`suppression[].scope`** (`global` / `number` / `brand` / `campaign`) — see *Scoped suppression*
(`texting-5.12`); explicit data, **no `dnd:<channel>` string-mangling**.

> **The lesson (applies to both the tag bag and split-DND).** The production system's *instinct* is **right** —
> avoid parallel tables; keep one shared state that suppression, the inbox, and stats all read. Its *mechanism*
> is what fails — **encoding structure into magic strings** in one array (`bad`, `dnd:brand_A`). Structured
> typed fields give the **no-parallel-table** win **and** queryability **and** provenance. **When tempted to
> suffix a string (`dnd:brandA`) or overload a shared bag → reach for a typed field instead.**

**Examples — magic string / shared bag → typed field:**

| Tempting (string / shared bag) | Typed instead | Why the typed form wins |
|---|---|---|
| `flags:["dnd:brand_A"]` | `suppression[].scope { level:"brand", id }` | query by scope; record carries `source`/`at`/`keyword` (provenance) |
| `flags:["bad"]` — *suppress? or agent note?* | `suppression.reason:"hard_block"` **vs** `labels:["bad"]` | one string, two meanings → two typed fields on different entities |
| `flags:["dailycap","timerange","nocarrier"]` on the contact | message **`outcome`** enum (+ raw `msgcode`) | per-message audit ≠ contact state; it lives on the **message** |
| `flags:["invalid:+1888…"]` | number **`health { state, reason, carrier? }`** | sending-number health ≠ contact state; different **entity** |
| counter columns `att_spam`, `verizon_tcr_err` | counters keyed by typed dims `{ carrier, tcr, errcode }` | query a dimension directly — no column-name prefix-parse (`texting-19.2`) |
| campaign flags `splitdnd` + `splitdnd-cid` + `no-splitdnd` | one enum **`optOutScope: global\|number\|brand\|campaign`** | 3 booleans encoding 1 choice → 1 enum |

The tell each time: you're about to **`split()` a string, scan for a prefix, or check "which group is this flag
in"** — that's structure that wants to be **a field**.

# Two-way texting (conversation / thread / inbox)

"Route message to the correct user / account / service" **undersells it** — a texting platform's core is a
**conversation / thread model**: `contact ↔ your-number ↔ account` with **message history** (the inbox UX).

* **Inbound routing** keys off **(from contact, to your-number)** resolved against the **recorded
  `(contact → number used)` map** to find **context** (which campaign / rep / bot). Because the send map can
  hold **multiple numbers per contact** (area-code match, multi-number campaign, failover), a reply to **any** of
  them threads to the **same conversation** — stickiness of *replies* is enforced by the recorded mapping, not by
  forcing one number outbound.
* **Inbound must push real-time to the web app** (the audio-notification assets → a **live inbox** over
  [realtime](../realtime/SPECS.md)).
* This **thread / inbox** model is arguably the **biggest product surface** email doesn't have to the same
  degree — texting **owns the conversation store**; [web](../web/SPECS.md) renders it; [realtime](../realtime/SPECS.md)
  delivers the live updates.

**One big inbox across campaigns** (not a per-campaign silo) — a single unified surface a **texter** (the
agent / user working it) works, with:

* **Filter by campaign** and by **time range**.
* **Filter by status** — `unread` · `contact_replied` · `texter_responded` · `texter_modified` · `delivered` ·
  `undelivered` · `daily_capped` · `unreachable` · `carrier_skip` · `expired` · **`all`**. (A blend of
  **conversation state** — unread / replied / responded — and **delivery outcome** from the UDF — delivered /
  undelivered / carrier_skip / daily_capped / unreachable / expired.)
* **Search** — by **contact name, number**, message text, etc., over a **selectable time window** the texter
  positions: it **defaults to recent** but can **slide back in history** (find that message from 8 months ago).
  The **max window *width* (span) is an application-level hard ceiling** — an **account / user can go *narrower*
  but never wider**; the **server clamps** the requested span to the app max (never client-trusted). Slide it to
  reach older periods. Results are **most-recent-first within the window** (result cap ~10,000). The **bounded
  width** is what keeps it cheap — so **no full all-time search index is needed**.
* **Tags on messages** — label messages (and threads) for triage / routing; filterable.

> **Replies obey quiet hours.** A texter **cannot reply to a contact during that contact's quiet hours** — an
> in-thread reply runs **`canSend()`** (suppression / consent / **quiet-hours per recipient TZ** / block-list)
> exactly like an outbound send. Conversational replies are **not** exempt from TCPA quiet hours. The inbox
> surfaces *why* a reply is blocked and can **offer to schedule it for the next allowed window**.

# ⚠️ The P2P human-agent workflow (the product's heart)

**This is the differentiator — not automation.** A rewrite that treats the platform as "an SMS API with a UI"
**misses the product.** The core is **human texters working contacts at scale**, one-to-one, under compliance —
so the load-bearing capabilities are about **agent throughput and contact concurrency**, not just delivery.

* **Texter sending modes** — manual send from a project / action; **rapid mode** (mass one-by-one, tap- or
  space-to-send) and **response mode** (reply to the next unread); a **work-pull** primitive (*"give me the next
  unread / next contact"*) so agents are fed work rather than hunting for it.
* **⚠️ Contact checkout locking (a real concurrency primitive)** — when multiple texters work the same audience,
  contacts are **checked out in batches under a lock** (count / TTL / requeue) so **two texters never collide on
  the same contact**. This is the subtle, easy-to-miss heart: P2P at scale is a **distributed work-queue of
  contacts**, not a broadcast. Built on the `WorkQueue` fair-share primitive + a Redis lock.
  * **Real-time over WebSocket** — the lock is **coordinated live** (acquire / hold / release) over the
    **[realtime](../realtime/SPECS.md)** WebSocket, so every agent sees lock state **as it changes**, not on
    poll. Redis holds the authoritative lock (+ TTL); realtime pushes the deltas.
  * **Auto-release on disconnect** — a **WebSocket disconnect** (closed browser, network drop, crash) is
    **presence-detected** (realtime owns the connection / presence) and **releases the agent's held locks** —
    so a dropped session **never strands a contact**. The **TTL is the backstop** if presence is missed; the
    two together guarantee no permanently-stuck lock.
  * **Unlock governance** — an **`ACCOUNT`-role admin can force-unlock** a stuck/held contact (audited), and a
    **peer can request an unlock** (another texter asks the holder to release) — realtime **notifies the
    holder**; on no response it falls back to **TTL / admin force-unlock**. Force-unlock + grab is **audited**
    (who unlocked whom, when, why).
* **Per-agent conversation / inbox** — the one-big-inbox (`texting-7.5`), filtered by status / labels, is the
  agent's workspace; assignment scopes what each agent sees.
* **Agent assignment** — **round-robin** assignment of contacts/threads to available texters, and
  **conversation reassignment** so an inbound reply routes to (or is handed to) the right agent. *(This makes
  `texting-7.6` — conversation assignment — load-bearing, not "later", for the staffed-team model.)*

# Surveys (delegated — not a second engine)

Built-in surveys are an **interactive, stateful conversation state machine**: send question → await reply →
branch on the answer → next question, with **reply timeouts** ("no answer in 24h → …") and keyword / intent
matching. That's qualitatively different from fire-and-forget sending.

**This belongs to [survey](../survey/SPECS.md), not texting.** Per the survey spec, an **SMS survey is a
channel-agnostic definition compiled to workflow `collect-input` steps** — texting provides the **send /
receive transport** and the conversation thread; it does **not** build a parallel conversation engine. A survey
**completion** is a workflow trigger.

# Drip campaigns (sequenced sends)

A **drip** is a **time-sequenced series of messages** to a contact — e.g. **Day 0 welcome → Day 2 follow-up →
Day 5 offer** — where each enrolled contact progresses on **their own timeline** (enrolled at different times),
with **exit conditions** (opt-out, reply, goal met, end of sequence).

**It's orchestration, not a channel feature — same call as surveys.** The **drip engine belongs to
campaign / workflow** (channel-agnostic): the **sequence definition** (steps + inter-step **delays** + optional
**branching** on behavior), **enrollment** (trigger / segment / manual), **per-contact scheduling**, and
**exit-condition** evaluation. **Texting just delivers each step's send** through the normal lifecycle
(`canSend()` → two-stage gating → provider), exactly like a one-off. **Don't build a second sequencing engine
in the channel** (cf. surveys, `texting-8`).

Three sequencing patterns, one rule — *the channel delivers, the orchestrator sequences:*
* **Autoresponder** — single inbound trigger → single reply (`texting-7.7`). *In-channel.*
* **Survey** — **reply-driven** branching conversation (await reply → branch) → [survey](../survey/SPECS.md).
* **Drip** — **time-driven** sequence (delays between steps); replies can exit/branch → campaign/workflow.

**How a step flows:**
* The orchestrator schedules each enrolled contact's **next step at time T** — at scale via a **time-bucketed
  sweep** ("who's due now?"), not a timer per contact-step.
* At T it **enqueues the step's send** → texting runs the full lifecycle (pinned number, `canSend()`, gating,
  DLR). **Quiet-hours / suppression apply per step** — a drip step due at 11pm **holds** like any send; an
  opted-out contact's remaining steps are **suppressed** (Stage A).
* **Inbound feeds the drip** — a **reply** or **STOP** is an **exit / branch** signal: STOP → unenroll
  (suppression blocks further sends anyway); a reply can **advance / branch / pause**. Texting's inbound
  pipeline (keyword / autoresponder, `texting-7.8`) **emits the signal**; the orchestrator decides.

**Drip vs broadcast** — a **broadcast** sends to a segment at one time (the send-window / reservation model,
`texting-15`); a **drip** is **per-contact over time**, contacts independent. Both ride the same send pipeline;
the difference is the orchestration on top.

> **Applies equally to [email](../email/SPECS.md)** — a drip is **channel-agnostic**; the same engine drives
> email drip steps and **mixed-channel** drips (SMS step → email step). Email **delivers** its steps the same
> way; neither channel owns the engine.

# MMS

* **MMS → the [media](../media/SPECS.md) service** (the primary consumer we predicted). Mind **carrier size
  limits** (~600KB–1.2MB practical) and that **the carrier fetches a public URL** — ties to media's
  **public-signed delivery** path.
* **Per-segment + per-MMS cost accounting** per account (SMS bills **per segment**; long / multipart and MMS
  cost more) → **billing tie-in**, and the **segment counter** is the same one the conditional-template
  length warning needs.

# Provider abstraction & failover (reference)

Why SMS provider failover is **even more constrained than email's** (captured for reference):

* **A number lives on one provider.** A 10DLC / TFN / short code is **provisioned, registered, and carrier-vetted
  on a specific provider** — you **cannot re-route an existing number's traffic** to another provider at send
  time. "Failover" is **not** "point the message at provider B."
* **Registration is per-number-per-provider.** 10DLC brand/campaign vetting and trust score attach to the
  number's provider; a second provider means **re-provisioning + re-registering** numbers there (lead time,
  separate trust score).
* **Stance:** **single-provider-per-number**; the factory abstracts providers so the **account's pool can span
  providers**. Provider redundancy = **provision numbers on a second provider in advance**, not live re-routing
  of one number's traffic. An **idempotency key** prevents a retry double-send within a provider.
* **Failover is for *initial* sends only — conversational replies are PINNED.** The first send to a contact
  **pins** the conversation's number ("stuck"). A **reply must go out on that same stuck number** and is **never
  failover-eligible** — switching mid-conversation fragments the thread on the contact's device. If that
  number's provider is **down / blocking, the reply waits in the queue** (**backpressure** — circuit-breaker
  keep-in-queue) **until the provider accepts again**; it does **not** reroute. **Failover applies to initial
  sends** (no live conversation), where another provider's number is acceptable and becomes the stuck one.
  *(Inbound **routing** still resolves across any recorded number — that's receiving; the **pin** governs which
  number a reply is **sent from**.)*

# Providers & carriers

**Provider ≠ carrier.** A **provider** (CPaaS / aggregator) is the **path we send through**; a **carrier**
(MNO) is the **network that delivers to the handset**. They're orthogonal — a Verizon subscriber can be reached
via Twilio *or* Bandwidth, and the same delivery outcome may surface as different raw codes per provider. The
**UDF** (`texting-3.3`) normalizes the **provider × carrier** code matrix to one status vocabulary.

> **Reference tables — to be completed.** Columns are the dimensions that matter for SMS; cells marked **`TBD`**
> are placeholders to fill as each integration is confirmed. **Legend:** ✅ supported · ⚠️ partial · ➖ no ·
> **`TBD`** to confirm.

## Supported providers — channels & coverage

*What each provider can send.* **Channels: 10DLC** (A2P long code) · **SC** (short code) · **TF** (toll-free).

| Provider | Variant of | SMS | MMS | 10DLC | SC | TF | Coverage | Status |
|---|---|---|---|---|---|---|---|---|
| **Bandwidth**  | — | ✅ | TBD | TBD | TBD | TBD | TBD | Supported |
| **Bandwidth3** | Bandwidth | ✅ | TBD | TBD | TBD | TBD | TBD | Supported |
| **BroadNet**   | — | ✅ | TBD | TBD | TBD | TBD | TBD | Supported |
| **Infobip**    | — | ✅ | TBD | TBD | TBD | TBD | TBD | Supported |
| **SignalWire** | — | ✅ | TBD | TBD | TBD | TBD | TBD | Supported |
| **Sinch**      | — | ✅ | TBD | TBD | TBD | TBD | TBD | Supported |
| **Telnyx**     | — | ✅ | TBD | TBD | TBD | TBD | TBD | Supported |
| **Telnyx3**    | Telnyx | ✅ | TBD | TBD | TBD | TBD | TBD | Supported |
| **Twilio**     | — | ✅ | TBD | TBD | TBD | TBD | TBD | Supported |
| **Vonage**     | — | ✅ | TBD | TBD | TBD | TBD | TBD | Supported |
| **`fake`**     | — | ✅ | ✅ | ➖ | ➖ | ➖ | n/a | Test-only |

## Supported providers — integration (webhooks) & send limits

*How we send + receive, and what we must throttle to.* **Send (API)** = the provider's **hardcoded host(s)** —
endpoints live in **adapter code, not config** (`texting-3.8`); `{…}` = a host **fragment** from config, `@…@` =
an account-id interpolated into a fixed path. **Inbound webhook** = how the provider posts **replies (MO)** back.
**DLR webhook** = how it posts **delivery receipts / status**. **Webhook auth** = signature scheme we validate.
**Order & retries** = whether callbacks arrive ordered / are retried (the UDF must tolerate out-of-order + dupes).
**Send limit** = the provider's **account-level send-rate / concurrency cap** we pace under. *(Hosts below are
the current-system reference; the rest is `TBD` to confirm per integration.)*

| Provider | Send (API) — hardcoded host(s) | Inbound webhook (MO) | DLR / status webhook | Webhook auth / sig | Order & retries | Send limit (throttle) | Notes |
|---|---|---|---|---|---|---|---|
| **Bandwidth**  | `dashboard.bandwidth.com/api/…` + `messaging.bandwidth.com/api/v2` (`@account-id@`) | TBD | TBD | TBD | TBD | TBD | TBD |
| **Bandwidth3** | (same as Bandwidth) | TBD | TBD | TBD | TBD | TBD | Distinct account/config of Bandwidth (separate pool) |
| **BroadNet**   | `api.decantr.net` | TBD | TBD | TBD | TBD | TBD | TBD |
| **Infobip**    | `{host}.infobip.com` (subdomain from config) | TBD | TBD | TBD | TBD | TBD | TBD |
| **SignalWire** | `{space}.signalwire.com` (space from config) | TBD | TBD | TBD | TBD | TBD | TBD |
| **Sinch**      | `*.api.sinch.com` (conversation / sms / numbers) + `api.ci.mblox.com` (`@project@`) | TBD | TBD | TBD | TBD | TBD | TBD |
| **Telnyx**     | `api.telnyx.com/v2` | TBD | TBD | TBD | TBD | TBD | TBD |
| **Telnyx3**    | (same as Telnyx) | TBD | TBD | TBD | TBD | TBD | Distinct account/config of Telnyx (separate pool) |
| **Twilio**     | `api.twilio.com/2010-04-01/Accounts/{sid}/…` + `lookups.twilio.com` | TBD | TBD | TBD | TBD | TBD | per-call `host` override (in code) |
| **Vonage**     | `rest.nexmo.com` · `api.nexmo.com` · `api-eu.vonage.com` (per op) | TBD | TBD | TBD | TBD | TBD | per-call `host` override (in code) |
| **`fake`**     | internal | simulated | simulated | none | simulated | configurable | Simulates DLR / inbound / STOP at scale |

## Supported carriers (destination MNOs)

| Carrier | 10DLC MPS (trust-based) | Content filtering | DLR reliability | Raw code set | Notes |
|---|---|---|---|---|---|
| **AT&T**        | TBD | TBD | TBD | TBD | TBD |
| **Verizon**     | TBD | TBD | TBD | TBD | TBD |
| **T-Mobile**    | TBD | TBD | TBD | TBD | TBD |
| **US Cellular** | TBD | TBD | TBD | TBD | TBD |

> These are **maintained data assets**, not hardcoded constants — provider feature sets, per-carrier MPS, and
> the raw→UDF code maps **drift** (vendor docs change, carriers retune). Own them as config / reference data.

# Message lifecycle (sequence)

The whole send / receive lifecycle in one view — **our** architecture (two-level queue, `canSend()` gate,
circuit breaker, realtime push, marketplace fan-out). Renders in the VSCode markdown preview.

```mermaid
sequenceDiagram
    autonumber
    participant CA as Caller (campaign/workflow S2S)
    participant L1 as Dispatch L1 (fair-share)
    participant Q as Per-provider queue (L2)
    participant W as Provider worker
    participant G as canSend + limits + classifier
    participant AD as Provider adapter
    participant API as Provider API
    participant DB as DynamoDB (send-log + conversations)
    participant CT as Contact phone
    participant IN as Inbound pipeline
    participant RT as realtime (live inbox)
    participant INT as Integrations (webhooks/marketplace)

    Note over CA,DB: PHASE 1 — OUTBOUND SEND
    CA->>L1: enqueue (idempotency key)
    L1->>Q: fair-share route to provider queue
    Q->>W: pull job
    W->>G: canSend? (suppression/consent/quiet-hours/number-health)
    alt blocked
        G-->>Q: requeue 601 (window) / drop (suppressed)
    else allowed
        W->>DB: resolve number record (number→provider→creds→TCR)
        W->>G: token-bucket (provider×carrier×tcr×line) + breaker
        alt over budget / breaker open
            G-->>Q: requeue 600/602 (backpressure)
        else within budget
            W->>AD: send on pinned number
            AD->>API: HTTP POST
            alt success
                API-->>AD: {id, segments}
                AD-->>W: {id, segments}
                W->>DB: send-log=sent; cost→billing
            else error
                API-->>AD: error {code,message}
                AD-->>W: raw msgcode
                W->>G: classify (cascade + codes-map)
                G-->>W: errcode (+errflag); side-effects
                W->>DB: errcode; err_count/flags; bench number if invalid
                opt transient 429/5xx
                    W-->>Q: requeue 600 (backpressure)
                end
            end
        end
    end

    Note over API,DB: PHASE 2 — DELIVERY RECEIPT (async)
    API->>IN: signed DLR webhook
    IN->>AD: UDF normalize (provider×carrier code → status)
    IN->>DB: send-log.status; contact err_count
    Note over IN: timeout → unknown, never block

    Note over CT,INT: PHASE 3 — INBOUND REPLY
    CT->>API: texts back
    API->>IN: signed inbound webhook
    IN->>IN: dedup by msgid (dup→406; delete-on-error)
    IN->>DB: associate number→account→contact (or provider tag)
    IN->>G: keyword match — STOP/START/PAUSE first (compliance)
    G-->>DB: scoped suppression + lifecycle (replied/optin) write-back
    IN->>DB: append inbound to conversation
    IN->>RT: push to live inbox

    Note over IN,INT: PHASE 4 — AUTORESPONSE + FAN-OUT
    IN->>G: non-compliance keyword → autoresponder / survey
    G-->>CA: addAutoResponse (templated) ↺ re-enters PHASE 1
    IN->>INT: MESSAGE_RECEIVED fan-out (webhooks + marketplace)
```

**Key invariants the diagram encodes** (`texting-16`):
* **Every phase boundary is an SQS hop** — which is what gives **idempotency** (outbound msgkey, inbound msgid)
  and **backpressure** (600/601/602 requeue instead of fail).
* **Provider specifics live only at the edges** — the **adapter** is the only participant that speaks the
  provider's dialect (send · DLR-normalize · inbound-normalize); everything inboard reasons about **normalized
  `msgid` / `errcode` / `status` / flags**.
* **The classifier is the hinge** — `msgcode → errcode → errflag` (config-driven, `texting-6.5`) turns raw
  provider codes into normalized categories + side effects *before* any business logic.
* **Phase 4 loops back to Phase 1** — an autoresponse / survey step is just **another outbound send** (the only
  sequencing primitive); it re-enters pinned + `canSend()`-gated.
* **Compliance is inline** — STOP detected during inbound keyword processing sets the contact's `suppression`
  (`reason=dnd`), so the **next outbound is suppressed before it ever reaches a provider**.

# Cross-service load-bearing requirements

The platform's *defining* requirements span services — **captured here so a rewrite doesn't lose them.** Texting
**consumes / enforces** these; the **SoT is the named owner**. **⚠️ = easy to miss.**

**⚠️ Identity, roles, teams, tenancy → [auth](../auth/specs/SPECS.md) + [account](../account/specs/SPECS.md)**
* **Role hierarchy** (root / admin / manager / support / staff / campaign-admin / **texter** / tester / api) + **per-campaign role overrides**.
* **Per-action access control** — `send_users` / `reply_users` allow-lists + **team-tag gating**; texting **enforces** these on send / reply / inbox.
* **Teams** (full-service / outsourced) — tag-based membership + texter stats / ranking.
* **Multi-tenant hierarchy** — campaign → parent (**brand / white-label**) → owner (**reseller**); sub-accounts; **every record tenant-keyed** + **per-tenant config / credentials / branding**. *Reseller / white-label is **day-one**, pervasive — not bolted on.*

**⚠️ Consent beyond STOP → [contact](../contact/SPECS.md) (SoT) + texting (keyword engine)**
* **Opt-in flows** — keyword / **double opt-in**, **hosted consent forms** on custom domains, **age-gating**, consent-language templates, DND re-activation.
* **Auditability** — message / flag history + **consent records** retained for compliance review.

**⚠️ Number lifecycle & 10DLC/TCR → [registration](../registration/SPECS.md)**
* **Number (proxy) lifecycle** — order / provision / status / **release + reuse grace** / no-reuse / no-release; per-number credentials — a real **inventory subsystem** (texting consumes the pool).
* **TCR / 10DLC** — RUP-as-**CSP**, brand + campaign registration, external vetting, **Campaign Verify** (political), **MNO daily caps**, monthly use-case fees. Large regulatory surface a US platform can't omit.
* **Free-trial governance (PFT)** — carrier trial caps (e.g. T-Mobile 200 seg / 10 contacts / day, AT&T 6/min), watermarking, expiry.

**⚠️ Inline billing → billing / [account](../account/specs/SPECS.md)**
* **Per-segment billing** (SMS/MMS × line type SC / TF / TCR / LC), **prepaid balance + cutoff + auto-charge**, **`max_out` caps**, surcharges, tax-by-zip, **rollup (parent) billing**, discount / invoice / bypass, Stripe. **Enforced inline in the send path** (`canSend()` balance gate, `texting-11.5`) — a requirement, **not** a back-office afterthought.

**Integration & extensibility → [marketplace](../marketplace/SPECS.md) / public-API surface**
* **Public developer API** — contacts / send / projects / proxy / webhooks; **API-key auth** (versioned, per-tenant scoped, expiry), per-endpoint rate limits, IP geoblocking.
* **Outbound webhook framework** (`MESSAGE_RECEIVED` / `contact.responded` / delivery status) + **retry queue** + **hook-chain** so integrations subscribe without touching core (`texting-7.8`).

**Adjacent → others**
* **URL shortening + click attribution** → [links](../links/SPECS.md) (custom domains; per-contact / message).
* **CSV/Excel import** (dedup / mapping / batched parallel / large lists) + **group / segment** ops → [contact](../contact/SPECS.md).
* **Voice call-forwarding** on proxy numbers (numbers are voice-capable) → a voice surface *(adjacent; scope TBD)*.

**⚠️ Real-time contact-lock coordination → [realtime](../realtime/SPECS.md) (WebSocket + presence)**
* The **P2P contact checkout lock** (`texting-21.2`) is **coordinated live over realtime's WebSocket** — agents
  see lock state as it changes, and a **WebSocket disconnect is presence-detected → auto-releases** the agent's
  locks (TTL backstop). Redis holds the authoritative lock; **realtime owns the connection / presence** that
  drives release + the peer **unlock-request** notification. Texting owns the lock semantics; realtime is
  load-bearing for the live coordination + disconnect signal.

# Service & Job topology

**Convention (platform-wide).** Each service layers **framework base → domain base → concrete role**. A **domain
Service base** (`TextingService extends Service`) and a **domain Job base** (`TextingJob extends Job`) hold the
**shared domain code** — the **provider adapter registry** (factory), **number routing / binding** + the
**sticky-number** rule, the **UDF normalization** (status / errcode / outcome), the **two-stage rate gate**
(Redis token-bucket + bench map), the **`canSend()`** client, and the **send-log / conversation** store — so
every concrete role inherits it.

```
Application
├── Service (Fastify, long-running — ECS)
│     └── TextingService            (domain base — adapter registry · number routing/binding · UDF normalize · Redis rate-gate/bench · canSend · send-log/conversation store; not deployed alone)
│           ├── TextingMainService    (the /texting/* API: send-enqueue · templates · conversation/inbox · autoresponder config · number mgmt · opt-out admin · the P2P agent workflow (checkout/lock) · config/health)
│           └── TextingWebhookService (provider INBOUND + DLR webhooks — signature-verify at edge, ACK fast → enqueue; provider-facing, scales apart from the user API)
└── Job (Lambda, event-driven)
      └── TextingJob                 (domain base — adapter registry · UDF · rate-gate · retry/DLQ · idempotency)
            ├── TextingSendWorker     (SQS L2 per-provider — provider-AGNOSTIC: dispatch by message.provider · canSend + two-stage rate gate · adapter.send · send-log · status; retry → failover → DLQ)
            ├── TextingDlrJob         (SQS from DLR webhook — normalize provider DLR → UDF status · update send-log · bench number on hard error · emit engagement → analytics/realtime)
            ├── TextingInboundJob     (SQS from inbound webhook — normalize → dedup → conversation/thread · opt-out STOP/START/HELP · autoresponder trigger · emit)
            ├── TextingDripJob        (EventBridge/SQS — sequenced drip orchestration: advance steps, enqueue the next send)
            └── TextingScheduleJob    (EventBridge — release scheduled sends into the pipeline at window open; dispatch owns the cross-account scheduler)
```

**Services (HTTP, ECS Fargate)**

| Class | Extends | Role |
|---|---|---|
| **`TextingService`** | `Service` | **Domain base** — adapter registry · number routing/binding · UDF normalize · Redis rate-gate/bench · `canSend` · send-log/conversation store; **not deployed alone**. |
| **`TextingMainService`** | `TextingService` | The **`/texting/*` API** — send-enqueue, templates, **conversation / inbox** (read + agent send), **autoresponder** config, **number** management, **opt-out** admin, the **P2P agent workflow** (contact checkout / lock), config/health. |
| **`TextingWebhookService`** | `TextingService` | Provider **inbound + DLR** ingress — **thin**: `adapter.verifySignature` at the edge, **ACK fast**, **enqueue the RAW payload + `{provider, account}` tag** (no normalization here). Routes **by concern** → the **DLR queue** and the **inbound queue** (not per-provider). **Provider-facing** (high-volume, signature-auth not user-JWT) so it **scales apart** from the user API. |

**Jobs (Lambda, event-driven)** — each extends `TextingJob`:

| Class | Trigger | Role | Req |
|---|---|---|---|
| **`TextingSendWorker`** | SQS (**L2 per-provider** queues) | **Provider-agnostic** — dispatch by `message.provider` via the adapter registry, run **`canSend` + the two-stage rate gate** (throttle), `adapter.send`, write send-log + status; **retry → failover → DLQ**. *(One factory worker, per-provider queues for HoL isolation — not a worker-per-provider.)* | texting-1.0 / 9.0 / 17.0 |
| **`TextingDlrJob`** | SQS (**DLR queue**) | **Provider-agnostic** — load the adapter by the message's `provider` tag, `adapter.normalizeStatus` → **UDF status** (3-layer `<provider>-codes-map`), update send-log, **bench the number** on a hard error, emit engagement → analytics / realtime | texting-6.0 / 19.0 |
| **`TextingInboundJob`** | SQS (**inbound queue**) | **Provider-agnostic** — `adapter.normalizeInbound` → **dedup** → conversation / thread; **opt-out STOP/START/HELP**; **autoresponder** trigger; emit | texting-7.0 |
| **`TextingDripJob`** | EventBridge / SQS | **Sequenced drip** orchestration — advance steps, enqueue the next send (the channel delivers) | texting-18.0 |
| **`TextingScheduleJob`** | EventBridge | Release **scheduled sends** into the pipeline at window open (the cross-account scheduler is [dispatch](../../../packages/services/DISPATCH.md)'s) | texting-15.0 |

> **Shared modules (not deployables).** The **provider adapter registry** (self-registering, endpoints-in-code),
> the **UDF normalization**, the **two-stage rate gate** (Redis token-bucket + bench map), the **number-routing /
> sticky-number** logic, and the **`canSend()`** client (on the `Application` base) are reused across the
> services + jobs. The **send worker is provider-agnostic** — adding a provider is a new adapter + a queue
> mapping, not a new worker (`texting-3.0` / `20.0`).
>
> **The adapter is the only code that speaks provider dialect** — the typed `SmsAdapter` exposes `verifySignature`
> (used by `TextingWebhookService` at the edge), `normalizeStatus`, and `normalizeInbound` (used by the workers),
> plus `send`. **One stateless adapter per provider lives in a registry on the `TextingService` / `TextingJob`
> base** (self-registered at cold-start; resolved by `providers.get(provider)`, creds passed in per-call) — see
> *Provider adapters & number binding → Adapter instantiation & topology* for the role→method table. So the webhook
> service **verifies + ACKs + enqueues raw**; the **workers normalize** via the adapter's 3-layer
> `<provider>-codes-map` (raw `msgcode` → UDF `errcode` / status → applied to a typed field). **Inbound / DLR
> routes by concern** (a DLR queue + an inbound queue, fair-shared per account, `provider` tag on the message) —
> **not** per-provider; per-provider *physical* inbound queues are an **optional HoL-isolation escape hatch**
> (same logical→physical pattern as send). *(Contrast the **send** side, which **is** per-provider — to enforce
> each provider's rate limit; inbound has no rate limit to enforce, only burst to absorb.)*

# AWS Services and Other Dependencies

**AWS services**
* **SQS** (+ **DLQ**) — **two levels**: L1 fair-share intake → **config-mapped physical queues** (L2; logical→physical, **most-specific-first → shared default**, per-provider = common mapping); per-queue visibility-timeout / prefetch / concurrency; **Lambda** workers throttle + retry.
* **DynamoDB** — the **send-log** + the **conversation / message store** (threads + history).
* **EventBridge Scheduler** — scheduled sends.
* **Kafka (MSK)** — normalized inbound / DLR / engagement events → [analytics](../analytics/SPECS.md) + [realtime](../realtime/SPECS.md).
* **Redis (ElastiCache)** — pause flags, **token-bucket limiter** (`SMSRATE:<provider>:<name>` key-prefix
  hierarchy: provider / carrier / tcr / carrier-tcr / tf / sc / per-line), **benched-sending-number map (24h
  TTL)**, **inbound dedup counters** (~hourly TTL), circuit-breaker state, **sticky-number selection cache** (the
  **durable** `(contact → number used)` record is the send-log / conversation store, since replies can arrive
  days later).
* **API Gateway** — provider **inbound + DLR webhooks** (signature-verified).
* **S3** — MMS staging / exports (media is the SoT). **KMS** — encryption at rest.

**Third-party libraries / services**
* **SMS/MMS providers (factory):** **Bandwidth · Bandwidth3 · BroadNet · Infobip · SignalWire · Sinch · Telnyx ·
  Telnyx3 · Twilio · Vonage** + **`fake`** (simulate DLR / inbound / STOP at scale). *(`Bandwidth3` / `Telnyx3`
  = distinct provider configs / accounts of the same vendor — separate adapters, separate number pools.)*
* **Carriers (destination MNOs):** **AT&T · Verizon · T-Mobile · US Cellular** — per-carrier **MPS / filtering /
  DLR codes**; 10DLC trust + registration via [registration](../registration/SPECS.md) (TCR brand/campaign).

**Internal (`@repo/*`)**
* `@repo/services` (Sqs, Dynamo, Kafka, Cache, S3, Kms, Scheduler), `@repo/endpoint` (`Access`), `@repo/common` (`Type`).
* Consumes **[contact](../contact/SPECS.md)** (recipients / suppression / `canSend`) · **[links](../links/SPECS.md)** (branded shortener) · **[media](../media/SPECS.md)** (MMS) · **[registration](../registration/SPECS.md)** (MPS / 10DLC); emits to **[analytics](../analytics/SPECS.md)** + **[realtime](../realtime/SPECS.md)**; **operational alerts → [monitor](../monitor/SPECS.md)** (backpressure / breaker); ordered by **[dispatch](../../../packages/services/DISPATCH.md)**; cost to **billing**.

# Compliance & standards mapping

How **this texting service's** controls map to **OWASP Top 10 (2021)**, **ISO/IEC 27001:2022** (Annex A),
**SOC 2 Type 2** (TSC), **HIPAA** (if PHI), **GDPR**, **CCPA/CPRA**, and **messaging law** — **TCPA** (consent,
**quiet hours**, STOP), **CTIA** messaging principles, **10DLC / A2P** registration, **CASL** (Canada). SMS
compliance is **stricter than email**. Texting is a **sending channel**, so it **runs the `canSend()` gate**
(suppression / consent / **quiet-hours** / block-list) **before delivery**, honors **STOP/START/HELP** at a
**double layer** (provider + platform), and feeds suppression back to [contact](../contact/SPECS.md). There is
**no PCI** surface; **HIPAA** is ➖ (no PHI by [AUP](../account/specs/SPECS.md); content *could* carry it).
SMS is **not E2E-encrypted** (the carrier carries it in clear) — we encrypt **at rest** and rely on carrier
transit; this is inherent to the medium. Tracked links / short domains → [links](../links/SPECS.md); fair-share
+ per-number MPS → [dispatch](../../../packages/services/DISPATCH.md); 10DLC trust → [registration](../registration/SPECS.md);
residency is the platform [AWS topology](../../../packages/services/src/aws/SPECS.md).

**Legend:** ✅ meets/exceeds · ⚠️ partial / open — see Gaps · ➖ n/a

| Texting control | OWASP T10 | ISO 27001:2022 | SOC 2 (TSC) | HIPAA (if PHI) | GDPR | CCPA | Messaging | |
|---|---|---|---|---|---|---|---|---|
| **Pre-send `canSend()` gate** — suppression / consent / **quiet-hours (per-recipient TZ)** / block-list before delivery | A04 | A.5.34 | (Privacy) | ➖ | Art 21 | §1798.120 | **TCPA quiet-hours** | ✅ channel |
| **STOP/START/HELP** — mandated keywords, instant, **double-layer** (provider + platform) → suppression | A04 | A.5.34 | (Privacy) | ➖ | Art 21 | §1798.120 | **TCPA / CTIA** | ✅ |
| **10DLC / A2P registration** — brand/campaign vetting + trust-score MPS (via registration) | A04 | A.5.31 / A.5.34 | CC7.1 | ➖ | ➖ | ➖ | **10DLC / CTIA** | ✅ via registration |
| **Content filtering (SHAFT + URL)** — screen prohibited content; **branded short domain** (no public shorteners) | A04 | A.5.34 | CC7.1 | ➖ | ➖ | ➖ | **CTIA** | ✅ |
| **DLR best-effort handling** — timeout → `unknown`; conservative on unknown codes (no blind retry) | A04 | A.8.16 | CC7.2 | ➖ | ➖ | ➖ | ➖ | ✅ |
| **Bounce/STOP suppression write-back** — suppression flows back to [contact](../contact/SPECS.md) | A04 | A.8.16 | CC7.2 | ➖ | Art 21 | §1798.120 | TCPA | ✅ |
| **No PII in tracking URLs** — opaque codes via [links](../links/SPECS.md) | A01 / A04 | A.8.11 | CC6.1 | ➖ | Art 5(1)(c) / 25 | §1798.100 | ➖ | ✅ via links |
| **No PII in the analytics lake** — opaque `contactId` only | A09 | A.5.34 | (Privacy) | ➖ | Art 5(1)(c) | §1798.100 | ➖ | ✅ via analytics |
| **GDPR forget** — texting joins the **contact-forget fan-out**: obfuscate **body + to-number** in the **conversation store + send-log** (`contactId` shell retained) | A04 | A.8.10 | (Privacy) | §164.310(d)(2) | Art 17 | §1798.105 | ➖ | ✅ via forget job |
| **Retention** — **full retention of inbound / conversation history, NO TTL** (business record); storage-limitation met by **erasure-on-request** (forget), not time-expiry | A09 | A.5.33 / A.8.10 | CC6.x | ➖ | Art 5(1)(e) / 17 | §1798.105 | ➖ | ✅ via forget |
| **Sub-processor + EU residency** — providers (Twilio / Bandwidth) are Art 28 sub-processors (DPA); EU sends via EU-region infra | A08 | A.5.19–23 | CC9.x | ➖ | Art 28 / 44–49 | §1798.140 | ➖ | ✅ |
| **Encryption** — at rest (DynamoDB / S3 SSE-KMS); carrier transit (SMS **not** E2E — inherent to the medium) | A02 | A.8.24 | CC6.1 | §164.312(e) | Art 32 | ➖ | ➖ | ✅ at rest |
| **Tenant isolation + per-number rate** — send-log / conversations partitioned; no account starves others | A01 / A04 | A.8.3 / A.8.6 | CC6.1 / A1.2 | ➖ | Art 32 | ➖ | ➖ | ✅ |
| **Inbound webhook authenticity** — provider DLR / inbound webhooks **signature-verified** | A08 | A.8.26 | CC6.1 / CC7.1 | ➖ | Art 32 | ➖ | ➖ | ✅ |
| **Audit** — send-log, pause/cancel, DLQ requeue, number provisioning (who/when) | A09 | A.8.15 | CC7.2 | ➖ | ➖ | ➖ | ➖ | ✅ |

> **Design-intent mapping** — how the service is *intended* to satisfy each control, not an attestation.

# Gaps & decisions

*The one review list — the working notes above are the rationale; this reconciles them with platform decisions.*
✅ = resolved/decided · ⚠️ = **open — needs attention**.

1. ✅ **Analytics storage — DECIDED (mirrors email).** Texting keeps an **operational send-log + conversation
   store in DynamoDB**; **engagement / normalized events go to [analytics](../analytics/SPECS.md)** (Kafka). No
   parallel analytics lake in texting.
2. ✅ **Branded shortener / short domains — owned by [links](../links/SPECS.md).** Texting **uses** the mint
   (same shortener as email — *required* on SMS since carriers block public shorteners); it does not own short
   domains.
3. ✅ **The "dispatcher" = the [dispatch](../../../packages/services/DISPATCH.md) governor**, pacing **per-account fairness ×
   per-number carrier MPS**. SMS is the original noisy-neighbor case; texting is one adopting channel.
4. ✅ **Suppression / consent — texting runs `canSend()`.** As the channel it evaluates the gate
   (suppression / consent / **quiet-hours per recipient TZ** / block-list, per [contact](../contact/SPECS.md))
   **before delivery**; STOP/HELP write suppression **back**.
5. ✅ **DLR handling — DECIDED.** DLRs are async / out-of-order / late / sometimes-never; **timeout → `unknown`**,
   **don't block**, and **don't blind-retry** unknown/rejection codes. The **UDF** normalizes per-provider codes.
6. ✅ **Provider failover — DECIDED (initial sends only; replies are PINNED).** A number lives on **one**
   provider; you **cannot live-reroute** its traffic. **Failover applies to *initial* sends** (pick another
   provider's number when the chosen one is down — that number then becomes stuck). **Conversational replies are
   PINNED to the contact's stuck number and are NEVER failover-eligible** — if that provider is down, the reply
   **waits in the queue (backpressure) until it recovers**, it does **not** reroute (switching mid-conversation
   fragments the thread). Redundancy = pre-provision a second provider's numbers; idempotency key blocks retry
   double-sends *(see Provider abstraction & failover)*.
7. ✅ **Two-way conversation / inbox — DECIDED: texting owns the store.** Conversation / thread model
   (`contact ↔ number ↔ account`) + history live here; **[realtime](../realtime/SPECS.md)** pushes live updates;
   **[web](../web/SPECS.md)** renders the inbox UX.
8. ✅ **Surveys — DECIDED: delegated to [survey](../survey/SPECS.md).** SMS survey = a definition **compiled to
   workflow `collect-input`**; texting is transport + thread, **not** a second conversation engine.
9. ✅ **Number routing, stickiness & the reply pin — DECIDED.** An account/campaign may offer **multiple
   numbers**. **Initial-send** selection = **sticky-first → area-code match → pool-balance** (+ failover); every
   send **records `(account/campaign, contact) → number used`**. The **first send pins** the conversation's
   number ("stuck"). **Inbound routing** resolves across any recorded number (receiving). **Outbound
   conversational replies are PINNED to the stuck number — never failover** — on a provider outage they **wait
   in queue (backpressure) until recovery**. Dispatch paces per-number MPS.
10. ✅ **MMS — DECIDED.** Media is the SoT; carrier fetches a **public-signed URL** ([media](../media/SPECS.md));
    respect **~600KB–1.2MB** practical carrier limits.
11. ✅ **Per-segment / per-MMS cost accounting — DECIDED.** Texting maintains the **segment counter** (also the
    template length warning) and emits **segment / MMS counts** to **billing**.
12. ✅ **Number provisioning & lifecycle — DECIDED: owned by [registration](../registration/SPECS.md).** Numbers
    (10DLC long code · TFN · short code) are **provisioned + registered there + tied to the account**; texting
    **consumes** the pool (routing + sticky-select per gap #9) and the published MPS — it does **not** buy /
    register / release numbers.
13. ✅ **Inbox model — DECIDED: one big inbox across campaigns.** A single unified surface (not per-campaign),
    worked by **texters**, with **filter by campaign / time range / status** (`unread` · `contact_replied` ·
    `texter_responded` · `texter_modified` · `delivered` · `undelivered` · `daily_capped` · `unreachable` ·
    `carrier_skip` · `expired` · `all`), **search** (contact name / number / text over a **slidable time window** —
    defaults recent, can reach old messages; **max width = app config**; most-recent-first, cap ~10,000), and
    **message tags**. *(A
    **shared** inbox — explicit per-thread assignment / bot-vs-human hand-off is a later enhancement, not
    required by the shared model — `texting-7.6`.)*
16. ✅ **Send-window reservation & capacity scheduling ("tetris") — DECIDED.** Accounts declare **send windows +
    volume**; a **capacity-aware reservation** (admission control) gives a **best-effort projection** a batch
    clears **by window-end** or **flags** it. **Posture: soft ops tool, NOT a hard SLA** (we're at the mercy of
    provider/carrier) — its job is **protecting shared provider/carrier capacity from overload** (cross-account
    blast radius) + softening the blow; **over-subscription = soft alert, never hard-reject** (batch still
    queues; the execution layer absorbs). **FCFS + account priority (1–5, 5 = highest)**. The **"tetris" packer**
    smooths load with inputs **account priority (1–5) × message count + size (segment/MMS load) × desired window
    × outbound send rate** (exact heuristic = implementation). A **CS gantt/tetris view** shows contention; CS
    can also **switch a campaign's provider** to level load (`texting-4.9`). **Cross-account capacity model +
    scheduler + gantt belong to [dispatch](../../../packages/services/DISPATCH.md)** (cross-channel); texting defines windows
    + relays assurance/alerts; window-end = a **soft target** monitored by `texting-12.3`. *(Warrants a matching
    dispatch-spec section.)* — `texting-15.0`
14. ✅ **Inbound retention & quiet-hours edges — DECIDED.**
    * **Full retention of inbound messages — NO TTL.** The conversation / inbound history is kept **indefinitely**
      (a business record); it is **not** time-expired. Removal is **compliance-driven only**: a contact's
      **GDPR forget** obfuscates body + number (`texting-13.1`), and **opt-out (STOP)** suppresses future sends
      (it does **not** delete history). *(GDPR storage-limitation is met via **erasure-on-request**, not a blanket
      TTL — see `texting-13.5`.)*
    * **STOP / HELP are exempt from quiet hours** — the **mandated opt-out / HELP confirmation** auto-reply is a
      **required compliance response** and is sent **even during quiet hours**; only **conversational** replies
      are blocked (`texting-5.2.1`).
    * **Unknown / cross-TZ recipient** — infer TZ from area code; if still unknown, use a **conservative
      default** (account default TZ, treat ambiguous as quiet) so quiet-hours is never *under*-enforced.
    * **Number-change re-mapping** — if a contact's sticky number is released, re-map to a new pool number on the
      next send; history stays on the thread.
15. ✅ **Production-platform fold-in — DECIDED (keep what works, keep our improvements).** Folded from the current
    SMS platform: **self-registering adapters** (convention, no central registry — `texting-3.7`); the
    **number record as the pivot** (number → provider → creds → config → TCR — `texting-4.6`); **3-tier config**
    with named config sets (`texting-4.7`); **config-driven carrier-id regex** (`texting-4.8`); the
    **defense-in-depth limit stack** — token-bucket key hierarchy + window + sending-number benching + carrier
    pause/discard + TPM/LTPM + daily/TCR caps + balance (`texting-1.3.2`, `5.7`–`5.9`, `11.5`); **backpressure
    via control statuses 600/601/602** (`texting-1.3.2`); the **3-layer error classification** (raw `msgcode` →
    normalized `errcode` → `errflag`, specificity cascade + config-driven codes-map + side effects —
    `texting-6.5`); the **typed tag attributes** (suppression / lifecycle /
    labels / outcome / health — **deliberately NOT** the production single `flags[]` bag — `texting-5.11`); **inbound idempotency** (msgid dedup, delete-on-error —
    `texting-7.1.1`); **association via the number map + provider context tag** (`texting-7.3.2`); **inbound
    integration fan-out** (`MESSAGE_RECEIVED` → webhooks + marketplace — `texting-7.8`); **distinct SQS queues
    per concern** + **idempotent sends** (msgkey dedup — `texting-1.6` / `14.1`); the **config-driven queue
    topology** (logical→physical, most-specific-first → shared default — `texting-1.3.3`). **Kept as our improvements:**
    **L1 cross-account fair-share** (the production system lacks it), the **conversation store + one-big-inbox**,
    the **recorded `(contact → number)` reply map**, the **per-provider circuit breaker**, and **realtime**
    live-inbox push.
17. ⚠️ **AI / LLM — greenfield, decide scope.** The legacy system has **none**. High-leverage for a next-gen
    agent UX: **reply classification**, **suggested responses**, **sentiment**, **spam-risk scoring**,
    **conversation summarization**. Agent-facing assist sits with the **inbox**; the model layer / heavy analysis
    is **[analytics](../analytics/SPECS.md) / AI** (cf. the social on-demand-summary pattern). *Open: scope + per-item vs on-demand + where the model layer lives.*
18. ⚠️ **Automatic failover & least-cost routing — decide.** Failover is currently **manual** (`texting-3.4` =
    initial-sends-only, ops-driven). A stated next-gen requirement could be **automatic** initial-send failover +
    **least-cost routing** across providers/numbers (cheapest eligible route that meets deliverability) — bounded
    by the pinned-reply rule (replies never reroute). *Open: cost model + auto-failover policy.*
19. ⚠️ **Event-sourced lifecycle + typed schemas + versioned public API — a rewrite-moment call.** Consider an
    **event-sourced** message-lifecycle log (append-only events vs a mutable send-log — gives replay / audit /
    rebuild), **typed schemas end-to-end** (`texting-20`), and a **versioned public-API contract** day-one.
    *Open: event-sourcing vs mutable store for the send-log/conversation.*
20. ✅ **First-class sequences — DECIDED (drip + journey via orchestration).** The legacy "sequences" (autoresponder
    + survey) are ad-hoc; we make **drip** first-class (`texting-18`) and broader **journeys** a
    campaign/workflow concern (like survey) — not a channel engine.
21. ✅ **Analytics path — DECIDED: warehouse, not counters.** Rich cohort / funnel reporting rides the
    **[analytics](../analytics/SPECS.md)** lake (Kafka → S3), not incremented counters; texting keeps only
    operational counters + the feedback loop (`texting-19.6`).

# Out of scope (deferred — later considerations)

* **RCS / WhatsApp / other rich-messaging channels** — separate channels with their own provider + compliance
  models; SMS/MMS first.
* **Carrier-level number portability automation** (porting an existing number in/out across providers) — manual
  / provider-console for now.
* **Voice / IVR** — a separate channel (the survey phone runner, [survey](../survey/SPECS.md) `survey-2.4`).

# Requirements (traceable register)

The traceable requirement register for the **texting service** (the sections above are the rationale; this is
the coded list). IDs are stable handles (**`texting-N.M`**) — cite them in code, tickets, and tests.
**Priority:** **A** = MVP, **B** = core / hardening, **C** = later. One level of sub-requirements; a group's
priority is its floor. **Boundaries:** texting owns **send execution, provider abstraction, retry/DLQ, the
conversation store, DLR/UDF normalization, number routing, the send-log + segment counter**; it **delegates** —
suppression/consent SoT → [contact](../contact/SPECS.md) (texting *runs* `canSend()`); fair-share + per-number
MPS → [dispatch](../../../packages/services/DISPATCH.md); 10DLC/MPS → [registration](../registration/SPECS.md); shortener →
[links](../links/SPECS.md); MMS media → [media](../media/SPECS.md); event lake → [analytics](../analytics/SPECS.md);
live inbox push → [realtime](../realtime/SPECS.md); survey state → [survey](../survey/SPECS.md); cost → billing.

## texting-1.0 Sending — A
- **texting-1.1** **Single send** (SMS / MMS) — A
- **texting-1.2** **Bulk send** from **[contact](../contact/SPECS.md)** segments — A
- **texting-1.3** **Two-level queueing** — **(L1)** account **fair-share** ([dispatch](../../../packages/services/DISPATCH.md)) emits a **logical queue name** → resolves to a **physical queue** (config); **(L2)** a **worker** pulls + **throttles to the provider's config** via **Redis** counters — A
  - **texting-1.3.1** **L2 enforces both send-side ceilings** — **per-provider account send limit** + **per-number carrier MPS** (Redis token-bucket / sliding-window, per-provider + per-number); over budget → **leave on queue (backpressure), don't drop** — A
  - **texting-1.3.2** **Defense-in-depth limits (must clear ALL)** — one **token-bucket** with a **key-prefix hierarchy** (`provider` · `carrier` · `tcr` · `carrier-tcr` · `tf`/`sc` · per-line) **+** send-window **+** invalid-number suppression **+** carrier pause/discard **+** TPM/LTPM **+** daily/TCR caps **+** balance; **backpressure via control statuses** (`600` provider 429/5xx · `601` out-of-window · `602` carrier-paused) keeps the SQS message **invisible + retried** (pacing, not drop); only permanent failures + successes leave — A
  - **texting-1.3.3** **Baseline: queue-per-provider + factory worker** — providers are a **bounded, code-managed** set (static, ~1:1), so the baseline is **one physical queue per provider + one factory worker per provider queue** (provider-agnostic adapter factory `texting-20.1` as an **SQS event-source-mapping per queue** — one codebase, N mappings). **No logical-name / fallthrough machinery needed** — the provider *is* the queue key. Per-queue **visibility-timeout / prefetch / concurrency**; ordering key `@group` (per-conversation) — A
  - **texting-1.3.4** **Provider-agnostic worker** — dispatches by **`message.provider`** → **`registry[provider].send()`** (typed `SmsAdapter`); a per-provider queue is for **HoL + failure isolation**, **not** because the worker is provider-bound (it isn't) — A
  - **texting-1.3.5** **Logical→physical mapping = OPTIONAL escape hatch (deferred / YAGNI)** — the most-specific-first taxonomy/fallthrough is **not** the baseline; its only residual value is carving a **sub-provider** slice (carrier / MMS / TCR) onto its **own queue** for **within-provider HoL isolation** when the Redis token bucket can't prevent it — **rare, operational, an infra change anyway**. Sub-dimension *throttling* lives in the token bucket (`texting-1.3.2`), not queues. *(Legacy shipped the full taxonomy, ran 2 queues — over-built.)* — C
- **texting-1.4** **Scheduled delivery** via EventBridge (quiet-hours-aware) — A
- **texting-1.5** Recipient + merge data from the **contact** service — A
- **texting-1.6** **Idempotent sends** — a per-message **dedup key** (`uniqueKey` + TTL, e.g. the message `ctime`/`msgkey`) so a **re-enqueued job never double-sends**; retry / failover safe — A
- **texting-1.7** **Pre-launch test send + test-number library** — a per-account **library of named test numbers** (`name + number`, **reusable** across campaigns); **send a campaign test to selected test numbers before go-live** (a launch gate — verify rendering / merge / links / segments on real handsets first) — A
  - **texting-1.7.1** **A test send is NOT a compliance bypass** — it still traverses the **real provider / carrier**, so **10DLC registration + content (SHAFT) rules still apply**; test numbers are **account-owned** (consent satisfied), but **STOP-suppression is still honored** (a test number that opted out won't receive) — A

## texting-2.0 Templates & content — A
- **texting-2.1** Template management — A
- **texting-2.2** **Merge tags / personalization** — contact / account / campaign + custom fields; **placeholder validation** (every `@field@` resolves, or flag before send) — A
- **texting-2.3** **MMS media** from the **[media](../media/SPECS.md)** service (carrier public-signed fetch; ~600KB–1.2MB limit) — A
- **texting-2.4** **Tracked links** via [links](../links/SPECS.md) — **required** branded short domain (carriers block public shorteners) — A
- **texting-2.5** **Segment counter** — compute SMS segments / encoding; surface length + cost warning (same counter billing uses) — B
- **texting-2.6** **Content-compliance validation (pluggable stage)** — message validation is a **pluggable pipeline** (placeholder checks, review-word / SHAFT alerts, Campaign-Verify formatting rules); runs pre-send, extensible without core changes — B

## texting-3.0 Provider abstraction (factory) & UDF — A
- **texting-3.1** Provider **factory** — **Bandwidth · Bandwidth3 · BroadNet · Infobip · SignalWire · Sinch · Telnyx · Telnyx3 · Twilio · Vonage** + **`fake`** (`Bandwidth3` / `Telnyx3` = separate configs/accounts of the same vendor) — A
- **texting-3.2** **`fake`** provider — simulate DLR / inbound / STOP at scale (config thresholds) — B
- **texting-3.3** **UDF code normalization** — map each **provider × carrier** status/error code → one vocabulary (`queued`/`sent`/`delivered`/`undelivered`/`failed`/`unknown`); retain the raw code — A
- **texting-3.4** **Provider failover = initial sends only** — a number lives on one provider; failover = **re-send from a *different* number on another provider** (must be **provisioned + 10DLC-registered**) for an **initial** send. **Conversational replies are PINNED to the stuck number — NEVER failover** (see `texting-4.3.3`) *(gap #6)* — B
- **texting-3.5** **Per-provider integration profile** — each adapter declares its **send API**, **inbound (MO) webhook**, **DLR/status webhook**, **webhook auth/sig**, callback **order/retry** behavior, and **account-level send limit** (see the provider integration table) — A
- **texting-3.6** **Per-provider send limit = a throttle axis** — the provider's account-level send-rate / concurrency cap (one dimension of the token-bucket key hierarchy, `texting-1.3.2`) — A
- **texting-3.7** **Self-registering adapters (convention)** — a provider is **any adapter implementing the typed `SmsAdapter`** (`send` · `verifySignature` · `normalizeStatus`/**UDF** · `normalizeInbound` · delivery-apply · number-order hooks) — the **single component that speaks provider dialect** (no separate inbound adapter); **dynamic dispatch by `Provider`, no central switch to edit** (proven in production) — A
- **texting-3.8** **Endpoints in adapter code, not config** — each adapter **hardcodes** its provider host(s) + paths; **config supplies only credentials + account identifiers** (`sid` / `token` / `account-id` / `project` / `apikey` / host *fragments*) interpolated into fixed URLs (`@token@` placeholders; Infobip subdomain / SignalWire space; optional per-call `host` override set **in code**). Endpoints are **versioned/reviewed code**, not runtime config — A
- **texting-3.9** **Adapter registry & topology** — one **stateless adapter per provider** self-registers into a typed `providers` map on the **`TextingService` / `TextingJob` base** (cold-start once, warm-reused); resolved by **`providers.get(provider)`**, never a switch. The **same** adapter serves every role — `TextingWebhookService` (`verifySignature`), `TextingSendWorker` (`send`), `TextingDlrJob` (`normalizeStatus`), `TextingInboundJob` (`normalizeInbound`). **Credentials are passed in per-call** (3-tier from the number record), **not baked in** — one adapter per *provider*, not per *account* (see *Adapter instantiation & topology*) — A

## texting-4.0 Numbers & routing — A
- **texting-4.1** **Number types** — 10DLC long code · **TFN** · **short code**, each with its carrier throughput profile — A
- **texting-4.2** **Number pool per account** — A
- **texting-4.3** **Number selection** — preference order: **sticky-first** (last number used for this contact), else **area-code match** (local presence), else pool-balance; an account/campaign may offer **multiple numbers** *(gap #9)* — A
  - **texting-4.3.1** **Record `(account/campaign, contact) → number used`** on every send — the map that makes **reply routing** work across **multiple numbers** (area-code / multi-number / failover) — A
  - **texting-4.3.2** **Inbound routing = the recorded map** — `(from contact, to number)` resolves to the same conversation regardless of which of the contact's numbers it arrives on (receiving) — A
  - **texting-4.3.3** **First send PINS the number; replies are pinned, NEVER failover** — the initial send sets the contact's **stuck** number; a **conversational reply must go out on that same number**; on a provider outage the reply **waits in queue (backpressure) until recovery**, it does **not** reroute (failover is initial-sends-only, `texting-3.4`) — A
- **texting-4.4** **Per-number carrier MPS** consumed from [registration](../registration/SPECS.md) (trust score) → paced by **[dispatch](../../../packages/services/DISPATCH.md)** — A
- **texting-4.5** **Numbers provisioned in [registration](../registration/SPECS.md)** — buy / register (10DLC/TCR) / assign / release is **registration's**, tied to the account; texting **consumes** the pool (does not provision) *(gap #12)* — A
- **texting-4.6** **Number record = the pivot** — binds **`number → provider → credentials → config-set → TCR identity`** (`tcr_cid` / `tcr_brand` / `tcr_csp`); **resolved at send** to pick adapter + creds (the `getProxy` step); credentials may be **per-number overrides** — A
- **texting-4.7** **3-tier config resolution** (most-specific wins) — **(A)** global provider creds + **named config sets**, **(B)** per-number overrides, **(C)** per-campaign `provider` / `mmsprovider` / `tcrmmsprovider` + **provider-map** remap — A
- **texting-4.8** **Carrier identification** — config-driven **regex map → `carrierId`** (att / verizon / tmobile / us-cellular); feeds per-carrier rate / pause / discard — A
- **texting-4.9** **Switchable campaign provider (ops load-leveling)** — when a campaign's pool spans **multiple providers**, **message-ops / CS can switch the campaign's default provider** to **level sending** off a congested provider (a manual lever complementing the automatic packer). Applies to **new / initial sends** (selection picks the new provider's numbers); **pinned conversational replies stay on their stuck number/provider** (`texting-4.3.3`) — B
- **texting-4.10** **TCR campaign number group & selection mode (the "parent number")** — the **1+ numbers registered under a 10DLC/TCR campaign** form that campaign's **number group**; a campaign selects the routing scope over it, **all modes = round-robin over an eligible set**: **`all`** (the *parent* — every number in the group) · **`area_code`** (only the **subset** of the group in a specified NPA — a *subset of `all`*) · **`single`** (one number). A set/subset of **one number just routes there**. The mode = the **eligible set** for an **initial** send; **whichever number is picked becomes the contact/campaign STUCK number** → replies pinned (`texting-4.3.3`), **regardless of mode**; **sticky-first short-circuits** for an already-engaged contact (`texting-4.3`). Group registered in [registration](../registration/SPECS.md); texting routes over it — A
  - **texting-4.10.1** **Round-robin / LRU within the eligible set** — `all` rotates the whole group, `area_code` rotates the **NPA subset**, `single` is the one number; a **1-element set → that number** (even throughput / deliverability) — A

## texting-5.0 Carrier compliance & deliverability — A
- **texting-5.1** **Pre-send `canSend()` gate** — suppression / consent / **quiet-hours** / block-list before delivery — A
- **texting-5.2** **Quiet hours (TCPA)** — no texts 8am–9pm **recipient-local-time**; enforced per-recipient-TZ by scheduler/dispatcher — A
  - **texting-5.2.1** **Applies to inbox replies** — a texter **cannot reply** during the contact's quiet hours; an in-thread reply runs `canSend()` like any send (conversational replies **not** exempt); inbox shows the reason + can **schedule for the next allowed window** — A
- **texting-5.3** **STOP / START / HELP** — mandated, instant, **double-layer** (provider + platform); STOP → suppression write-back to [contact](../contact/SPECS.md) — A
  - **texting-5.3.1** **Recognized keywords (configurable, layered)** — opt-out `STOP`/`STOPALL`/`UNSUBSCRIBE`/`CANCEL`/`END`/`QUIT`/`OPT OUT`/`REVOKE` · help `HELP`/`INFO` · resume `START`/`UNSTOP`/`YES` · `PAUSE`/`SNOOZE`; **noise-word stripping first** (per-campaign `stop_ignore`, so "pls stop" still matches); case-insensitive — A
  - **texting-5.3.2** **Double-layer reconciliation** — **ingest provider opt-out signals** (STOP webhook / "unsubscribed" error) into our suppression; **don't double-send** the confirmation if the provider already did — A
  - **texting-5.3.3** **Account-level scope, sticky** — STOP suppresses the account's SMS to the contact (all campaigns), persists until **contact-initiated `START`**; full-retention opt-out record (`texting-13.5`) — A
  - **texting-5.3.4** **Mandated confirmation / help** — one opt-out confirmation + HELP text; **quiet-hours-exempt** (`texting-5.2.1`) — A
  - **texting-5.3.5** **Audit** every opt-out / opt-in (keyword · channel · number · timestamp) — A
- **texting-5.4** **SHAFT + URL content filtering** — screen prohibited content; branded short domain only — A
- **texting-5.5** **10DLC / A2P** — consume brand/campaign trust → MPS from [registration](../registration/SPECS.md); don't send on an unregistered number — A
- **texting-5.6** **Supported carriers** — **AT&T · Verizon · T-Mobile · US Cellular**; track **per-carrier MPS / filtering / DLR codes** (carrier ≠ provider) — feeds dispatch pacing + the UDF map — A
- **texting-5.7** **Sending-number benching (proxy health)** — an **`invalid`** errcode **benches the *sending* number** (Redis 24h TTL); **`nocarrier`/`spam`** bench it **for that carrier only**; the bench is **broadcast fleet-wide** for instant effect (no cache-TTL wait); number-selection (`texting-4.3`) skips benched numbers — A
- **texting-5.8** **Carrier pause / discard** — per-carrier **pause** (requeue; precedence `carrierId → tcr_cid → cid → *`) + **discard** (drop when a carrier rejects outright) — A
- **texting-5.9** **Daily / TCR caps** — `brandDailyCap` + quota hooks (10DLC, via [registration](../registration/SPECS.md)) enforced at send — A
- **texting-5.10** **Contact `suppression` attribute (typed)** — a **per-channel** `suppression { status, reason, source, at, scope }` (reason: `dnd`/`hard_block`/`unreachable`/`landline`/`deactivated`) → **skipped from live sends**; set by errcode classification (`texting-6.5`), `err_count` (`texting-6.4`), or STOP; **not** a string in a shared array — A
- **texting-5.11** **Typed tags, NOT one bag** — separate typed attributes — `suppression` · `lifecycle` (enum) · `labels` (agent set) · message `outcome` · number `health` — each **one mission, one type, on the right entity**; **reject the production single `flags[]` array** — A
- **texting-5.12** **Scoped suppression (replaces "split DND")** — suppression is a **list of typed records** `{ channel, reason, scope{level,id}, source, at, keyword }`; `scope.level` ∈ `global`/`number`/`brand`/`campaign`; a send is blocked if a record is **`global`** or matches the send's `{number, brand, campaign}`; granularity = campaign **`optOutScope`** enum; stats roll up by `reason` (ignore scope); **no `dnd:<channel>` suffix strings** — A

## texting-6.0 DLR & status — A
- **texting-6.1** Ingest DLRs (async / out-of-order / late) via the inbound webhook pipeline — A
- **texting-6.2** **Timeout → `unknown`** — don't block on a DLR that never arrives — A
- **texting-6.3** **Conservative on unknown / rejection codes** — no blind retry — A
- **texting-6.4** **Delivery-report apply + per-contact `err_count`** — normalized status → send-log; bump the contact's **`err_count`** (feeds the contact `suppression` attribute, `texting-5.10`); per-send **status callback URL keyed by message/log id** — A
- **texting-6.5** **Error classification (raw → normalized → typed attribute)** — `msgcode` (raw, audit) → `errcode` (normalized: `invalid`/`spam`/`nocarrier`/`dnd`/`bad`/`landline`/`unreachable`/`deact`/`temp`/`ignore`/`OverCapacity`) → **applied to the right typed attribute** (deliverability block → contact `suppression.reason`; `invalid` → sending-number `health`); **specificity cascade** `provider.type.carrier → provider.type → provider.carrier → provider`; **config-driven `<provider>-codes-map`** (new codes via config); side effects: `ignore`→delivered, `invalid`→bench sending number, `nocarrier`/`spam`→bench-for-carrier, `temp`→retryable — A
- **texting-6.6** **Per-adapter response normalization** — native → success `{ id, segments }` / error `{ code, message, status }` — A

## texting-7.0 Inbound & two-way (conversation / inbox) — A
- **texting-7.1** **Inbound webhook pipeline** — `webhook/texting/<provider> → verify (signature) → react → enrich → emit` — A
  - **texting-7.1.1** **Inbound idempotency** — dedup by provider **message-id** (Redis counter, ~hourly TTL); a duplicate → **406**; **delete the key on processing error** so the provider's retry can still succeed — A
- **texting-7.2** **Conversation / thread model** — `contact ↔ number ↔ account` + **message history** (texting owns the store) *(gap #7)* — A
- **texting-7.3** **Inbound routing** — key off **(from contact, to number)** resolved against the recorded `(contact → number used)` map (`texting-4.3.1`) → resolve context (campaign / rep / bot); supports **multiple numbers per contact** — A
  - **texting-7.3.1** **Replies are pinned + wait on outage** — an outbound reply goes on the contact's **stuck number** (`texting-4.3.3`); if that provider is down it **waits in queue (backpressure)**, never failover — A
  - **texting-7.3.2** **Association: number → account → contact** — resolve `to`=our number → account, then contact by `from`; **some providers round-trip context** (cid / action / tcr) in the message **tag** → direct association, no lookup — A
- **texting-7.8** **Inbound integration fan-out** — inbound emits a **`MESSAGE_RECEIVED`** event consumed by **multiple independent subscribers** — outbound **webhooks** + **[marketplace](../marketplace/SPECS.md)** connectors (Zapier / HubSpot / …) — the integration extension seam — B
- **texting-7.4** **Real-time push** of inbound to the web inbox via **[realtime](../realtime/SPECS.md)** — A
- **texting-7.5** **One big inbox across campaigns** — a single unified, **shared** surface (not per-campaign), worked by **texters** *(gap #13)* — A
  - **texting-7.5.1** **Filter** — by **campaign**, **time range**, and **status**: `unread` · `contact_replied` · `texter_responded` · `texter_modified` · `delivered` · `undelivered` · `daily_capped` · `unreachable` · `carrier_skip` · `expired` · `all` — A
  - **texting-7.5.2** **Search (slidable time window)** — contact name / number / message text over a **texter-positioned time window** (defaults recent; can slide back to find old messages, e.g. 8 months ago); most-recent-first within the window (result cap ~10,000). Bounded width → **no full all-time search index required** — B
    - **texting-7.5.2.1** **Max window width = application-level hard ceiling** — an **account / user may request a *narrower* window but never wider**; the **server clamps** `width = min(requested, appMax)` (never client-trusted) and signals if it clamped — B
  - **texting-7.5.3** **Message tags** — label messages (and threads) for triage; filterable — B
- **texting-7.6** **Conversation assignment / hand-off** *(later)* — explicit per-thread ownership (rep / bot / queue); not required by the shared-inbox model — C
- **texting-7.7** **Keyword autoresponders** — configurable keyword-triggered auto-replies on inbound, **by account + by campaign** (marketing/engagement, beyond mandated STOP/HELP) — A
  - **texting-7.7.1** **Compliance-first** — STOP/HELP/START matched **first + authoritative**; a compliance keyword **never** triggers a marketing autoresponse — A
  - **texting-7.7.2** **Config scope (campaign > account)** — account defaults + campaign-specific override/extend — A
  - **texting-7.7.3** **Reply runs `canSend()`** — pinned number; **suppression always wins** (no autoresponse to an opted-out contact); **quiet-hours applies** (not exempt) — A
  - **texting-7.7.4** **Loop / abuse guards** — no auto-reply to an auto-reply; **one response per trigger**; per-contact rate-limit — A
  - **texting-7.7.5** **Tag / route option** — an autoresponder may tag/route the thread, not only reply — B
  - **texting-7.7.6** **Multi-step = [survey](../survey/SPECS.md)** (workflow-compiled), not an autoresponder (single trigger → single reply) — A
  - **texting-7.7.7** **Templated, scheduled-or-immediate** — auto-replies are **merge-templated** (against contact / log) and either **scheduled** or **queued immediately**; surveys hook the **same inbound path** — B

## texting-8.0 Surveys (delegated) — B
- **texting-8.1** SMS survey = a **[survey](../survey/SPECS.md)** definition compiled to workflow `collect-input`; texting = transport + thread, **not** a second engine *(gap #8)* — B

## texting-9.0 Retry, failure & DLQ — A
- **texting-9.1** **Failure classification** — **transient** (5xx/timeout/429) vs **provider-outage** vs **permanent/per-message**; act per class (don't treat an outage like a bad message) — A
- **texting-9.2** **Transient retry** — same provider/number, **exponential backoff**, config **N attempts** — A
- **texting-9.3** **Permanent / per-message failures not retried, not failed-over** (bad number / unregistered / content reject / carrier rejection) → **DLQ immediately** — A
- **texting-9.4** **Per-provider circuit breaker** — Redis state (off the throttle metrics); error-rate threshold **opens** it → worker **stops pulling that provider's queue** (messages **wait in queue**, **not** consumed → **no `maxReceiveCount` burn**); **half-open** probe → **close + drain** on recovery — A
  - **texting-9.4.1** **Outage ⇒ keep-in-queue, not DLQ** — for a provider-wide outage, pause consumption (backpressure); **do not DLQ + repopulate** — A
  - **texting-9.4.2** **Backpressure alerting (via [monitor](../monitor/SPECS.md))** — backpressure must be **visible + alerted**, since held messages don't fail loudly. Emit **system alerts** so **devops can contact the provider**: **circuit breaker open**, **sustained queue depth / message-age growth**, **carrier pause active**, **elevated `600`/`602` + provider error rate**. Routed to devops (Slack, per monitor's N-channel routing); mind SQS **≤14-day retention** during long outages — A
- **texting-9.5** **Failover after retries / breaker-open — initial sends only** — *initial* sends may re-route to another provider's registered number (per `texting-3.4`). **Pinned conversational replies do NOT failover** — they **wait in queue (backpressure)** until the stuck number's provider recovers (`texting-4.3.3`) — B
- **texting-9.6** **DLQ = poison + last resort** — exhausted retries w/ no failover path + permanent per-message; **manual requeue API**, by batch / accountId, once resolved — B
- **texting-9.7** **Visibility-timeout** + **max-receives** → DLQ (for genuine poison, not paused-provider messages) — A

## texting-10.0 Pause / halt / cancel — A
- **texting-10.1** **Redis pause flag** — by **account and/or campaign**; the job checks before each send — A
- **texting-10.2** Move paused items to a **`/pause` queue** — B

## texting-11.0 Logs, analytics & cost — A
- **texting-11.1** **Operational send-log in DynamoDB** (queued / sent / delivered / undelivered / failed / unknown / inbound / STOP) — A
- **texting-11.2** Engagement / normalized events **emitted to [analytics](../analytics/SPECS.md)** (Kafka) — not a texting-owned lake *(gap #1)* — B
- **texting-11.3** **Per-segment + per-MMS cost accounting** → emit counts to **billing**; **meter against the campaign budget cap** ([campaign → Channel cost management](../campaign/SPECS.md), the cross-channel cost authority) *(gap #11)* — A
- **texting-11.4** **No PII** in events / logs — opaque `contactId` — A
- **texting-11.5** **Account balance / max-out hard stop** — block send on negative balance (`bal_cutoff`) or `max_out` (billing) → 403 / OverCapacity (the per-account ceiling; **separate from** the per-campaign budget cap owned by [campaign](../campaign/SPECS.md)) — A

## texting-12.0 Visibility & fair-share — B
- **texting-12.1** Cross-account **send visibility** (volume / when — the gantt) — B
- **texting-12.2** Fair-share ordering + **per-number carrier MPS** + **per-provider send limit** (three axes) via the **[dispatch](../../../packages/services/DISPATCH.md)** governor *(gap #3)* — B
- **texting-12.3** **Message-age & delivery-SLA monitoring (ALL queues) — CRITICAL** — track **oldest-message age per queue** (L1 intake, per-provider L2, retry, pause, scheduled) against **configurable delivery SLAs**; **alert (via [monitor](../monitor/SPECS.md)) as age approaches / breaches SLA** so messages **never silently get old / stuck**. Age (not just depth) is the true "stuck" signal — A

## texting-13.0 Privacy & compliance — A
- **texting-13.1** **GDPR erasure (Art 17)** — on the [contact](../contact/SPECS.md) `contact-forget` **SQS** message, obfuscate the **`to`-number + body** in the **conversation store + send-log** (`contactId` shell retained for aggregates) — B
- **texting-13.2** **No PII in tracking URLs** (opaque codes via links) — A
- **texting-13.3** **No PHI** by [AUP](../account/specs/SPECS.md) — A
- **texting-13.4** **Tenant isolation** + per-number rate limits — A
- **texting-13.5** **Full retention of inbound / conversation history — NO TTL** — kept indefinitely (business record); **not** time-expired. **GDPR storage-limitation (Art 5(1)(e)) is satisfied by erasure-on-request** (`texting-13.1`), not a blanket TTL; **opt-out (STOP)** suppresses future sends, it does **not** delete history *(gap #14)* — A
- **texting-13.6** **Sub-processor + residency (Art 28 / 44–49)** — providers (Twilio / Bandwidth) are **sub-processors** (DPA); EU-market sends ride EU-region infra (no cross-region) — A
- **texting-13.7** **Encryption at rest** (DynamoDB / S3 SSE-KMS); SMS is **not E2E** (carrier transit) — inherent to the medium — A
- **texting-13.8** **Access / portability (Art 15 / 20)** — contribute SMS history to a contact's data export (via [contact](../contact/SPECS.md) / [analytics](../analytics/SPECS.md)) — B

## texting-14.0 Infra footprint — A
- **texting-14.1** **SQS** (+ DLQ) — **distinct queues per concern** (segment/send · inbound · status/DLR · webhook) + **L1 fair-share intake → config-mapped physical send queues (L2)** (logical→physical, most-specific-first → default); **Lambda** workers; **DynamoDB** (send-log + conversations) — A
- **texting-14.2** **EventBridge** (schedule), **Redis** (pause flag, **throttle counters: per-provider send limit + per-number carrier MPS**, sticky map) — A
- **texting-14.3** **API Gateway** (provider inbound + DLR webhooks, signature-verified); **Kafka** (events) — A
- **texting-14.4** Consumes **contact / links / media / registration**; emits to **analytics / realtime**; ordered by **dispatch**; cost to **billing** — A

## texting-15.0 Send-window reservation & capacity scheduling — B *(cross-account scheduler owned by [dispatch](../../../packages/services/DISPATCH.md))*
- **texting-15.1** **Account send windows** — a campaign declares a batch's window `[start, end]` (account TZ) + volume — B
- **texting-15.2** **Capacity-aware reservation (admission control)** — reserve against **projected deliverable capacity** (provider send limit × per-number carrier MPS × pool) in the window; **confirm** if the volume clears **by window-end**, else **flag**; cross-account arbitration **delegated to dispatch** *(gap #16)* — B
- **texting-15.3** **First-come + account priority (1–5)** — reservations FCFS; **account priority 1–5** (5 = highest) reorders under contention — B
- **texting-15.4** **"Tetris" load-smoothing** — pack batches into capacity-vs-time. **Inputs: account priority (1–5) × message count + size (segment/MMS load) × desired window × outbound send rate.** Plan feeds the L1 governor's ordering (exact heuristic = implementation) — C
- **texting-15.5** **Best-effort assurance + soft over-subscription alert** — a confirmed reservation is a **best-effort target** (window-end, `texting-12.3`), **not a guarantee** (we don't control provider/carrier); an **over-subscribed** window **alerts** ops + the marginal account (extend / reschedule / reduce / upgrade) but **still queues the batch** (no hard-reject) — B
- **texting-15.6** **CS gantt / "tetris" visualization** — reserved batches vs capacity over time, to see contention + intervene; **owned by [dispatch](../../../packages/services/DISPATCH.md)** (cross-account / cross-channel) — B
- **texting-15.7** **Posture = soft ops tool, not a hard SLA** — purpose is **protecting shared provider/carrier capacity** from overload (cross-account blast radius); execution layer (backpressure + fair-share) absorbs pile-up *(gap #16)* — B

## texting-16.0 Message lifecycle & invariants — A *(see [Message lifecycle (sequence)](#message-lifecycle-sequence))*
- **texting-16.1** **Phase boundaries are SQS hops** — every async step crosses a queue (segment/send · status · inbound · webhook); this is what yields **idempotency** (outbound msgkey, inbound msgid) + **backpressure** (600/601/602) — A
- **texting-16.2** **Provider specifics only at the edges** — the **adapter** is the only component that speaks the provider dialect (send / DLR-normalize / inbound-normalize); everything inboard reasons about **normalized `msgid` / `errcode` / `status` / flags** — A
- **texting-16.3** **The classifier is the hinge** — `msgcode → errcode → errflag` (config-driven, `texting-6.5`) converts raw provider codes into normalized categories + side effects **before** any business logic — A
- **texting-16.4** **Inbound can trigger outbound (the only sequencing primitive)** — an autoresponse / survey step **re-enters the outbound path** (pinned, `canSend()`-gated) — A
- **texting-16.5** **Compliance is inline** — STOP detected during inbound keyword processing sets the contact's `suppression` (`reason=dnd`); the next outbound is **suppressed before it reaches a provider** — A

## texting-17.0 Rate limiting & gating (two stages) — A *(see [Rate limiting & gating](#rate-limiting--gating-two-stages))*
- **texting-17.1** **Outcome classes** — **BLOCK** (hard error, nothing queued) · **SKIP** (suppressed + logged reason, terminal) · **DROP** (discarded mid-send, terminal) · **REQUEUE** (transient, 600/601/602, **no failure recorded**) · **SEND** — A
- **texting-17.2** **Stage A — pre-enqueue gating (terminal, once)** — money/eligibility/compliance decided **before a job exists** → BLOCK/SKIP, **never churns the queue**: balance (BLOCK, `texting-11.5`) → window (SKIP) → unreachable (SKIP) → landline/nocarrier (SKIP) → daily/TCR cap (SKIP, `texting-5.9`) → DND/suppression (SKIP, `texting-5.3`/`5.10`); pass → idempotent enqueue (`texting-1.6`) — A
- **texting-17.3** **Stage B — send-time gating (per dequeue / retry)** — rate/carrier → REQUEUE/DROP: queue-time (REQUEUE 601) → benched number (DROP, `texting-5.7`) → carrier pause (REQUEUE 602, `texting-5.8`) → carrier discard (DROP, `texting-5.8`) → TPM/LTPM + token bucket (REQUEUE 600, `texting-1.3.2`) → provider 429/5xx (REQUEUE 600, `texting-9.x`) — A
- **texting-17.4** **Fail fast vs pace** — Stage A is **terminal** (no queue churn); Stage B is **REQUEUE** (visibility-timeout pacing, never drop / hammer) — A
- **texting-17.5** **Compliance + rate-limiting gate via the same `suppression` attribute** — a `dnd` opt-out and a `landline`/`unreachable` deliverability block are the **same typed field, different `reason`** (not a separate compliance engine, not a shared flags bag) — A

## texting-18.0 Drip / sequenced campaigns (delegated) — B
- **texting-18.1** **Drip = orchestration (campaign/workflow), not a channel engine** — sequence (steps + delays + branching) + enrollment + per-contact scheduling + exit conditions live **above** the channel; **texting delivers each step** via the normal pipeline *(cf. surveys, `texting-8`)* — B
- **texting-18.2** **Per-step send obeys the full pipeline** — each step runs `canSend()` + two-stage gating + pinned number + DLR like any send (**quiet-hours / suppression apply per step**; an opted-out contact's remaining steps are suppressed) — B
- **texting-18.3** **Inbound feeds drip exit / branch** — reply / STOP are exit / branch signals; texting's inbound pipeline **emits** the signal (`texting-7.8`), the orchestrator advances / branches / unenrolls — B
- **texting-18.4** **Scale via time-bucketed sweep** — "who's due now?" query, **not** a timer per contact-step (orchestrator's concern) — B
- **texting-18.5** **Channel-agnostic** — the same drip engine drives **[email](../email/SPECS.md)** + **mixed-channel** drips; the channel only delivers — B

## texting-19.0 Status, metrics & the feedback loop — A
- **texting-19.1** **Two-tier counter aggregation** — **in-memory merge** (coalesce) → **periodic flush** (~3–5s; worker via SQS) → **atomic incr / upsert**; avoids write contention on shared counters at volume — A
- **texting-19.2** **Multi-dimensional counters — typed dimensions** — keyed by a tuple `{ scope (campaign/provider/account), id, period (lifetime/day/month), carrier?, tcr?, broadcast?, errcode? }`, **queried by dimension directly** (**not** `<carrier>_<errcode>` prefixed column-name parsing — the typed-field lesson applied to stats); account-local buckets + **after-midnight correction** — B
- **texting-19.3** **Declared headline metrics** — a **registry** declares which `errcode`s are **first-class headline metrics** (`unreachable`/`nocarrier`/`landline`/`spam`/`invalid`/`dailycap`) vs. only a dimensional breakdown; **human labels via a stats-label map** — B
- **texting-19.4** **Headline rates** — **delivery % = 100 − (err / total_sent)** + per-provider / per-carrier / per-errcode + TCR variants — each a **typed dimension queried directly** (not `<carrier>_<metric>` column-prefix parsing) — B
- **texting-19.5** **Feedback loop — stats drive gating** — per-carrier `err`/`spam` counters are the **sensor** for `pauseCarrier`/`discardCarrier` (`texting-5.8`) + the circuit breaker (`texting-9.4`); failure → bench number / carrier; **benched numbers broadcast fleet-wide** for instant effect — A
- **texting-19.6** **Ownership split** — operational counters + feedback loop = **texting** (+ [monitor](../monitor/SPECS.md) alerts); business / marketing analytics lake = **[analytics](../analytics/SPECS.md)** (`texting-11.2`) — A

## texting-20.0 Platform engineering principles (divergences from legacy) — A
- **texting-20.1** **Typed adapter interface + registry** — providers implement a typed **`SmsAdapter`**; resolved via a **typed registry**, **no runtime string dispatch** (supersedes the convention-only framing of `texting-3.7`) — A
- **texting-20.2** **No magic status codes** — a **typed result** `{ outcome, reason, retryAfter? }` (`texting-17.1`); legacy `600/601/602` survive only as a mapping footnote — A
- **texting-20.3** **Stateless workers + partition-aware keys** — all state in Redis / DynamoDB; scale **out** by adding consumers; DynamoDB keys **avoid hot partitions** (a high-volume account ≠ one hot key) — A
- **texting-20.4** **Token-bucket leasing** — a worker **leases a batch** of tokens + refills periodically, not a Redis round-trip **per message** — B
- **texting-20.5** **Durable billing counts ≠ best-effort stats** — segment / MMS **billing counts are durable** (with the send-log / a durable stream); stats counters stay best-effort merge (refines `texting-19.1` / `11.3`) — A
- **texting-20.6** **Bench state = Redis SoT + pub/sub invalidation** — not an in-memory fleet broadcast a restarted / new worker would miss (refines `texting-5.7`) — A
- **texting-20.7** **Computed-delay backpressure** — re-schedule a throttled message with **delay ≈ token-bucket refill** (SQS delay-seconds), not blind visibility-timeout polling; breaker-open waits on the **breaker signal**, not a poll loop (refines `texting-1.3.2` / `9.4`) — B

## texting-21.0 ⚠️ P2P human-agent workflow (the product's heart) — A
- **texting-21.1** **Texter sending modes** — manual send from a project/action; **rapid mode** (mass one-by-one, tap/space-to-send) + **response mode** (reply to next unread); a **work-pull** primitive ("next unread / next contact") feeds agents work — A
- **texting-21.2** **⚠️ Contact checkout locking (concurrency primitive)** — contacts checked out in **batches under a lock** (count / TTL / requeue) so **two texters never collide** on the same contact; P2P at scale = a distributed **work-queue of contacts** (on the `WorkQueue` primitive + Redis lock, authoritative + TTL) — A
- **texting-21.2.1** **Real-time lock over WebSocket** — lock acquire / hold / release is **coordinated live** via the **[realtime](../realtime/SPECS.md)** WebSocket; every agent sees lock state as it changes (Redis = SoT + TTL, realtime pushes deltas) — A
- **texting-21.2.2** **Auto-release on disconnect** — a WebSocket **disconnect** (closed browser / network drop / crash) is **presence-detected** (realtime) and **releases the agent's held locks** — never strands a contact; **TTL is the backstop** — A
- **texting-21.2.3** **Unlock governance** — **`ACCOUNT`-role force-unlock** of a stuck lock (audited) **+ peer unlock-request** (realtime-notifies the holder; no response → TTL / admin force-unlock) — B
- **texting-21.3** **Per-agent inbox** — the one-big-inbox (`texting-7.5`), filtered by assignment / status / labels, is the agent's workspace — A
- **texting-21.4** **Agent assignment** — **round-robin** assignment + **conversation reassignment** so an inbound reply routes / hands off to the right texter (makes `texting-7.6` **load-bearing**, not "later", for staffed teams) — A
- **texting-21.5** **Texter stats / ranking** — per-agent throughput / quality (ties **teams**, cross-service) — B

## texting-22.0 Service & Job topology — B
- **texting-22.1** **Domain bases** — `TextingService extends Service` + `TextingJob extends Job` hold the shared code (adapter registry · number routing/binding · UDF normalize · Redis rate-gate/bench · `canSend` · send-log/conversation store); **concrete roles extend the domain base** — B
- **texting-22.2** **`TextingMainService`** — the `/texting/*` API (send-enqueue · conversation/inbox · autoresponder · numbers · opt-out admin · P2P agent workflow) — A
- **texting-22.3** **`TextingWebhookService`** — provider **inbound + DLR** ingress (signature-verify + ACK-fast → enqueue); **scales apart** from the user API — A
- **texting-22.4** **Jobs extend `TextingJob`** — `TextingSendWorker` / `TextingDlrJob` / `TextingInboundJob` / `TextingDripJob` / `TextingScheduleJob` — A
- **texting-22.5** **`TextingSendWorker` is provider-agnostic** — one factory worker dispatches by `message.provider`; **per-provider queues = HoL isolation, not a worker-per-provider** (`texting-3.0` / `20.0`) — A

# Endpoints (first cut)

A first pass at the endpoint surface, in [`@repo/endpoint`](../../../packages/endpoint/SPECS.md) style — all
service-prefixed **`/texting/*`**. **Sending is S2S** ([campaign](../campaign/SPECS.md) / workflow /
transactional callers enqueue; no user-facing "blast" route). **Inbound + DLRs arrive on signed provider
webhooks.** The **conversation / inbox** read+reply surface is user-facing; the **live** inbox is pushed via
[realtime](../realtime/SPECS.md). **Click tracking is the [links](../links/SPECS.md) redirect.**

**Access column:** **`minAccess`** — **`-`** public · account ladder **`SENDER`<`USER`<`BILLING`<`ACCOUNT`** ·
staff **`SUPPORT`<`APPLICATION`<`ROOT`** · **`⬆`** = step-up · **`Internal`** = VPC-only S2S ·
**`Provider-sig`** = signature-verified provider webhook.

### Send (S2S — campaign / workflow / transactional) (texting-1)
| Method | URI | Purpose | Access | Req |
|---|---|---|---|---|
| POST | `/texting/send` | Enqueue a **single** SMS/MMS (job-id pointer → SQS) | Internal | texting-1.1/1.3 |
| POST | `/texting/send/bulk` | Enqueue a **bulk** send from a contact segment | Internal | texting-1.2 |
| POST | `/texting/send/test` | Send a **test** to the composer (self) — render + deliver one | USER | texting-1.1/2.2 |
| GET, POST | `/texting/test-numbers` | List / add a **named test number** (`name + number`) — account library | USER | texting-1.7 |
| DELETE | `/texting/test-numbers/{id}` | Remove a test number | USER | texting-1.7 |
| POST | `/texting/campaigns/{campaignId}/test` | **Pre-launch test** — send the campaign to selected **test numbers** | USER | texting-1.7 |

### Send-window reservation (texting-15) — *scheduler/gantt in [dispatch](../../../packages/services/DISPATCH.md)*
| Method | URI | Purpose | Access | Req |
|---|---|---|---|---|
| POST | `/texting/reservations` | Reserve a send window (`start`/`end`/TZ + volume) → **confirmed** or **flagged** (can't assure) | ACCOUNT | texting-15.1/15.2 |
| GET | `/texting/reservations/{id}` | Reservation status + **assurance** (will-complete-by-window-end) / over-subscription notice | USER | texting-15.5 |

### Templates (texting-2)
| Method | URI | Purpose | Access | Req |
|---|---|---|---|---|
| GET, POST | `/texting/templates` | List / create a template | USER | texting-2.1 |
| GET, PATCH, DELETE | `/texting/templates/{id}` | Get / update / archive a template | USER | texting-2.1 |
| POST | `/texting/templates/{id}/preview` | Render with merge data + **segment count** | USER | texting-2.2/2.5 |

### Conversations / inbox (texting-7)
| Method | URI | Purpose | Access | Req |
|---|---|---|---|---|
| GET | `/texting/conversations` | **One big inbox** — filter by `campaign` / `status` / time range; **search** (contact name / number / text) | USER | texting-7.5/7.5.1/7.5.2 |
| GET | `/texting/conversations/{id}` | Thread + message history | USER | texting-7.2 |
| POST | `/texting/conversations/{id}/reply` | Send a reply in-thread on the **pinned/stuck number** (never failover; **waits/backpressure** if provider down); runs `canSend()`; **blocked in quiet hours** (reason; may schedule) | SENDER | texting-7.3.1/5.2.1 |
| PATCH | `/texting/conversations/{id}/messages/{messageId}` | **Tag** a message (and set read / thread status) | USER | texting-7.5.3 |
| GET, PUT | `/texting/autoresponders` | **Account-level** keyword auto-replies (defaults) | USER | texting-7.7.2 |
| GET, PUT | `/texting/campaigns/{campaignId}/autoresponders` | **Campaign-level** keyword auto-replies (override/extend) | USER | texting-7.7.2 |

### P2P agent workflow — checkout & locking (texting-21)
*Lock state is **live over the [realtime](../realtime/SPECS.md) WebSocket** (texting-21.2.1); these REST routes are the control plane. Redis = lock SoT + TTL.*
| Method | URI | Purpose | Access | Req |
|---|---|---|---|---|
| POST | `/texting/agent/checkout` | **Work-pull** — check out the next N contacts under a lock (rapid / response mode) | SENDER | texting-21.1/21.2 |
| POST | `/texting/agent/checkout/{contactId}/release` | Release a held lock (done / skip) | SENDER | texting-21.2 |
| POST | `/texting/agent/checkout/{contactId}/request-unlock` | **Peer unlock-request** — ask the holder to release (realtime-notifies them) | SENDER | texting-21.2.3 |
| POST | `/texting/agent/checkout/{contactId}/force-unlock` | **Admin force-unlock** a stuck lock (audited) | ACCOUNT | texting-21.2.3 |

### Numbers (texting-4) — *provisioning lives in [registration](../registration/SPECS.md)*
| Method | URI | Purpose | Access | Req |
|---|---|---|---|---|
| GET | `/texting/numbers` | List the account's numbers + type / status / provider (**read** — provisioned in registration) | USER | texting-4.1/4.5 |

### Messages — send-log & status (texting-11)
| Method | URI | Purpose | Access | Req |
|---|---|---|---|---|
| GET | `/texting/messages` | Query the send-log (by campaign / account / status) | USER | texting-11.1 |
| GET | `/texting/messages/{id}` | Single message status (+ normalized UDF + raw code) | USER | texting-11.1/3.3 |

### Pause / halt / cancel (texting-10)
| Method | URI | Purpose | Access | Req |
|---|---|---|---|---|
| POST | `/texting/campaigns/{campaignId}/pause` | Set the Redis pause flag — stop further sends | ACCOUNT | texting-10.1 |
| POST | `/texting/campaigns/{campaignId}/resume` | Resume a paused campaign | ACCOUNT | texting-10.1 |
| POST | `/texting/campaigns/{campaignId}/cancel` | Cancel remaining sends | ACCOUNT | texting-10.1 |
| POST | `/texting/accounts/{accountId}/pause` | **Account-wide** pause (ops / compliance hold) | APPLICATION ⬆ | texting-10.1 |
| PUT | `/texting/campaigns/{campaignId}/provider` | **Switch the campaign's default provider** (ops/CS load-leveling; **new sends only**, replies stay pinned) | SUPPORT ⬆ | texting-4.9 |

### Retry / DLQ (texting-9)
| Method | URI | Purpose | Access | Req |
|---|---|---|---|---|
| GET | `/texting/dlq` | List DLQ items (by account / type) | APPLICATION | texting-9.6 |
| POST | `/texting/dlq/requeue` | Requeue DLQ items — by batch / accountId | APPLICATION ⬆ | texting-9.6 |
| GET | `/texting/providers/{id}/breaker` | Circuit-breaker state + queue depth (ops) | APPLICATION | texting-9.4.2 |

### Providers — platform config (texting-3)
| Method | URI | Purpose | Access | Req |
|---|---|---|---|---|
| GET | `/texting/providers` | List configured providers + status | APPLICATION | texting-3.1 |
| PUT | `/texting/providers/{id}` | Configure a provider (factory: Twilio / Bandwidth / … / `fake`) | APPLICATION ⬆ | texting-3.1 |

### Webhooks & internal / ops
| Method | URI | Purpose | Access | Req |
|---|---|---|---|---|
| POST | `/texting/webhook/{provider}` | Provider **inbound SMS/MMS + DLR / status** → verify → UDF → react / suppress (STOP) / push | Provider-sig | texting-7.1/6.1/5.3 |
| POST | `/texting/internal/erase` | S2S forget hook — obfuscate `to`-number + body in conversation + log (`contact-forget` fan-out) | Internal | texting-13.1 |
| GET, PUT | `/texting/config` | Read / set runtime config (quiet-hours policy, DLR timeouts, sticky map, **inbox search max window width**) | ROOT | texting-14.2/7.5.2 |
| GET | `/texting/health` | Liveness / readiness of the worker fleet | - | texting-14.1 |

# eof
