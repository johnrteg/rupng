#
# Blackbaud integration
#

# Objective

Connect an account's **Blackbaud Raiser's Edge NXT** (via the **SKY API**) as a **two-way nonprofit-CRM sync +
trigger source**: keep a RumbleUp [contact](../../core/contact/SPECS.md) in step with a Blackbaud **constituent**,
and turn the fundraising events Blackbaud emits — **a new gift (donation), a constituent created/updated, an event
registration, a membership change** — into **normalized events on the platform bus** that an account's
**[workflow](../../core/workflow/SPECS.md)** acts on. *"A donor made a gift → send a thank-you + tax receipt + start
a stewardship journey."* *"A constituent registered for the gala → send a confirmation + logistics series."* This is
**two-way: constituent sync + gift triggers** — Blackbaud is **both** a mirror (constituent ↔ contact) **and** the
**stimulus** (gift / event), the platform's channels are the **engagement**.

It is also a **first-class conversion source**: a Blackbaud **`gift.created`** is the **goal event**
[analytics](../../core/analytics/SPECS.md) attributes back to the channel touches that earned the donation (the
analytics **conversion contract**, `analytics-6.5` — *"an integration commerce/goal event first… a donation"*). So a
gift both **triggers** a thank-you workflow and **closes the loop** on attribution — the nonprofit analogue of a
[Shopify](../shopify/SPECS.md) order.

Blackbaud is a **nonprofit-flavored [NationBuilder](../nationbuilder/SPECS.md)** — donor + gift centric where
NationBuilder/[NGP VAN](../ngpvan/SPECS.md) are voter/supporter centric. It is **account-connected** (the org
connects *their* Blackbaud environment), so it lives under **[marketplace](../../core/marketplace/SPECS.md)**
governance — **OAuth2** (SKY API), the **Zapier governance pattern** ([zapier](../zapier/SPECS.md): accept-to-enable
· cross-border gate · metering · egress feature-flag × permission). **The account is the controller.** This is
**not a new data plane**: ingest rides the platform **incoming-webhook intake** (verify → SQS); the **connector
runtime** normalizes; triggers ride the **Kafka backbone** into workflow; outbound constituent sync rides the
**connector / sync framework**; engagement rides the **channels behind `canSend()`**; secrets ride the
**marketplace vault**.

# Role & boundaries

**Owns:**
* The **Blackbaud event contract** — which **SKY API webhook / change topics** map to which **normalized events**
  (`blackbaud.gift.created`, `blackbaud.constituent.created`, `blackbaud.event.registered`, …) and the
  **payload → context** shape each carries (gift amount / fund / appeal, constituent ref, event ref).
* **Constituent ↔ contact sync (two-way)** — resolve a Blackbaud constituent to a RumbleUp **`contactId`**
  ([contact](../../core/contact/SPECS.md) lookup), store the constituent id in
  **[`externalRefs`](../../core/contact/src/model/ContactModel.ts)** (`{ blackbaud: { id } }`), and **upsert** in
  both directions with **loop prevention** ([contact](../../core/contact/SPECS.md) `contact-8.5`).
* **Object & field mapping** — the **declarative map** between RumbleUp contact fields and Blackbaud constituent
  fields (+ gift / event / membership context), HubSpot-style (`field / value / type`).
* **Webhook verification + connector normalization** — verify the SKY API webhook signature, dedupe on the
  Blackbaud event id, and **normalize** the vendor payload (the [marketplace](../../core/marketplace/SPECS.md)
  `MarketplaceConnectorJob` pattern).
* **Gift → conversion emission** — emit a gift **both** as a workflow trigger **and** as the
  [analytics](../../core/analytics/SPECS.md) **`converted`** conversion event.
* **Outbound actions** *(secondary)* — typed Blackbaud action nodes (add a constituent note · add to a fund /
  appeal · update a constituent) a workflow `integration-action` invokes.

**Delegates / does NOT do:**

| Concern | Owner |
|---|---|
| **OAuth + credential vault + catalog + cross-border gate + metering** | **[marketplace](../../core/marketplace/SPECS.md)** (Zapier governance pattern) |
| **Webhook intake edge** (HTTPS → SQS) | the platform **incoming-webhook intake** |
| **The trigger graph / what to do next** | **[workflow](../../core/workflow/SPECS.md)** (these events are its **trigger nodes**) |
| **The engagement send** (SMS / email) + **consent / suppression / quiet-hours** | the **channel** + **`canSend()`** ([texting](../../core/texting/SPECS.md)) |
| **Conversion attribution math** | **[analytics](../../core/analytics/SPECS.md)** (a gift = the conversion it credits) |
| **Contact identity + custom fields + suppression + the stable `contactId`** | **[contact](../../core/contact/SPECS.md)** |
| **Pacing / retry / DLQ / fair-share** of inbound + outbound | the shared **connector / dispatch framework** |
| **Gift-receipting / 990 / nonprofit reporting** *(the financial record of truth)* | **the account in Blackbaud** (we trigger a receipt **message**; Blackbaud + the org own the financial record) |

> **No PII reach-down; the account is controller.** Blackbaud is the **account's** system of record for donors +
> gifts. When a contact is forgotten, erasure here = **stop-syncing + stop-acting + disclose**, not
> reach-in-delete (the [egress erasure boundary](../../../docs/SPECS.md)). Donor PII (the constituent's giving history)
> is **the account's**; we sync a **`contactId` + the facts**, never hold the financial record of truth.

# Core concepts

* **Connection (environment)** — an account's connected Blackbaud environment: the OAuth grant (vaulted in
  marketplace), the SKY API subscription, the registered webhook subscriptions, and connection health. Lifecycle is
  the marketplace `enable → connect → active → pause → remove` (+ **auto-pause** on revoke / token-refresh failure).
* **Constituent ↔ contact** — the Blackbaud **constituent** (a donor / supporter) is resolved to a RumbleUp
  **`contactId`** (by normalized email / E.164 phone / constituent id); the constituent id is stored in the
  contact's **`externalRefs.blackbaud`**. The sync is **two-way** (constituent ⇄ contact) with a per-account
  **source-of-truth** config + **loop prevention** ([contact](../../core/contact/SPECS.md) `contact-8.2` / `8.5`).
* **Gift** — a **donation**: amount + currency + **fund** + **appeal** + designation + gift date. A `gift.created`
  is the headline **trigger** (thank-you / receipt) **and** the **conversion event** (value + currency +
  `contactId`).
* **Trigger event** — a Blackbaud webhook / change **normalized** into a platform event (`blackbaud.gift.created`,
  …). These are **dynamic integration trigger events** (marketplace-contributed) — *not* entries in the static core
  [`Events`](../../../packages/endpoint/src/EventTypes.ts) vocabulary — matched by an account's **workflow trigger
  bindings**, exactly like any [marketplace](../../core/marketplace/SPECS.md) integration trigger node.
* **Object & field map** — a **declarative** map: RumbleUp contact field ⇄ Blackbaud constituent field, plus the
  gift / event / membership context fields, with **value translations** (enum) and **types** — the
  [HubSpot](../hubspot/SPECS.md) stance (adding a synced field = a map entry, not code).
* **Action node** *(outbound)* — a typed Blackbaud call a workflow `integration-action` invokes with the account's
  vaulted token (add a constituent note · add to a fund / appeal · update a constituent).

# Architecture & flow

```
 INBOUND TRIGGERS  (the headline)
   Blackbaud SKY API ──webhook (topic + signature)──► incoming-webhook intake (HTTPS)
        • verify signature · dedupe on Blackbaud event id · ACK fast (200)
        └─► SQS ──► blackbaud CONNECTOR (normalize)
                 • map topic → normalized event ; resolve constituent → contactId (+ externalRefs)
                 └─► emit `blackbaud.<event>` on the Kafka backbone
                          ├─► workflow TRIGGER router ── match account bindings → start / signal instances
                          │        └─► engagement: send-text / send-email (thank-you / receipt)  (ALWAYS via canSend())
                          └─► analytics (gift.created → the `converted` conversion contract → attribution)

 TWO-WAY CONSTITUENT SYNC
   contact change ──► outbound upsert → Blackbaud constituent (PATCH by externalRefs.blackbaud.id / POST new)
   constituent change (webhook) ──► inbound upsert → contact   (origin-stamped; NOT echoed back — loop prevention)

 OUTBOUND ACTIONS  (secondary — a workflow node)
   workflow integration-action ──► blackbaud connector ──► SKY API (account's vaulted OAuth token)
        throttled to SKY API rate limits ; retry → DLQ

 AUTH:  per-account Blackbaud SKY API OAuth2 → tokens minted + vaulted via the marketplace broker
```

* **Inbound-first, idempotent.** Blackbaud **retries** webhooks; the connector dedupes on the **Blackbaud event
  id** and every downstream effect is idempotent — a redelivered gift doesn't double-trigger a receipt or
  double-count a conversion. Two-way sync is **origin-stamped** so a change that arrived *from* Blackbaud is **not**
  echoed back ([contact](../../core/contact/SPECS.md) `contact-8.5`).
* **No new engine.** Intake = the shared webhook intake; normalize = the marketplace connector runtime; trigger =
  workflow; send = the channels + `canSend()`; sync upsert = the connector / sync framework; throttle = the shared
  framework. Blackbaud adds a **connector + event/field map**, not infrastructure.

# Trigger catalog — what Blackbaud emits → what we do

The SKY API webhook / change **topics** the connector subscribes to, the **normalized event** each becomes, and
the **engagement** it typically drives. The subscribed set is **config** (add a topic = a map entry). SKY API
delivers some objects by **webhook** and some by **change-list polling** (the
[marketplace](../../core/marketplace/SPECS.md) `marketplace-4.1` poll-and-dedupe path) — both normalize to the same
event.

| Blackbaud topic(s) | Normalized event | Typical engagement |
|---|---|---|
| gift added | **`blackbaud.gift.created`** | **thank-you + tax receipt**; start a stewardship journey; **conversion** (attribution) |
| gift updated / acknowledged | `blackbaud.gift.updated` | acknowledgment / pledge-paid follow-up |
| recurring-gift / pledge | `blackbaud.gift.recurring` | recurring-donor stewardship; lapsed-recurring win-back |
| constituent added | **`blackbaud.constituent.created`** | **welcome** series; consent capture; sync down to contact |
| constituent updated | `blackbaud.constituent.updated` | sync attributes → contact (loop-prevented) |
| event registration | **`blackbaud.event.registered`** | **event confirmation** + logistics / reminder series |
| event attended / checked-in | `blackbaud.event.attended` | post-event thank-you / follow-up ask |
| membership added / lapsed | `blackbaud.membership.changed` | renewal reminders; lapsed-member win-back |

> **Engagement composes in workflow.** Each normalized event is a **trigger node**; the *journey* (wait, branch,
> send, ask, A/B) is authored in [workflow](../../core/workflow/SPECS.md). Blackbaud just says *what happened* + *to
> whom* (`contactId`) + *the facts* (gift amount / fund / appeal, event ref) in the trigger context — **no raw PII
> on the bus** (the [Shopify](../shopify/SPECS.md) / [analytics](../../core/analytics/SPECS.md) discipline).

# Object & field mapping

The constituent-sync surface (the two-way mirror), **declarative** like [HubSpot](../hubspot/SPECS.md):

* **Field map** — `fields-constituent`: RumbleUp contact field ⇄ Blackbaud constituent field (name, emails,
  phones, address, custom). Gift / event / membership context fields map into the **trigger event context**, not
  the contact mirror.
* **Value map** — enum / choice translations (RumbleUp value ⇄ Blackbaud value — e.g. constituent type, gift
  designation).
* **Type map** — Blackbaud field type per field: **string · number · date · array**.
* **Upsert via `externalRefs`** — the Blackbaud constituent id lives in the contact's
  **[`externalRefs.blackbaud`](../../core/contact/src/model/ContactModel.ts)**; outbound sync **PATCHes** by that
  id; absent ⇒ **POST**, then **write the id back**; a stale id (404) clears + re-creates — the
  [HubSpot](../hubspot/SPECS.md) `externalRefs` mechanic, reused.
* **Source-of-truth + loop prevention** — per-account **SoT** config (ours vs Blackbaud, per
  [contact](../../core/contact/SPECS.md) `contact-8.2`); every change is **origin-stamped** so an inbound
  constituent change is **not** echoed back to Blackbaud (`contact-8.5`), guarding sync storms.

> **Why declarative.** Adding a synced field is a **map entry**, not code — the synced surface grows cheaply (the
> [HubSpot](../hubspot/SPECS.md) / [zapier](../zapier/SPECS.md) "sync = config" stance). Gifts + events are
> **trigger context** (one-directional, inbound), not part of the constituent mirror.

# Constituent → contact resolution & consent

* **Resolve → `contactId`.** The connector normalizes the constituent's **email** (lowercased) / **phone** (E.164)
  / Blackbaud constituent id and asks [contact](../../core/contact/SPECS.md) for the `contactId`; the constituent
  id is written to **`externalRefs.blackbaud`**. **Unknown constituent** → **auto-create** (account-config) or an
  opaque **`anonId`** (the [Shopify](../shopify/SPECS.md) / [analytics](../../core/analytics/SPECS.md) rule).
* **Consent mapping — a signal, never a bypass.** Blackbaud's solicit-codes / communication-preferences (e.g.
  "do not email", "do not call") map onto the contact's RumbleUp **consent** as a **signal** — but **`canSend()`
  always governs** the actual send ([contact](../../core/contact/SPECS.md) consent / suppression / STOP /
  quiet-hours / 10DLC). A Blackbaud "OK to solicit" flag never overrides a platform opt-out, and a Blackbaud "do
  not contact" **does** suppress.
* **No raw PII on the bus.** Normalized events carry **`contactId`** + the facts (gift amount / fund / appeal,
  event ref), **not** raw donor email / phone / giving-history — PII stays in [contact](../../core/contact/SPECS.md)
  (the analytics discipline).
* **Forget fan-out.** On GDPR/CCPA forget, the synced constituent values **purge** on the contact and the
  `externalRefs.blackbaud` link clears ([contact](../../core/contact/SPECS.md) `contact-10.3`); we **stop syncing +
  disclose**, never reach into Blackbaud's donor record (egress erasure boundary; the financial / receipting record
  is the account's obligation).

# Conversion & attribution

* A Blackbaud **gift** is the platform's nonprofit **conversion event** (`analytics-6.5`): the connector emits the
  gift as an [analytics](../../core/analytics/SPECS.md) **`converted`** with **value + currency + `contactId`** (+
  fund / appeal as breakdown dimensions), and analytics attributes it to the contact's prior channel touches
  (email → SMS → … → gift) within the lookback window, by the account's chosen attribution model.
* **One event, two consumers** — the same `blackbaud.gift.created` both **triggers** a workflow (thank-you /
  receipt / stewardship) and **feeds** attribution. They don't compete; the connector emits once, both subscribe —
  the nonprofit analogue of a [Shopify](../shopify/SPECS.md) order, and the **goal** an [i360](../i360/SPECS.md)
  modeled audience or a [NationBuilder](../nationbuilder/SPECS.md) / [NGP VAN](../ngpvan/SPECS.md) supporter list
  was targeted to earn.
* **Receipting is the account's record of truth.** We trigger a **receipt / acknowledgment message**; the
  **tax-receipt + 990 + gift-record of truth** lives in **Blackbaud + the org** — we don't file or compute it.

# Auth & governance

* **Per-account OAuth2 (SKY API).** The org authorizes via **Blackbaud SKY API OAuth2**; tokens are **minted +
  vaulted via the [marketplace](../../core/marketplace/SPECS.md) OAuth broker**, auto-refreshed, revocable — the
  [zapier](../zapier/SPECS.md) auth model. The connector holds a **reference**, never the token. SKY API also
  requires a **developer subscription key** (the application's, platform-held), distinct from the per-account OAuth.
* **Least-privilege scopes (v1).** Read the constituents + gifts + events the enabled triggers / sync need; write
  only the v1 action set (constituent note / fund-appeal add / constituent update). Request only what the enabled
  triggers + actions need — the [Shopify](../shopify/SPECS.md) least-privilege stance.
* **Webhook verification.** Every inbound SKY API webhook is **signature-verified** at the intake edge before it's
  trusted; failures dropped + alerted. Dedupe on the **Blackbaud event id**.
* **Marketplace / Zapier governance.** Blackbaud is a **[marketplace](../../core/marketplace/SPECS.md)
  `IntegrationDefinition`** (category **`CRM`**, vertical **nonprofit**) under the **Zapier governance pattern**:
  **accept-to-enable**, **per-account OAuth**, the **`dataJurisdiction` cross-border gate** (a UK/EU org's donor
  data stays in-region — SKY API has regional environments), **metering** (events ingested / syncs / actions), and
  **egress = feature-flag × the connecting user's permission**. The **account is the controller** on both ends.
* **Kill switches** — disable / **dry-run** (log intended triggers + actions + syncs, do nothing) / pause
  (AppConfig + the marketplace lifecycle).

# Reliability

* **Idempotent ingest** — dedupe on the **Blackbaud event id**; downstream effects keyed so a redelivery is a
  no-op (no double-receipt, no double-count). Two-way sync upsert is keyed by `externalRefs.blackbaud` and
  **origin-stamped** (no echo loop).
* **No backfill at launch — new events only.** We act on what Blackbaud emits **after** connect (forward); we do
  **not** replay the gift history. A bounded historical **bulk import** (seed past constituents / gifts) is a
  **deferred future task** of uncertain value to a forward engagement engine; if ever built it's rate-limited +
  **consent-aware** (gap #9) — the [Shopify](../shopify/SPECS.md) `shopify-8.1` stance.
* **Throttle + backpressure** — outbound sync + actions ride the shared **token-bucket × per-account fair-share**
  (SKY API rate limits); 429 / 5xx → **computed-delay requeue** → DLQ → **auto-pause + alert**
  ([monitor](../../core/monitor/SPECS.md)) — reused, not reinvented (the [SMS-provider throttle](../../core/texting/SPECS.md) /
  [zapier](../zapier/SPECS.md) `zapier-6.3` pattern).
* **Webhook re-subscription** — on connect (and a periodic reconcile) ensure the SKY API subscriptions exist;
  re-register if Blackbaud dropped them; fall back to **change-list polling** for objects without webhooks.

# Out of scope

* **Blackbaud's financial / accounting backend** (Financial Edge, gift entry, receipting math, 990) — we
  **consume** gift events + sync constituents; we don't run the org's accounting or file its returns.
* **Storefront / donation-form UI** — Blackbaud (or a donation platform) owns the giving experience; we engage
  **after** the gift event.
* **A full constituent-record mirror of every Blackbaud object** — v1 syncs the **constituent** two-way + treats
  **gifts / events / memberships as trigger context**; a deep mirror of every gift / event object as a contact
  sub-record is a separate, deferred surface.
* **Nonprofit-reporting / compliance filing** — how the org uses gift data for tax / regulatory reporting is **the
  account's concern** (the account is controller).

# AWS Services and Other Dependencies

**AWS services**
* **API Gateway** — the Blackbaud **webhook intake** (signature-verified) + the small `/blackbaud/*` config /
  health surface.
* **SQS** (+ **DLQ**) — webhook ingest buffering + outbound sync / action workers + retry.
* **Kafka (MSK)** — the **normalized trigger events** (to workflow + analytics).
* **EventBridge Scheduler** — **change-list polling** cadence (objects without webhooks) + periodic
  webhook-subscription reconcile + token-refresh.
* **DynamoDB** — connection state · webhook-dedupe ids · sync state (Blackbaud ids live on the contact's
  **`externalRefs`**, not a separate store).
* **Redis (ElastiCache)** — outbound throttle (token-bucket × fair-share) + breaker state.
* **Secrets Manager** (+ **KMS**) — the per-account OAuth tokens + the platform SKY API subscription key (**via
  marketplace**).

**Third-party**
* **Blackbaud SKY API** (Raiser's Edge NXT — constituents / gifts / events / memberships, REST + webhooks) —
  **Blackbaud is a sub-processor** of the account's donor data.

**Internal (`@repo/*`) + services**
* `@repo/services` (Sqs, Kafka, Dynamo, Cache, SecretsManager, Kms), `@repo/endpoint` (`Access`), `@repo/common` (`Type`).
* Composes **[marketplace](../../core/marketplace/SPECS.md)** (OAuth / vault / catalog / governance / connector
  runtime), **[workflow](../../core/workflow/SPECS.md)** (trigger + action nodes), **[contact](../../core/contact/SPECS.md)**
  (resolution / two-way sync / consent / `externalRefs`), **[analytics](../../core/analytics/SPECS.md)** (gift =
  conversion), **[texting](../../core/texting/SPECS.md) + `canSend()`** (engagement), **[monitor](../../core/monitor/SPECS.md)**
  (health / backpressure).

# Compliance & standards mapping

How **this Blackbaud integration's** controls map to **OWASP Top 10 (2021)**, **ISO/IEC 27001:2022** (Annex A),
**SOC 2** (TSC), **GDPR**, **CCPA/CPRA**, and **messaging law**. Blackbaud is an **account-controlled two-way CRM /
trigger** integration over **donor PII + giving history** — its dominant controls are **webhook authenticity**,
**OAuth secret custody**, **consent fidelity** (Blackbaud solicit-codes → `canSend()`), **two-way sync integrity +
loop prevention**, **no-PII-on-the-bus**, and the **egress erasure boundary**. **No PCI** (gift card / payment data
lives in Blackbaud's payment surface, not here); **no PHI**.

**Legend:** ✅ meets/exceeds · ⚠️ partial / open — see Gaps · ➖ n/a

| Blackbaud control | OWASP T10 | ISO 27001:2022 | SOC 2 (TSC) | GDPR | CCPA | Messaging | |
|---|---|---|---|---|---|---|---|
| **Webhook authenticity** — signature-verify every inbound SKY API webhook at the edge; drop + alert on failure | A08 / A01 | A.8.26 / A.5.14 | CC6.1 / CC7.1 | Art 32 | ➖ | ➖ | ✅ |
| **OAuth secret custody** — per-account tokens + SKY API subscription key in the **marketplace vault** (Secrets Manager + KMS); reference-only | A02 / A05 | A.8.24 / A.5.17 | CC6.1 | Art 32 | ➖ | ➖ | ✅ |
| **Consent fidelity** — Blackbaud solicit-codes / preferences map to our consent but **`canSend()` always governs**; a Blackbaud flag never overrides a platform opt-out | A04 | A.5.34 | CC6.1 | Art 6 / 7 | §1798.120 | **TCPA / opt-in** | ✅ |
| **Two-way sync integrity + loop prevention** — upsert keyed by `externalRefs.blackbaud`; origin-stamped; no echo storm | A08 | A.8.24 / A.5.23 | CC7.1 | Art 32 | ➖ | ➖ | ✅ |
| **No PII on the bus** — normalized events carry **`contactId`** + gift / event facts, not raw donor email / phone / giving-history | A09 | A.8.11 | (Privacy) | Art 5(1)(c) | §1798.100 | ➖ | ✅ |
| **Idempotent ingest** — dedupe on the Blackbaud event id; no double-receipt / double-count | A08 | A.8.26 | CC7.1 | ➖ | ➖ | ➖ | ✅ |
| **Egress erasure boundary** — Blackbaud is the account's system; forget = **stop-sync + stop-act + disclose**; the gift / receipting record of truth is the account's | A04 | A.8.10 | (Privacy) | Art 17 | §1798.105 | ➖ | ✅ |
| **Cross-border gate** — a UK/EU org's donor data stays in-region (marketplace `dataJurisdiction`; SKY API regional environments) | A08 | A.5.14 | CC6.7 | Art 44–49 | ➖ | ➖ | ✅ |
| **Donor-PII / nonprofit-reporting boundary** — donor giving-history is the **account's**; tax-receipt / 990 / reporting is the **account's concern** (account is controller) | A04 | A.5.34 | CC9.2 | Art 28 | §1798.140 | ➖ | ⚠️ account-responsible |
| **Outbound throttle + backpressure** — SKY API rate limits → token-bucket × fair-share; 429 → requeue → DLQ → auto-pause + alert | A08 | A.8.26 | CC7.1 | Art 32 | ➖ | ➖ | ✅ |
| **Least-privilege scopes** — request only the SKY API scopes the enabled triggers / sync / actions need | A01 | A.5.15 / A.8.2 | CC6.1 / CC6.3 | Art 25 | ➖ | ➖ | ✅ |
| **Audit** — connect / disconnect / config change + manual resync audited | A09 | A.8.15 | CC7.2 | Art 30 | ➖ | ➖ | ✅ |

> **Design-intent mapping** — how the integration is *intended* to satisfy each control, not an attestation.

# Gaps & decisions

*The one review list.* ✅ = resolved/decided · ⚠️ = **open — needs attention**.

1. ✅ **Archetype — DECIDED: two-way sync + gift triggers.** Constituent ⇄ contact **two-way sync** + **gift /
   event triggers** → workflow (+ analytics conversion). Outbound **action nodes** are secondary; a full mirror of
   every Blackbaud object is out of scope. The nonprofit analogue of [NationBuilder](../nationbuilder/SPECS.md),
   donor-centric.
2. ✅ **Governance — DECIDED: marketplace / Zapier pattern.** Per-account OAuth2 (SKY API), accept-to-enable,
   cross-border gate, metering, egress feature-flag × permission; **account = controller** — same posture as
   [Shopify](../shopify/SPECS.md) / [HubSpot](../hubspot/SPECS.md)'s external flavor.
3. ✅ **Events are dynamic integration triggers — DECIDED.** `blackbaud.*` events are **marketplace-contributed**
   trigger nodes the workflow router matches — **not** entries in the static core `Events` vocabulary.
4. ✅ **Identity — DECIDED: resolve to `contactId`.** Connector resolves constituent (email / E.164 / constituent
   id) → `contactId`; id in **`externalRefs.blackbaud`**; unknown → auto-create (config) or `anonId`. No raw PII on
   the bus.
5. ✅ **Two-way sync — DECIDED: declarative map + `externalRefs` upsert + loop prevention.** Field / value / type
   map (HubSpot-style); upsert by `externalRefs.blackbaud` (PATCH / POST-and-store / 404 re-create); per-account
   SoT + origin-stamp ([contact](../../core/contact/SPECS.md) `contact-8.2` / `8.5`). Gifts / events are **trigger
   context**, not part of the constituent mirror.
6. ✅ **Consent — DECIDED: map but never bypass.** Blackbaud solicit-codes / preferences map onto our consent as a
   **signal**; **`canSend()` always governs** the send (TCPA / STOP / quiet-hours / 10DLC).
7. ✅ **Conversion — DECIDED.** A gift = the analytics **`converted`** event (value + currency + `contactId` + fund
   / appeal dimensions), `analytics-6.5`; one emit, two consumers (workflow + analytics) — the nonprofit
   [Shopify](../shopify/SPECS.md)-order analogue.
8. ✅ **Auth — DECIDED.** Per-account **SKY API OAuth2** (vaulted via marketplace) + the platform **subscription
   key**; webhook **signature-verified**; SKY API objects via **webhook or change-list polling**
   (`marketplace-4.1`).
9. ✅ **Backfill — DECIDED: none at launch; new events only.** Forward engagement engine — we react to gifts /
   constituent changes emitted *after* connect. Historical bulk import (seed past gifts / constituents) is a
   **deferred future task** of uncertain relevance; if built: bounded · rate-limited · **consent-aware**
   (`blackbaud-9.1`) — the [Shopify](../shopify/SPECS.md) `shopify-8.1` stance.
10. ⚠️ **SKY API scope / capability surface — OPEN.** The exact SKY API objects + scopes + which arrive by
    **webhook vs change-list polling** (gifts vs constituents vs events vs memberships), the regional-environment
    `dataJurisdiction` mapping, and the v1 outbound action set are **provisional** — to be pinned against the live
    SKY API capability set on build. The donor-PII / nonprofit-reporting boundary (financial record of truth stays
    in Blackbaud + the org) is the **account's** controller obligation, disclosed at accept-to-enable.

# Requirements (traceable register)

The traceable register for the **Blackbaud integration** (IDs **`blackbaud-N.M`**). **Priority:** **A** = MVP,
**B** = core / hardening, **C** = later. **Boundary:** Blackbaud owns the **event contract + connector normalize +
constituent two-way sync + object/field map + gift→conversion emission + outbound actions**; OAuth / vault /
governance = [marketplace](../../core/marketplace/SPECS.md), triggers / automation = [workflow](../../core/workflow/SPECS.md),
sends + consent = channels / `canSend()`, attribution = [analytics](../../core/analytics/SPECS.md), identity +
custom fields = [contact](../../core/contact/SPECS.md).

## blackbaud-1.0 Connection & auth — A
- **blackbaud-1.1** **Per-account OAuth2 (SKY API)** — tokens minted + **vaulted via marketplace**; connector holds a reference, never the token; + the platform **subscription key** *(gap #8)* — A
- **blackbaud-1.2** **Lifecycle** — `enable → connect → active → pause → remove`; **auto-pause** on revoke / refresh-failure; **least-privilege scopes** (only what the enabled triggers / sync / actions need) — A
- **blackbaud-1.3** **Webhook + change-list subscription management** — register configured topics on connect + **periodic reconcile**; **change-list polling** fallback for objects without webhooks (`marketplace-4.1`) — A

## blackbaud-2.0 Inbound webhooks & normalization — A
- **blackbaud-2.1** **Signature verification** at the intake edge; drop + alert on failure — A
- **blackbaud-2.2** **Idempotent ingest** — dedupe on the **Blackbaud event id**; ACK-fast (200) → SQS → connector — A
- **blackbaud-2.3** **Normalize topic → event** — map each subscribed topic to a **`blackbaud.<event>`** with a payload→context shape; subscribed set is **config** — A
- **blackbaud-2.4** **No raw PII on the bus** — events carry **`contactId`** + gift / event facts, never raw donor email / phone / giving-history — A

## blackbaud-3.0 Trigger catalog — A
- **blackbaud-3.1** **Gifts** — `gift.created` / `gift.updated` / `gift.recurring` — A
- **blackbaud-3.2** **Constituents** — `constituent.created` / `constituent.updated` (also drive sync-down) — A
- **blackbaud-3.3** **Events** — `event.registered` / `event.attended` — B
- **blackbaud-3.4** **Memberships** — `membership.changed` (added / lapsed) — B
- **blackbaud-3.5** **Triggers are dynamic** marketplace nodes matched by **workflow** bindings (not the static `Events` catalog) *(gap #3)* — A

## blackbaud-4.0 Constituent two-way sync & mapping — A
- **blackbaud-4.1** **Resolve constituent → `contactId`** (normalized email / E.164 / constituent id) via [contact](../../core/contact/SPECS.md); store id in **`externalRefs.blackbaud`** *(gap #4)* — A
- **blackbaud-4.2** **Unknown constituent** → **auto-create** (account-config) or opaque **`anonId`** — B
- **blackbaud-4.3** **Declarative object / field map** — field / value / type map (contact ⇄ constituent); adding a synced field = a map entry *(gap #5)* — A
- **blackbaud-4.4** **Upsert via `externalRefs`** — PATCH by `externalRefs.blackbaud`; absent ⇒ POST + write id back; 404 ⇒ clear + re-create — A
- **blackbaud-4.5** **Source-of-truth + loop prevention** — per-account SoT config; **origin-stamp** every change; inbound is **not** echoed back ([contact](../../core/contact/SPECS.md) `contact-8.2` / `8.5`) — A

## blackbaud-5.0 Consent & privacy — A
- **blackbaud-5.1** **Consent mapping** — Blackbaud solicit-codes / preferences → our consent **as a signal**; **`canSend()` always governs** the send *(gap #6)* — A
- **blackbaud-5.2** **Forget** — synced constituent values **purge on forget**; clear `externalRefs.blackbaud`; **stop-sync + disclose**, never reach into Blackbaud's donor record (egress erasure boundary) — A
- **blackbaud-5.3** **Donor-PII / nonprofit-reporting boundary** — giving-history + receipting / 990 record of truth is the **account's** (account is controller); disclosed at accept-to-enable *(gap #10)* — B

## blackbaud-6.0 Conversion & attribution — A
- **blackbaud-6.1** **Gift → analytics `converted`** (value + currency + `contactId` + fund / appeal dimensions), the `analytics-6.5` conversion contract; one emit feeds **both** workflow + analytics *(gap #7)* — A

## blackbaud-7.0 Outbound actions (secondary) — B
- **blackbaud-7.1** **Action nodes (v1)** via workflow `integration-action` — **add constituent note · add to a fund / appeal · update a constituent** — executed with the vaulted token; least-privilege write scopes *(gap #10)* — B
- **blackbaud-7.2** **Throttle** — SKY API rate limits → token-bucket × fair-share + backpressure requeue → DLQ → auto-pause + alert — B

## blackbaud-8.0 Governance & reliability — A
- **blackbaud-8.1** **Marketplace / Zapier governance** — accept-to-enable · **`dataJurisdiction` cross-border gate** (regional SKY API environments) · metering · egress feature-flag × permission; **account = controller** *(gap #2)* — A
- **blackbaud-8.2** **Kill switches** — disable / **dry-run** (log intent, do nothing) / pause (AppConfig) — A
- **blackbaud-8.3** **Backpressure + retry + DLQ + auto-pause** on ingest + outbound; **idempotent** throughout (dedupe + `externalRefs`-keyed + origin-stamped) — A
- **blackbaud-8.4** **No backfill at launch — new events only** (forward engagement engine). Historical bulk import is a **deferred future task** of uncertain relevance; if built: bounded · rate-limited · **consent-aware** *(gap #9)* — C
- **blackbaud-8.5** **Audit** — connect / disconnect / config change / manual resync — B

## blackbaud-9.0 Infra — A
- **blackbaud-9.1** **API Gateway** (webhook intake + `/blackbaud/*`) · **SQS + DLQ** · **Kafka** (normalized events) · **EventBridge Scheduler** (change-list poll + reconcile + token-refresh) · **DynamoDB** (connection / dedupe / sync state) · **Redis** (throttle) · **Secrets Manager + KMS** (via marketplace) — A

# Endpoints (first cut)

A first pass, in [`@repo/endpoint`](../../../packages/endpoint/SPECS.md) style — service-prefixed `/blackbaud/*`.
**Ingest is webhook- (+ poll-) driven** and **automation is workflow** — so the HTTP surface is **OAuth callback +
webhooks + config/health + operator resync**, no per-record public API. **Access column:** **`-`** public/system ·
**`State`** = OAuth state-validated callback · **`Provider-sig`** = signature-verified Blackbaud webhook · account
ladder `USER`<`ACCOUNT` · **`Internal`** = VPC-only S2S.

| Method | URI | Purpose | Access | Req |
|---|---|---|---|---|
| GET | `/blackbaud/oauth/install` | Begin SKY API OAuth (redirect to Blackbaud) | ACCOUNT | blackbaud-1.1 |
| GET | `/blackbaud/oauth/callback` | OAuth callback — exchange, **vault** token, register webhooks (state-validated) | State | blackbaud-1.1/1.3 |
| POST | `/blackbaud/webhook/{topic}` | Blackbaud webhook ingress — **signature-verify** → dedupe → ACK → SQS | Provider-sig | blackbaud-2.1/2.2 |
| GET, PUT | `/blackbaud/connections/{id}/config` | Connection config — subscribed topics · field map · SoT · auto-create · dry-run | ACCOUNT | blackbaud-2.3/4.3 |
| POST | `/blackbaud/connections/{id}/resync` | Operator/account resync — **re-register webhooks** + re-sync a constituent (no historical backfill at launch) | ACCOUNT | blackbaud-1.3/4.4 |
| GET | `/blackbaud/connections/{id}/status` | Connection health — subscriptions · poll cadence · queue depth · backpressure · last event | USER | blackbaud-8.3 |
| GET | `/blackbaud/health` | Liveness / readiness (intake + connector) | - | blackbaud-9.1 |

# eof
