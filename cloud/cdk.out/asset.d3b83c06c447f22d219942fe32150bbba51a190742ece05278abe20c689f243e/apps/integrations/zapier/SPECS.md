#
# Zapier integration
#

# Objective

A **bidirectional Zapier connector** — let accounts wire RumbleUp into Zapier's 7,000+ app ecosystem **without
custom code**:

* **Triggers (app → Zapier)** — selected platform **events** ("contact replied", "message delivered",
  "campaign completed") flow **out** to a user's Zaps.
* **Actions (Zapier → app)** — Zapier **sends data in** from external systems ("create contact", "send SMS",
  "add to campaign") via our **public API**.
* **Searches (Zapier → app)** — look up a record (find contact by phone/email) to use in a Zap.

It is a **thin translation + delivery layer**, not a new data plane: triggers ride the existing **Kafka event
backbone** + **outbound-webhook framework**; actions ride the **public API** → core services; auth + enable +
billing ride **[auth](../../core/auth/specs/SPECS.md)** + **[marketplace](../../core/marketplace/SPECS.md)**.
Zapier is **one [marketplace](../../core/marketplace/SPECS.md) integration** (catalog entry, accept-to-enable,
cross-border gate) — this spec is the Zapier-specific contract behind it.

# Role & boundaries

**Owns:**
* The **Zapier app contract** — the trigger / action / search **catalog**, their **payload shapes**, and the
  Zapier-platform app definition (built with the **Zapier CLI / Platform**).
* **Trigger delivery mechanics** — REST-Hook **subscribe / unsubscribe** endpoints + a **subscription store**;
  mapping a platform event → the Zapier payload; **polling** endpoints as the fallback.
* **Action / search mapping** — translating a Zapier action/search call → the right **core-service API** call.

**Delegates / does NOT do:**

| Concern | Owner |
|---|---|
| The **event source** (entity state-change events) | the **Kafka backbone** ([analytics](../../core/analytics/SPECS.md) / per-service emit) |
| **Outbound delivery + retry / DLQ + signing** | the platform **outbound-webhook framework** (Zapier is one subscriber kind) |
| The **actual mutation** (create contact, send message) | the **core services** via their **public API** — [contact](../../core/contact/SPECS.md) · [texting](../../core/texting/SPECS.md) · [email](../../core/email/SPECS.md) · [campaign](../../core/campaign/SPECS.md) |
| **Auth / tokens / API keys** | **[auth](../../core/auth/specs/SPECS.md)** (OAuth2 / scoped API key) |
| **Catalog listing · accept-to-enable · cross-border gate · billing / metering** | **[marketplace](../../core/marketplace/SPECS.md)** (Zapier = an `IntegrationDefinition`) |
| **Compliance gate on a send action** (`canSend()`) | the **channel** (texting / email) — Zapier **cannot** bypass consent / suppression / quiet-hours |

> **No backdoor.** A Zapier *action* is just an **authorized, audited public-API call** — same path, auth, and
> compliance as any other caller. Zapier never gets a privileged write channel.

# Core concepts

* **Trigger** — *"when X happens in RumbleUp"* → data **out** to Zapier. Two delivery modes:
  * **REST Hook (subscribe)** *(preferred)* — Zapier **POSTs a target URL** to our subscribe endpoint when a
    user turns a Zap on; we **deliver** to it on each matching event. Real-time, efficient.
  * **Polling** *(fallback)* — Zapier periodically **GETs** a "recent X" endpoint; for events without a hook.
* **Action** — *"do X in RumbleUp"* → data **in** from Zapier → a core-service API call (create/update/send).
* **Search** — *"find X"* → a read used as a Zap step.
* **Subscription** — a `{ account, event type, target URL }` registered by a Zap (REST Hook); the unit triggers
  fan out to.
* **The Zapier app** — the definition hosted on **Zapier's platform** (their CLI); *our* side is the
  endpoints + the event→payload mapping it calls.

# Architecture & flow

```
 TRIGGERS (app → Zapier)
   core services ──*.changed / *.event──► Kafka backbone
        └─► zapier TRIGGER consumer ── filter by (account, subscribed event type)
                 └─► map → Zapier payload ─► outbound-webhook framework (sign · THROTTLE · retry · DLQ)
                          └─► POST  Zapier target URL   (the REST-Hook subscription)
                              throttle (like SMS providers): per-target token bucket × per-account fair-share;
                              429/fail → backpressure requeue → breaker auto-pause

 ACTIONS (Zapier → app)
   Zapier ──POST /zapier/actions/<action>  (OAuth2 / API key — the account's)──►
        └─► validate + map → core-service public API  (runs the SAME auth + canSend() gate)
                 └─► contact.create · texting.send · campaign.add · …

 SUBSCRIBE (Zap on/off)
   Zapier ──POST /zapier/subscribe  { event, targetUrl }──► store subscription
   Zapier ──DELETE /zapier/subscribe/{id}──► remove (Zap turned off)
```

* **Triggers are a Kafka consumer + the webhook framework** — the connector subscribes to the entity-event
  stream, filters to each account's active subscriptions, maps to the Zapier payload, and hands off to the
  shared **outbound-webhook framework** (signing, retry, DLQ) for delivery. **No new delivery engine.**
* **Actions are public-API calls** — Zapier authenticates as the account (OAuth2 / scoped key) and calls a
  `/zapier/actions/*` endpoint that **maps to the core service's API** — so the mutation runs the **same
  authorization + `canSend()` compliance** as any caller.
* **Eventual + idempotent** — triggers lag the SoT by the event pipeline; every trigger payload carries a
  **stable `id`** (Zapier dedupes on it); every action accepts an **idempotency key** (no double-create).

# Triggers — event catalog (curated, code-defined)

Triggers are **declarative / configurable** — a trigger = `{ name, source event, payload map, filter }`. Because
the event **already flows on the Kafka backbone**, adding one is mostly a **declaration** (pick the event + map
the fields + optional filter), **not procedural code** — so the outbound catalog **grows cheaply**. Curated
**v1 set** (grows by declaration):

| Trigger | Fires on | Source event |
|---|---|---|
| `contact.created` | a new contact | contact `*.created` |
| `contact.updated` | a contact field/tag change | contact `*.changed` |
| `contact.opted_out` | STOP / unsubscribe | suppression event |
| `message.received` | inbound SMS/email reply | texting / email inbound |
| `message.delivered` | DLR delivered | texting / email status |
| `message.failed` | undelivered / failed | texting / email status |
| `campaign.completed` | a campaign finishes sending | campaign event |
| `survey.completed` | a survey submission | [survey](../../core/survey/SPECS.md) completion |

* **REST Hook preferred**, polling fallback (a `GET /zapier/triggers/{trigger}/recent` returns the latest N for
  Zapier's polling + the **"test trigger"** sample on Zap setup).
* **No PII in trigger metadata** beyond what the user's own Zap consumes — payloads carry the record the user
  asked for (it's *their* data going to *their* Zap), but **opaque ids** elsewhere; the catalog grows per
  product need.
* **Outbound = config; inbound = code.** Adding a **trigger** is **declarative** (reshape + forward an event
  that already flows). Adding an **action** needs **processing** — validate untrusted external data, map → our
  model, enforce **`canSend()` + idempotency**, call the core API — so **actions grow by engineering, triggers
  by declaration.**

# Actions — catalog (→ core APIs)

Each action **maps to a core-service public-API call** (auth + compliance enforced there):

| Action | → Core API | Notes |
|---|---|---|
| `contact.create` / `contact.update` | [contact](../../core/contact/SPECS.md) | **configurable opt-in flag** (default **off**); opt-in = **account-asserted** consent (`source = zapier`, audited) — not messageable until opted-in |
| `contact.tag` / `contact.add_to_segment` | contact | |
| `contact.opt_out` | contact | let a Zap honor an external opt-out → suppression |
| `message.send_sms` | [texting](../../core/texting/SPECS.md) | **runs `canSend()`** (consent / suppression / quiet-hours) — **no bypass** |
| `message.send_email` | [email](../../core/email/SPECS.md) | same gate |
| `campaign.add_contact` | [campaign](../../core/campaign/SPECS.md) | |

> **Send actions are not a compliance loophole.** `message.send_*` rides the channel's `canSend()` exactly like
> any send — an opted-out / quiet-hours recipient is **blocked**, and the Zap step returns the reason.

# Searches

| Search | → | Returns |
|---|---|---|
| `contact.find` | [contact](../../core/contact/SPECS.md) (by phone / email) | the matching contact (or empty) — for "find or create" Zap patterns |

# Auth

* **OAuth2 (preferred)** — the account authorizes Zapier; tokens are minted + **vaulted via the
  [marketplace](../../core/marketplace/SPECS.md) OAuth broker** (`grant`/`arctic` + vault), auto-refreshed.
  Cleaner UX (no key copy-paste) + revocable.
* **Scoped API key (alt)** — a per-account, **least-privilege**, expiring key (the public-API key model from
  [auth](../../core/auth/specs/SPECS.md)). Per-endpoint rate-limited.
* Either way Zapier acts **as the account**, scoped to the connecting user's **role** — it can do **no more**
  than that user could (RBAC unchanged).

# Within marketplace

Zapier is a **[marketplace](../../core/marketplace/SPECS.md) integration** (`IntegrationDefinition`) — it
inherits, not reinvents:
* **Accept-to-enable** + **sub-processor acknowledgment** (data flows to Zapier, a 3rd party).
* **`dataJurisdiction = US`** → the **cross-border gate**: an **EU account** enabling Zapier must accept the
  **escalated GDPR data-transfer notice** (SCCs; US processing) — `marketplace-2.7`.
* **Usage metering** (triggers delivered + actions invoked) → billing; **paywall** if it's a paid add-on.
* **Lifecycle** — enable → connect (OAuth/key) → ACTIVE ⇄ pause → remove (purge subscriptions + revoke token).

# AWS Services and Other Dependencies

**AWS services**
* **Kafka (MSK)** — the trigger event source (consumer). **SQS** (+ DLQ) — outbound delivery workers + retry.
* **Redis (ElastiCache)** — **delivery throttle** (token-bucket × per-account fair-share) + circuit-breaker state.
* **DynamoDB** — the **subscription store** (`{account, event, targetUrl}`) + delivery/idempotency state.
* **API Gateway** — the public `/zapier/*` surface (subscribe, actions, searches, polling).
* **KMS** — encryption at rest; **Secrets Manager** — (via marketplace vault) OAuth tokens.

**Third-party**
* **Zapier Platform** (CLI) — the app definition lives there; **Zapier is a US-based sub-processor**.

**Internal (`@repo/*`) + services**
* `@repo/services` (Kafka, Sqs, Dynamo, Kms), `@repo/endpoint` (`Access`), `@repo/common` (`Type`).
* Consumes: **marketplace** (catalog / enable / OAuth / metering), **auth** (API keys / OAuth / RBAC),
  **contact / texting / email / campaign / survey** (the action + trigger surfaces); rides the
  **outbound-webhook framework** for delivery.

# Compliance & standards mapping

How **this Zapier connector's** controls map to **OWASP Top 10 (2021)**, **ISO/IEC 27001:2022** (Annex A),
**SOC 2** (TSC), **GDPR**, **CCPA/CPRA**, and **messaging law**. Zapier is a **data egress + ingress** seam —
its dominant controls are **sub-processor + cross-border governance**, **least-privilege scoped auth**,
**no compliance bypass on send**, and **inbound validation**. **No PCI / PHI** (➖, no payment/PHI;
no [AUP](../../core/account/specs/SPECS.md) PHI).

**Legend:** ✅ meets/exceeds · ⚠️ partial / open — see Gaps · ➖ n/a

| Zapier control | OWASP T10 | ISO 27001:2022 | SOC 2 (TSC) | GDPR | CCPA | Messaging | |
|---|---|---|---|---|---|---|---|
| **Sub-processor + cross-border** — Zapier = US sub-processor; **accept-to-enable** + **EU→US transfer gate** (SCCs) via marketplace | A08 | A.5.19–.23 | CC9.2 | Art 28 / 44–49 | §1798.140 | ➖ | ✅ via marketplace |
| **Scoped, least-privilege auth** — OAuth2 / expiring API key; Zapier acts **as the account**, no more than the user's role | A01 / A07 | A.5.15 / A.8.2 | CC6.1 / CC6.3 | Art 32 | ➖ | ➖ | ✅ |
| **Egress access control** — outbound gated by account **feature flag** + scoped to the **connecting user's permissions** (export only what they can access; re-checked on role change) | A01 | A.5.15 / A.8.3 | CC6.1 / CC6.3 | Art 32 | §1798.100 | ➖ | ✅ |
| **No compliance bypass on send** — `message.send_*` runs **`canSend()`** (consent / suppression / quiet-hours) | A04 | A.5.34 | CC6.1 | Art 21 | §1798.120 | **TCPA / CAN-SPAM** | ✅ |
| **Consent on inbound contacts** — **configurable opt-in flag, default off**; opt-in is **account-asserted** (`source = zapier`, attested + audited); not messageable until opted-in | A04 | A.8.10 | (Privacy) | Art 6 | §1798.100 | ➖ | ✅ |
| **Inbound validation + rate-limit** — action payloads validated; per-account API rate limits; idempotency key | A03 / A04 | A.8.26 | CC6.1 / CC7.1 | Art 32 | ➖ | ➖ | ✅ |
| **Outbound delivery integrity + throttle** — signed deliveries + **throttled (token bucket × fair-share, like SMS providers)** + backpressure + retry/DLQ; unguessable target URL | A08 | A.8.26 | CC7.1 | Art 32 | ➖ | ➖ | ✅ |
| **No PII in logs** — opaque ids; trigger/action payloads not logged | A09 | A.5.34 / A.8.11 | (Privacy) | Art 5(1)(c) | §1798.100 | ➖ | ✅ |
| **Tenant isolation** — subscriptions + actions scoped to the connecting account | A01 | A.8.3 | CC6.1 | Art 32 | §1798.100 | ➖ | ✅ |
| **GDPR erasure** — disconnect **purges subscriptions + revokes token**; contact-forget stops future triggers; **downstream PII already delivered = account's responsibility** (controller; disclosed, not claimed-erased) | A04 | A.8.10 | (Privacy) | Art 17 | §1798.105 | ➖ | ✅ |
| **Audit** — connect / subscribe / action invocations audited | A09 | A.8.15 | CC7.2 | Art 30 | ➖ | ➖ | ✅ |

> **Design-intent mapping** — how the connector is *intended* to satisfy each control, not an attestation.

# Gaps & decisions

*The one review list.* ✅ = resolved/decided · ⚠️ = **open — needs attention**.

1. ✅ **Triggers = REST Hooks (subscribe), polling fallback — DECIDED.** Real-time delivery via the
   outbound-webhook framework; polling only for the "test trigger" sample + events without a hook.
2. ✅ **Actions = the public API, no backdoor — DECIDED.** A Zapier action is an authorized, audited public-API
   call running the same RBAC + `canSend()` as any caller.
3. ✅ **Within marketplace — DECIDED.** Zapier is one `IntegrationDefinition`; accept-to-enable, **`dataJurisdiction = US`** → EU→US cross-border gate, metering, billing all inherited.
4. ✅ **Auth — DECIDED: OAuth2 preferred, scoped API key alternative.** Both scope Zapier to the connecting
   user's role; tokens vaulted via the marketplace OAuth broker.
5. ✅ **Consent for Zapier-imported contacts — DECIDED: configurable, account-asserted, default-off.** The
   `contact.create` action has an **opt-in flag**; **default = not opted-in** (can't be messaged until opt-in —
   avoids TCPA exposure from arbitrary imports). A Zap **can** mark contacts **opted-in** when the account has a
   lawful basis in the source system (e.g. a consented web form) — recorded as an **account-asserted consent**
   (`source = zapier`, attester + timestamp), **audited** as the compliance record. The **account is the
   controller / responsible party** for that assertion — `zapier-2.5`.
6. ✅ **GDPR erasure reach — DECIDED.** On contact-forget we **stop future triggers + purge our subscriptions /
   state**, but **PII already delivered to Zapier (and onward to the account's connected apps) cannot be
   recalled** — we **do not claim to erase downstream.** The **account is the controller and takes
   responsibility** for erasure in their connected systems; **disclosed at accept-to-enable** (the
   sub-processor / data-egress acknowledgment).
7. ✅ **Add-a-trigger / add-an-action — DECIDED: outbound declarative, inbound coded.** **Outbound triggers are
   configurable / declarative** — a trigger = `{ name, source event, payload map, filter }`; since the event
   already flows on Kafka, adding one is a **declaration** (low/no procedural code), so the trigger catalog grows
   cheaply. **Inbound actions need processing** — each validates untrusted external data, maps to our model,
   enforces `canSend()` + idempotency, and calls a core API → **per-action engineering**, not config
   (`zapier-1.4` / `2.6`). *(Open follow-on: plan/role-gating specific triggers.)*
8. ✅ **Outbound delivery throttling — DECIDED: throttle like SMS providers.** Any outbound event / webhook
   delivery (Zapier + future targets) is **throttled** by the outbound-webhook framework — a **per-target token
   bucket** (Zapier's inbound-hook rate limit) **× per-account fair-share** (one account's event firehose can't
   starve others — the `WorkQueue` primitive), with **backpressure** (429 / fail → **computed-delay requeue**,
   not hammer) and **circuit-breaker auto-pause** of a failing target after a consecutive-failure threshold — **system default,
   account-overridable** (`/zapier/config`) — + account notice. **Same pattern as the SMS-provider throttle**
   (`texting-1.3.2` / `9.4`) — **reused, not reinvented.**

# Requirements (traceable register)

The traceable register for the **Zapier connector** (IDs **`zapier-N.M`**). **Priority:** **A** = MVP,
**B** = core / hardening, **C** = later. **Boundary:** Zapier owns the **trigger/action/search contract +
subscribe/deliver/map mechanics**; event source = Kafka, delivery = the webhook framework, mutations = core
APIs, auth = auth, enable/billing = marketplace.

## zapier-1.0 Triggers (app → Zapier) — A
- **zapier-1.1** **REST-Hook subscribe / unsubscribe** — `POST /zapier/subscribe { event, targetUrl }` + `DELETE`; **subscription store** (DynamoDB) — A
- **zapier-1.2** **Event consumer** — read the **Kafka backbone**, filter by `(account, subscribed event)`, **map → Zapier payload** — A
- **zapier-1.3** **Deliver via the outbound-webhook framework** — sign + **throttle** (per-target token bucket × per-account fair-share — **same pattern as SMS providers**, `texting-1.3.2`) + **retry / DLQ**; no new delivery engine — A
- **zapier-1.4** **Trigger catalog — declarative / configurable** — a trigger = `{ name, source event, payload map, filter }`; grows by **declaration** (the event already flows on Kafka), **not** procedural code; v1: `contact.created/updated/opted_out` · `message.received/delivered/failed` · `campaign.completed` · `survey.completed` *(gap #7)* — A
- **zapier-1.5** **Polling fallback** — `GET /zapier/triggers/{trigger}/recent` (latest N) for polling + the Zap-setup **test sample** — B
- **zapier-1.6** **Dedupe id** — every payload carries a stable `id` (Zapier dedupes) — A

## zapier-2.0 Actions (Zapier → app) — A
- **zapier-2.1** **Action → core-API mapping** — `contact.create/update/tag/add_to_segment/opt_out` · `message.send_sms/send_email` · `campaign.add_contact` → the owning service's public API — A
- **zapier-2.2** **No backdoor** — actions run the **same RBAC + `canSend()`** as any caller; **send actions never bypass** consent / suppression / quiet-hours — A
- **zapier-2.3** **Idempotency key** per action — no double-create / double-send on Zap retry — A
- **zapier-2.4** **Validate + rate-limit** inbound action payloads (per-account) — A
- **zapier-2.5** **Configurable import consent (account-asserted)** — the `contact.create` action carries an **opt-in flag** the Zap sets; **default = NOT opted-in** (safe — can't be messaged until opt-in); when set opt-in, recorded as an **account-asserted** consent (`source = zapier`, attester + timestamp) and **audited** as the lawful-basis record (the **account is the controller**) *(gap #5)* — A
- **zapier-2.6** **Actions need per-action processing (code, not config)** — each action **validates** untrusted external input, **maps** it to our model, enforces **`canSend()` + idempotency**, and calls the core API → real **engineering per action** (the inbound counterpart to declarative triggers) *(gap #7)* — A

## zapier-3.0 Searches — B
- **zapier-3.1** `contact.find` (by phone / email) for find-or-create Zaps — B

## zapier-4.0 Auth — A
- **zapier-4.1** **OAuth2** (preferred) — account authorizes; tokens **vaulted via the marketplace broker**, auto-refresh — A
- **zapier-4.2** **Scoped API key** (alt) — per-account, least-privilege, expiring; per-endpoint rate-limited — A
- **zapier-4.3** Zapier acts **as the account**, **≤ the connecting user's role** (RBAC unchanged) — A
- **zapier-4.4** **Egress gating — feature flag × connecting-user permissions** — outbound data to Zapier requires the account's **feature flag** (egress / Zapier enabled; off ⇒ no triggers fire, no data leaves) **AND** is **scoped to the permissions of the user who created the connection** — Zapier can export / act on **only what that user can access** (e.g. no billing fields if they can't see billing); **re-checked** as roles change (revoked permission ⇒ that data stops flowing) — A

## zapier-5.0 Marketplace & governance — A
- **zapier-5.1** **`IntegrationDefinition`** in the [marketplace](../../core/marketplace/SPECS.md) catalog; **accept-to-enable** + sub-processor ack — A
- **zapier-5.2** **`dataJurisdiction = US`** → **EU→US cross-border transfer gate** (SCCs) on enable *(marketplace-2.7)* — A
- **zapier-5.3** **Usage metering** (triggers delivered + actions invoked) → billing — B
- **zapier-5.4** **Disconnect** purges subscriptions + revokes the OAuth token / key — A

## zapier-6.0 Reliability & compliance — A
- **zapier-6.1** **Tenant isolation** — subscriptions + actions scoped to the account — A
- **zapier-6.2** **No PII in logs** (opaque ids; payloads not logged) — A
- **zapier-6.3** **Throttle + back-pressure + auto-pause** — outbound delivery **throttled per target** (Zapier's inbound-hook rate limit) via the **token-bucket × per-account fair-share** pattern from SMS providers (`texting-1.3.2`); **429 / sustained fail → computed-delay requeue** (backpressure), then **circuit-breaker auto-pause** the subscription after a consecutive-failure threshold — **system default, account-overridable** (`/zapier/config`) — + **notify the account** *(gap #8)* — A
- **zapier-6.4** **GDPR** — on contact-forget, **stop future triggers + purge our subscriptions/state**; **PII already delivered downstream is the account's responsibility** (account = controller; **disclosed at accept-to-enable**, **not** claimed-erased) *(gap #6)* — B
- **zapier-6.5** **Audit** — connect / subscribe / action invocations — B

## zapier-7.0 Infra — A
- **zapier-7.1** **Kafka** (trigger source) · **SQS + DLQ** (delivery) · **DynamoDB** (subscriptions) · **API Gateway** (`/zapier/*`) · **KMS** — A

# Endpoints (first cut)

A first pass, in [`@repo/endpoint`](../../../packages/endpoint/SPECS.md) style — service-prefixed `/zapier/*`.
**Auth:** Zapier calls authenticate **as the account** (OAuth2 / scoped API key); event **delivery** is outbound
(we POST Zapier's registered target URL). **Access column:** **`-`** public · account ladder
**`SENDER`<`USER`<`BILLING`<`ACCOUNT`** · **`Zapier-auth`** = the account's OAuth2 / API key (≤ the user's role).

| Method | URI | Purpose | Access | Req |
|---|---|---|---|---|
| POST | `/zapier/subscribe` | REST-Hook subscribe — `{ event, targetUrl }` (Zap turned on) | Zapier-auth | zapier-1.1 |
| DELETE | `/zapier/subscribe/{id}` | Unsubscribe (Zap turned off) | Zapier-auth | zapier-1.1 |
| GET | `/zapier/triggers` | List available triggers (the catalog) | Zapier-auth | zapier-1.4 |
| GET | `/zapier/triggers/{trigger}/recent` | Polling + test-sample (latest N) | Zapier-auth | zapier-1.5 |
| POST | `/zapier/actions/{action}` | Invoke an action (create contact, send, …) → core API | Zapier-auth | zapier-2.1 |
| GET | `/zapier/searches/{search}` | Run a search (find contact) | Zapier-auth | zapier-3.1 |
| GET | `/zapier/auth/test` | Auth ping (Zapier connection-test) | Zapier-auth | zapier-4.3 |
| GET, PUT | `/zapier/config` | Runtime config — throttle rates · **auto-pause failure threshold (account override of the system default)** | ACCOUNT | zapier-6.3 |
| GET | `/zapier/health` | Liveness / readiness (consumer + delivery) | - | zapier-7.1 |

# eof
