#
# Analytics Service
#

# Objective

The platform's **business / engagement plane**: the centralized, append-only **event history** of
everything that happens to a message after it leaves us — sent, delivered, bounced, opened, clicked,
replied, opted-out, converted — across **every channel**, and the **aggregate queries + dashboards**
built on it. It answers *"how did this campaign / account / contact engage?"*, never *"is the system
healthy?"* (that's monitor).

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
   analytics:  consumer ─► dedup (provider, providerEventId) ─► Firehose ─► S3 RAW (Parquet, partitioned)
                                                                            │
                              rollups (streaming or scheduled) ─► curated tables + hot store (Redis/OpenSearch)
                                                                            │
   query API (RBAC-scoped) ◄── hot store (live) ── + ── Athena (historical) ──┘     report ◄── query API
```

* **Time-sensitive events take the operational path *first*** (suppression can't wait on the lake) and
  *also* land in analytics for history — the two are not either/or.
* **S3 partitioned** by `account / channel / date` (tenant isolation + deletion + cheap scans), stored
  as **Parquet** (columnar — Athena scans far less), with **compaction** of streaming small files.
* **Rollups** keep dashboards off raw Athena: precomputed hourly/daily aggregates by
  account/campaign/channel/event-type, populated as events stream in.

# What analytics answers

* **Cross-channel engagement** by account, campaign, contact (the core ask).
* **Funnels** — sent → delivered → opened → clicked → converted, per campaign/variant.
* **A/B + attribution** — which variant earned the click/conversion.
* **Deliverability** — bounce/complaint/failure rates by provider/channel/domain (feeds provider
  fail-over decisions in dispatch).
* **Cohorts / retention / fatigue** — engagement over time; messages-per-contact-per-period.
* **(Later) anonymized benchmarks** across accounts.

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

# Gaps & issues (what's missing / needs deciding)

1. **GDPR vs an append-only lake — the biggest issue.** You can't surgically delete one contact from
   immutable S3/Parquet. **Resolution: store only the OPAQUE `contactId`, never raw PII** (no phone/
   email, and **enforce no-PII-in-`attrs`**). Then a GDPR "forget" is handled by the **contact**
   service's tombstone (keep the uuid shell, strip PII) — the lake's events become **unlinkable to a
   person** without mutating the lake. (Fallbacks if PII must live here: crypto-shredding with a
   per-contact key, or contact-partitioned deletes — both worse. Pick the no-PII rule.)
2. **Attribution model is undefined.** Last-touch vs multi-touch? **Conversion attribution window**
   (a click today, a purchase in 3 days)? Which campaign/variant gets credit? Needs a stated model.
3. **Conversion event source.** How does `converted` get created — a tracking pixel, a server-side
   postback, a manual goal? The **primary source is an integration's commerce/goal event** (e.g. a
   Shopify `order.placed` via marketplace → workflow), attributed back to the channel touch — see
   `apps/CHANNELS.md` "e-commerce is the trigger/data/**conversion** layer". *That's the general
   pattern* (any integration that signals a goal — a donation, a booking, a closed deal — is a
   conversion source); still open is the attribution window + which touch gets credit (#1).
4. **Live-dashboard freshness SLA + rollup mechanism.** Streaming aggregation (Kinesis Data Analytics /
   Flink) vs scheduled Athena CTAS vs incremental counters in Redis — each has a different
   freshness/cost/complexity profile. Undecided.
5. **Small-files problem.** Streaming → Firehose → S3 makes many tiny Parquet files that wreck Athena
   performance; needs a **compaction** job (and a partition strategy that doesn't explode cardinality).
6. **Identity resolution for unknown senders.** Inbound (`replied`) from a number not mapped to a
   `contactId`, or a contact with multiple phones/emails — who resolves to one `contactId`, and what
   happens when it's unknown? (Contact owns identity; analytics needs a defined "unknown" handling.)
7. **Exactly-once vs at-least-once.** The stream is at-least-once → duplicates reach the lake →
   dedup must happen at **query time too** (not just ingestion), or rollups double-count.
8. **Late events corrupt closed periods.** A delivery receipt arriving after a daily rollup ran must
   trigger a **recompute** of that period — rollups can't be write-once.
9. **Warehouse engine choice not settled.** S3+Athena (serverless, cheap, recommended default) vs
   Redshift (heavy BI/joins) vs OpenSearch (text/log + live). Recommend **S3+Athena** primary,
   OpenSearch for live/search, Redshift only if BI demands it. (Mirrors the DynamoDB-default,
   OLAP-is-separate stance in services/DATABASE.md.)
10. **Webhook intake — DECIDED.** Provider delivery-receipt webhooks use **channel-specific endpoints
    per provider** (`/email/webhook/mailgun`, `/texting/webhook/twilio`) owned by the channel service
    (it owns the format), which **verify at the edge and enqueue to SQS** for a worker to digest — *not*
    the general 3rd-party intake (that stays for marketplace integration webhooks). The digest queues
    use the **fair-share** pattern (below) so one account's webhook burst can't starve others.
11. **PII in links / `attrs`.** `clicked` events carry the destination URL; if URLs embed PII or tokens,
    that re-introduces the GDPR problem gap #1 solves. Needs a redaction/tokenization rule.
12. **Replay/ordering for derived state.** If analytics ever derives per-message funnels, out-of-order
    events (clicked before delivered) need ordering by `occurredAt`, not ingest order.

# Services & primitives to utilize

* **Kafka (MSK)** or **Kinesis** — the engagement event stream from channel services, **and the in-app
  behavior-event stream from the [app BFF](../app/SPECS.md) `/app/events` intake** (product analytics).
* **Kinesis Firehose** — buffered, Parquet-converting, partitioned delivery to S3.
* **S3** — the append-only data lake (raw + curated), lifecycle-tiered.
* **Athena** (+ **Glue Catalog**) — serverless SQL over the lake; schema registry.
* **Redis / OpenSearch** — hot store for live dashboards + recent aggregates.
* **SQS** — ingestion buffering + the priority/fair-share split (time-sensitive vs bulk).
* **report** consumes the query API; **monitor** is the separate operational plane.

# Open decisions

1. **Attribution** — **DECIDED** (see **Attribution**): **multi-touch ships in v1** — last-touch
   (default), first-touch, linear, time-decay, and position-based are all selectable per account/campaign;
   only **data-driven** is deferred (needs volume + ML). Default window: click-through 7d / view-through
   1d (configurable). Remaining: confirm the default-window numbers with the first real campaigns.
2. **Conversion ingestion** — pixel / postback / integration / manual (gap #3).
3. **Rollup mechanism + freshness SLA** (streaming vs scheduled).
4. **Stream transport** — Kafka (we have the facade) vs Kinesis Firehose-direct.
5. **Warehouse engine** — confirm S3+Athena primary (gap #9).
6. **Provider-webhook intake** — channel-service-owned vs shared general intake (gap #10).
7. **Benchmarks** — offer anonymized cross-account comparisons? (privacy + product call).
