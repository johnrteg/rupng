#
# NationBuilder integration
#

# Objective

Connect an account's **NationBuilder** (the community / campaign **CRM** for political committees,
nonprofits, and advocacy orgs) as a **two-way** integration: **inbound triggers** turn NationBuilder
activity — a new **person**, a **donation**, an **event RSVP**, a **membership** start, a **path step**, a
**tag applied** — into **normalized events on the platform bus** an account's
[workflow](../../core/workflow/SPECS.md) acts on (*"someone RSVP'd to a town hall → send the details + a
reminder the night before"*, *"a donation landed → fire a thank-you"*, *"a tag was applied → start a
volunteer-recruitment sequence"*); and **outbound sync** pushes/upserts RumbleUp contacts ↔ the
NationBuilder **person** record and writes back engagement (texted, replied, opted-out), **tags**, and
**path / list** membership.

This is a **hybrid** of the two integration archetypes: the **inbound trigger** side mirrors
[Shopify](../shopify/SPECS.md) (verify → normalize → bus → workflow + analytics), and the **outbound
sync** side mirrors [HubSpot](../hubspot/SPECS.md) (object mapping · upsert via `externalRefs` id
write-back · declarative field maps · batch sync). A NationBuilder **donation** is also a **first-class
conversion source**: it feeds the [analytics](../../core/analytics/SPECS.md) **conversion contract**
(`analytics-6.5`) — value + `contactId` — so the same donation both **triggers** a workflow and **closes
the loop** on attribution. NationBuilder is the **community-CRM sibling** of the voter CRM
[NGP VAN](../ngpvan/SPECS.md) and the donation connectors [ActBlue](../actblue/SPECS.md) /
[WinRed](../winred/SPECS.md).

**Account-connected** (a committee/org connects *their* NationBuilder nation), so it lives under
[marketplace](../../core/marketplace/SPECS.md) governance — the **Zapier governance pattern**
([zapier](../zapier/SPECS.md): accept-to-enable · `dataJurisdiction` cross-border gate · metering ·
egress feature-flag × permission). **The account is the controller.** **Auth:** NationBuilder uses
**OAuth2** (a per-nation grant minted + vaulted via the marketplace OAuth broker), and supports
**webhooks** for new person / donation / RSVP.

This is **not a new data plane**: ingest rides the platform **incoming-webhook intake** (verify → SQS);
the **connector runtime** normalizes; triggers ride the **Kafka backbone** into workflow; engagement
rides the **channels behind `canSend()`**; outbound upserts ride the **sync-worker framework** (throttle ·
retry · DLQ); secrets ride the **marketplace vault**.

# Role & boundaries

**Owns:**
* The **NationBuilder event contract** — which webhook topics / signals (new person · donation · RSVP ·
  membership · path step · tag applied) map to which **normalized events**, and the **payload → context**
  shape each carries (amount, event/RSVP, path/step, tag, contactId).
* **Webhook verification + connector normalization** — verify the NationBuilder webhook
  (signature/shared-secret), dedupe on the NationBuilder event id, and **normalize** the payload into a
  platform event (the [marketplace](../../core/marketplace/SPECS.md) `MarketplaceConnectorJob` pattern).
* The **NationBuilder sync contract (outbound)** — which **RumbleUp entities** map to which
  **NationBuilder objects** (a RumbleUp **contact ↔ a NationBuilder person**) and the **field / value /
  type mapping** between them.
* **Upsert mechanics (outbound)** — create-or-update a NationBuilder person by the stored NationBuilder id
  (via [`externalRefs`](../../core/contact/src/model/ContactModel.ts), the same id-mapping pattern), incl.
  conflict / stale-id recovery; write engagement, **tags**, and **path / list** membership back.
* **Person → contact resolution + consent mapping** — resolve a NationBuilder person to a RumbleUp
  `contactId` ([contact](../../core/contact/SPECS.md) lookup), store the NationBuilder id in
  `externalRefs`, and map NationBuilder's email/SMS opt-in onto our consent **as a signal** (`canSend()`
  always governs).

**Delegates / does NOT do:**

| Concern | Owner |
|---|---|
| **OAuth + credential vault + catalog + cross-border gate + metering** | **[marketplace](../../core/marketplace/SPECS.md)** (Zapier governance pattern) |
| **Webhook intake edge** (HTTPS endpoint → SQS) | the platform **incoming-webhook intake** |
| **The trigger graph / what to do next** | **[workflow](../../core/workflow/SPECS.md)** (these events are its **trigger nodes**) |
| **The engagement send** (SMS / email) + **consent / suppression / quiet-hours** | the **channel** + **`canSend()`** ([texting](../../core/texting/SPECS.md)) |
| **Conversion attribution math** | **[analytics](../../core/analytics/SPECS.md)** (a NationBuilder donation = the conversion event it credits) |
| **Contact identity + suppression + the stable `contactId`** | **[contact](../../core/contact/SPECS.md)** |
| **Outbound delivery + retry / DLQ + throttle** (inbound + outbound) | the shared **connector / sync-worker framework** |
| **FEC / campaign-finance reporting** | the **committee / org** (in NationBuilder / their compliance vendor) — **not us** |

> **No PII reach-down; the account is controller.** NationBuilder is the **account's** system holding
> **supporter / donor PII** (sensitive). When a contact is forgotten, erasure here = **stop-syncing +
> stop-acting + disclose**, not reach-in-delete (the [egress erasure boundary](../../../docs/SPECS.md)) — the
> org is the controller of its nation.

# Core concepts

* **Connection (installation)** — an account's connected NationBuilder nation: the OAuth grant (vaulted in
  marketplace), the nation slug, the registered webhook subscriptions, the configured trigger set, and
  connection health. Lifecycle is the marketplace `enable → connect → active → pause → remove` (+
  **auto-pause** on account inactive or revoked grant).
* **Trigger event** — a NationBuilder webhook **normalized** into a platform event
  (`nationbuilder.donation.created`, `nationbuilder.rsvp.created`, …). These are **dynamic integration
  trigger events** (marketplace-contributed) — *not* entries in the static core
  [`Events`](../../../packages/endpoint/src/EventTypes.ts) vocabulary — matched by an account's **workflow
  trigger bindings**, exactly like any [marketplace](../../core/marketplace/SPECS.md) integration trigger
  node.
* **Object mapping (outbound)** — a RumbleUp entity → a NationBuilder object: a RumbleUp **contact** ↔ a
  NationBuilder **person** (a "signup"). Activity (texted / replied / opted-out), **tags**, and
  **path / list** membership are pushed onto the matched person.
* **Upsert via id write-back** — the NationBuilder person id (`nbId`) is stored back on the RumbleUp
  contact's [`externalRefs`](../../core/contact/src/model/ContactModel.ts) (`{ nationbuilder: { nbId,
  nation } }`); next sync **PATCHes** by that id instead of re-matching. First sync uses NationBuilder's
  **push/match person** (by email / phone); a **conflict** adopts the existing id; a **stale/deleted** id
  is cleared and re-matched.
* **Field / value / type map** — **declarative** config: RumbleUp field → NationBuilder person field, with
  **value translations** (enum mapping) and **types**. Adding a synced field = a **map entry**, not code
  (the [zapier](../zapier/SPECS.md) "outbound = config" stance).
* **Tag / path** — NationBuilder's tag (a label) and **path** (a multi-step pipeline, e.g. a
  volunteer-onboarding path). Inbound: an applied tag / advanced path step is a **trigger**. Outbound:
  RumbleUp can **apply a tag** / **advance a path step** on a person as a workflow action.
* **Conversion** — a NationBuilder **donation** is emitted **both** as a workflow trigger **and** as the
  analytics **`converted`** event (amount + `contactId`) for multi-touch attribution.
* **Batch sync** — a bounded **bulk import/export** on connect: seed contacts from a NationBuilder **list /
  tag** (import) and/or push the account's RumbleUp contacts to the nation (export), batched to respect
  NationBuilder's rate limits — opt-in + consent-aware.

# Architecture & flow

```
 INBOUND TRIGGERS  (the engagement side — Shopify-style)
   NationBuilder ──webhook (signed)──► incoming-webhook intake (HTTPS)
        • verify signature/secret · dedupe on NB event id · ACK fast (200)
        └─► SQS ──► nationbuilder CONNECTOR (normalize)
                 • map topic → normalized event ; resolve person → contactId (+ externalRefs) ; map consent
                 └─► emit `nationbuilder.<event>` on the Kafka backbone
                          ├─► workflow TRIGGER router ── match account bindings → start / signal instances
                          │        └─► engagement: event reminder · volunteer recruit · donor thank-you · GOTV  (ALWAYS via canSend())
                          └─► analytics (donation → the `converted` conversion contract → attribution)

 OUTBOUND SYNC  (the CRM-mirror side — HubSpot-style)
   contact.* change / workflow integration-action ──► nationbuilder SYNC consumer
        └─► map (field/value/type) → NB person ; resolve externalRefs.nationbuilder.nbId
                 └─► sync-worker framework (THROTTLE × fair-share · retry · DLQ)
                          └─► upsert NB person  (push/match-create / PATCH by nbId)
                               201 → write nbId back to externalRefs       409 → adopt existing id
                               + apply tag · advance path step · list add   404 → clear stale id, re-match
                          push engagement back (texted / replied / opted-out)

 BATCH SYNC  (bounded, on connect — opt-in)
   import a NB list/tag → contacts   ·   export RumbleUp contacts → NB persons   (batched, consent-aware)

 AUTH:  per-nation NationBuilder OAuth2 → tokens minted + vaulted via the marketplace broker
```

* **Two-way, idempotent.** Inbound is deduped on the NationBuilder event id; every downstream effect is
  idempotent. Outbound upsert is **keyed by the stored `nbId`**, so a redelivered webhook re-upserts the
  same person — no duplicates, no double-trigger, no double-count.
* **No new engine.** Intake = the shared webhook intake; normalize = the marketplace connector runtime;
  trigger = workflow; send = the channels + `canSend()`; upsert = the sync-worker framework; throttle =
  the shared token-bucket × fair-share. NationBuilder adds a **connector + event/field maps**, not
  infrastructure.

# Trigger catalog (inbound)

The NationBuilder webhook topics the connector subscribes to, the **normalized event** each becomes, and
the **engagement** it typically drives. The subscribed set is **config** (add a topic = a map entry).

| NationBuilder topic / signal | Normalized event | Typical engagement |
|---|---|---|
| person created | **`nationbuilder.person.created`** | welcome / volunteer-recruitment series; consent capture |
| person updated (contact methods, opt-in) | `nationbuilder.person.updated` | sync attributes + **opt-out** state |
| **donation created** | **`nationbuilder.donation.created`** | **donor thank-you**; receipt; **conversion** (attribution) |
| donation refunded / failed | `nationbuilder.donation.updated` | refund acknowledgment; recovery |
| **event RSVP / signup** | **`nationbuilder.rsvp.created`** | RSVP confirmation; **event reminder** (night-before); GOTV |
| RSVP updated (cancelled / attended) | `nationbuilder.rsvp.updated` | re-confirm; thank-attendees; no-show win-back |
| **membership started / renewed / expiring** | **`nationbuilder.membership.changed`** | renewal nudge; lapsed-member win-back |
| **tag applied** | **`nationbuilder.tag.applied`** | start a **segment-driven** sequence (volunteer / issue / GOTV) |
| **path step advanced** | **`nationbuilder.path.advanced`** | step-specific outreach (onboarding, stewardship) |
| list membership change *(later)* | `nationbuilder.list.changed` | segment-driven outreach |

> **Engagement composes in workflow.** Each normalized event is a **trigger node**; the *journey* (wait,
> branch, send, A/B) is authored in [workflow](../../core/workflow/SPECS.md). NationBuilder just says *what
> happened* + *to whom* (`contactId`) + *the facts* (amount, RSVP, path step, tag) in the trigger context.

# Object & field mapping (outbound sync)

The CRM-mirror side, modeled on [HubSpot](../hubspot/SPECS.md)'s declarative sync:

* **Object mapping** — a RumbleUp **contact** ↔ a **NationBuilder person**. NationBuilder is
  person-centric; there is no account/company analogue.
* **Declarative maps** (config, not code):
  * **field map** — RumbleUp field → NationBuilder person field (name, emails, phones, address — NB's
    contact-method shapes).
  * **value map** — enum / choice translations (e.g. RumbleUp consent state → NB email/SMS opt-in).
  * **type map** — NationBuilder field type per field: **string · number · array**.
* **Activity write-back** — on send/reply/opt-out, the connector applies a NationBuilder **tag** and/or
  writes a note (config-mapped) so the org sees engagement in their nation.
* **Tag / path / list membership** — RumbleUp segment membership maps to a NationBuilder **list / tag**;
  a workflow action can **advance a path step** (add-only / forward by default; never destructive without
  explicit config).
* **Why declarative.** Reshaping/forwarding a record that already exists is a **mapping**, so the synced
  surface grows cheaply — adding a synced field is a **map entry**, not code.

## Upsert & id mapping (outbound)

* **Id home = `externalRefs`.** The NationBuilder person id lives in the contact's
  [`externalRefs`](../../core/contact/src/model/ContactModel.ts) under a `nationbuilder` key
  (`{ nationbuilder: { nbId, nation } }`) — the **same id-mapping mechanism** as every external system.
  **No dedicated `nb_id` column.**
* **Create-or-update** — id present ⇒ **PATCH** by `nbId`; absent ⇒ NationBuilder's **push/match person**
  (by email / phone), then **write the returned `nbId` back** so the next sync updates in place.
* **Conflict / stale recovery** — a **409** (NationBuilder already has the person) ⇒ **adopt** the existing
  id; a **404** (our stored id is stale / deleted) ⇒ **clear it** and re-match. Nation-keyed so a person
  can carry ids across nations without collision.

# Person → contact resolution & consent

* **Resolve → `contactId`.** The connector normalizes the NationBuilder person's **email** (lowercased) /
  **phone** (E.164) and asks [contact](../../core/contact/SPECS.md) for the `contactId`; the NationBuilder
  id is written to the contact's `externalRefs.nationbuilder`. Unknown person → **auto-create**
  (account-config) or an opaque **`anonId`** (same rule as analytics identity resolution).
* **Consent mapping — NationBuilder state → RumbleUp consent.** NationBuilder's email / mobile / call
  opt-in flags map onto the contact's consent record. **Crucially: a signal, not a bypass** — every
  triggered send still runs **`canSend()`** (consent · suppression · STOP · quiet-hours · 10DLC / TCPA),
  so a NationBuilder opt-in flag never overrides a platform opt-out.
* **No raw PII on the bus.** The normalized event carries **`contactId`** + facts (amount, RSVP, path
  step, tag), **not** raw email/phone/address — PII stays in contact (same discipline as analytics
  events).

# Conversion & attribution (donations)

* A NationBuilder **donation** is the platform's conversion event (`analytics-6.5`): the connector emits
  it as an [analytics](../../core/analytics/SPECS.md) **`converted`** with **amount + `contactId`**, and
  analytics attributes it to the contact's prior channel touches (email → SMS → … → donation) within the
  lookback window, by the account's chosen attribution model — the same contract
  [ActBlue](../actblue/SPECS.md) / [WinRed](../winred/SPECS.md) / [NGP VAN](../ngpvan/SPECS.md) /
  [Shopify](../shopify/SPECS.md) feed.
* **One event, two consumers** — the same `nationbuilder.donation.created` both **triggers** a workflow
  (donor thank-you / receipt) and **feeds** attribution. The connector emits once, both subscribe.
* **Not FEC reporting.** We surface the donation as an **engagement/conversion** signal;
  **FEC / campaign-finance disclosure** (itemization, limits, filing) is the **org's** obligation in
  NationBuilder / their compliance vendor — explicitly **out of scope** here.

# Auth & governance

* **Per-nation OAuth2.** The org authorizes via **NationBuilder OAuth**; tokens are **minted + vaulted via
  the [marketplace](../../core/marketplace/SPECS.md) OAuth broker**, auto-refreshed, revocable — exactly
  the [zapier](../zapier/SPECS.md) auth model. The connector holds a **reference**, never the token.
  (This contrasts [NGP VAN](../ngpvan/SPECS.md), which uses an **API key**, not OAuth.)
* **Least-privilege scopes.** Request only the scopes the enabled triggers + sync need — reads for the
  triggers (people / donations / events / memberships / tags / paths), writes for the action set (tag,
  advance path, list add, push person).
* **Webhook verification.** Every inbound webhook is **signature/secret-verified** at the intake edge
  before it's trusted; failures are dropped + alerted. **Dedupe on the NationBuilder event id.**
  Re-subscribe the configured topics on connect + a **periodic reconcile** (re-register if dropped).
* **Marketplace / Zapier governance.** NationBuilder is a [marketplace](../../core/marketplace/SPECS.md)
  `IntegrationDefinition` under the **Zapier governance pattern** ([zapier](../zapier/SPECS.md)):
  **accept-to-enable**, the **`dataJurisdiction` cross-border gate** (supporter-data residency / an EU
  nation stays in-region), **metering**, and **egress = feature-flag × the connecting user's permission**.
  The **account is the controller**.
* **Kill switches** — disable / **dry-run** (log intended triggers + upserts, do nothing) / pause the
  connection (AppConfig + the marketplace lifecycle).

# Reliability (idempotency, throttle, batch)

* **Idempotent both ways** — inbound deduped on the NationBuilder event id; outbound upsert **keyed by the
  stored `nbId`** (or a deterministic match), so redelivery re-upserts the same person — no double-trigger,
  no double-count, no duplicate person.
* **Throttle like an SMS provider.** NationBuilder enforces **API rate limits**; both inbound (any
  reconcile poll) and outbound upserts ride the shared **token-bucket throttle × per-account fair-share**
  (no one account starves the queue) — the **same pattern** as the
  [SMS-provider throttle](../../core/texting/SPECS.md) and [zapier](../zapier/SPECS.md). **Reused, not
  reinvented.**
* **Backpressure + retry.** 429 / 5xx ⇒ **computed-delay requeue** (backpressure, not hammer) → retry →
  **DLQ** after threshold; a sustained-failure connection **auto-pauses** + **alerts**
  ([monitor](../../core/monitor/SPECS.md)).
* **Batch sync — bounded + opt-in.** A connect-time **bulk import** (seed from a NationBuilder list / tag)
  and/or **export** (push RumbleUp contacts to the nation) is **rate-limited + consent-aware**, with a
  `{ timestamp, batch_size, batch_number, items[] }` envelope and `batch_number` for resumability — not an
  unbounded full-nation slurp.
* **Webhook re-subscription** — on connect (and a periodic reconcile) ensure the topic subscriptions
  exist; re-register if NationBuilder dropped them.

# Out of scope

* **FEC / campaign-finance reporting** — itemization, contribution limits, disclosure filing are the
  **org's** obligation (in NationBuilder / a compliance vendor); we never compute or file them.
* **NationBuilder website / page builder / CMS** — NationBuilder owns the supporter-facing site; we engage
  **after** the event, we don't run the nation's website or donation pages.
* **Full membership / dues billing** — we ingest **membership change** signals; we don't run the org's
  billing.
* **Two-way live continuous mirror beyond the mapped fields** — the sync is **contact ↔ person** + tags /
  paths / lists + activity write-back, not a deep replication of every NationBuilder object.
* **Backfill beyond the bounded connect-time import** — we are a **forward** engagement engine; a larger
  historical replay is a deferred, consent-aware task.

# AWS Services and Other Dependencies

**AWS services**
* **API Gateway** — the NationBuilder **webhook intake** (verified) + the small `/nationbuilder/*` config /
  health surface.
* **SQS** (+ **DLQ**) — webhook ingest buffering + outbound upsert / action workers + retry.
* **Kafka (MSK)** — the **normalized trigger events** (to workflow + analytics) + the `contact.*` consumer
  that drives outbound sync.
* **EventBridge Scheduler** — periodic webhook-subscription reconcile + the batch-sync schedule.
* **DynamoDB** — connection state · webhook-dedupe ids · sync/idempotency state (NationBuilder ids live on
  the contact's **`externalRefs`**, not a separate store).
* **Redis (ElastiCache)** — throttle (token-bucket × fair-share) + circuit-breaker state.
* **Secrets Manager** (+ **KMS**) — the per-nation OAuth tokens (**via marketplace**).

**Third-party**
* **NationBuilder API + Webhooks** (people · donations · events + RSVPs · memberships · paths · tags ·
  lists) — **NationBuilder is a sub-processor** of the account's supporter/donor data.

**Internal (`@repo/*`) + services**
* `@repo/services` (Sqs, Kafka, Dynamo, Cache, SecretsManager, Kms), `@repo/endpoint` (`Access`),
  `@repo/common` (`Type`).
* Composes **marketplace** (OAuth / vault / catalog / governance / connector runtime), **workflow**
  (trigger + action nodes), **contact** (resolution / consent / `externalRefs`), **analytics**
  (conversion), **texting + `canSend()`** (engagement), **monitor** (health / backpressure). Sibling of
  [ngpvan](../ngpvan/SPECS.md) · [actblue](../actblue/SPECS.md) · [winred](../winred/SPECS.md); shares the
  sync engine with [hubspot](../hubspot/SPECS.md) and the trigger pattern with [shopify](../shopify/SPECS.md).

# Compliance & standards mapping

How **this NationBuilder integration's** controls map to **OWASP Top 10 (2021)**, **ISO/IEC 27001:2022**
(Annex A), **SOC 2** (TSC), **GDPR**, **CCPA/CPRA**, and **messaging law**. NationBuilder is an
**account-controlled two-way integration** over **sensitive supporter / donor PII** — its dominant
controls are **webhook authenticity**, **OAuth secret custody**, **consent fidelity** (NationBuilder state
→ `canSend()`), **no-PII-on-the-bus**, the **egress erasure boundary**, and **data residency /
jurisdiction**. **FEC / campaign-finance reporting is the org's** (➖ here). **No PCI** (we never touch
card data — donations are recorded in NationBuilder); **no PHI**.

**Legend:** ✅ meets/exceeds · ⚠️ partial / open — see Gaps · ➖ n/a

| NationBuilder control | OWASP T10 | ISO 27001:2022 | SOC 2 (TSC) | GDPR | CCPA | Messaging | |
|---|---|---|---|---|---|---|---|
| **Webhook authenticity** — verify signature/secret every inbound at the edge; drop + alert on failure | A08 / A01 | A.8.26 / A.5.14 | CC6.1 / CC7.1 | Art 32 | ➖ | ➖ | ✅ |
| **OAuth secret custody** — per-nation tokens in the **marketplace vault** (Secrets Manager + KMS); auto-refresh; revocable; reference-only | A02 / A05 | A.8.24 / A.5.17 | CC6.1 | Art 32 | ➖ | ➖ | ✅ |
| **Consent fidelity** — NationBuilder opt-in maps to our consent but **`canSend()` always governs**; an NB flag never overrides a platform opt-out | A04 | A.5.34 | CC6.1 | Art 6 / 7 | §1798.120 | **TCPA / opt-in** | ✅ |
| **No PII on the bus** — events carry **`contactId`** + facts (amount / RSVP / path / tag), not raw email/phone/address | A09 | A.8.11 | (Privacy) | Art 5(1)(c) | §1798.100 | ➖ | ✅ |
| **Idempotent two-way** — inbound dedupe on NB event id; outbound upsert keyed by `nbId`; no double-trigger / double-count / duplicate person | A08 | A.8.26 | CC7.1 | ➖ | ➖ | ➖ | ✅ |
| **Egress erasure boundary** — NationBuilder is the account's system; forget = **stop-sync + stop-act + disclose**, not reach-in-delete (org is controller of its nation) | A04 | A.8.10 | (Privacy) | Art 17 | §1798.105 | ➖ | ✅ |
| **Data residency / jurisdiction** — supporter-data residency honored via the marketplace `dataJurisdiction` cross-border gate (an EU nation stays in-region) | A08 | A.5.14 | CC6.7 | Art 44–49 | ➖ | ➖ | ✅ |
| **Sensitive donor / supporter data** — donation + membership treated as sensitive; never in logs | A01 / A04 | A.8.10 / A.5.12 | CC6.1 | Art 5(1)(f) | §1798.140 (sensitive) | ➖ | ✅ |
| **FEC / campaign-finance reporting** — the **org's** obligation in NationBuilder / a compliance vendor; we never compute or file disclosure | ➖ | A.5.31 | ➖ | ➖ | ➖ | ➖ | ➖ org-owned |
| **Outbound throttle + backpressure** — NationBuilder rate limit → token-bucket × fair-share; 429 → requeue → DLQ → auto-pause + alert | A08 | A.8.26 | CC7.1 | Art 32 | ➖ | ➖ | ✅ |
| **Least-privilege scopes** — request only the OAuth scopes the trigger/action/sync set needs | A01 | A.5.15 / A.8.2 | CC6.1 / CC6.3 | Art 25 | ➖ | ➖ | ✅ |
| **Audit** — connect / disconnect / config change + manual resync audited | A09 | A.8.15 | CC7.2 | Art 30 | ➖ | ➖ | ✅ |

> **Design-intent mapping** — how the integration is *intended* to satisfy each control, not an attestation.

# Gaps & decisions

*The one review list.* ✅ = resolved/decided · ⚠️ = **open — needs attention**.

1. ✅ **Archetype — DECIDED: two-way.** **Inbound triggers** (new person · donation · RSVP · membership ·
   path step · tag) → workflow + analytics conversion (Shopify-style), **and** **outbound sync** (contact
   ↔ NB person upsert · activity / tag / path / list write-back) keyed by `externalRefs` (HubSpot-style).
   One connector, both directions.
2. ✅ **Auth — DECIDED: OAuth2.** Per-nation OAuth, tokens minted + vaulted via the marketplace broker,
   auto-refreshed, revocable. Contrasts the API-key model of [ngpvan](../ngpvan/SPECS.md).
3. ✅ **Events are dynamic integration triggers — DECIDED.** `nationbuilder.*` events are
   **marketplace-contributed** trigger nodes the workflow router matches — **not** entries in the static
   core `Events` vocabulary.
4. ✅ **Inbound transport — DECIDED: webhooks (+ reconcile).** NationBuilder webhooks (new person /
   donation / RSVP, …) verified + deduped on the NB event id; subscriptions re-registered on connect + a
   periodic reconcile.
5. ✅ **Identity — DECIDED: resolve to `contactId` upstream.** Connector resolves person (email/E.164) →
   `contactId`; NB id in **`externalRefs.nationbuilder`**; unknown → auto-create (config) or `anonId`. No
   raw PII on the bus.
6. ✅ **Consent — DECIDED: map but never bypass.** NationBuilder opt-in maps onto our consent as a
   **signal**; **`canSend()` always governs** the send (TCPA / STOP / quiet-hours / 10DLC).
7. ✅ **Upsert / id mapping — DECIDED.** Push/match-create then PATCH by `nbId` in **`externalRefs`**
   (nation-keyed); **409** adopts, **404** re-matches — same pattern as [hubspot](../hubspot/SPECS.md). No
   bespoke column.
8. ✅ **Conversion — DECIDED.** A donation = the analytics **`converted`** event (amount + `contactId`),
   `analytics-6.5`; one emit, two consumers (workflow + analytics).
9. ✅ **FEC / campaign-finance — DECIDED: out of scope.** Disclosure / itemization / limits are the
   **org's** obligation in NationBuilder; we treat a donation only as an engagement/conversion signal.
10. ✅ **Throttle + batch — DECIDED.** NationBuilder rate limits → token-bucket × fair-share +
    backpressure + DLQ + auto-pause; connect-time bulk import/export is **bounded + consent-aware**, not an
    unbounded slurp.
11. ⚠️ **Activity write-back granularity — OPEN.** Which engagement to mirror into NationBuilder (a tag vs
    a note vs a path-step advance) and how finely is **config**, but the **default mapping** for texted /
    replied / opted-out needs to be pinned with a design partner.

# Requirements (traceable register)

The traceable register for the **NationBuilder integration** (IDs **`nationbuilder-N.M`**). **Priority:**
**A** = MVP, **B** = core / hardening, **C** = later. **Boundary:** NationBuilder owns the **event
contract + connector normalize + person/consent resolution + the NB sync contract (object/field map +
upsert + activity / tag / path / list write-back) + bounded batch sync**; OAuth/vault/governance =
marketplace, triggers/automation = workflow, sends + consent = channels/`canSend()`, attribution =
analytics.

## nationbuilder-1.0 Connection & auth — A
- **nationbuilder-1.1** **Per-nation OAuth2** — tokens minted + **vaulted via marketplace**, auto-refreshed, revocable; connector holds a reference, never the token *(gap #2)* — A
- **nationbuilder-1.2** **Lifecycle** — `enable → connect → active → pause → remove`; **auto-pause** on account inactive / revoked grant; **least-privilege scopes** (only what the enabled triggers + sync need) — A
- **nationbuilder-1.3** **Webhook subscription management** — register the configured topics on connect + **periodic reconcile** (re-register if dropped) — A

## nationbuilder-2.0 Inbound webhooks & normalization — A
- **nationbuilder-2.1** **Signature/secret verification** at the intake edge; drop + alert on failure — A
- **nationbuilder-2.2** **Idempotent ingest** — dedupe on the **NationBuilder event id**; ACK-fast (200) → SQS → connector — A
- **nationbuilder-2.3** **Normalize topic → event** — map each subscribed topic to a **`nationbuilder.<event>`** with a payload→context shape; subscribed set is **config** *(gap #4)* — A
- **nationbuilder-2.4** **No raw PII on the bus** — events carry **`contactId`** + facts (amount / RSVP / path / tag), never raw email/phone/address — A
- **nationbuilder-2.5** **Triggers are dynamic** marketplace nodes matched by **workflow** bindings (not the static `Events` catalog) *(gap #3)* — A

## nationbuilder-3.0 Trigger catalog — A
- **nationbuilder-3.1** **People** — `person.created` / `person.updated` (volunteer recruit, attribute + opt-out sync) — A
- **nationbuilder-3.2** **Donation** — `donation.created` / `donation.updated` (donor thank-you + **conversion**; refund/fail recovery) — A
- **nationbuilder-3.3** **Event RSVP** — `rsvp.created` / `rsvp.updated` (confirm, **event reminder**, attended thank-you, no-show win-back) — A
- **nationbuilder-3.4** **Membership** — `membership.changed` (renewal nudge, lapsed win-back) — B
- **nationbuilder-3.5** **Tag applied** — `tag.applied` (segment-driven sequence) — A
- **nationbuilder-3.6** **Path advanced** — `path.advanced` (step-specific outreach) — B
- **nationbuilder-3.7** **List change** *(later)* — `list.changed` (segment-driven outreach) — C

## nationbuilder-4.0 Person → contact resolution & consent — A
- **nationbuilder-4.1** **Resolve person → `contactId`** (normalized email / E.164) via [contact](../../core/contact/SPECS.md); store NB id in **`externalRefs.nationbuilder`** (nation-keyed) — A
- **nationbuilder-4.2** **Unknown person** → **auto-create** (account-config) or opaque **`anonId`** — B
- **nationbuilder-4.3** **Consent mapping** — NationBuilder opt-in → our consent **as a signal**; **`canSend()` always governs** the send *(gap #6)* — A

## nationbuilder-5.0 Outbound sync (CRM mirror) — B
- **nationbuilder-5.1** **Object + declarative field/value/type map** — RumbleUp contact ↔ NB person; adding a synced field = a **map entry**, not code — B
- **nationbuilder-5.2** **Upsert via `externalRefs`** — push/match-create then PATCH by `nbId` (nation-keyed); **409** adopts existing id, **404** clears + re-matches *(gap #7)* — B
- **nationbuilder-5.3** **Activity write-back** — texted / replied / opted-out → NB tag / note (config-mapped) *(gap #11)* — B
- **nationbuilder-5.4** **Tag / path / list write-back** — apply a tag / advance a path step / add to a list (add-only / forward by default) — B
- **nationbuilder-5.5** **Deliver via the sync-worker framework** — throttle (token-bucket × fair-share) + backpressure requeue + retry / DLQ; **no new delivery engine** — B
- **nationbuilder-5.6** **Idempotent** — upsert keyed by stored `nbId` / deterministic match; redelivery re-upserts the same person — B

## nationbuilder-6.0 Conversion & attribution — A
- **nationbuilder-6.1** **Donation → analytics `converted`** (amount + `contactId`), the `analytics-6.5` conversion contract; one emit feeds **both** workflow + analytics *(gap #8)* — A

## nationbuilder-7.0 Batch sync (bounded) — B
- **nationbuilder-7.1** **Bulk import** — seed contacts from a NationBuilder **list / tag** on connect (opt-in, **rate-limited + consent-aware**), batched with a resumable envelope — B
- **nationbuilder-7.2** **Bulk export** — push RumbleUp contacts → NB persons (opt-in, batched, consent-aware) — C

## nationbuilder-8.0 Governance & privacy — A
- **nationbuilder-8.1** **Marketplace / Zapier governance** — accept-to-enable · **`dataJurisdiction` cross-border gate** (supporter-data residency) · metering · egress feature-flag × permission; **account = controller** — A
- **nationbuilder-8.2** **Egress erasure boundary** — NationBuilder is the account's system; forget = **stop-sync + stop-act + disclose**, not reach-in-delete — A
- **nationbuilder-8.3** **FEC / campaign-finance reporting out of scope** — the org's obligation; we never compute or file disclosure *(gap #9)* — A
- **nationbuilder-8.4** **Kill switches** — disable / **dry-run** (log intent, do nothing) / pause (AppConfig + marketplace lifecycle) — A
- **nationbuilder-8.5** **Audit** — connect / disconnect / config change / manual resync — B

## nationbuilder-9.0 Reliability — B
- **nationbuilder-9.1** **Idempotent both ways** — inbound dedupe on NB event id; outbound keyed by `nbId` — A
- **nationbuilder-9.2** **Throttle + backpressure + retry + DLQ + auto-pause** on both ingest and outbound (token-bucket × fair-share, like SMS providers) — B
- **nationbuilder-9.3** **No PII in logs** — opaque ids; payloads not logged; dry-run logs **intent**, not content — A

## nationbuilder-10.0 Infra — A
- **nationbuilder-10.1** **API Gateway** (webhook intake + `/nationbuilder/*`) · **SQS + DLQ** · **Kafka** (normalized events + contact consumer) · **EventBridge Scheduler** (reconcile / batch) · **DynamoDB** (connection / dedupe / sync state) · **Redis** (throttle) · **Secrets Manager + KMS** (OAuth tokens, via marketplace) — A

# Endpoints (first cut)

A first pass, in [`@repo/endpoint`](../../../packages/endpoint/SPECS.md) style — service-prefixed
`/nationbuilder/*`. Ingest is **webhook-driven** and automation is **workflow**, so the HTTP surface is
**OAuth callback + webhooks + config/health + operator resync**, no per-record public API. **Access
column:** **`-`** public/system · **`Provider-sig`** = verified NationBuilder webhook · **`State`** =
OAuth `state`-validated callback · account ladder `USER`<`ACCOUNT` · **`Internal`** = VPC-only S2S.

| Method | URI | Purpose | Access | Req |
|---|---|---|---|---|
| GET | `/nationbuilder/oauth/install` | Begin OAuth (redirect to NationBuilder authorize) | ACCOUNT | nationbuilder-1.1 |
| GET | `/nationbuilder/oauth/callback` | OAuth callback — exchange code, **vault** token, register webhooks | State | nationbuilder-1.1/1.3 |
| POST | `/nationbuilder/webhook/{topic}` | NationBuilder webhook ingress — **verify** → dedupe → ACK → SQS | Provider-sig | nationbuilder-2.1/2.2 |
| GET, PUT | `/nationbuilder/connections/{id}/config` | Connection config — subscribed topics · field/value maps · auto-create · dry-run | ACCOUNT | nationbuilder-2.3/5.1/8.4 |
| POST | `/nationbuilder/connections/{id}/sync` | Operator/account **outbound resync** — re-upsert mapped contacts → NB persons | ACCOUNT | nationbuilder-5.2 |
| POST | `/nationbuilder/connections/{id}/import` | Bounded **bulk import** from a NationBuilder list / tag (opt-in, consent-aware) | ACCOUNT | nationbuilder-7.1 |
| GET | `/nationbuilder/connections/{id}/status` | Connection health — subscriptions · queue depth · backpressure · last event · auto-pause state | USER | nationbuilder-9.2 |
| GET | `/nationbuilder/health` | Liveness / readiness (intake + connector + sync) | - | nationbuilder-10.1 |

# eof
