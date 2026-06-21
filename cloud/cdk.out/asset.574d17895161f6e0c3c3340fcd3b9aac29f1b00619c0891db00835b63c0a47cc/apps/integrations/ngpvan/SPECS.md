#
# NGP VAN integration
#

# Objective

Connect an account's **NGP VAN** (Voter Activation Network — the Democratic / progressive **voter +
volunteer CRM**) as a **two-way** integration: **inbound triggers** turn VAN activity — a new
person/volunteer, a **contribution**, an **event signup**, an **activist code applied**, a **canvass
result** — into **normalized events on the platform bus** an account's
[workflow](../../core/workflow/SPECS.md) acts on (*"a volunteer signed up for a canvass → send the shift
details + a reminder the night before"*, *"a contribution landed → fire a donor thank-you"*, *"an
activist code was applied → start a GOTV / recruitment sequence"*); and **outbound sync** pushes/upserts
RumbleUp contacts ↔ the **VAN person record** and writes back engagement (texted, replied, opted-out),
**activist codes**, and **saved-list** membership.

This is a **hybrid** of the two integration archetypes: the **inbound trigger** side mirrors
[Shopify](../shopify/SPECS.md) (verify → normalize → bus → workflow + analytics), and the **outbound
sync** side mirrors [HubSpot](../hubspot/SPECS.md) (object mapping · upsert via `externalRefs` id
write-back · declarative field maps · batch sync). A VAN **contribution** is also a **first-class
conversion source**: it feeds the [analytics](../../core/analytics/SPECS.md) **conversion contract**
(`analytics-6.5`) — value + `contactId` — so the same donation both **triggers** a workflow and **closes
the loop** on attribution. NGP VAN is the **political sibling** of the donation connectors
[ActBlue](../actblue/SPECS.md) / [WinRed](../winred/SPECS.md) and the community CRM
[NationBuilder](../nationbuilder/SPECS.md).

**Account-connected** (a campaign/committee connects *their* VAN account), so it lives under
[marketplace](../../core/marketplace/SPECS.md) governance — the **Zapier governance pattern**
([zapier](../zapier/SPECS.md): accept-to-enable · `dataJurisdiction` cross-border gate · metering ·
egress feature-flag × permission). **The account is the controller.** **Auth nuance:** VAN does **not**
use OAuth — it authenticates with an **API key** (an application name + a **mode-specific** key:
*MyCampaign* vs *MyVoters / VoterFile*), vaulted per-account in marketplace.

This is **not a new data plane**: ingest rides the platform **incoming-webhook intake** (verify → SQS);
the **connector runtime** normalizes; triggers ride the **Kafka backbone** into workflow; engagement
rides the **channels behind `canSend()`**; outbound upserts ride the **sync-worker framework** (throttle ·
retry · DLQ); secrets ride the **marketplace vault**.

# Role & boundaries

**Owns:**
* The **VAN event contract** — which VAN signals (new person · contribution · event signup · activist-code
  applied · canvass result) map to which **normalized events**, and the **payload → context** shape each
  carries (amount, event/shift, activist-code id, contactId).
* **Inbound verification + connector normalization** — verify the inbound (signature/shared-secret or
  polled-snapshot dedupe), dedupe on the VAN record/change id, and **normalize** the VAN payload into a
  platform event (the [marketplace](../../core/marketplace/SPECS.md) `MarketplaceConnectorJob` pattern).
* The **VAN sync contract (outbound)** — which **RumbleUp entities** map to which **VAN objects** (a
  RumbleUp **contact ↔ a VAN person**) and the **field / value / type mapping** between them.
* **Upsert mechanics (outbound)** — create-or-update a VAN person by the stored VAN id (via
  [`externalRefs`](../../core/contact/src/model/ContactModel.ts), the same id-mapping pattern), incl.
  conflict / stale-id recovery; write engagement, **activist codes**, and **saved-list** membership back.
* **Person → contact resolution + consent mapping** — resolve a VAN person to a RumbleUp `contactId`
  ([contact](../../core/contact/SPECS.md) lookup), store the VAN id in `externalRefs`, and map VAN
  contactability/opt-out onto our consent **as a signal** (`canSend()` always governs).

**Delegates / does NOT do:**

| Concern | Owner |
|---|---|
| **API-key vault + catalog + cross-border gate + metering** | **[marketplace](../../core/marketplace/SPECS.md)** (Zapier governance pattern) |
| **Inbound intake edge** (HTTPS endpoint / poll → SQS) | the platform **incoming-webhook intake** + connector runtime |
| **The trigger graph / what to do next** | **[workflow](../../core/workflow/SPECS.md)** (these events are its **trigger nodes**) |
| **The engagement send** (SMS / email) + **consent / suppression / quiet-hours** | the **channel** + **`canSend()`** ([texting](../../core/texting/SPECS.md)) |
| **Conversion attribution math** | **[analytics](../../core/analytics/SPECS.md)** (a VAN contribution = the conversion event it credits) |
| **Contact identity + suppression + the stable `contactId`** | **[contact](../../core/contact/SPECS.md)** |
| **Outbound delivery + retry / DLQ + throttle** (inbound + outbound) | the shared **connector / sync-worker framework** |
| **FEC / campaign-finance reporting** | the **committee** (VAN/their compliance vendor) — **not us**; we never compute or file disclosure |

> **No PII reach-down; the account is controller.** VAN is the **account's** system holding **voter-file
> data** (highly sensitive PII). When a contact is forgotten, erasure here = **stop-syncing + stop-acting
> + disclose**, not reach-in-delete (the [egress erasure boundary](../../../docs/SPECS.md)) — the committee is
> the controller of its VAN voter file.

# Core concepts

* **Connection (installation)** — an account's connected VAN account: the **API key** (vaulted in
  marketplace), the **application name**, the **API mode** (MyCampaign vs MyVoters/VoterFile), the
  configured trigger set, and connection health. Lifecycle is the marketplace
  `enable → connect → active → pause → remove` (+ **auto-pause** on account inactive).
* **Trigger event** — a VAN signal **normalized** into a platform event (`ngpvan.contribution.created`,
  `ngpvan.signup.created`, …). These are **dynamic integration trigger events** (marketplace-contributed)
  — *not* entries in the static core [`Events`](../../../packages/endpoint/src/EventTypes.ts) vocabulary —
  matched by an account's **workflow trigger bindings**, exactly like any
  [marketplace](../../core/marketplace/SPECS.md) integration trigger node.
* **Object mapping (outbound)** — a RumbleUp entity → a VAN object: a RumbleUp **contact** ↔ a VAN
  **person**. Activity (texted / replied / opted-out), **activist codes**, and **saved-list** membership
  are pushed onto the matched person.
* **Upsert via id write-back** — the VAN person id (`vanId`) is stored back on the RumbleUp contact's
  [`externalRefs`](../../core/contact/src/model/ContactModel.ts) (`{ ngpvan: { vanId, mode } }`); next
  sync **updates** by that id instead of re-matching. First sync **finds-or-creates** (VAN's
  match-or-create person endpoint); a **conflict** adopts the existing id; a **stale/deleted** id is
  cleared and re-matched.
* **Field / value / type map** — **declarative** config: RumbleUp field → VAN field, with **value
  translations** (enum mapping) and **types**. Adding a synced field = a **map entry**, not code (the
  [zapier](../zapier/SPECS.md) "outbound = config" stance).
* **Activist code / canvass result** — VAN's tag-like markers (an activist code applied) and contact
  outcomes (a canvass result). Inbound: an applied activist code is a **trigger**. Outbound: RumbleUp can
  **apply** an activist code / record a canvass result on a person as a workflow action.
* **Conversion** — a VAN **contribution** is emitted **both** as a workflow trigger **and** as the
  analytics **`converted`** event (amount + `contactId`) for multi-touch attribution.
* **Batch sync** — a bounded **bulk import/export** on connect: seed contacts from a VAN **saved list**
  (import) and/or push the account's RumbleUp contacts to VAN (export), batched to respect VAN's rate
  limits — opt-in + consent-aware.

# Architecture & flow

```
 INBOUND TRIGGERS  (the engagement side — Shopify-style)
   NGP VAN ──change (webhook-or-poll)──► incoming-webhook intake / connector poll
        • verify (shared-secret / signed) OR poll-snapshot dedupe on VAN change id · ACK fast (200)
        └─► SQS ──► ngpvan CONNECTOR (normalize)
                 • map signal → normalized event ; resolve person → contactId (+ externalRefs) ; map consent
                 └─► emit `ngpvan.<event>` on the Kafka backbone
                          ├─► workflow TRIGGER router ── match account bindings → start / signal instances
                          │        └─► engagement: GOTV text · event reminder · volunteer recruit · donor thank-you  (ALWAYS via canSend())
                          └─► analytics (contribution → the `converted` conversion contract → attribution)

 OUTBOUND SYNC  (the CRM-mirror side — HubSpot-style)
   contact.* change / workflow integration-action ──► ngpvan SYNC consumer
        └─► map (field/value/type) → VAN person ; resolve externalRefs.ngpvan.vanId
                 └─► sync-worker framework (THROTTLE × fair-share · retry · DLQ)
                          └─► upsert VAN person  (find-or-create / update by vanId)
                               201 → write vanId back to externalRefs       conflict → adopt existing id
                               + apply activist code · record canvass result · saved-list add   404 → clear stale id, re-match
                          push engagement back (texted / replied / opted-out)

 BATCH SYNC  (bounded, on connect — opt-in)
   import a VAN saved list → contacts   ·   export RumbleUp contacts → VAN persons   (batched, consent-aware)

 AUTH:  per-account VAN API key (application name + mode key: MyCampaign | MyVoters/VoterFile) — vaulted in marketplace
```

* **Two-way, idempotent.** Inbound is deduped on the VAN change/record id; every downstream effect is
  idempotent. Outbound upsert is **keyed by the stored `vanId`**, so a redelivered change re-upserts the
  same person — no duplicates, no double-trigger, no double-count.
* **No new engine.** Intake = the shared webhook intake / connector poll; normalize = the marketplace
  connector runtime; trigger = workflow; send = the channels + `canSend()`; upsert = the sync-worker
  framework; throttle = the shared token-bucket × fair-share. NGP VAN adds a **connector + event/field
  maps**, not infrastructure.

# Trigger catalog (inbound)

The VAN signals the connector watches, the **normalized event** each becomes, and the **engagement** it
typically drives. The watched set is **config** (add a signal = a map entry). VAN's push surface is
limited, so most signals are derived from a **polled snapshot** (changed-since cursor) deduped on the VAN
change id — the marketplace `polling + dedupe` capability.

| VAN signal | Normalized event | Typical engagement |
|---|---|---|
| new person / volunteer added | **`ngpvan.person.created`** | welcome / volunteer-recruitment series; consent capture |
| person updated (contactability, attributes) | `ngpvan.person.updated` | sync attributes + **opt-out** state |
| **contribution received** | **`ngpvan.contribution.created`** | **donor thank-you**; receipt; **conversion** (attribution) |
| **event signup / RSVP** | **`ngpvan.signup.created`** | shift confirmation; **event reminder** (night-before); GOTV |
| event signup status change (confirmed / cancelled / no-show) | `ngpvan.signup.updated` | re-confirm; win-back a no-show |
| **activist code applied** | **`ngpvan.activistcode.applied`** | start a **GOTV / recruitment / issue** sequence |
| canvass result recorded | `ngpvan.canvass.recorded` | follow-up by outcome (supporter → GOTV; undecided → persuasion) |
| saved-list membership change *(later)* | `ngpvan.list.changed` | segment-driven outreach |

> **Engagement composes in workflow.** Each normalized event is a **trigger node**; the *journey* (wait,
> branch, send, A/B) is authored in [workflow](../../core/workflow/SPECS.md). NGP VAN just says *what
> happened* + *to whom* (`contactId`) + *the facts* (amount, shift, activist-code id) in the trigger context.

# Object & field mapping (outbound sync)

The CRM-mirror side, modeled on [HubSpot](../hubspot/SPECS.md)'s declarative sync:

* **Object mapping** — a RumbleUp **contact** ↔ a **VAN person**. There is no account/company analogue;
  VAN is person-centric (the voter file).
* **Declarative maps** (config, not code):
  * **field map** — RumbleUp field → VAN person field (name, emails, phones, address — VAN's
    contact-method shapes).
  * **value map** — enum / choice translations (e.g. RumbleUp consent state → VAN contactability).
  * **type map** — VAN field type per field: **string · number · array**.
* **Activity write-back** — on send/reply/opt-out, the connector writes a VAN **canvass result / note**
  and/or applies an **activist code** to the person (config-mapped) so the campaign sees engagement in VAN.
* **Saved-list membership** — RumbleUp segment membership maps to a VAN **saved list** (add-only by
  default; never destructive without explicit config).
* **Why declarative.** Reshaping/forwarding a record that already exists is a **mapping**, so the synced
  surface grows cheaply — adding a synced field is a **map entry**, not code.

## Upsert & id mapping (outbound)

* **Id home = `externalRefs`.** The VAN person id lives in the contact's
  [`externalRefs`](../../core/contact/src/model/ContactModel.ts) under an `ngpvan` key
  (`{ ngpvan: { vanId, mode } }`) — the **same id-mapping mechanism** as every external system. **No
  dedicated `van_id` column.**
* **Find-or-create** — id present ⇒ **update** by `vanId`; absent ⇒ VAN's **match-or-create person**
  (by email / phone / name + address), then **write the returned `vanId` back** so the next sync updates
  in place.
* **Conflict / stale recovery** — a match that resolves to an existing person ⇒ **adopt** that `vanId`;
  a **stale / deleted** stored id ⇒ **clear it** and re-match. Mode-keyed (`MyCampaign` vs
  `MyVoters`) so a person can carry both without collision.

# Person → contact resolution & consent

* **Resolve → `contactId`.** The connector normalizes the VAN person's **email** (lowercased) / **phone**
  (E.164) and asks [contact](../../core/contact/SPECS.md) for the `contactId`; the VAN id is written to
  the contact's `externalRefs.ngpvan`. Unknown person → **auto-create** (account-config) or an opaque
  **`anonId`** (same rule as analytics identity resolution).
* **Consent mapping — VAN state → RumbleUp consent.** VAN **contactability / opt-out** flags map onto the
  contact's consent record. **Crucially: a signal, not a bypass** — every triggered send still runs
  **`canSend()`** (consent · suppression · STOP · quiet-hours · 10DLC / TCPA), so a VAN contactability
  flag never overrides a platform opt-out. Political SMS is TCPA-governed like any other.
* **No raw PII on the bus.** The normalized event carries **`contactId`** + facts (amount, shift,
  activist-code id), **not** raw voter-file PII (name / address / voter id) — PII stays in contact (same
  discipline as analytics events). Voter-file fields (voter id, address) are **especially sensitive** and
  never ride the bus.

# Conversion & attribution (contributions)

* A VAN **contribution** is the platform's conversion event (`analytics-6.5`): the connector emits it as
  an [analytics](../../core/analytics/SPECS.md) **`converted`** with **amount + `contactId`**, and
  analytics attributes it to the contact's prior channel touches (email → SMS → … → donation) within the
  lookback window, by the account's chosen attribution model — the same contract
  [ActBlue](../actblue/SPECS.md) / [WinRed](../winred/SPECS.md) / [Shopify](../shopify/SPECS.md) feed.
* **One event, two consumers** — the same `ngpvan.contribution.created` both **triggers** a workflow
  (donor thank-you / receipt) and **feeds** attribution. The connector emits once, both subscribe.
* **Not FEC reporting.** We surface the contribution as an **engagement/conversion** signal; **FEC /
  campaign-finance disclosure** (itemization, limits, filing) is the **committee's** obligation in VAN /
  their compliance vendor — explicitly **out of scope** here.

# Auth & governance

* **Per-account API key — NOT OAuth.** VAN authenticates with an **application name + an API key** scoped
  to a **mode** (*MyCampaign* for a single committee's data, or *MyVoters / VoterFile* for shared
  voter-file data). The account pastes its key; marketplace **validates** it immediately and stores it
  **encrypted** (Secrets Manager + per-account **KMS** CMK) — never logged, never returned after save. The
  connector holds a **reference**, never the key. (This differs from the OAuth model of
  [NationBuilder](../nationbuilder/SPECS.md) / [Shopify](../shopify/SPECS.md) — VAN has no OAuth.)
* **Least-privilege mode.** Request only the **mode** the enabled triggers + sync need; voter-file
  (MyVoters) access is the more sensitive and is gated harder.
* **Marketplace / Zapier governance.** NGP VAN is a [marketplace](../../core/marketplace/SPECS.md)
  `IntegrationDefinition` under the **Zapier governance pattern** ([zapier](../zapier/SPECS.md)):
  **accept-to-enable**, the **`dataJurisdiction` cross-border gate** (voter data residency / jurisdiction
  honored), **metering** (events ingested / syncs / actions), and **egress = feature-flag × the connecting
  user's permission**. The **account is the controller**.
* **Kill switches** — disable / **dry-run** (log intended triggers + upserts, do nothing) / pause the
  connection (AppConfig + the marketplace lifecycle).

# Reliability (idempotency, throttle, batch)

* **Idempotent both ways** — inbound deduped on the VAN change/record id; outbound upsert **keyed by the
  stored `vanId`** (or a deterministic match), so redelivery re-upserts the same person — no double-trigger,
  no double-count, no duplicate person.
* **Throttle like an SMS provider.** VAN enforces **API rate limits**; both inbound polling and outbound
  upserts ride the shared **token-bucket throttle × per-account fair-share** (no one account starves the
  queue) — the **same pattern** as the [SMS-provider throttle](../../core/texting/SPECS.md) and
  [zapier](../zapier/SPECS.md). **Reused, not reinvented.**
* **Backpressure + retry.** 429 / 5xx ⇒ **computed-delay requeue** (backpressure, not hammer) → retry →
  **DLQ** after threshold; a sustained-failure connection **auto-pauses** + **alerts**
  ([monitor](../../core/monitor/SPECS.md)).
* **Batch sync — bounded + opt-in.** A connect-time **bulk import** (seed from a VAN saved list) and/or
  **export** (push RumbleUp contacts to VAN) is **rate-limited + consent-aware**, with a
  `{ timestamp, batch_size, batch_number, items[] }` envelope and `batch_number` for resumability — not an
  unbounded full-file slurp.
* **Polling cursor** — where VAN has no push, the connector polls a **changed-since cursor** and dedupes;
  a periodic reconcile re-anchors the cursor if it drifts.

# Out of scope

* **FEC / campaign-finance reporting** — itemization, contribution limits, disclosure filing are the
  **committee's** obligation (in VAN / a compliance vendor); we never compute or file them.
* **Voter-file management / data products** — we **consume + mirror** person/activity signals; we do not
  run a voter file, score voters, or resell L2/TargetSmart-style data.
* **Full MiniVAN / OpenVPB canvassing apps** — the field-canvassing UX is VAN's; we ingest **results**, we
  don't run the canvass.
* **Phone banking / predictive dialer** — a separate channel surface, not this connector.
* **Backfill beyond the bounded connect-time import** — we are a **forward** engagement engine; a larger
  historical replay is a deferred, consent-aware task.

# AWS Services and Other Dependencies

**AWS services**
* **API Gateway** — the VAN inbound intake (verified) + the small `/ngpvan/*` config / health surface.
* **SQS** (+ **DLQ**) — inbound ingest buffering + outbound upsert / action workers + retry.
* **Kafka (MSK)** — the **normalized trigger events** (to workflow + analytics) + the `contact.*`
  consumer that drives outbound sync.
* **EventBridge Scheduler** — the **polling cursor** cadence + periodic reconcile + batch-sync schedule.
* **DynamoDB** — connection state · change-dedupe ids · sync/idempotency state (VAN ids live on the
  contact's **`externalRefs`**, not a separate store).
* **Redis (ElastiCache)** — throttle (token-bucket × fair-share) + circuit-breaker state.
* **Secrets Manager** (+ **KMS**) — the per-account **VAN API key** (**via marketplace**).

**Third-party**
* **NGP VAN API** (people · events + signups · activist codes · canvass results · contributions · saved
  lists) — **NGP VAN is a sub-processor** of the account's voter/donor data.

**Internal (`@repo/*`) + services**
* `@repo/services` (Sqs, Kafka, Dynamo, Cache, SecretsManager, Kms), `@repo/endpoint` (`Access`),
  `@repo/common` (`Type`).
* Composes **marketplace** (API-key vault / catalog / governance / connector runtime), **workflow**
  (trigger + action nodes), **contact** (resolution / consent / `externalRefs`), **analytics**
  (conversion), **texting + `canSend()`** (engagement), **monitor** (health / backpressure). Sibling of
  [nationbuilder](../nationbuilder/SPECS.md) · [actblue](../actblue/SPECS.md) ·
  [winred](../winred/SPECS.md); shares the sync engine with [hubspot](../hubspot/SPECS.md) and the trigger
  pattern with [shopify](../shopify/SPECS.md).

# Compliance & standards mapping

How **this NGP VAN integration's** controls map to **OWASP Top 10 (2021)**, **ISO/IEC 27001:2022**
(Annex A), **SOC 2** (TSC), **GDPR**, **CCPA/CPRA**, and **messaging law**. NGP VAN is an
**account-controlled two-way integration** over **highly sensitive voter/donor PII** — its dominant
controls are **API-key secret custody**, **consent fidelity** (VAN state → `canSend()`),
**no-PII-on-the-bus** (voter-file fields never leave contact), the **egress erasure boundary**, and
**data-residency / jurisdiction**. **FEC / campaign-finance reporting is the committee's** (➖ here). **No
PCI** (we never touch card data — contributions are recorded in VAN); **no PHI**.

**Legend:** ✅ meets/exceeds · ⚠️ partial / open — see Gaps · ➖ n/a

| NGP VAN control | OWASP T10 | ISO 27001:2022 | SOC 2 (TSC) | GDPR | CCPA | Messaging | |
|---|---|---|---|---|---|---|---|
| **API-key secret custody** — per-account VAN key in the **marketplace vault** (Secrets Manager + KMS); validated on save; never logged / returned; reference-only | A02 / A05 | A.8.24 / A.5.17 | CC6.1 | Art 32 | ➖ | ➖ | ✅ |
| **Inbound authenticity** — verify shared-secret / signed inbound, or dedupe a signed poll snapshot; drop + alert on failure | A08 / A01 | A.8.26 / A.5.14 | CC6.1 / CC7.1 | Art 32 | ➖ | ➖ | ✅ |
| **Consent fidelity** — VAN contactability/opt-out maps to our consent but **`canSend()` always governs**; a VAN flag never overrides a platform opt-out | A04 | A.5.34 | CC6.1 | Art 6 / 7 | §1798.120 | **TCPA / opt-in** | ✅ |
| **No PII on the bus** — events carry **`contactId`** + facts (amount / shift / code), never raw voter-file PII (name / address / voter id) | A09 | A.8.11 | (Privacy) | Art 5(1)(c) | §1798.100 | ➖ | ✅ |
| **Sensitive voter-file data** — voter id / address treated as sensitive; minimum mode (MyVoters gated harder); never in logs | A01 / A04 | A.8.10 / A.5.12 | CC6.1 | Art 9-adjacent | §1798.140 (sensitive) | ➖ | ✅ |
| **Idempotent two-way** — inbound dedupe on VAN change id; outbound upsert keyed by `vanId`; no double-trigger / double-count / duplicate person | A08 | A.8.26 | CC7.1 | ➖ | ➖ | ➖ | ✅ |
| **Egress erasure boundary** — VAN is the account's system; forget = **stop-sync + stop-act + disclose**, not reach-in-delete (committee is controller of its voter file) | A04 | A.8.10 | (Privacy) | Art 17 | §1798.105 | ➖ | ✅ |
| **Data residency / jurisdiction** — voter data residency honored via the marketplace `dataJurisdiction` cross-border gate | A08 | A.5.14 | CC6.7 | Art 44–49 | ➖ | ➖ | ✅ |
| **FEC / campaign-finance reporting** — the **committee's** obligation in VAN / a compliance vendor; we never compute or file disclosure | ➖ | A.5.31 | ➖ | ➖ | ➖ | ➖ | ➖ committee-owned |
| **Outbound throttle + backpressure** — VAN rate limit → token-bucket × fair-share; 429 → requeue → DLQ → auto-pause + alert | A08 | A.8.26 | CC7.1 | Art 32 | ➖ | ➖ | ✅ |
| **Least-privilege mode** — request only the VAN mode (MyCampaign / MyVoters) the triggers + sync need | A01 | A.5.15 / A.8.2 | CC6.1 / CC6.3 | Art 25 | ➖ | ➖ | ✅ |
| **Audit** — connect / disconnect / config change + manual resync audited | A09 | A.8.15 | CC7.2 | Art 30 | ➖ | ➖ | ✅ |

> **Design-intent mapping** — how the integration is *intended* to satisfy each control, not an attestation.

# Gaps & decisions

*The one review list.* ✅ = resolved/decided · ⚠️ = **open — needs attention**.

1. ✅ **Archetype — DECIDED: two-way.** **Inbound triggers** (new person · contribution · signup ·
   activist-code · canvass) → workflow + analytics conversion (Shopify-style), **and** **outbound sync**
   (contact ↔ VAN person upsert · activity / activist-code / saved-list write-back) keyed by
   `externalRefs` (HubSpot-style). One connector, both directions.
2. ✅ **Auth — DECIDED: API key, not OAuth.** VAN authenticates with an **application name + mode key**
   (MyCampaign / MyVoters); pasted, validated, **vaulted** per-account in marketplace (Secrets Manager +
   KMS). Differs from the OAuth siblings ([nationbuilder](../nationbuilder/SPECS.md) / shopify).
3. ✅ **Events are dynamic integration triggers — DECIDED.** `ngpvan.*` events are
   **marketplace-contributed** trigger nodes the workflow router matches — **not** entries in the static
   core `Events` vocabulary.
4. ✅ **Inbound transport — DECIDED: poll-first + dedupe.** VAN's push surface is limited, so most signals
   are derived from a **changed-since polled snapshot** deduped on the VAN change id (the marketplace
   `polling + dedupe` capability); where a verified push exists, use it.
5. ✅ **Identity — DECIDED: resolve to `contactId` upstream.** Connector resolves person (email/E.164) →
   `contactId`; VAN id in **`externalRefs.ngpvan`**; unknown → auto-create (config) or `anonId`. No raw
   PII (esp. voter-file fields) on the bus.
6. ✅ **Consent — DECIDED: map but never bypass.** VAN contactability/opt-out maps onto our consent as a
   **signal**; **`canSend()` always governs** the send (TCPA / STOP / quiet-hours / 10DLC).
7. ✅ **Upsert / id mapping — DECIDED.** Find-or-create by `vanId` in **`externalRefs`** (mode-keyed);
   conflict adopts, stale re-matches — same pattern as [hubspot](../hubspot/SPECS.md). No bespoke column.
8. ✅ **Conversion — DECIDED.** A contribution = the analytics **`converted`** event (amount +
   `contactId`), `analytics-6.5`; one emit, two consumers (workflow + analytics).
9. ✅ **FEC / campaign-finance — DECIDED: out of scope.** Disclosure / itemization / limits are the
   **committee's** obligation in VAN; we treat a contribution only as an engagement/conversion signal.
10. ✅ **Throttle + batch — DECIDED.** VAN rate limits → token-bucket × fair-share + backpressure + DLQ +
    auto-pause; connect-time bulk import/export is **bounded + consent-aware**, not an unbounded slurp.
11. ⚠️ **Activity write-back granularity — OPEN.** Which engagement to mirror into VAN (a canvass result
    vs a note vs an applied activist code) and how finely is **config**, but the **default mapping** for
    texted / replied / opted-out needs to be pinned with a design partner.

# Requirements (traceable register)

The traceable register for the **NGP VAN integration** (IDs **`ngpvan-N.M`**). **Priority:** **A** = MVP,
**B** = core / hardening, **C** = later. **Boundary:** NGP VAN owns the **event contract + connector
normalize + person/consent resolution + the VAN sync contract (object/field map + upsert + activity /
activist-code / saved-list write-back) + bounded batch sync**; API-key vault / governance = marketplace,
triggers/automation = workflow, sends + consent = channels/`canSend()`, attribution = analytics.

## ngpvan-1.0 Connection & auth — A
- **ngpvan-1.1** **Per-account API key** (application name + **mode** key: MyCampaign / MyVoters/VoterFile) — pasted, **validated on save**, **vaulted via marketplace** (Secrets Manager + KMS); connector holds a reference, never the key *(gap #2)* — A
- **ngpvan-1.2** **Lifecycle** — `enable → connect → active → pause → remove`; **auto-pause** on account inactive; **least-privilege mode** (request only the mode the triggers + sync need) — A
- **ngpvan-1.3** **Polling cursor + reconcile** — changed-since cursor for VAN's limited push surface; periodic reconcile re-anchors a drifted cursor — A

## ngpvan-2.0 Inbound triggers & normalization — A
- **ngpvan-2.1** **Inbound authenticity** — verify shared-secret / signed inbound, or dedupe a signed poll snapshot on the **VAN change id**; drop + alert on failure — A
- **ngpvan-2.2** **Idempotent ingest** — dedupe on the VAN change/record id; ACK-fast → SQS → connector — A
- **ngpvan-2.3** **Normalize signal → event** — map each watched VAN signal to a **`ngpvan.<event>`** with a payload→context shape; watched set is **config** *(gap #4)* — A
- **ngpvan-2.4** **No raw PII on the bus** — events carry **`contactId`** + facts (amount / shift / activist-code id), never raw voter-file PII — A
- **ngpvan-2.5** **Triggers are dynamic** marketplace nodes matched by **workflow** bindings (not the static `Events` catalog) *(gap #3)* — A

## ngpvan-3.0 Trigger catalog — A
- **ngpvan-3.1** **People** — `person.created` / `person.updated` (volunteer recruit, attribute + opt-out sync) — A
- **ngpvan-3.2** **Contribution** — `contribution.created` (donor thank-you + **conversion**) — A
- **ngpvan-3.3** **Event signup** — `signup.created` / `signup.updated` (shift confirm, **event reminder**, no-show win-back) — A
- **ngpvan-3.4** **Activist code applied** — `activistcode.applied` (start GOTV / recruitment / issue sequence) — A
- **ngpvan-3.5** **Canvass result** — `canvass.recorded` (follow-up by outcome) — B
- **ngpvan-3.6** **Saved-list change** *(later)* — `list.changed` (segment-driven outreach) — C

## ngpvan-4.0 Person → contact resolution & consent — A
- **ngpvan-4.1** **Resolve person → `contactId`** (normalized email / E.164) via [contact](../../core/contact/SPECS.md); store VAN id in **`externalRefs.ngpvan`** (mode-keyed) — A
- **ngpvan-4.2** **Unknown person** → **auto-create** (account-config) or opaque **`anonId`** — B
- **ngpvan-4.3** **Consent mapping** — VAN contactability/opt-out → our consent **as a signal**; **`canSend()` always governs** the send *(gap #6)* — A

## ngpvan-5.0 Outbound sync (CRM mirror) — B
- **ngpvan-5.1** **Object + declarative field/value/type map** — RumbleUp contact ↔ VAN person; adding a synced field = a **map entry**, not code — B
- **ngpvan-5.2** **Upsert via `externalRefs`** — find-or-create by `vanId` (mode-keyed); **conflict** adopts existing id, **stale/deleted** clears + re-matches *(gap #7)* — B
- **ngpvan-5.3** **Activity write-back** — texted / replied / opted-out → VAN canvass result / note (config-mapped) *(gap #11)* — B
- **ngpvan-5.4** **Activist-code + saved-list write-back** — apply an activist code / add to a saved list (add-only by default) — B
- **ngpvan-5.5** **Deliver via the sync-worker framework** — throttle (token-bucket × fair-share) + backpressure requeue + retry / DLQ; **no new delivery engine** — B
- **ngpvan-5.6** **Idempotent** — upsert keyed by stored `vanId` / deterministic match; redelivery re-upserts the same person — B

## ngpvan-6.0 Conversion & attribution — A
- **ngpvan-6.1** **Contribution → analytics `converted`** (amount + `contactId`), the `analytics-6.5` conversion contract; one emit feeds **both** workflow + analytics *(gap #8)* — A

## ngpvan-7.0 Batch sync (bounded) — B
- **ngpvan-7.1** **Bulk import** — seed contacts from a VAN **saved list** on connect (opt-in, **rate-limited + consent-aware**), batched with a resumable envelope — B
- **ngpvan-7.2** **Bulk export** — push RumbleUp contacts → VAN persons (opt-in, batched, consent-aware) — C

## ngpvan-8.0 Governance & privacy — A
- **ngpvan-8.1** **Marketplace / Zapier governance** — accept-to-enable · **`dataJurisdiction` cross-border gate** (voter-data residency) · metering · egress feature-flag × permission; **account = controller** — A
- **ngpvan-8.2** **Egress erasure boundary** — VAN is the account's system; forget = **stop-sync + stop-act + disclose**, not reach-in-delete — A
- **ngpvan-8.3** **FEC / campaign-finance reporting out of scope** — the committee's obligation; we never compute or file disclosure *(gap #9)* — A
- **ngpvan-8.4** **Kill switches** — disable / **dry-run** (log intent, do nothing) / pause (AppConfig + marketplace lifecycle) — A
- **ngpvan-8.5** **Audit** — connect / disconnect / config change / manual resync — B

## ngpvan-9.0 Reliability — B
- **ngpvan-9.1** **Idempotent both ways** — inbound dedupe on VAN change id; outbound keyed by `vanId` — A
- **ngpvan-9.2** **Throttle + backpressure + retry + DLQ + auto-pause** on both ingest and outbound (token-bucket × fair-share, like SMS providers) — B
- **ngpvan-9.3** **No PII in logs** — opaque ids; payloads not logged; dry-run logs **intent**, not content — A

## ngpvan-10.0 Infra — A
- **ngpvan-10.1** **API Gateway** (inbound intake + `/ngpvan/*`) · **SQS + DLQ** · **Kafka** (normalized events + contact consumer) · **EventBridge Scheduler** (poll cursor / reconcile / batch) · **DynamoDB** (connection / dedupe / sync state) · **Redis** (throttle) · **Secrets Manager + KMS** (API key, via marketplace) — A

# Endpoints (first cut)

A first pass, in [`@repo/endpoint`](../../../packages/endpoint/SPECS.md) style — service-prefixed
`/ngpvan/*`. Inbound is **poll-/webhook-driven** and automation is **workflow**, so the HTTP surface is
**connect (API-key validate) + inbound + config/health + operator resync**, no per-record public API.
**Access column:** **`-`** public/system · **`Provider-sig`** = verified VAN inbound · account ladder
`USER`<`ACCOUNT` · **`Internal`** = VPC-only S2S.

| Method | URI | Purpose | Access | Req |
|---|---|---|---|---|
| POST | `/ngpvan/connect` | Connect — submit the **API key** (application + mode) → **validate** + **vault** (via marketplace) | ACCOUNT | ngpvan-1.1 |
| POST | `/ngpvan/webhook` | Verified VAN inbound (where push exists) — verify → dedupe → ACK → SQS | Provider-sig | ngpvan-2.1/2.2 |
| GET, PUT | `/ngpvan/connections/{id}/config` | Connection config — watched signals · field/value maps · auto-create · dry-run · mode · poll cadence | ACCOUNT | ngpvan-2.3/5.1/8.4 |
| POST | `/ngpvan/connections/{id}/sync` | Operator/account **outbound resync** — re-upsert mapped contacts → VAN persons | ACCOUNT | ngpvan-5.2 |
| POST | `/ngpvan/connections/{id}/import` | Bounded **bulk import** from a VAN saved list (opt-in, consent-aware) | ACCOUNT | ngpvan-7.1 |
| GET | `/ngpvan/connections/{id}/status` | Connection health — poll cursor · queue depth · backpressure · last event · auto-pause state | USER | ngpvan-9.2 |
| GET | `/ngpvan/health` | Liveness / readiness (intake + connector + sync) | - | ngpvan-10.1 |

# eof
