#
# i360 integration
#

# Objective

Connect an account's **i360** subscription as a **voter / consumer data layer** for the platform: **enrich** a
RumbleUp [contact](../../core/contact/SPECS.md) with i360's modeled attributes — **partisanship + ideology scores,
turnout / persuasion models, demographics, the voter-file linkage** — and **sync audiences** (match-list segments)
between i360 and the platform for targeting. *"Append the i360 turnout score + party model to this contact, then
only text the persuadable middle."* *"Push this RumbleUp segment to i360 as an audience, match it against the voter
file, and pull back the modeled universe."* This is **mainly a two-way sync — data-enrichment-first**, audience
push/pull second; i360 is the **data source**, the platform's channels are the **engagement**.

i360 is a **conservative voter-data / analytics platform** built on the **national voter file + consumer data**.
Its value here is **append + match**, not real-time events: enrichment runs as a **workflow `enrich` node**
([workflow](../../core/workflow/SPECS.md) action — `enrich` / `sync-crm`) or a **batch match job**, and audiences
move as **bulk push/pull**, so i360 is **less webhook-trigger-y** than a CRM like [Blackbaud](../blackbaud/SPECS.md)
or a storefront like [Shopify](../shopify/SPECS.md) — there is **no rich live trigger stream**, the headline is the
**batch match + enrichment + audience sync**.

i360 is **account-connected** (the account brings *their* i360 subscription + data license), so it lives under
**[marketplace](../../core/marketplace/SPECS.md)** governance — **per-account API key / OAuth**, the **Zapier
governance pattern** ([zapier](../zapier/SPECS.md): accept-to-enable · cross-border gate · metering · egress
feature-flag × permission). **The account is the controller.** This is **not a new data plane**: enrichment +
match ride the **connector runtime** ([marketplace](../../core/marketplace/SPECS.md) `MarketplaceActionJob`); bulk
match rides the **batch / sync framework**; engagement rides the **channels behind `canSend()`**; secrets ride the
**marketplace vault**.

> **Voter data is the sharp edge.** i360's voter + consumer data is **highly sensitive** and **licensed**, not
> owned — the account's **i360 data-license terms** (permitted use, redistribution limits, retention) govern what
> may be appended, stored, and acted on. That license is **between the account and i360**, **not ours to grant** —
> a standing **compliance gap** (gap #8). We **disclose + meter + gate**; the account is responsible for staying
> within its license.

# Role & boundaries

**Owns:**
* The **i360 enrichment contract** — which i360 attributes (scores · models · demographics · voter-file linkage)
  map to which RumbleUp **custom fields** ([contact](../../core/contact/SPECS.md) `contact-2.0` — voter id is a
  **custom field**, not a system field), and the **append shape** an `enrich` node returns.
* The **match → contact resolution** — resolve a RumbleUp contact to an i360 record (by name + address + phone /
  email, i360's match logic), store i360's id in **[`externalRefs`](../../core/contact/src/model/ContactModel.ts)**
  (`{ i360: { id } }`), and surface match confidence.
* **Audience push/pull** — push a RumbleUp [segment](../../core/contact/SPECS.md) to i360 as a match-list audience;
  pull an i360 modeled universe back as a segment (membership snapshot, contactIds resolved).
* **Batch match / enrichment jobs** — bulk-match + bulk-append over a segment or import, throttled + chunked.
* **Enrichment freshness** — re-enrich on a cadence (models refresh between election cycles) and on demand.

**Delegates / does NOT do:**

| Concern | Owner |
|---|---|
| **API key / OAuth + credential vault + catalog + cross-border gate + metering** | **[marketplace](../../core/marketplace/SPECS.md)** (Zapier governance pattern) |
| **The `enrich` / `sync-crm` action node + the trigger graph** | **[workflow](../../core/workflow/SPECS.md)** (i360 contributes a typed `integration-action`) |
| **The custom-field definitions + the appended values + segments + consent** | **[contact](../../core/contact/SPECS.md)** (i360 writes through its sync API) |
| **The engagement send** (SMS / email) + **consent / suppression / quiet-hours** | the **channel** + **`canSend()`** ([texting](../../core/texting/SPECS.md)) |
| **Audience / segment evaluation at scale** | **search** (contact delegates; i360 pushes/pulls membership) |
| **Pacing / retry / DLQ / fair-share** of match + audience jobs | the shared **connector / batch framework** |
| **The voter-data license** (permitted use / redistribution / retention) | **the account ↔ i360** (we disclose + meter; not ours to grant — gap #8) |

> **No PII reach-down; the account is controller.** i360 is the **account's** licensed source. When a contact is
> forgotten, erasure here = **stop-enriching + purge the appended values on the contact + disclose**, not
> reach-in-delete of i360's file (the [egress erasure boundary](../../../docs/SPECS.md)). The appended i360 values live
> on the contact as **custom fields** and **purge on forget** like any PII ([contact](../../core/contact/SPECS.md)
> classification).

# Core concepts

* **Connection (subscription)** — an account's connected i360 subscription: the API key / OAuth grant (vaulted in
  marketplace), the licensed data scope, and connection health. Lifecycle is the marketplace
  `enable → connect → active → pause → remove` (+ **auto-pause** on account-inactive / license lapse).
* **Enrichment append** — i360 attributes appended to a contact: **modeled scores** (turnout, persuasion,
  partisanship / ideology, issue models), **demographics** (age band, gender, ethnicity model), and the
  **voter-file linkage** (a voter id custom field + registration / vote-history flags). Each maps to a RumbleUp
  **custom field** ([contact](../../core/contact/SPECS.md) `contact-2.2`), flagged **sensitive / optional**
  (`contact-2.7`) — voter + modeled data is **GDPR Art 9-adjacent** (political opinion).
* **Match** — resolving a RumbleUp contact to an i360 record. i360 matches on name + address (+ phone / email);
  the connector stores i360's id in **`externalRefs.i360`** and records **match confidence** so a low-confidence
  append can be skipped or flagged. Match is the prerequisite for both enrichment and audience pull.
* **Audience** — a match-list segment moved between systems. **Push** a RumbleUp [segment](../../core/contact/SPECS.md)
  to i360 (the connector sends the audience's match keys, i360 matches → a modeled universe); **pull** an i360
  universe back into a RumbleUp **segment** (membership = resolved contactIds, snapshotted like any segment,
  `contact-4.2`).
* **`enrich` node** — the workflow [action node](../../core/workflow/SPECS.md) (`enrich` / `integration-action`) a
  journey invokes: *"on contact added → enrich from i360 → branch on turnout score."* The connector runs the
  append with the account's vaulted credential; the result writes through [contact](../../core/contact/SPECS.md).
* **Enrichment as a signal, never a bypass** — an appended score targets / branches, but it **does not authorize a
  send**: every engagement still runs **`canSend()`** ([contact](../../core/contact/SPECS.md) consent /
  suppression / STOP / quiet-hours / 10DLC). A high persuasion score never overrides an opt-out.

# Architecture & flow

```
 ENRICHMENT  (the headline — append, not events)
   workflow `enrich` node ──► i360 CONNECTOR (MarketplaceActionJob)
        • resolve contact → i360 match (name+addr+phone/email) → externalRefs.i360 (+ confidence)
        • append: scores · demographics · voter-file linkage → map to RumbleUp custom fields
        └─► write through contact sync API  (custom-field values; sensitive/optional; purge-on-forget)
                 └─► back to the journey: branch on score (turnout / persuasion / party)
                          └─► engagement: send-text / send-email …  (ALWAYS via canSend())

 BATCH MATCH / ENRICHMENT  (bulk — segment or import)
   segment / import ──► batch match job ── chunk + throttle (i360 rate / cost)
        └─► match each → externalRefs.i360 ; append values ; report unmatched
                 (no live triggers — i360 is append/match, not a webhook stream)

 AUDIENCE SYNC  (push / pull)
   PUSH: RumbleUp segment ──match keys──► i360 (match-list audience) ──► modeled universe
   PULL: i360 modeled universe ──► resolve to contactIds ──► RumbleUp segment (snapshot)

 AUTH:  per-account i360 API key / OAuth → vaulted via the marketplace broker (reference-only)
 LICENSE: the account's i360 data-license governs permitted use — disclosed + metered, not ours to grant
```

* **Append-first, idempotent.** Enrichment is a **read-then-append**, keyed by `externalRefs.i360`; re-enriching
  the same contact **overwrites the same custom fields** (no duplicate appends), and a redelivered batch chunk
  re-matches the same records. There is **no live event stream** to dedupe — i360 is **pull**, not push.
* **No new engine.** Match + append = the marketplace **connector runtime** (`MarketplaceActionJob`, egress-gated +
  `WorkQueue`-paced); bulk = the shared **batch / sync framework**; targeting = [contact](../../core/contact/SPECS.md)
  segments; send = the channels + `canSend()`. i360 adds a **connector + attribute map**, not infrastructure.

# Data enrichment & audiences

The i360-distinctive surface: **enrichment (append + match)** and **audience push/pull** — *not* a heavy
real-time trigger catalog (i360 has no meaningful live event stream; it's a **batch match + append** source). The
enriched attribute set and the audience operations are **config** (add an attribute = a map entry).

**Enrichment — appended attributes (→ RumbleUp custom fields)**

| i360 attribute group | Example fields | RumbleUp field type | Notes |
|---|---|---|---|
| **Voter-file linkage** | voter id · registration status · party registration · vote-history flags | `string` / `choice` / `boolean` | voter id is a **custom field** (`contact-2.2`), not a system field |
| **Partisanship / ideology models** | party model · ideology score · partisan-lean | `number` / `choice` | **GDPR Art 9-adjacent** (political opinion) — flagged **sensitive / optional** (`contact-2.7`) |
| **Behavioral models** | turnout score · persuasion score · issue-support models | `number` | the primary **targeting / branch** dimensions |
| **Demographics** | age band · gender · ethnicity model · household | `choice` / `string` | modeled, not asserted — flagged sensitive where applicable |
| **Match metadata** | i360 record id · **match confidence** | `externalRefs.i360` + `number` | id in `externalRefs`; confidence drives skip / flag |

* **Append → custom fields, not system fields.** Every i360 value lands in an account **custom field**
  ([contact](../../core/contact/SPECS.md) `contact-2.0`), **declaratively mapped** (i360 attribute → field key +
  type + value translation) — adding an appended attribute is a **map entry**, not code (the
  [HubSpot](../hubspot/SPECS.md) declarative-map stance). Sensitive groups (party / ideology / demographics) are
  **flagged + kept optional** (`contact-2.7`) and **purge on forget**.
* **Match confidence gates the append** — a low-confidence match can **skip** the append or write it **flagged**,
  configurable per account, so a bad match never silently poisons a contact's targeting.
* **Freshness / re-enrich** — models refresh between cycles; the connector re-enriches on a **cadence** (EventBridge
  schedule) and **on demand** (an `enrich` node or a manual resync), overwriting the same fields in place.

**Audience push / pull**

| Operation | Direction | What moves | Result |
|---|---|---|---|
| **Push audience** | RumbleUp → i360 | a [segment](../../core/contact/SPECS.md)'s match keys (name + addr + phone/email) | an i360 **match-list audience** → a modeled universe i360 holds |
| **Pull universe** | i360 → RumbleUp | an i360 modeled universe (a built target list) | a RumbleUp **segment** (membership = resolved contactIds, **snapshotted** `contact-4.2`) |
| **Refresh** | either | re-run match / re-pull on cadence or demand | updated segment membership (user-accepted refresh, `contact-4.3`) |

> **Audiences compose in workflow + campaign.** i360 supplies the **modeled universe** (who, by score); the
> **journey** (wait, branch, send) is authored in [workflow](../../core/workflow/SPECS.md) and the **send-time
> freeze** is [campaign](../../core/campaign/SPECS.md)'s — i360 just says *who matches* + *the model facts*. No raw
> voter PII rides the bus: audiences move as **contactIds + match keys** through the connector, not on Kafka.

# Person → contact resolution & consent

* **Resolve → `contactId`.** Enrichment + pull always run against an existing RumbleUp **contact**: the connector
  resolves by normalized name + address (+ E.164 phone / lowercased email) and stores i360's id in the contact's
  **`externalRefs.i360`** ([contact `externalRefs`](../../core/contact/src/model/ContactModel.ts)). i360 is a
  **read source** — it **does not create** RumbleUp contacts from the voter file (no unsolicited PII ingest); a
  pulled universe resolves only to **contacts the account already holds** (unmatched → reported, not auto-created).
* **No raw PII on the bus.** Appended values write through the [contact](../../core/contact/SPECS.md) sync API as
  **custom-field values on a `contactId`**; the connector's match keys stay inside the connector call — events on
  the bus carry **`contactId` + non-PII facts** (which attributes refreshed), never raw voter PII (the
  [analytics](../../core/analytics/SPECS.md) / [Shopify](../shopify/SPECS.md) discipline).
* **Consent is independent of enrichment.** i360 supplies **targeting data**, **not** consent — a turnout or
  persuasion score is a **signal**, never a permission. **`canSend()` always governs** the actual send
  ([contact](../../core/contact/SPECS.md) consent / suppression / STOP / quiet-hours / 10DLC); an i360 universe
  membership never overrides a platform opt-out.
* **Forget fan-out.** On GDPR/CCPA forget, the appended i360 custom-field values **purge** with the contact's other
  PII ([contact](../../core/contact/SPECS.md) `contact-10.3`); the `externalRefs.i360` link is cleared so the
  tombstone can't be re-matched. We do **not** reach into i360's file — that's the account's controller obligation
  with i360 (egress erasure boundary).

# Conversion & attribution

* i360 is a **targeting / data** source, **not** a commerce/goal source — it has **no native conversion event**
  (contrast [Blackbaud](../blackbaud/SPECS.md) gifts or a [Shopify](../shopify/SPECS.md) order). i360 does **not**
  feed the [analytics](../../core/analytics/SPECS.md) **`converted`** contract (`analytics-6.5`).
* What i360 *does* feed attribution is the **audience / model dimension**: an i360 modeled universe is the
  **segment** a campaign targets, so [analytics](../../core/analytics/SPECS.md) can break engagement + downstream
  conversions **by i360 model band** (e.g. turnout-score decile) at the **campaign / audience** level — the
  *targeting* side of attribution, not the conversion event itself. The actual goal event (a donation, a pledge)
  arrives from a **fundraising integration** ([ActBlue](../actblue/SPECS.md) / [WinRed](../winred/SPECS.md) /
  [Blackbaud](../blackbaud/SPECS.md)), keyed to the same `contactId`.

# Auth & governance

* **Per-account API key / OAuth.** The account connects *their* i360 subscription per i360's API (an **API key**
  or **OAuth** grant); credentials are **minted / validated + vaulted via the
  [marketplace](../../core/marketplace/SPECS.md) broker**, auto-refreshed (OAuth), revocable — the
  [zapier](../zapier/SPECS.md) auth model. The connector holds a **reference**, never the raw key.
* **Least privilege.** Request only the i360 API scopes the enabled enrichment + audience operations need
  (match / append read; audience push/pull) — no broader file access than the account's use requires.
* **Marketplace / Zapier governance.** i360 is a **[marketplace](../../core/marketplace/SPECS.md)
  `IntegrationDefinition`** (category **`ANALYTICS`** / CDP, vertical **political**) under the **Zapier governance
  pattern** ([zapier](../zapier/SPECS.md)): **accept-to-enable** (terms / privacy **+ the i360 data-license
  acknowledgment**), **per-account credential**, the **`dataJurisdiction` cross-border gate**, **metering**
  (matches / appends / audience syncs), and **egress = feature-flag × the connecting user's permission**. The
  **account is the controller**; the connector **contributes the `enrich` + audience action nodes** to workflow,
  scoped to what the account connected.
* **Data-license acknowledgment (i360-specific).** Beyond the ordinary sub-processor accept, enabling i360 surfaces
  an **explicit acknowledgment** that voter / consumer data use is bound by the **account's i360 data-license
  terms** (permitted use, redistribution limits, retention) — disclosed + **audited** on the installation. The
  license itself is **the account's, not ours** (gap #8).
* **Kill switches** — disable / **dry-run** (log the intended match + append, write nothing) / pause the connection
  (AppConfig + the marketplace lifecycle).

# Reliability

* **Idempotent append + match** — enrichment keyed by `externalRefs.i360`; re-enrich overwrites the same custom
  fields (no duplicate appends); a redelivered batch chunk re-matches the same records — no double-count of
  metered appends.
* **Batch chunking + throttle** — bulk match / enrichment over a segment runs **chunked**, riding the shared
  **token-bucket × per-account fair-share** throttle against i360's **rate / cost** limit (the
  [SMS-provider throttle](../../core/texting/SPECS.md) / [zapier](../zapier/SPECS.md) `zapier-6.3` pattern); 429 /
  5xx → **computed-delay requeue** → DLQ → **auto-pause + alert** ([monitor](../../core/monitor/SPECS.md)) —
  **reused, not reinvented**.
* **Unmatched reporting** — a batch reports **matched / unmatched / low-confidence** counts (the
  [contact import](../../core/contact/SPECS.md) error-report shape); unmatched records are **never** auto-created
  as contacts.
* **No live trigger backfill** — i360 has no event stream to replay; "go back in time" = **re-run the batch match**
  over a segment, rate-limited + license-aware.

# Out of scope

* **i360's own analytics / modeling UI** — we **consume** i360's models; we don't build voter models or run i360's
  dashboards.
* **Creating RumbleUp contacts from the voter file** — i360 is a **read / append** source for contacts the account
  already holds; bulk-importing the voter file as new contacts is **not** this integration (and is a sharp
  license + consent question — out of scope).
* **FEC / campaign-finance reporting** — how the account uses i360 data within election law is **the account's
  concern** (the account is controller); we don't file or validate reports.
* **Real-time voter-file change triggers** — i360 isn't event-shaped; if i360 ever exposes a live change feed, it
  slots in as a connector trigger later (deferred).

# AWS Services and Other Dependencies

**AWS services**
* **SQS** (+ **DLQ**) — `MarketplaceActionJob` enrichment / match workers + batch chunks + retry.
* **Kafka (MSK)** — **non-PII** enrichment-complete signals (`contactId` + which attributes refreshed) → workflow /
  analytics; **no raw voter PII** on the bus.
* **EventBridge Scheduler** — re-enrichment **cadence** + audience-refresh schedule.
* **DynamoDB** — connection state · match / batch-job state · idempotency (i360 ids live on the contact's
  **`externalRefs`**, appended values on the **contact**, not a separate store).
* **Redis (ElastiCache)** — batch throttle (token-bucket × fair-share) + breaker state.
* **Secrets Manager** (+ **KMS**) — the per-account i360 API key / OAuth tokens (**via marketplace**).
* **API Gateway** — the small `/i360/*` config / health / manual-enrich + resync surface.

**Third-party**
* **i360 API** (match / enrichment / audiences) — **i360 is a sub-processor** of the account's data; the account's
  **i360 data-license** governs voter / consumer-data use.

**Internal (`@repo/*`) + services**
* `@repo/services` (Sqs, Kafka, Dynamo, Cache, SecretsManager, Kms), `@repo/endpoint` (`Access`), `@repo/common` (`Type`).
* Composes **[marketplace](../../core/marketplace/SPECS.md)** (credential vault / catalog / governance / connector
  runtime), **[workflow](../../core/workflow/SPECS.md)** (`enrich` + audience action nodes), **[contact](../../core/contact/SPECS.md)**
  (match resolution / custom-field append / segments / consent / `externalRefs`), **[texting](../../core/texting/SPECS.md)
  + `canSend()`** (engagement), **[analytics](../../core/analytics/SPECS.md)** (model-band breakdowns), **[monitor](../../core/monitor/SPECS.md)**
  (health / backpressure).

# Compliance & standards mapping

How **this i360 integration's** controls map to **OWASP Top 10 (2021)**, **ISO/IEC 27001:2022** (Annex A),
**SOC 2** (TSC), **GDPR**, **CCPA/CPRA**, and **messaging law**. i360 is an **account-controlled data-enrichment**
integration over **highly sensitive, licensed voter / consumer data** — its dominant controls are the
**voter-data license boundary**, **sensitive-data classification** (political opinion ≈ GDPR Art 9),
**credential custody**, **no-raw-PII-on-the-bus**, **consent independence** (model ≠ permission; `canSend()`
governs), and the **egress erasure boundary**. **No PCI** (no payment data); **no PHI**.

**Legend:** ✅ meets/exceeds · ⚠️ partial / open — see Gaps · ➖ n/a

| i360 control | OWASP T10 | ISO 27001:2022 | SOC 2 (TSC) | GDPR | CCPA | Messaging | |
|---|---|---|---|---|---|---|---|
| **Credential custody** — per-account API key / OAuth in the **marketplace vault** (Secrets Manager + KMS); reference-only | A02 / A05 | A.8.24 / A.5.17 | CC6.1 | Art 32 | ➖ | ➖ | ✅ |
| **Voter-data license boundary** — voter / consumer data is **licensed** (account ↔ i360), not owned; permitted use / redistribution / retention is the **account's license**; we disclose + meter + acknowledge, **not grant** | A08 | A.5.19–.23 / A.5.34 | CC9.2 | Art 6 / 28 | §1798.140 | ➖ | ⚠️ account-licensed *(gap #8)* |
| **Sensitive-data classification** — party / ideology / demographic models ≈ **GDPR Art 9** (political opinion); appended as **flagged, optional** custom fields; **purge on forget** | ➖ | A.5.34 / A.8.10 | (Privacy) | **Art 9** | §1798.140 (sensitive) | ➖ | ✅ flagged + optional |
| **Consent independence** — an i360 model is a **targeting signal**, never a send permission; **`canSend()` always governs** | A04 | A.5.34 | CC6.1 | Art 6 / 7 | §1798.120 | **TCPA / opt-in** | ✅ |
| **No raw PII on the bus** — appended values write through contact on a **`contactId`**; events carry which attributes refreshed, not raw voter PII | A09 | A.8.11 | (Privacy) | Art 5(1)(c) | §1798.100 | ➖ | ✅ |
| **No unsolicited ingest** — i360 is **read / append** for existing contacts; the voter file is **not** bulk-created as contacts | A04 | A.5.34 | (Privacy) | Art 5(1)(b) | §1798.100 | ➖ | ✅ |
| **Match integrity + idempotency** — keyed by `externalRefs.i360`; re-enrich overwrites in place; low-confidence skip/flag; redelivery-safe | A08 | A.8.26 | CC7.1 | Art 5(1)(d) | ➖ | ➖ | ✅ |
| **Egress erasure boundary** — appended values **purge on forget**; we **stop-enrich + purge + disclose**, never reach into i360's file (account is controller) | A04 | A.8.10 | (Privacy) | Art 17 | §1798.105 | ➖ | ✅ |
| **Cross-border gate** — an EU account enabling i360 (`dataJurisdiction`) takes the marketplace transfer escalation | A08 | A.5.14 | CC6.7 | Art 44–49 | ➖ | ➖ | ✅ |
| **Batch throttle + backpressure** — i360 rate / cost → token-bucket × fair-share; 429 → requeue → DLQ → auto-pause + alert | A08 | A.8.26 | CC7.1 | Art 32 | ➖ | ➖ | ✅ |
| **Least-privilege scopes** — request only the match / append / audience scopes the enabled ops need | A01 | A.5.15 / A.8.2 | CC6.1 / CC6.3 | Art 25 | ➖ | ➖ | ✅ |
| **Audit** — connect / disconnect / config + **license acknowledgment** + manual resync audited | A09 | A.8.15 | CC7.2 | Art 30 | ➖ | ➖ | ✅ |

> **Design-intent mapping** — how the integration is *intended* to satisfy each control, not an attestation.

# Gaps & decisions

*The one review list.* ✅ = resolved/decided · ⚠️ = **open — needs attention**.

1. ✅ **Archetype — DECIDED: two-way sync, enrichment-first.** i360 is **append + match** (the `enrich` node /
   batch match) + **audience push/pull** — **not** a live trigger stream. It contributes the `enrich` + audience
   action nodes to [workflow](../../core/workflow/SPECS.md); no rich webhook catalog (i360 isn't event-shaped).
2. ✅ **Governance — DECIDED: marketplace / Zapier pattern.** Per-account API key / OAuth, accept-to-enable,
   cross-border gate, metering, egress feature-flag × permission; **account = controller** — same posture as
   [Shopify](../shopify/SPECS.md) / [HubSpot](../hubspot/SPECS.md)'s external flavor.
3. ✅ **Append target — DECIDED: custom fields, declaratively mapped.** i360 attributes map to RumbleUp **custom
   fields** ([contact](../../core/contact/SPECS.md) `contact-2.0`); voter id is a custom field (not a system
   field); adding an attribute is a **map entry**, not code (the [HubSpot](../hubspot/SPECS.md) stance).
4. ✅ **Identity — DECIDED: resolve to an existing `contactId`; never auto-create.** Match stores i360's id in
   **`externalRefs.i360`** with confidence; i360 is **read / append** — the voter file is **not** bulk-created as
   contacts (no unsolicited PII ingest).
5. ✅ **Sensitivity — DECIDED: party / ideology / demographics are Art 9-adjacent.** Appended as **flagged,
   optional** custom fields (`contact-2.7`); **purge on forget**.
6. ✅ **Consent — DECIDED: model ≠ permission.** Scores are **targeting signals**; **`canSend()` always governs**
   the send (TCPA / STOP / quiet-hours / 10DLC).
7. ✅ **No conversion source — DECIDED.** i360 has no native goal event; it feeds attribution as the
   **audience / model dimension**, not the [analytics](../../core/analytics/SPECS.md) `converted` event — the goal
   event comes from a fundraising integration ([ActBlue](../actblue/SPECS.md) / [WinRed](../winred/SPECS.md) /
   [Blackbaud](../blackbaud/SPECS.md)).
8. ⚠️ **Voter-data license terms — OPEN (account's, not ours).** The account's **i360 data-license** (permitted
   use, redistribution, retention) governs what may be appended / stored / acted on. It is **between the account
   and i360** — **not ours to grant**. We **disclose + acknowledge (accept-to-enable) + meter + gate**; staying
   within the license is the **account's** obligation. The standing risk: we cannot technically enforce a contract
   we aren't party to — surfaced, acknowledged, audited, but **not resolved by code**.

# Requirements (traceable register)

The traceable register for the **i360 integration** (IDs **`i360-N.M`**). **Priority:** **A** = MVP, **B** = core /
hardening, **C** = later. **Boundary:** i360 owns the **enrichment contract + match resolution + audience
push/pull + batch match**; credential / vault / governance = [marketplace](../../core/marketplace/SPECS.md),
`enrich` + audience nodes = [workflow](../../core/workflow/SPECS.md), custom-field append + segments + consent =
[contact](../../core/contact/SPECS.md), sends + consent = channels / `canSend()`.

## i360-1.0 Connection & auth — A
- **i360-1.1** **Per-account API key / OAuth** — validated + **vaulted via marketplace**; connector holds a reference, never the raw key *(gap #2)* — A
- **i360-1.2** **Lifecycle** — `enable → connect → active → pause → remove`; **auto-pause** on account-inactive / license lapse; **least-privilege** API scopes (match / append / audience — only what's enabled) — A
- **i360-1.3** **Data-license acknowledgment** — accept-to-enable surfaces the **i360 data-license** acknowledgment (permitted use / redistribution / retention); disclosed + **audited** *(gap #8)* — A

## i360-2.0 Enrichment (append + match) — A
- **i360-2.1** **Match → contact** — resolve a contact to an i360 record (name + addr + phone/email); store i360 id in **`externalRefs.i360`** + **match confidence** *(gap #4)* — A
- **i360-2.2** **Append → custom fields** — i360 attributes (scores · models · demographics · voter-file linkage) **declaratively mapped** to RumbleUp custom fields ([contact](../../core/contact/SPECS.md)); adding an attribute = a map entry *(gap #3)* — A
- **i360-2.3** **Sensitive flagging** — party / ideology / demographic models flagged **sensitive + optional** (`contact-2.7`, Art 9-adjacent); **purge on forget** *(gap #5)* — A
- **i360-2.4** **Match-confidence gate** — low-confidence match **skips or flags** the append (account-config) — B
- **i360-2.5** **`enrich` node** — the [workflow](../../core/workflow/SPECS.md) `enrich` / `integration-action` runs the append with the vaulted credential, writes through contact, returns the score for branching — A
- **i360-2.6** **Freshness / re-enrich** — re-enrich on a **cadence** (EventBridge) + **on demand**; overwrite the same fields in place — B

## i360-3.0 Batch match / enrichment — B
- **i360-3.1** **Bulk match + append** over a [segment](../../core/contact/SPECS.md) / import — **chunked + throttled** (i360 rate / cost) — B
- **i360-3.2** **Unmatched reporting** — matched / unmatched / low-confidence counts (the contact import error-report shape); **never** auto-create contacts *(gap #4)* — B
- **i360-3.3** **Idempotent** — keyed by `externalRefs.i360`; re-run overwrites the same fields; no double-counted metered appends — B

## i360-4.0 Audience push / pull — B
- **i360-4.1** **Push audience** — a RumbleUp segment's match keys → an i360 match-list audience → a modeled universe — B
- **i360-4.2** **Pull universe** — an i360 modeled universe → a RumbleUp **segment** (membership = resolved contactIds, **snapshotted** `contact-4.2`) — B
- **i360-4.3** **Refresh** — re-run match / re-pull on cadence or demand; **user-accepted** segment refresh (`contact-4.3`) — C
- **i360-4.4** **No raw PII on the bus** — audiences move as contactIds + match keys through the connector, not on Kafka — A

## i360-5.0 Resolution, consent & privacy — A
- **i360-5.1** **Resolve to `contactId`** ([contact](../../core/contact/SPECS.md)); i360 is **read / append** — never auto-creates contacts from the voter file *(gap #4)* — A
- **i360-5.2** **Consent independence** — a model is a **targeting signal**; **`canSend()` always governs** the send *(gap #6)* — A
- **i360-5.3** **Forget** — appended i360 custom-field values **purge on forget**; clear `externalRefs.i360`; **stop-enrich + disclose**, never reach into i360's file (egress erasure boundary) — A
- **i360-5.4** **No raw PII on the bus** — appended values write through contact on a `contactId`; events carry which attributes refreshed, not raw voter PII — A

## i360-6.0 Governance & compliance — A
- **i360-6.1** **Marketplace / Zapier governance** — accept-to-enable · **`dataJurisdiction` cross-border gate** · metering (matches / appends / audience syncs) · egress feature-flag × permission; **account = controller** *(gap #2)* — A
- **i360-6.2** **Voter-data license boundary** — the account's i360 license governs use; we **disclose + meter + gate**, **not grant** *(gap #8)* — A
- **i360-6.3** **Kill switches** — disable / **dry-run** (log intended match + append, write nothing) / pause (AppConfig) — A
- **i360-6.4** **Audit** — connect / disconnect / config + license acknowledgment + manual resync — B

## i360-7.0 Reliability — B
- **i360-7.1** **Batch throttle + backpressure** — i360 rate / cost → token-bucket × fair-share + backpressure requeue → DLQ → **auto-pause + alert** ([monitor](../../core/monitor/SPECS.md)) — B
- **i360-7.2** **Idempotent throughout** — append + match keyed by `externalRefs.i360`; redelivery-safe — B

## i360-8.0 Infra — A
- **i360-8.1** **SQS + DLQ** (action / batch workers) · **Kafka** (non-PII enrichment signals) · **EventBridge Scheduler** (re-enrich / audience refresh) · **DynamoDB** (connection / job / idempotency state) · **Redis** (throttle) · **Secrets Manager + KMS** (via marketplace) · **API Gateway** (`/i360/*`) — A

# Endpoints (first cut)

A first pass, in [`@repo/endpoint`](../../../packages/endpoint/SPECS.md) style — service-prefixed `/i360/*`.
Enrichment is **node- + batch-driven** (workflow `enrich` → connector → contact), and audiences are
**push/pull jobs** — so the HTTP surface is **OAuth / key connect + config/health + operator enrich/resync**, no
per-record public API. **Access column:** **`-`** public/system · **`State`** = OAuth state-validated callback ·
account ladder `USER`<`ACCOUNT` · **`Internal`** = VPC-only S2S.

| Method | URI | Purpose | Access | Req |
|---|---|---|---|---|
| POST | `/i360/connections` | **Enable / connect** — API-key validate + store, or begin OAuth (**+ data-license acknowledgment**) | ACCOUNT | i360-1.1/1.3 |
| GET | `/i360/oauth/callback` | OAuth callback — exchange, **vault** token (state-validated) | State | i360-1.1 |
| GET, PUT | `/i360/connections/{id}/config` | Connection config — attribute map · match-confidence gate · re-enrich cadence · dry-run | ACCOUNT | i360-2.2/6.3 |
| POST | `/i360/connections/{id}/enrich` | Operator/manual enrich — `{ scope: contact|segment, id, attributes? }` (re-match + append) | ACCOUNT | i360-2.1/3.1 |
| POST | `/i360/connections/{id}/audience/push` | Push a segment to i360 as a match-list audience | ACCOUNT | i360-4.1 |
| POST | `/i360/connections/{id}/audience/pull` | Pull an i360 universe into a RumbleUp segment (snapshot) | ACCOUNT | i360-4.2 |
| GET | `/i360/connections/{id}/status` | Connection health — last enrich · batch progress · matched/unmatched · backpressure | USER | i360-7.1 |
| GET | `/i360/internal/enrich` | S2S: the connector runtime resolves a match + append for an `enrich` node | Internal | i360-2.5 |
| GET | `/i360/health` | Liveness / readiness (connector + batch) | - | i360-8.1 |

# eof
