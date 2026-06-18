#
# Analytics Service
#

# Objective

The platform's **business / engagement plane**: the centralized, append-only **event history** of
everything that happens to a message after it leaves us — sent, delivered, bounced, opened, clicked,
replied, opted-out, converted — across **every channel**, and the **aggregate queries + dashboards**
built on it. It answers *"how did this campaign / account / contact engage?"*, never *"is the system
healthy?"* (that's [monitor](../monitor/SPECS.md)).

The load-bearing ideas:
* **enrich at source, stream out** — the **channel service** owns the provider format *and* the operational
  reaction, attaches the platform ids, and emits a **normalized** event; analytics is the **central historian**.
  Analytics **never queries another service's operational store**, and operational services **never query the
  lake** for live status — the one rule that keeps the two planes from fusing;
* **one canonical event across every channel** — a single immutable event shape with a channel-specific `attrs`
  bag, so SMS, email, print scans, and link clicks land in **one stream you can join** — the basis for
  **cross-channel funnels + multi-touch attribution**;
* **insight, not system of record** — the event history is **append-only** (S3 raw → curated Parquet, queried by
  Athena); it derives **aggregates** from the stream and is explicitly **not** where you ask "what's the current
  state of message X" (that's the channel service);
* **a hot store in front of the lake** — recent aggregates live in **Redis / OpenSearch** for live dashboards so
  a page load **doesn't Athena-scan the lake** (the cost trap); the lake is for depth, the hot store for speed;
* **starts at the normalized event** — analytics does **not** parse raw provider webhooks, hold per-message
  status, or drive suppression; it begins where the channel's normalization ends.

# Role & boundaries (read this first)

Analytics is a **sink + warehouse + query layer**, not a webhook receiver and not a system of record
for operational state. It **consumes normalized engagement events** that the channel services emit,
stores them durably for cross-channel reporting, and serves aggregates. It does **not** parse provider
webhooks, hold current per-message status, or drive suppression.

| Concern | Owner |
|---|---|
| Receiving + **normalizing** provider webhooks (Twilio/SES/Bandwidth/Mailgun formats) | **texting / email** (channel services) |
| **Operational reactions** — current message status, retries, suppression on bounce/opt-out | **texting / email / dispatch / compliance** |
| **Link shortening + click capture** | **links/tracking** (click events flow here) |
| **Contact identity** (the stable `contactId`, PII) | **contact** |
| **Report files** (CSV/PDF, scheduling, delivery) | **report** (queries analytics) |
| **Operational/infra metrics, traces, logs** | **monitor** |
| **Event history, cross-channel joins, aggregates, dashboards, funnels** | **analytics** (this service) |

**Core principle (keep this):** *enrich at source, stream out.* The channel service owns the provider
format **and** the operational reaction, attaches the platform ids, and emits a normalized event;
analytics is the central historian. **Analytics never queries another service's operational store**,
and **operational services never query the lake** for live status.

# Out of scope (deferred)

* **Authoritative per-message status** — that's operational (channel services). Analytics derives
  aggregates from the event stream; it is not the place to ask "what's the current state of message X".
* **Predictive ML / send-time optimization** — a later layer *on top of* the warehouse, not v1.
* **Raw webhook ingestion** — channel services own it (provider-specific). Analytics starts at the
  normalized event.

# Core concepts

* **Event** — one normalized, immutable engagement fact (a delivery, a click, an opt-out…).
* **Event type** — the taxonomy below; the verb of the event.
* **Canonical schema** — one event shape across all channels, with a channel-specific `attrs` bag.
* **Rollup / aggregate** — precomputed counts (by account/campaign/channel/period) for fast reads.
* **Data lake** — append-only S3 (raw → curated Parquet), queried by Athena.
* **Hot store** — recent aggregates in Redis/OpenSearch for live dashboards (so we don't Athena-scan
  on every page load — the cost trap).

# The canonical event

```jsonc
{
  "eventId":         "uuid",            // our id (idempotency)
  "occurredAt":      "ISO-8601",        // provider event time (not ingest time)
  "ingestedAt":      "ISO-8601",
  "accountId":       "uuid",            // partition + tenant isolation
  "campaignId":      "uuid?",           // null for transactional / non-campaign
  "messageId":       "uuid",            // our send id
  "contactId":       "uuid",            // OPAQUE id only — never raw phone/email (see PII)
  "channel":         "sms|mms|email|push|whatsapp|rcs|voice",
  "provider":        "twilio|ses|bandwidth|mailgun|...",
  "eventType":       "delivered|...",   // taxonomy below
  "providerEventId": "string",          // for dedup
  "variant":         "string?",         // A/B variant, for attribution
  "attrs":           { }                // channel-specific (segments, userAgent, linkUrl, bounceType…)
}
```

**Event-type taxonomy** (normalized across providers):
* **Outbound lifecycle:** `queued`, `sent`, `delivered`, `delivery_failed`, `bounced` (+ `attrs.bounceType: hard|soft`), `rejected`.
* **Engagement:** `opened` (email), `clicked` (link — from links/tracking), `replied` (inbound).
* **Negative / compliance:** `opted_out` / `unsubscribed`, `complained` (spam report).
* **Conversion:** `converted` (a goal — see the attribution gap below), plus custom events.

**Dedup key:** `(provider, providerEventId)` — *not* `providerEventId` alone (not globally unique
across providers). Ingestion is **idempotent** on this key within a window.

# Product / behavior events (in-app)

A **second event family**, distinct from the channel-message events above: **in-app user behavior**
(navigation, feature usage, intent, friction) — first-party product analytics, **not Google Analytics**
(see [app BFF → Telemetry & analytics](../app/SPECS.md)). Same lake + query API, different shape + intake.

**Ingestion path** (separate from provider webhooks): the web app's `track()` **batches** events → **BFF
`/app/events` intake** → Kafka → analytics ingestion → S3 lake + rollups. **Capture / batching / delivery is
the [web app's job](../web/SPECS.md)** (buffer + periodic flush + `sendBeacon` on page-hide); analytics owns
this **catalog + usage**.

**Behavior event envelope:**
```jsonc
{
  "eventId":       "uuid",
  "occurredAt":    "ISO-8601",                // client time (UTC)
  "accountId":     "uuid",                    // identity-joined (first-party advantage over GA)
  "userId":        "uuid",
  "sessionId":     "string",
  "event":         "report.create.clicked",   // object.action — domain-meaningful
  "route":         "/campaigns/123",          // + fromRoute
  "transactionId": "uuid?",                   // correlates to RUM + backend traces
  "appVersion":    "string",
  "device":        { },                       // os/browser/… from @repo/common UserAgent
  "props":         { }                        // event-specific — OPAQUE ids only, NEVER PII
}
```

**Catalog (the meaningful set):**
* **Screen views** — `screen.viewed {route, fromRoute}` + time-on-screen → paths & funnels.
* **Dialog / drawer flows** — `dialog.opened` → `dialog.completed` | **`dialog.abandoned {step}`** (abandonment = where mini-flows die).
* **Feature usage** — `report.created`, `template.edited`, `workflow.published` → adoption / dead features.
* **Lifecycle / activation** — `onboarding.step.completed {step}`, first-key-action → activation + retention.
* **Intent / CTA** — `upgrade.clicked`, `export.requested`, `invite.sent` (**selective** — decisions, not every click).
* **Search & filter** — `search.performed {len, resultCount}`, **`search.zero_results`**, `filter.applied {facets}`.
* **UX friction** (≠ RUM JS crashes) — `form.validation_failed {field}`, rage/dead-clicks, empty-state hits.

**Client = intent, server = outcome.** The client does **not** emit `campaign.sent` / `payment.succeeded` —
those arrive as **Kafka domain events** (the canonical/outcome path). The client fires the *intent*
(`send.clicked`); analytics **joins intent → outcome** on `accountId` / `userId` / `sessionId` /
`transactionId`. **PII:** opaque ids only (search → length + result count, never the raw query);
**GDPR-forget** purges behavior events by `accountId` / `userId` (first-party = actually deletable).

# Architecture — ingestion pipeline

```
 provider webhook ─► channel service: a CHANNEL-SPECIFIC endpoint per provider
                       (e.g. POST /email/webhook/mailgun, /texting/webhook/twilio)
                       • verify at edge (signature/HMAC), light-validate, ACK fast
                       • enqueue raw to SQS ─► worker NORMALIZES provider format → canonical event + ids
                       • split:  time-sensitive (hard bounce / complaint / opt-out / failed)
                       │            └─► SYSTEM PRIORITY queue → operational reaction NOW (suppression, retry)
                       └─► bulk events ─► FAIR-SHARE queue (per-account) → worker → stream ─► analytics ingestion
                                                                            │
   analytics:  consumer ─► dedup (provider, providerEventId) ─► Kafka→S3 sink ─► S3 RAW (Parquet, partitioned)
                                                                            │
                              rollups (near-real-time: Lambda-consumed + scheduled) ─► curated tables + hot store (Redis/OpenSearch)
                                                                            │
   query API (RBAC-scoped) ◄── hot store (live) ── + ── Athena (historical) ──┘     report ◄── query API
```

* **Time-sensitive events take the operational path *first*** (suppression can't wait on the lake) and
  *also* land in analytics for history — the two are not either/or.
* **S3 partitioned** by `account / channel / date` (tenant isolation + deletion + cheap scans), stored
  as **Parquet** (columnar — Athena scans far less), with **compaction** of streaming small files.
* **Rollups** keep dashboards off raw Athena: precomputed hourly/daily aggregates by
  account/campaign/channel/event-type, computed **near-real-time by Lambda consuming Kafka** (+ scheduled
  passes). A **lateness / grace window** delays closing a period; a straggler after close **triggers a
  recompute** (rollups are not write-once).

# What analytics answers

* **Cross-channel engagement** by account, campaign, contact (the core ask).
* **Funnels** — sent → delivered → opened → clicked → converted, per campaign/variant.
* **A/B + attribution** — which variant earned the click/conversion.
* **Deliverability** — bounce/complaint/failure rates by provider/channel/domain (feeds provider
  fail-over decisions in dispatch).
* **Cohorts / retention / fatigue** — engagement over time; messages-per-contact-per-period.
* **Anonymized cross-account benchmarks** — the aggregate **"what"**, never the **"who"** (k-anonymity thresholds).

# Attribution (which touch earns the conversion)

Attribution lives **here** because it's a computation over the **cross-channel** event history — the
touches (sends/opens/clicks across email/SMS/mail/social) **and** the conversion — all of which land in
this lake. Workflow only *emits* touches and *ingests* conversions; campaign/report *display* the
result; analytics *computes* it.

* **Touch** — a trackable channel event tied to a `contactId` + `campaignId`/`variant` (a delivered
  message, an open, a **click** — the strongest intent signal). Each carries the channel it came from.
* **Conversion** — a goal event, primarily an **integration's commerce/goal event** (a Shopify order, a
  donation, a booking — see CHANNELS.md), tied to the same `contactId`.
* **Attribution** — within a **lookback window** before the conversion, assign credit to the
  contact's prior touch(es) for that account, by a chosen **model**.

**Models** (configurable; one is the account default):
| Model | Credit | When |
|---|---|---|
| **Last-touch** *(default)* | 100% to the **last** touch before conversion | simple, deterministic, the safe default |
| **First-touch** | 100% to the first touch | measuring acquisition source |
| **Linear** | split evenly across all touches | valuing the whole journey |
| **Time-decay** | more credit to touches nearer the conversion | long considered-purchase journeys |
| **Position-based (U)** | weighted to first + last, rest split | balance acquisition + closing |
| **Data-driven** *(later)* | model-learned weights | needs volume + ML; deferred |

* **Lookback window** — separate **click-through** (e.g. 7 days) and **view-through** (e.g. 1 day)
  windows; configurable per account/campaign. A conversion outside any touch's window is **organic**
  (unattributed) — don't over-credit.
* **Cross-channel by design** — a journey email → SMS → postcard → social retarget → order is one
  attribution chain; it only works because every channel's touches sit in **one** lake keyed by contact.
* **Reproducibility** — store the **model + window used** with each computed attribution (and snapshot
  on the campaign), so a report run later matches what was reported then (same rule as versioned specs).
* **Identity matters** — attribution needs the touch and the conversion on the **same `contactId`**.
  Addressed channels (email/SMS/mail) resolve cleanly; **social posts are 1:many + anonymous**, so they
  rarely attribute to an individual conversion — credit them at the **campaign/audience** level, not 1:1.

> **Attribution ≠ causation.** Last-touch especially over-credits the closer and ignores lift. For true
> *incrementality*, pair it with **holdout/control groups** (the campaign spec's holdout) — attribution
> says *who to credit*, a holdout says *whether the touch actually caused* the conversion. Surface both;
> don't let attributed numbers masquerade as incremental lift.

# Requirements

* **Idempotent, dedup'd ingestion** keyed on `(provider, providerEventId)`; tolerate provider
  **duplicates, out-of-order, and late-arriving** events (append-only handles arrival; rollups must be
  recomputable).
* **Append-only, immutable** lake; **never** the source of operational status.
* **Tenant isolation** — partitioned + RBAC-scoped so an account only sees its own data; platform
  staff get cross-account aggregates.
* **Query API** — the surface report/campaign/web read (not direct lake access); live reads hit the
  hot store, historical hit Athena.
* **Schema registry + versioning** — a single canonical schema with a versioned `attrs` contract
  (Glue Catalog); adding a channel/provider/event-type is backward-compatible.
* **Reprocessing/backfill** — keep enough raw to **re-normalize and rebuild** rollups if logic changes
  or a bug ships.
* **Cost controls** — Parquet + partition pruning + S3 lifecycle (hot→cold→Glacier); dashboards served
  from rollups, not ad-hoc scans.
* **Fair-share digestion** — webhook/event workers consume via the shared **`WorkQueue`** fair-share
  pattern (`@repo/services`): a **system priority** queue (time-sensitive events) drained first, plus a
  **per-account fair queue** so one account's burst can't monopolize workers and stall everyone else's.

# Gaps, issues & open decisions (the one review list)

*Open decisions are merged here — a single list to review.* ✅ = resolved/decided · ⚠️ = **open — needs attention**.

1. ✅ **GDPR vs an append-only lake — the biggest issue.** You can't surgically delete one contact from
   immutable S3/Parquet. **Resolution: store only the OPAQUE `contactId`, never raw PII** (no phone/
   email, and **enforce no-PII-in-`attrs`**). Then a GDPR "forget" is handled by the **contact**
   service's tombstone (keep the uuid shell, strip PII) — the lake's events become **unlinkable to a
   person** without mutating the lake. (Fallbacks if PII must live here: crypto-shredding with a
   per-contact key, or contact-partitioned deletes — both worse. Pick the no-PII rule.)
2. ✅ **Attribution model — DECIDED** (see **Attribution**): **multi-touch ships in v1** — last-touch
   (default), first-touch, linear, time-decay, position-based, **selectable per account/campaign**;
   **data-driven** deferred (needs volume + ML). Default window **click-through 7d / view-through 1d**
   (configurable). Remaining: confirm the default-window numbers with the first real campaigns.
3. ✅ **Conversion event source — DECIDED: flexible, integration-event first.** `converted` is a **pluggable
   conversion contract** — multiple sources can feed it (integration commerce/goal event · server-side postback ·
   tracking pixel · manual goal) — but the **starting point (v1) is the integration event**: a marketplace
   integration's **commerce/goal event** (a Shopify `order.placed`, a donation, a booking, a closed deal — see
   [CHANNELS](../../CHANNELS.md)) via **marketplace → workflow → analytics**, attributed back to the channel
   touch on the same `contactId`. Other sources (postback / pixel / manual goal) are added later **behind the
   same conversion-event contract** — no model / window change (those are settled in #2) (`analytics-6.5`).
4. ✅ **Dashboard freshness + rollup mechanism — DECIDED: near-real-time.** Analytics is **not real-time** —
   **near-real-time is fine**. Rollups are computed by **Lambda consuming the Kafka stream** (incremental) plus
   scheduled passes into curated tables / the hot store; the **inherent Kafka-backlog / Lambda lag is
   acceptable** (minutes, not seconds). No streaming-aggregation engine (Flink / Kafka Streams) needed.
5. ✅ **Small-files problem — DECIDED.** Three levers: **(1) compress** — **Parquet + ZSTD** (better ratio than
   Snappy/GZIP at similar speed, splittable → **less Athena scan = cheaper**). **(2) buffer at the sink** — the
   Kafka→S3 sink flushes on **size-or-time** (~128 MB or ~5–15 min) so files start large (near-real-time
   tolerates the minutes, #4). **(3) scheduled compaction** — once the grace window closes a partition (#8),
   **`AnalyticsScheduleJob`** rewrites its small files into a few **~128–512 MB** files (Glue/Spark or Athena
   `CTAS` / `INSERT INTO`); keep partitioning to **`account/channel/date`** (don't over-partition into tiny
   files). **Apache Iceberg** (built-in compaction + row-level deletes — would also help GDPR #1) is kept for
   **later consideration**, not v1.
6. ✅ **Identity resolution for unknown senders — DECIDED: resolved upstream by contact; unknown → opaque
   anon.** **Identity is [contact](../contact/SPECS.md)'s job, done upstream** — the channel receiving an inbound
   event resolves the sender value → `contactId` via contact's lookup (normalized E.164 / lowercased email,
   considering **all** of a contact's identifiers + the external-id GSI, `contact-1.8`), and the canonical event
   carries the **resolved `contactId`**. Analytics does **not** resolve identity itself.
   * **Multiple phones/emails** all map to the **same `contactId`** (contact is the multi-valued SoT) → deterministic.
   * **Unknown sender** (value matches no contact): the event is **still recorded** (it's real history) but
     attributed to an **opaque `anonId` = salted hash of the normalized value** (`contactId` = null) — **no raw
     PII** in the lake (#1 / #11), and repeat events from the same value **group** under one `anonId`.
   * **Late binding** — if that value is *later* mapped to a contact (auto-created / added — a **contact**
     decision, not analytics), **future events carry `contactId`**; historical `anonId` rows can be
     **re-attributed on a rollup recompute** (#8) or left anonymous.
   * **Attribution credits only known `contactId`s** — an `anonId` can't be 1:1 attributed (same rule as
     anonymous social posts, credited at campaign/audience level).
7. ✅ **Exactly-once vs at-least-once — DECIDED: at-least-once + dedup at every stage.** We **don't pursue
   exactly-once delivery** (expensive + fragile); we accept at-least-once and **dedup on a stable event id**
   everywhere, so a duplicate never double-counts:
   * **Ingestion** dedups on **`(provider, providerEventId)`** before the sink (`analytics-1.3`) — best-effort
     (a window / state store catches the common case).
   * **Rollups** are the **authoritative** dedup — aggregate **one row per event id** (dedup before `COUNT`); and
     because rollups are **recomputable** (#8) they can always be rebuilt correctly from raw.
   * **Query-time** (ad-hoc Athena over raw) **also dedups** (`ROW_NUMBER` / window over the event id), since a
     late duplicate can land in the append-only lake after the ingestion window closed (`analytics-4.5`).
   * **Every event carries a stable id** — provider events use `(provider, providerEventId)`; internally
     generated events (e.g. app-BFF behavior events) carry a **producer-assigned UUID** so they're equally
     dedupable. Rollup writes are **idempotent** (keyed on dimension + period) so recompute can't double-apply.
8. ✅ **Late events — DECIDED.** **Delay the rollup window** (a lateness / grace window) so most late-arriving
   events land before a period closes — analytics needn't be real-time. If an event **still** arrives after
   close, it **triggers a recompute** of that period (rollups are not write-once).
9. ✅ **Warehouse engine — DECIDED: S3 + Athena (for now).** **Athena over the S3 Parquet lake** is the
   historical-query engine (serverless, cheap, no cluster to run); **OpenSearch** stays the **hot store** for
   live / search; **Redshift is deferred** — added only if heavy BI / joins later demand it. Mirrors the
   DynamoDB-default / OLAP-is-separate stance in [DATABASE](../../../packages/services/DATABASE.md). **Revisit
   only if** Athena scan cost / latency at volume forces a dedicated warehouse.
10. ✅ **Webhook intake — DECIDED.** Provider delivery-receipt webhooks use **channel-specific endpoints
    per provider** (`/email/webhook/mailgun`, `/texting/webhook/twilio`) owned by the channel service
    (it owns the format), which **verify at the edge and enqueue to SQS** for a worker to digest — *not*
    the general 3rd-party intake (that stays for marketplace integration webhooks). The digest queues
    use the **fair-share** pattern (below) so one account's webhook burst can't starve others.
11. ✅ **PII in links / `attrs` — DECIDED.** Links carry **only UUIDs, no PII** — a `clicked` event stores the
    **link UUID** (resolve via the links service), never a PII-bearing destination URL or token; **no PII in
    `attrs`** is enforced (gap #1). Closes the GDPR re-introduction risk.
12. ✅ **Replay/ordering — DECIDED.** Every event carries **`occurredAt`**; derived/per-message state (and
    inbound `replied`) is **ordered by `occurredAt`**, not ingest order — so out-of-order arrivals (clicked
    before delivered, a late reply) sort correctly.
13. ✅ **Stream transport — DECIDED: Kafka, one backbone.** The engagement + behavior-event streams ride
    **Kafka** (the existing `@repo/services` facade); **no Kinesis** — a single streaming backbone. The S3 lake
    is fed by a **Kafka→S3 sink** (Kafka Connect), not a separate Firehose path.
14. ✅ **Cross-account benchmarks — DECIDED (anonymized).** We **will** aggregate analytics **across accounts**,
    but **anonymized**: it's about the **"what"** (aggregate patterns / metrics), **not the "who"** — no
    per-account or per-person identification, enforced with **minimum-cohort-size (k-anonymity) thresholds** so
    a benchmark can't be traced back to one account.

# Services & primitives to utilize

* **Kafka (MSK)** — the **single streaming backbone**: the engagement event stream from channel services
  **and** the in-app behavior-event stream from the [app BFF](../app/SPECS.md) `/app/events` intake. No Kinesis.
* **Kafka→S3 sink (Kafka Connect)** — buffered, Parquet-converting, partitioned delivery to S3 (replaces a
  separate Firehose path).
* **S3** — the append-only data lake (raw + curated), lifecycle-tiered.
* **Athena** (+ **Glue Catalog**) — serverless SQL over the lake; schema registry.
* **Redis / OpenSearch** — hot store for live dashboards + recent aggregates.
* **SQS** — ingestion buffering + the priority/fair-share split (time-sensitive vs bulk).
* **report** consumes the query API; **monitor** is the separate operational plane.

> **Open decisions** are no longer a separate section — they're folded into **Gaps, issues & open
> decisions** above (the ⚠️ items), so there's one list to review.

# Service & Job topology

**Convention (platform-wide).** Each service layers **framework base → domain base → concrete role**. A **domain
Service base** (`AnalyticsService extends Service`) and a **domain Job base** (`AnalyticsJob extends Job`) hold
the **shared domain code** — the **canonical-event** model, the **schema registry / versioning** client (Glue
Catalog), the **hot-store + Athena query** clients, the **attribution model** library, and **RBAC / tenancy**
scoping — so **every concrete role inherits it**. Analytics is shaped unusually: it's **a thin query API over a
fleet of compute jobs** — the read surface is one Service; nearly all the work is event- / schedule-driven Jobs.

```
Application
├── Service (Fastify, long-running — ECS)
│     └── AnalyticsService            (domain base — canonical-event model · schema registry (Glue) · hot-store + Athena clients · attribution lib · RBAC/tenancy; not deployed alone)
│           └── AnalyticsQueryService (the RBAC-scoped Query API: hot store live + Athena historical; the surface report/campaign/web read + internal deliverability reads for dispatch; schema/config admin)
└── Job (Lambda, event-driven)
      └── AnalyticsJob                (domain base — schema-validated canonical event · dedup · S3/Parquet · hot-store + Athena clients · idempotency)
            ├── AnalyticsIngestJob      (Kafka — dedup (provider,providerEventId) → normalize → sink to RAW S3 Parquet, partitioned account/channel/date)
            ├── AnalyticsRollupJob      (Kafka, near-real-time — curated rollups → hot store; lateness/grace + straggler recompute)
            ├── AnalyticsScheduleJob    (EventBridge — period close after grace · Parquet compaction · k-anon benchmark refresh · cost sweeps)
            ├── AnalyticsAttributionJob (on conversion — credit touches over the lookback window by the configured model; store model+window for reproducibility)
            ├── AnalyticsBackfillJob    (operator-triggered — re-normalize raw + rebuild rollups when logic/schema changes)
            └── AnalyticsForgetJob      (SQS — contact/account forget → obfuscate PII in the lake + drop from hot store)
```

**Services (HTTP, ECS Fargate)**

| Class | Extends | Role |
|---|---|---|
| **`AnalyticsService`** | `Service` | **Domain base** — canonical-event model · schema registry (Glue) · hot-store + Athena query clients · attribution lib · RBAC/tenancy scoping; **not deployed alone**. |
| **`AnalyticsQueryService`** | `AnalyticsService` | The **RBAC-scoped Query API** — **live** reads from the hot store (Redis/OpenSearch) + **historical** via Athena; the surface **report / campaign / web** read (and dispatch's **deliverability** reads for provider fail-over); schema / config admin. **Analytics' only HTTP role** — the compute is all Jobs. **User-facing exports are [report](../report/SPECS.md)'s**, not here. |

**Jobs (Lambda, event-driven)** — each extends `AnalyticsJob`:

| Class | Trigger | Role | Req |
|---|---|---|---|
| **`AnalyticsIngestJob`** | Kafka | **Dedup** `(provider, providerEventId)` → **normalize** to the canonical event → **sink to RAW S3** (Parquet, partitioned `account/channel/date`); idempotent, late/out-of-order tolerant | analytics-1.0 / 3.0 |
| **`AnalyticsRollupJob`** | Kafka (near-real-time) | Precompute **curated rollups** → hot store (keeps dashboards off raw Athena); a **lateness/grace** window + **straggler recompute** (rollups are not write-once) | analytics-4.0 |
| **`AnalyticsScheduleJob`** | EventBridge | Scheduled passes — **period close** after grace · **compaction** (rewrite closed partitions' small files → ~128–512 MB, Parquet+ZSTD) · **k-anon benchmark** refresh · **cost** sweeps | analytics-3.5 / 4.0 / 9.0 |
| **`AnalyticsAttributionJob`** | on conversion (Kafka/SQS) | Credit prior **touches** over the **lookback window** by the configured **model**; **store model + window** for reproducibility | analytics-6.0 |
| **`AnalyticsBackfillJob`** | operator-triggered | **Re-normalize raw + rebuild rollups** when normalization / schema logic changes (the reprocessing path) | analytics-8.0 |
| **`AnalyticsForgetJob`** | SQS (contact / account forget) | Analytics' part of the platform **forget fan-out** — **obfuscate PII** in the lake + **drop from the hot store** (rollups stay `contactId`-only) | analytics-8.0 |

> **Shared modules (not deployables).** The **canonical-event model + schema registry** (Glue Catalog,
> versioned `attrs`) and the **attribution model library** (last/first/linear/time-decay/position) are reused
> across the Query API + the jobs. The **hot-store + Athena query clients** live on the `AnalyticsService` base.
> **Ingestion source = Kafka** (channel services normalize → stream); the **operational** path (time-sensitive
> suppression/retry) is **not** analytics — it's the channel/dispatch path, and analytics only keeps the history.

# AWS Services and Other Dependencies

**AWS services**
* **Kafka (MSK)** — the single streaming backbone (engagement + behavior events).
* **Kafka Connect (Kafka→S3 sink)** — Parquet, partitioned delivery to the lake.
* **S3** — append-only data lake (raw + curated Parquet); lifecycle → Glacier.
* **Athena** (+ **Glue Catalog**) — serverless SQL over the lake + schema registry.
* **Lambda** — near-real-time rollup consumers (+ scheduled passes).
* **Redis (ElastiCache)** / **OpenSearch** — hot store for live dashboards.
* **SQS** — ingestion buffering + the priority / fair-share split.

**Third-party libraries / services** — none notable (channel providers' webhook formats are normalized upstream by the channel services before they reach analytics).

**Internal (`@repo/*`)**
* `@repo/services` (Kafka, S3, Dynamo, Cache, `WorkQueue`), `@repo/common` (`Type`, `UserAgent`), `@repo/endpoint` (`Access`).

# Requirements (traceable register)

The traceable requirement register for the **analytics service** (the narrative `# Requirements` + Attribution
sections above are the rationale; this is the coded list). IDs are stable handles (**`analytics-N.M`**) — cite
them in code, tickets, and tests. **Priority:** **A** = MVP (ship first), **B** = core feature / hardening,
**C** = later. One level of sub-requirements only; a group's priority is its floor. **Boundaries:** channel
services *emit* engagement events, the [app BFF](../app/SPECS.md) *emits* behavior events, report/campaign/web
*read* via the query API, [monitor](../monitor/SPECS.md) is the separate operational plane — analytics owns the
**lake, rollups, query API, and attribution**.

## analytics-1.0 Ingestion & the canonical event — A
- **analytics-1.1** Canonical event schema — one shape across channels + a channel `attrs` bag — A
- **analytics-1.2** Event-type taxonomy (lifecycle / engagement / compliance / conversion) — A
- **analytics-1.3** **Stable event id + idempotent dedup** — `(provider, providerEventId)`; internally generated events carry a **producer UUID** *(gap #7)* — A
- **analytics-1.4** Tolerate duplicates / out-of-order / late — order by **`occurredAt`** — A
- **analytics-1.5** **Kafka** single backbone (no Kinesis) → Lambda consumer — A
- **analytics-1.6** Fair-share digestion — priority + per-account `WorkQueue` — B
- **analytics-1.7** **Identity resolved upstream (contact)** — event carries the resolved `contactId`; **unknown sender → opaque `anonId`** (salted hash of the value, no PII), late-binding re-attribution on recompute *(gap #6)* — B

## analytics-2.0 Product / behavior events (in-app) — B
- **analytics-2.1** Behavior event envelope (`object.action`, opaque ids, **never PII**) — B
- **analytics-2.2** Intake via app BFF `/app/events` → Kafka (web app owns capture/batching) — B
- **analytics-2.3** Behavior catalog (screen / dialog / feature / lifecycle / intent / search / friction) — B
- **analytics-2.4** Intent→outcome join (`accountId` / `userId` / `sessionId` / `transactionId`) — B
- **analytics-2.5** First-party only; **GDPR-forget purges by account/user** — B

## analytics-3.0 Data lake (storage) — A
- **analytics-3.1** Append-only, immutable S3 (raw → curated Parquet) — A
- **analytics-3.2** Partition by `account / channel / date` (isolation + cheap scans + deletion) — A
- **analytics-3.3** **Kafka→S3 sink** (Kafka Connect, Parquet) — **size-or-time buffered** (~128 MB / ~5–15 min) so files start large — A
- **analytics-3.4** **No PII in the lake** — opaque `contactId` / `userId` only — A
- **analytics-3.5** **Parquet + ZSTD** compression + **scheduled small-file compaction** (rewrite closed partitions → ~128–512 MB, `AnalyticsScheduleJob`); **Iceberg deferred** *(gap #5)* — B
- **analytics-3.6** S3 lifecycle tiering (hot → cold → Glacier) — B
- **analytics-3.7** Reprocessing / backfill — rebuild rollups from raw — B

## analytics-4.0 Rollups & hot store — A
- **analytics-4.1** **Near-real-time** rollups — Lambda-consumed Kafka (+ scheduled) — A
- **analytics-4.2** Hot store (Redis / OpenSearch) for live dashboards — A
- **analytics-4.3** Lateness / grace window before a period closes — B
- **analytics-4.4** Late straggler → **recompute** the period (not write-once) — B
- **analytics-4.5** **Dedup at rollup + query time** on the stable event id (at-least-once → no double-count); rollup writes idempotent (dimension+period) *(gap #7)* — B

## analytics-5.0 Query API — A
- **analytics-5.1** RBAC-scoped query API (report/campaign/web read; **no direct lake access**) — A
- **analytics-5.2** Live reads → hot store; historical → Athena — A
- **analytics-5.3** Tenant isolation — account sees own; staff get cross-account aggregates — A

## analytics-6.0 Attribution — B
- **analytics-6.1** Multi-touch models (last/first/linear/time-decay/position) selectable per account/campaign — B
- **analytics-6.2** Lookback windows — click-through 7d / view-through 1d (configurable) — B
- **analytics-6.3** Cross-channel chain keyed by `contactId` — B
- **analytics-6.4** Reproducibility — store the **model + window used** (snapshot) — B
- **analytics-6.5** Conversion source — **pluggable contract, integration commerce/goal event first** (postback / pixel / manual added later behind the same contract) *(gap #3)* — B
- **analytics-6.6** Data-driven (ML) model — C
- **analytics-6.7** Pair with holdout/incrementality (attribution ≠ causation) — C

## analytics-7.0 Read models (what analytics answers) — B
- **analytics-7.1** Cross-channel engagement by account / campaign / contact — B
- **analytics-7.2** Funnels (sent → delivered → opened → clicked → converted) — B
- **analytics-7.3** A/B + attribution by variant — B
- **analytics-7.4** Deliverability (bounce/complaint/failure by provider/channel/domain) → feeds dispatch fail-over — B
- **analytics-7.5** Cohorts / retention / fatigue — C
- **analytics-7.6** **Anonymized** cross-account benchmarks — the "what", not the "who" (k-anonymity) — C

## analytics-8.0 Schema & governance — B
- **analytics-8.1** Schema registry + versioned `attrs` contract (Glue Catalog) — B
- **analytics-8.2** Backward-compatible add of channel / provider / event-type — B
- **analytics-8.3** No-PII enforcement in `attrs` **and links (UUIDs only)** — A
- **analytics-8.4** Warehouse engine — S3+Athena primary (OpenSearch live; Redshift only if BI) *(confirm — gap #9)* — B

## analytics-9.0 Cost controls — B
- **analytics-9.1** Parquet + partition pruning — B
- **analytics-9.2** Dashboards served from **rollups**, not ad-hoc Athena scans — A
- **analytics-9.3** S3 lifecycle tiering — B

## analytics-10.0 Infra footprint & dependencies — A
- **analytics-10.1** Kafka (MSK) backbone + Lambda consumers — A
- **analytics-10.2** S3 lake + Athena + Glue Catalog — A
- **analytics-10.3** Redis / OpenSearch hot store — A
- **analytics-10.4** SQS + `WorkQueue` (priority / fair-share) — B
- **analytics-10.5** Consumes app-BFF `/app/events`; serves report / campaign / web via the query API — A

## analytics-11.0 Service & Job topology — B
- **analytics-11.1** **Domain bases** — `AnalyticsService extends Service` + `AnalyticsJob extends Job` hold the shared domain code (canonical-event model · schema registry (Glue) · hot-store + Athena clients · attribution lib · RBAC/tenancy); **concrete roles extend the domain base** — B
- **analytics-11.2** **`AnalyticsQueryService`** — the RBAC-scoped Query API (hot store live + Athena historical); the read surface for report/campaign/web + dispatch deliverability; analytics' **only HTTP role** — A
- **analytics-11.3** **Jobs extend `AnalyticsJob`** — `AnalyticsIngestJob` / `AnalyticsRollupJob` / `AnalyticsScheduleJob` / `AnalyticsAttributionJob` / `AnalyticsBackfillJob` / `AnalyticsForgetJob`, each a Lambda on the shared base — A
- **analytics-11.4** **`AnalyticsIngestJob` (Kafka)** — dedup → normalize → sink to RAW S3 Parquet (the ingestion consumer) — A
- **analytics-11.5** **`AnalyticsRollupJob` (Kafka near-real-time)** — curated rollups → hot store; lateness/grace + straggler recompute — A
- **analytics-11.6** **`AnalyticsForgetJob` (SQS)** — platform forget fan-out: obfuscate PII in the lake + drop from hot store — B
- **analytics-11.7** **Shared modules** — canonical-event model + schema registry + attribution model library, reused across the Query API + jobs (not deployables) — B

# Endpoints (first cut)

A first pass at the endpoint surface, in [`@repo/endpoint`](../../../packages/endpoint/SPECS.md) style — all
service-prefixed **`/analytics/*`**; reads return the `{ data, page }` envelope with query-string filters
(time range, account, campaign, channel, event-type, granularity).

**Access column:** recommended **`minAccess`** on the `Access` ladder — **`-`** = public · account ladder
**`SENDER`<`USER`<`BILLING`<`ACCOUNT`** · staff ladder **`SUPPORT`<`APPLICATION`<`ROOT`** · **`⬆`** = also
step-up · **`Internal`** = VPC-only S2S. A senior role satisfies any junior minimum.

> **Ingestion is not HTTP here.** Engagement events arrive on **Kafka** (channel services publish), behavior
> events via the **app BFF `/app/events`** → Kafka; analytics **consumes** them (Lambda) — so there is **no
> public event-intake route** on this service. The query API is **RBAC-scoped + tenant-isolated** (an account
> sees only its own; staff get cross-account aggregates). These are APP/INTERNAL shapes; the published API is
> the `/v1/...` facade.

### Query API — engagement & read models (analytics-5, analytics-7)
| Method | URI | Purpose | Access | Req |
|---|---|---|---|---|
| GET | `/analytics/metrics` | Aggregate metrics (counts by event-type / channel / campaign / period) | USER | analytics-5.1/7.1 |
| GET | `/analytics/funnels` | Funnel stages (sent → delivered → opened → clicked → converted) | USER | analytics-7.2 |
| GET | `/analytics/engagement` | Cross-channel engagement by account / campaign / contact | USER | analytics-7.1 |
| GET | `/analytics/deliverability` | Bounce / complaint / failure rates by provider / channel / domain | USER | analytics-7.4 |
| GET | `/analytics/cohorts` | Cohorts / retention / fatigue | USER | analytics-7.5 |
| GET | `/analytics/behavior` | Product/behavior funnels + feature adoption | USER | analytics-2.3 |
| GET | `/analytics/benchmarks` | This account vs an **anonymized** cross-account cohort (k-anonymity) | USER | analytics-7.6 |

### Attribution (analytics-6)
| Method | URI | Purpose | Access | Req |
|---|---|---|---|---|
| GET | `/analytics/attribution` | Computed attribution for a campaign (model + window applied) | USER | analytics-6.1 |
| GET, PUT | `/analytics/attribution/config` | Read/set the attribution model + lookback windows (account/campaign) | ACCOUNT | analytics-6.1/6.2 |

### Schema & governance (analytics-8)
| Method | URI | Purpose | Access | Req |
|---|---|---|---|---|
| GET | `/analytics/schema` | Canonical schema + event-type catalog + `attrs` versions | USER | analytics-8.1 |
| POST | `/analytics/schema/versions` | Register a new **backward-compatible** schema/`attrs` version (staff) | APPLICATION ⬆ | analytics-8.2 |

### Operations (analytics-3, analytics-4)
| Method | URI | Purpose | Access | Req |
|---|---|---|---|---|
| POST | `/analytics/reprocess` | Trigger backfill / rollup rebuild (by range / partition) | APPLICATION ⬆ | analytics-3.7 |

### Internal / S2S & ops (analytics-5, analytics-7, analytics-10)
| Method | URI | Purpose | Access | Req |
|---|---|---|---|---|
| GET | `/analytics/internal/deliverability` | S2S deliverability feed (dispatch provider fail-over) | Internal | analytics-7.4 |
| GET | `/analytics/internal/query` | S2S aggregate query (report service) | Internal | analytics-5.1 |
| GET | `/analytics/config` | Read the service's own runtime config (AppConfig-backed) | ROOT | analytics-10.1 |
| PUT | `/analytics/config` | Update service runtime config → reconfigure-without-restart; audited | ROOT ⬆ | analytics-10.1 |
| GET | `/analytics/health` | Liveness/readiness (read-only smoke) | Internal | analytics-10.1 |
