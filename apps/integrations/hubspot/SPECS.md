#
# HubSpot integration
#

# Objective

Sync RumbleUp data into **HubSpot CRM** so HubSpot stays a faithful mirror of the platform. There are **two
flavors** — same **sync engine**, very different **governance**:

* **Internal (this spec's focus)** — **RumbleUp → RumbleUp's own HubSpot portal.** Push *our* product/CRM data —
  **accounts, campaigns, admin users, usage rollups, [TCR/10DLC](../../core/registration/SPECS.md) brands** — into
  the **one RumbleUp sales/marketing portal** so RumbleUp's GTM team works live data. **RumbleUp is the
  controller**; one **platform-held** credential; **not** customer-configurable.
* **External (sibling flavor — see [External flavor](#external-flavor-customer-facing))** — **account →
  *their* HubSpot.** A customer connects **their own** HubSpot and syncs **their** contacts / replies / campaign
  activity to it. **The account is the controller on both ends**; per-account **OAuth**; lives in the
  **[marketplace](../../core/marketplace/SPECS.md)** under the **Zapier governance pattern**
  ([zapier](../zapier/SPECS.md)).

> **Why split.** The legacy code fused these — a global sales token *and* a per-campaign `hs_apikey` running
> through the same hooks. They are **different integrations**: different direction-of-ownership, auth, residency,
> and consent posture. Conflating them is the mistake this spec avoids. They **share a sync engine** (object
> mapping · upsert · throttle · Kafka triggers); they **do not share** auth, governance, or a portal.

This is a **one-way push + id write-back** (RumbleUp → HubSpot, upsert), **not** a new data plane: triggers ride
the **Kafka event backbone**; delivery rides the **outbound-webhook / sync-worker framework** (throttle · retry ·
DLQ); secrets ride **Secrets Manager**; scheduling rides **EventBridge**.

# Role & boundaries

**Owns:**
* The **HubSpot sync contract** — which **RumbleUp entities** map to which **HubSpot objects** (Company / Contact)
  and the **field / value / type mapping** between them.
* **Upsert mechanics** — create-or-update against HubSpot by the stored HubSpot object id (via
  **[`externalRefs`](../../core/contact/src/model/ContactModel.ts)**, the same id-mapping pattern), incl.
  conflict (409) / stale-id (404) recovery.
* **Sync triggering** — consuming the **entity state-change events** that should push to HubSpot, and the
  **scheduled batch sync** (account / user / TCR rollups).
* **Owner assignment** (internal) — mapping RumbleUp **staff → HubSpot owner ids** for sales/CEX assignment.

**Delegates / does NOT do:**

| Concern | Owner |
|---|---|
| The **event source** (entity state-change events) | the **Kafka backbone** ([analytics](../../core/analytics/SPECS.md) / per-service emit) |
| **Outbound delivery + retry / DLQ + throttle** | the platform **outbound-webhook / sync-worker framework** (HubSpot = one target kind) |
| **Scheduling** the batch sync | **EventBridge Scheduler** |
| The **source-of-truth records** | [account](../../core/account/specs/SPECS.md) · [campaign](../../core/campaign/SPECS.md) · [contact](../../core/contact/SPECS.md) · [registration](../../core/registration/SPECS.md) (TCR) |
| **Secrets** (the platform private-app token) | **Secrets Manager** (+ KMS) |
| **Per-account OAuth + catalog + cross-border gate** *(external flavor)* | **[marketplace](../../core/marketplace/SPECS.md)** (Zapier pattern) |

> **No PII reach-down.** HubSpot is a **downstream** system. Once a record is pushed, erasure = **stop-syncing +
> disclose**, not reach-in-and-delete — the [egress erasure boundary](../../../docs/SPECS.md). For **internal**, the
> data is RumbleUp's own; for **external**, the **account is controller** of their HubSpot.

# Core concepts

* **Object mapping** — a RumbleUp entity → a HubSpot object:
  * **Company** ← an **account / campaign** (the billing/relationship record).
  * **Contact** ← an **admin user** (internal: a person at the account) **or** an end-user **contact** (external).
* **Sync trigger** — *"when X changes in RumbleUp, upsert it to HubSpot."* An **entity event** on Kafka (the
  legacy lifecycle hooks, modernized) → the sync worker.
* **Upsert via id write-back** — the HubSpot object id is stored back on the RumbleUp record (in
  **`externalRefs`**, e.g. `{ hubspot: { id } }`); next sync **PATCHes** by that id instead of re-creating. First
  sync **POSTs**; a **409 conflict** recovers the existing id; a **404** clears a stale id and re-creates.
* **Field / value / type map** — **declarative** config: RumbleUp field → HubSpot property name, with **value
  translations** (enum mapping) and **types** (string / number / array). Adding a synced field = a **map entry**,
  not code.
* **Batch sync** — a **scheduled** (nightly) push of **rollups** that aren't event-shaped (account usage totals,
  recently-active users, TCR brand caps) — batched to respect HubSpot rate limits.
* **Owner assignment** *(internal)* — RumbleUp staff (sales / CEX) → HubSpot **owner id**, so synced
  companies/contacts land on the right rep.

# Architecture & flow

```
 EVENT-DRIVEN SYNC  (real-time)
   core services ──*.changed / lifecycle──► Kafka backbone
        └─► hubspot SYNC consumer ── filter (syncable event · not-suppressed)
                 └─► map (field/value/type) → HubSpot object
                          └─► sync-worker framework  (THROTTLE · retry · DLQ)
                                   └─► upsert HubSpot CRM v3   (POST new / PATCH by externalRefs.hubspot.id)
                                        429 / rate-limit → backpressure requeue (NOT hammer)
                                        201 → write id back to externalRefs        409 → adopt existing id
                                                                                    404 → clear stale id, re-create

 BATCH SYNC  (scheduled — rollups)
   EventBridge Scheduler ──nightly──► batch job
        └─► scan {accounts | active users | TCR brands} → batch (100 / 100 / 50)
                 └─► same map + throttle → HubSpot batch upsert

 AUTH
   internal:  ONE platform HubSpot private-app token  (Secrets Manager + KMS)  — RumbleUp's portal
   external:  per-account OAuth  (marketplace broker + vault)                   — the account's portal
```

* **One sync engine, two configs.** The consumer, mapper, upsert, throttle, and batch are **shared**; the
  **flavor** only changes *which entities sync*, *which credential / portal*, and *which governance gate*.
* **Eventual + idempotent.** Sync lags the SoT by the event pipeline; every upsert is **keyed by the stored
  HubSpot id** (or a deterministic match), so a **redelivered event re-upserts the same object** — no duplicates.
* **No new delivery engine** — HubSpot is one **target kind** of the shared outbound framework (the same one
  [zapier](../zapier/SPECS.md) deliveries ride), throttled like an SMS provider.

# Triggers — syncable events (modernized from the legacy hooks)

The legacy `bkjs` lifecycle hooks (`ucRegister`, `ucFinishUpdateCampaign`, `ucGetCampaign`, `bkAddAccount`,
`rupFinishUpdateContact`, …) become **entity state-change events on Kafka** — the integration is a **consumer**,
not a set of in-process hook calls. Internal flavor v1 set:

| Syncable event | Fires on | HubSpot effect |
|---|---|---|
| `account.registered` | account / campaign register | upsert **Company** |
| `account.updated` | campaign / billing (Stripe) update | upsert **Company** |
| `account.accessed` | admin accesses a campaign | upsert **Company** + owner **Contact** |
| `account.closed` | campaign / account close | upsert **Company** + **cancellation-survey fields** (reason, requested features, cancel date) |
| `user.added` / `user.updated` / `user.removed` | admin user lifecycle | upsert / update **Contact** |
| `project.changed` | project / action status change | upsert **Company** (activity rollup) |

* **Gating** (carried from the legacy `check()` rules): **skip internal/test campaigns**; skip accounts flagged
  no-sync; a **Contact** only syncs if the login is a **valid email**.
* **Config-driven event set** — which events sync is **config**, not hard-wiring; adding a syncable event is a
  declaration (the event already flows on Kafka), like the [zapier](../zapier/SPECS.md) trigger catalog.

# Object & field mapping

* **Declarative maps** (config, not code):
  * **field map** — `fields-<object>`: RumbleUp field → HubSpot property name (per object: company, contact,
    account, access, action, stripe, cancellation).
  * **value map** — enum / choice translations (RumbleUp value → HubSpot value).
  * **type map** — HubSpot property type per field: **string · number · array**.
* **Owner assignment** *(internal only)* — a **staff → HubSpot owner id** map; RumbleUp sales/CEX assignment
  (`sales[0/1]`, `cex[0]`) resolves to HubSpot owner properties before upsert.
* **Why declarative.** Mirrors the [zapier](../zapier/SPECS.md) "outbound = config" stance: reshaping/forwarding a
  record that already exists is a **mapping**, so the synced surface grows cheaply. (Contrast inbound *processing*
  — none here; this flavor is push-only.)

# Upsert & id mapping

* **Id home = `externalRefs`.** The HubSpot object id lives in the RumbleUp record's **`externalRefs`** under a
  `hubspot` (or `hubspot:<portal>`) key — the **same id-mapping mechanism** as every other external system
  ([contact `externalRefs`](../../core/contact/src/model/ContactModel.ts)). **No dedicated `hs_id` column** — the
  legacy `bk_user.hs_id` / `campaigns.hs_id` / `rup_contact.hs_id` columns collapse into the one typed
  `externalRefs` field.
* **Create-or-update** — id present ⇒ **PATCH**; absent ⇒ **POST**, then **write the returned id back** to
  `externalRefs` so the next sync updates in place.
* **Conflict recovery** — **409** (HubSpot already has the object) ⇒ **adopt the existing id** from the response
  and store it; **404** (our stored id is stale / deleted in HubSpot) ⇒ **clear it** and re-create.
* **Per-portal keys** — `externalRefs` is keyed by source, so an entity can carry **both** an internal-portal id
  and (external flavor) the account's-portal id without collision.

# Batch sync (scheduled rollups)

Event-shaped changes sync in real time; **aggregate / time-windowed** data syncs on a **schedule** (EventBridge),
batched to stay within HubSpot's rate limits:

| Batch job | Source | Batch | Carries |
|---|---|---|---|
| **account rollup** | all campaigns | 100 | usage totals (sent, billed, last-sent, admin-activity, p2p msg/time, billing total) |
| **active users** | users active in the window (excl. staff/texters) | 100 | user activity |
| **TCR brands** | TCR brands changed in the window + max daily cap | 50 | brand + 10DLC cap state |

* **Window-scoped** — scan only records **changed in the window** (e.g. last 24h), not full-table every night.
* **Batch envelope** — `{ timestamp, batch_size, batch_number, items[] }`; the same map + throttle as real-time.

# Auth

* **Internal — one platform private-app token.** A **single RumbleUp HubSpot private-app token** (RumbleUp's
  portal), held in **Secrets Manager** (encrypted with the per-env **KMS** CMK), **rotated** on the platform
  **semi-annual** cadence. **Not** per-account; **not** customer-visible.
* **External — per-account OAuth.** The account authorizes via **HubSpot OAuth**; tokens **minted + vaulted via
  the [marketplace](../../core/marketplace/SPECS.md) OAuth broker**, auto-refreshed, revocable — exactly the
  [zapier](../zapier/SPECS.md) auth model.
* **Kill switches** — config flags to **disable** sync, run **dry-run** (log the intended upsert, send nothing),
  or pause a flavor — carried from the legacy `disabled` / `fake` / `no-sync` switches, as **AppConfig**.

# External flavor (customer-facing)

The **external** HubSpot integration is a **sibling**, not part of this internal spec's surface — but it
**reuses the sync engine** above. Captured here so the boundary is explicit; **full spec deferred** until
prioritized.

| Aspect | Internal (this spec) | External (sibling) |
|---|---|---|
| **Direction / portal** | RumbleUp → **RumbleUp's** portal | account → **the account's** portal |
| **Controller** | **RumbleUp** | **the account** (both ends) |
| **Auth** | one platform private-app token (Secrets Manager) | **per-account OAuth** (marketplace broker + vault) |
| **Synced entities** | accounts · campaigns · admin users · usage · TCR | the account's **contacts · replies · campaign activity** |
| **Governance** | internal config | **[marketplace](../../core/marketplace/SPECS.md)** — accept-to-enable · `dataJurisdiction` **cross-border gate** · metering |
| **Consent** | n/a (RumbleUp's own GTM data) | end-user **consent** + **`canSend()`** still own any reply-back; sync itself is account→own-CRM |
| **Shared** | **sync engine** — object mapping · upsert via `externalRefs` · throttle · Kafka triggers · batch | ← same |

> **When external is built**, it slots in as a **[marketplace](../../core/marketplace/SPECS.md)
> `IntegrationDefinition`** under the **Zapier governance pattern** ([zapier](../zapier/SPECS.md) — accept-to-enable,
> per-account OAuth, cross-border gate, metering, egress feature-flag × user-permission gating), pointed at the
> **account's** portal with a **contacts/replies** entity set. The **engine is already there**; external adds the
> **governance wrapper + a different entity/credential config**, not a new sync system.

# Throttle & reliability

* **Throttle like an SMS provider.** HubSpot enforces **API rate limits**; outbound upserts ride the shared
  framework's **token-bucket throttle** (HubSpot's limit) **× per-account fair-share** (no one account's churn
  starves the queue) — the **same pattern** as the [SMS-provider throttle](../../core/texting/SPECS.md)
  (`texting-1.3.2`) and [zapier](../zapier/SPECS.md) (`zapier-6.3`). **Reused, not reinvented.**
* **Backpressure + retry.** 429 / 5xx ⇒ **computed-delay requeue** (backpressure, not hammer) → **retry** →
  **DLQ** after threshold; a sustained-failure target **auto-pauses** + **alerts** ([monitor](../../core/monitor/SPECS.md)).
* **Idempotent.** Upsert keyed by the stored HubSpot id (or deterministic match) ⇒ redelivery re-upserts the same
  object; the batch envelope carries `batch_number` for resumability.

# Out of scope

* **HubSpot Meetings embed** — the signup-page meeting-scheduler is a **static HubSpot iframe widget**, a
  **[web](../../core/web/SPECS.md)** concern, **not** an API integration; noted, not specified here.
* **Inbound HubSpot → RumbleUp processing** — this flavor is **push-only**. Pulling data *from* HubSpot (or the
  external flavor's two-way sync) is a separate, **coded inbound** surface (validate · map · `canSend()`),
  deferred.

# AWS Services and Other Dependencies

**AWS services**
* **Kafka (MSK)** — the sync event source (consumer). **SQS** (+ DLQ) — upsert delivery workers + retry.
* **Redis (ElastiCache)** — **throttle** (token-bucket × per-account fair-share) + circuit-breaker state.
* **DynamoDB** — sync / idempotency state (HubSpot ids live on the **source records' `externalRefs`**, not a
  separate store).
* **EventBridge Scheduler** — the **batch sync** schedule.
* **Secrets Manager** (+ **KMS**) — the **platform private-app token** (internal); the **OAuth vault** (external,
  via marketplace).
* **API Gateway** — the small `/hubspot/*` config / health / manual-resync surface.

**Third-party**
* **HubSpot CRM API (v3)** — companies / contacts upsert + owners; **HubSpot is a sub-processor**.

**Internal (`@repo/*`) + services**
* `@repo/services` (Kafka, Sqs, Dynamo, Kms, SecretsManager), `@repo/endpoint` (`Access`), `@repo/common` (`Type`).
* Consumes: **account / campaign / contact / registration** (the synced entities + their `externalRefs`),
  **monitor** (backpressure / failure alerts); **external flavor** consumes **marketplace** (catalog / OAuth /
  metering). Rides the **outbound sync-worker framework** for delivery.

# Compliance & standards mapping

How **this internal HubSpot sync's** controls map to **OWASP Top 10 (2021)**, **ISO/IEC 27001:2022** (Annex A),
**SOC 2** (TSC), **GDPR**, **CCPA/CPRA**, and **messaging law**. The internal flavor is a **first-party data
egress** to **RumbleUp's own** HubSpot — its dominant controls are **secret custody**, **sub-processor
governance**, **no-PII-in-logs**, and the **egress erasure boundary**. The data is **RumbleUp's GTM/CRM data**
(account / user / usage metadata), **not** customer end-user messaging content. **No PCI / PHI** (➖).

**Legend:** ✅ meets/exceeds · ⚠️ partial / open — see Gaps · ➖ n/a

| HubSpot (internal) control | OWASP T10 | ISO 27001:2022 | SOC 2 (TSC) | GDPR | CCPA | Messaging | |
|---|---|---|---|---|---|---|---|
| **Secret custody** — one platform private-app token in **Secrets Manager** + **KMS**; **semi-annual rotation**; never in code/logs | A02 / A05 | A.8.24 / A.5.17 | CC6.1 | Art 32 | ➖ | ➖ | ✅ |
| **Sub-processor governance** — HubSpot = sub-processor for **RumbleUp's** CRM data; in the sub-processor register | A08 | A.5.19–.23 | CC9.2 | Art 28 | §1798.140 | ➖ | ✅ |
| **Egress erasure boundary** — pushed records are **downstream**; erasure = **stop-sync + disclose**, not reach-in-delete (data is RumbleUp's own) | A04 | A.8.10 | (Privacy) | Art 17 | §1798.105 | ➖ | ✅ |
| **No PII in logs** — opaque ids; payloads not logged; dry-run logs intent not content | A09 | A.5.34 / A.8.11 | (Privacy) | Art 5(1)(c) | §1798.100 | ➖ | ✅ |
| **Upsert integrity + idempotency** — keyed by stored HubSpot id; 409/404 recovery; redelivery-safe | A08 | A.8.26 | CC7.1 | Art 32 | ➖ | ➖ | ✅ |
| **Outbound throttle + backpressure** — token-bucket × fair-share (like SMS providers); 429 → requeue → DLQ → auto-pause + alert | A08 | A.8.26 | CC7.1 | Art 32 | ➖ | ➖ | ✅ |
| **Least-privilege** — read SoT + write the mapped HubSpot objects only; scoped IAM | A01 | A.5.15 / A.8.2 | CC6.1 / CC6.3 | Art 32 | ➖ | ➖ | ✅ |
| **Residency** — internal GTM data follows RumbleUp's jurisdiction; **external** flavor inherits the marketplace **cross-border gate** | A08 | A.5.14 | CC6.7 | Art 44–49 | ➖ | ➖ | ✅ |
| **Sync gating** — internal/test campaigns + no-sync accounts excluded; contacts require a valid email | A04 | A.8.2 | CC6.1 | Art 6 | §1798.100 | ➖ | ✅ |
| **Audit** — sync config changes + manual resync audited | A09 | A.8.15 | CC7.2 | Art 30 | ➖ | ➖ | ✅ |

> **Design-intent mapping** — how the integration is *intended* to satisfy each control, not an attestation.

# Gaps & decisions

*The one review list.* ✅ = resolved/decided · ⚠️ = **open — needs attention**.

1. ✅ **Two flavors, one engine — DECIDED.** **Internal** (RumbleUp → RumbleUp's portal, platform token, GTM data,
   RumbleUp = controller) is this spec. **External** (account → their portal, per-account OAuth, marketplace,
   account = controller) is a sibling that **reuses the sync engine** but adds the **Zapier governance wrapper**.
   They **do not** share auth, portal, or governance.
2. ✅ **One-way push + id write-back — DECIDED.** RumbleUp → HubSpot **upsert**; the HubSpot id is written back to
   **`externalRefs`** (POST→store→PATCH; 409 adopt; 404 re-create). Inbound HubSpot→RumbleUp is out of scope.
3. ✅ **Id mapping = `externalRefs`, not `hs_id` columns — DECIDED.** The legacy per-table `hs_id` columns
   collapse into the **one typed `externalRefs`** field ([contact](../../core/contact/src/model/ContactModel.ts)),
   keyed per portal — same pattern as every external system. *(Typed-field lesson: no per-system bespoke column.)*
4. ✅ **Triggers = Kafka events, not in-process hooks — DECIDED.** The legacy `bkjs` lifecycle hooks become
   **entity state-change events** the sync worker consumes; the syncable-event set is **config**.
5. ✅ **Mapping = declarative — DECIDED.** field / value / type maps + owner map are **config**; adding a synced
   field is a map entry, not code (outbound = config, like [zapier](../zapier/SPECS.md)).
6. ✅ **Auth — DECIDED.** Internal = **one platform private-app token** in Secrets Manager + KMS, **semi-annual
   rotation**, never customer-visible. External = **per-account OAuth** via the marketplace broker.
7. ✅ **Throttle — DECIDED: like an SMS provider.** HubSpot rate limits → **token-bucket × fair-share** +
   **backpressure requeue** + **DLQ** + **auto-pause + alert** — the shared framework (`texting-1.3.2` /
   `zapier-6.3`), **reused**.
8. ✅ **Batch sync — DECIDED.** Aggregate/time-windowed rollups (account usage · active users · TCR caps) sync on
   an **EventBridge schedule**, **window-scoped** (changed-in-window only) + **batched** to respect rate limits.
9. ⚠️ **External flavor full spec — OPEN (deferred).** The engine is shared and the boundary is set, but the
   external flavor's **own** spec (marketplace `IntegrationDefinition`, OAuth scopes, contact/reply entity set,
   two-way option, consent posture) is **not written** — gated on prioritization.

# Requirements (traceable register)

The traceable register for the **internal HubSpot sync** (IDs **`hubspot-N.M`**). **Priority:** **A** = MVP,
**B** = core / hardening, **C** = later. **Boundary:** HubSpot owns the **object/field mapping + upsert + sync
triggering + batch**; event source = Kafka, delivery = the sync-worker framework, secrets = Secrets Manager,
schedule = EventBridge, source records = account/campaign/contact/registration.

## hubspot-1.0 Sync engine (shared by both flavors) — A
- **hubspot-1.1** **Event consumer** — read the **Kafka backbone**, filter to **syncable, non-suppressed** events, **map → HubSpot object** — A
- **hubspot-1.2** **Upsert via `externalRefs`** — id present ⇒ **PATCH**; absent ⇒ **POST** then **write id back** to the record's `externalRefs` (`hubspot[:portal]`); **409** ⇒ adopt existing id, **404** ⇒ clear stale id + re-create — A
- **hubspot-1.3** **Deliver via the sync-worker framework** — **throttle** (token-bucket × per-account fair-share — **same pattern as SMS providers**, `texting-1.3.2`) + **backpressure requeue** + **retry / DLQ**; **no new delivery engine** — A
- **hubspot-1.4** **Idempotent** — upsert keyed by stored HubSpot id / deterministic match; redelivery re-upserts the same object (no duplicates) — A
- **hubspot-1.5** **Declarative mapping** — field / value / type maps per object; adding a synced field = a **map entry**, not code — A
- **hubspot-1.6** **Kill switches** — config to **disable** / **dry-run** (log intent, send nothing) / **pause** a flavor (AppConfig) — A

## hubspot-2.0 Internal sync — entities & triggers — A
- **hubspot-2.1** **Company ← account / campaign** — upsert on `account.registered` / `account.updated` / `account.accessed` — A
- **hubspot-2.2** **Contact ← admin user** — upsert on `user.added/updated/removed`; **only if a valid email** — A
- **hubspot-2.3** **Close → cancellation-survey fields** — `account.closed` upserts the Company with cancellation reason / requested features / cancel date — B
- **hubspot-2.4** **Activity rollup** — `project.changed` upserts the Company activity fields — B
- **hubspot-2.5** **Sync gating** — **skip internal/test campaigns + no-sync accounts**; config-driven syncable-event set — A
- **hubspot-2.6** **Owner assignment** — **staff → HubSpot owner id** map (sales / CEX) resolved before upsert — B

## hubspot-3.0 Batch sync (scheduled rollups) — B
- **hubspot-3.1** **EventBridge schedule** drives a batch job; **window-scoped** (changed-in-window only) — B
- **hubspot-3.2** **Account rollup** (usage totals) batched 100; **active users** batched 100 (excl. staff/texters); **TCR brands** batched 50 (+ max daily cap) — B
- **hubspot-3.3** **Batch envelope** `{ timestamp, batch_size, batch_number, items[] }`; same map + throttle; resumable — B

## hubspot-4.0 Auth & secrets — A
- **hubspot-4.1** **Internal = one platform private-app token** in **Secrets Manager** + **KMS**; **semi-annual rotation**; never in code/logs — A
- **hubspot-4.2** **Least-privilege IAM** — read SoT + write the mapped HubSpot objects only — A

## hubspot-5.0 Reliability & compliance — A
- **hubspot-5.1** **Throttle + backpressure + auto-pause** — outbound upserts throttled per HubSpot's rate limit (token-bucket × fair-share); 429/5xx → **computed-delay requeue** → DLQ → **auto-pause + alert** ([monitor](../../core/monitor/SPECS.md)) *(gap #7)* — A
- **hubspot-5.2** **No PII in logs** — opaque ids; payloads not logged; dry-run logs **intent**, not content — A
- **hubspot-5.3** **Egress erasure boundary** — pushed records are downstream; erasure = **stop-sync + disclose**, not reach-in-delete (data is RumbleUp's own) — B
- **hubspot-5.4** **Sub-processor register** — HubSpot recorded as a sub-processor for RumbleUp's CRM data — B
- **hubspot-5.5** **Audit** — sync config changes + manual resync — B

## hubspot-6.0 External flavor (sibling — deferred) — C
- **hubspot-6.1** **External = marketplace `IntegrationDefinition`** under the **Zapier governance pattern** ([zapier](../zapier/SPECS.md)) — **per-account OAuth**, accept-to-enable, **`dataJurisdiction` cross-border gate**, metering — **reuses the `hubspot-1.0` engine** with the account's portal + a contacts/replies entity set *(gap #9)* — C
- **hubspot-6.2** **External controller = the account** (both ends); end-user **consent** + **`canSend()`** still own any reply-back — C

## hubspot-7.0 Infra — A
- **hubspot-7.1** **Kafka** (sync source) · **SQS + DLQ** (upsert delivery) · **Redis** (throttle) · **EventBridge** (batch) · **Secrets Manager + KMS** (token) · **API Gateway** (`/hubspot/*`) — A

# Endpoints (first cut)

A first pass, in [`@repo/endpoint`](../../../packages/endpoint/SPECS.md) style — service-prefixed `/hubspot/*`.
The internal sync is **event- + schedule-driven**, so the HTTP surface is small: **config**, **health**, and an
**operator-triggered resync** (no per-record public API). **Access column:** **`-`** internal/system ·
**`STAFF`** = RumbleUp staff (this is RumbleUp's own GTM tooling) · **`ADMIN`** = platform admin.

| Method | URI | Purpose | Access | Req |
|---|---|---|---|---|
| GET, PUT | `/hubspot/config` | Sync config — enabled · dry-run · throttle rate · syncable-event set · maps | ADMIN | hubspot-1.5 / 1.6 |
| POST | `/hubspot/resync` | Operator-triggered resync — `{ scope: account|user|tcr, since? }` (re-emit / re-batch) | STAFF | hubspot-3.1 |
| POST | `/hubspot/resync/{entity}/{id}` | Resync a single record (re-upsert one company/contact) | STAFF | hubspot-1.2 |
| GET | `/hubspot/status` | Sync health — queue depth · backpressure · last batch · auto-pause state | STAFF | hubspot-5.1 |
| GET | `/hubspot/health` | Liveness / readiness (consumer + delivery) | - | hubspot-7.1 |

# eof
