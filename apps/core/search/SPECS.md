#
# Search service (global content search)
#

# Objective

One **global content-search** plane — find a **contact / campaign / message / report / media / …** by text
across the platform. Backed by **AWS OpenSearch**, fed by services' **change events**, **account- + role-filtered
on every query**, and cached in Redis. Search owns the **index + the query path** — it owns **no source data**;
each owning service stays the system of record and **emits index documents** (stamped with `accountId` +
`minAccess`).

It is **not** the business-metrics plane ([analytics](../analytics/SPECS.md)), the downloadable-file plane
([report](../report/SPECS.md)), or the operational plane ([monitor](../monitor/SPECS.md)) — it answers
*"find the thing that matches this text, that I'm allowed to see."*

# Role & boundaries

**Owns:**
* The **search index** (OpenSearch) — a flattened, searchable **projection** of source entities.
* The **indexer** — consumes `*.changed` / `*.deleted` events and upserts / removes index docs.
* The **query API** — text + filters → ranked results, **account- + role-filtered**.
* The **result cache** (Redis) — recent searches, short TTL, keyed by `(query + account + role + filters)`.

**Delegates / does NOT do:**

| Concern | Owner |
|---|---|
| The **source data** (the SoT for a contact / campaign / …) | the **owning service** (it emits the index doc) |
| **Aggregates / metrics** (counts, funnels, attribution) | **[analytics](../analytics/SPECS.md)** |
| **Downloadable report files** | **[report](../report/SPECS.md)** |
| **Operational logs / traces** | **[monitor](../monitor/SPECS.md)** |
| **Identity + the role ladder** | **[auth](../auth/specs/SPECS.md)** (search enforces `minAccess`, doesn't define it) |

> **Each indexed doc carries `accountId` + `minAccess`** — stamped by the owning service when it emits the doc.
> These are the **non-negotiable filter keys** on every query.

# Core concepts

* **Index document** — a searchable projection of a source entity: `{ id, type, accountId, minAccess, title,
  text, fields…, updatedAt }`. The **owning service produces it** (not search) and emits it on change.
* **Searchable type** — which entity types are indexed. **v1: `campaign` · `contact` · `segment` · `email`**
  (more — report, media, … — later; each owning service emits its doc).
* **Query** — text + filters (type, date, …) → ranked results, **always** account- + role-filtered. Matching is
  **phonetic (soundex-like) + case-insensitive by default**; **exact** (verbatim phrase) match is **opt-in**.
* **Recent-search cache** — Redis, keyed by `(query + accountId + role + filters)`, short TTL, refreshed on hit.

# Architecture & flow

**Index-then-query** (not scatter-gather): owning services **push index docs**; search **queries OpenSearch
directly**. A search never fans a query out to every service.

```
 INGEST (write path) — eventually consistent
   owning service (contact / campaign / …) ──*.changed / *.deleted──► Kafka
        └─► search INDEXER (consumer) ──► OpenSearch upsert/delete
                 (doc carries id · type · accountId · minAccess · title · text · fields)

 QUERY (read path) — synchronous API
   client ─► GET /search?q=… ─► Redis cache  ──hit──► return (refresh TTL)
                                   │ miss
                                   └─► OpenSearch query  WITH A MANDATORY FILTER:
                                         accountId ∈ caller's account(s)  AND  minAccess ≤ caller's role
                                       └─► cache (key = query+account+role+filters) ─► return
```

* **Authorization is a query filter, server-side + non-bypassable** — the caller's `accountId`(s) + role are
  injected into every OpenSearch query; nothing the client sends widens it. Same posture as
  [realtime](../realtime/SPECS.md)'s per-event gate, applied as a filter.
* **Re-authorized per request** — roles/grants change; the filter is computed from the **current** session
  each query, and the cache is keyed by `(account, role)` so a **switch / logout never serves another
  context's results**.
* **Eventual consistency** — the index lags the SoT by the event pipeline; results note that (a just-changed
  record may take a moment to reflect). The SoT is always the owning service.

# Service & Job topology

**Convention (platform-wide).** Framework base → domain base → concrete role. **`SearchService extends Service`**
and **`SearchJob extends Job`** hold the shared domain code — the **OpenSearch client**, the **mandatory RBAC
query-filter** (`accountId ∈ caller's accounts AND minAccess ≤ role`, computed from the **current** session,
non-bypassable), the **index-doc model + analyzers** (phonetic / case-insensitive default, opt-in exact —
`search-2.3`/`2.4`), the **Redis result cache**, and **Kafka / SQS** consume. Search is **index-then-query**: a
query `Service` reads OpenSearch directly (never scatter-gathers); an indexer `Job` writes it from the event
stream.

**Services (HTTP, ECS Fargate)**

| Class | Extends | Role |
|---|---|---|
| **`SearchService`** | `Service` | **Domain base** — OpenSearch client · RBAC query-filter · index-doc model + analyzers · Redis cache · Kafka/SQS; **not deployed alone**. |
| **`SearchQueryService`** | `SearchService` | The **query API** — `GET /search`: **Redis-first** → OpenSearch with the **mandatory RBAC filter** (re-authorized per request); faceting + comparisons; config/health. |

**Jobs (Lambda, event-driven)** — each `extends SearchJob`:

| Class | Extends | Trigger | Role | Req |
|---|---|---|---|---|
| **`SearchIndexerJob`** | `SearchJob` | SQS ← Kafka `*.changed` / `*.deleted` | **Upsert / delete** OpenSearch docs (`id · type · accountId · minAccess · title · text · fields`); handles **GDPR forget** (drop / redact indexed PII on the forget / delete event). **SQS-buffered + DLQ** | search-1.0 / 5.0 |
| **`SearchReindexJob`** | `SearchJob` | EventBridge / operator | **Rebuild / backfill** the index from owning services on a mapping / analyzer change (new field, phonetic tweak) — **zero-downtime alias swap** | search-1.0 / 6.0 |

> **Notes.** Search holds **no source data** — owning services push index docs; the **SoT is always the owner**,
> the index is **eventually consistent**. **Authorization is a server-side query filter** (the security-critical
> shared piece on `SearchService`) — **non-bypassable**, nothing the client sends widens it, recomputed from the
> **current** session each query (a switch / logout never serves another context's results). The indexer **acts on
> every** content-change event (it indexes all, doesn't drop a subset) → a **`Job`**, not a `Consumer`; high-volume
> but SQS-buffered + retried.

# AWS Services and Other Dependencies

**AWS services**
* **OpenSearch** — the search index (RBAC-filtered queries; at rest via KMS).
* **Kafka (MSK)** — the `*.changed` / `*.deleted` ingest stream from owning services.
* **Redis (ElastiCache)** — the recent-search result cache (TTL, keyed by query+account+role).
* **SQS** (+ DLQ) — buffer + retry for the indexer consumer.
* **KMS** — encryption at rest.

**Third-party libraries / services** — none (OpenSearch is the engine).

**Internal (`@repo/*`)**
* `@repo/services` (OpenSearch, Kafka, Cache, Sqs, Kms), `@repo/endpoint` (`Access` — the role ladder + the per-query gate), `@repo/common` (`Type`).
* **Indexed by** the owning services (**[contact](../contact/SPECS.md)**, campaign, texting/email messages, **[report](../report/SPECS.md)**, media, …) — each emits its index doc; search holds **no source data**.

# Compliance & standards mapping

How **this search service's** controls map to **OWASP Top 10 (2021)**, **ISO/IEC 27001:2022** (Annex A),
**SOC 2 Type 2** (TSC), **HIPAA** (if PHI), **GDPR**, and **CCPA/CPRA**. Search holds a **PII-bearing index**
(names, emails, message text), so its dominant controls are **per-query account + role filtering** and **keeping
the index consistent with source-side erasure**. There is **no PCI** and **no messaging-law** surface. **HIPAA**
is ➖ (no PHI by [AUP](../account/specs/SPECS.md); the index *could* carry PII for the account). Identity/RBAC
live in [auth](../auth/specs/SPECS.md); residency is the platform [AWS topology](../../../packages/services/src/aws/SPECS.md).

**Legend:** ✅ meets/exceeds · ⚠️ partial / open — see Gaps · ➖ n/a

| Search control | OWASP T10 | ISO 27001:2022 | SOC 2 (TSC) | HIPAA (if PHI) | GDPR | CCPA | |
|---|---|---|---|---|---|---|---|
| **Per-query account + role filter** — `accountId` + `minAccess` injected server-side; client cannot widen | A01 | A.5.15 / A.8.3 | CC6.1 / CC6.3 | §164.312(a)(1) | Art 32 | §1798.100 | ✅ |
| **Re-authorized per request** — filter from the **current** session; cache keyed by `(account, role)` | A01 / A07 | A.5.18 | CC6.2 / CC6.3 | §164.312(a)(2)(iii) | Art 32 | ➖ | ✅ |
| **Account isolation** — a result for account A never reaches a B-only session | A01 | A.8.3 | CC6.1 | §164.312(a)(1) | Art 32 | §1798.100 | ✅ |
| **PII-bearing index** — searchable PII; the index is a **projection** → **forget auto-propagates** via the delete-event pipeline (bounded EC window) | A02 / A04 | A.8.10 / A.8.24 | (Privacy) | §164.312(a)(2)(iv) | Art 17 / 32 | §1798.105 | ✅ auto via pipeline |
| **Cache safety** — keyed by `(account + role)`; invalidated on switch / logout (no stale-authz serving) | A01 | A.8.3 | CC6.1 | ➖ | Art 32 | ➖ | ✅ |
| **Encryption** — OpenSearch at rest (KMS) + in transit | A02 | A.8.24 | CC6.1 | §164.312(e) | Art 32 | ➖ | ✅ |
| **Query audit** — who searched what; **configurable** (on/off · scope · TTL); default on/metadata-only | A09 | A.8.15 | CC7.2 | §164.312(b) | Art 30 | ➖ | ✅ configurable |
| **No PHI** by AUP — index carries no PHI | ➖ | A.5.34 | (Privacy) | §164.502 (AUP) | Art 9 | ➖ | ✅ |

# Gaps & open decisions

*The one review list.* ✅ = resolved/decided · ⚠️ = **open — needs attention**.

1. ✅ **Index-then-query — DECIDED (not scatter-gather).** Owning services **push index docs** (change events
   → OpenSearch); search **queries OpenSearch directly**. The notes' "put the search on SQS, each service
   listens + responds" per-query fan-out is **rejected** (slow, couples every service to every query).
2. ✅ **API, not WebSocket — DECIDED.** Search is **request/response** (`GET /search`), re-authorized per
   query. The notes' account/user-specific WebSocket isn't needed; **type-ahead / streaming** is a later
   enhancement, not v1.
3. ✅ **Searchable types (v1) — DECIDED: `campaign` · `contact` · `segment` · `email`.** v1 indexes
   **campaigns**, **contacts**, **segments** (contact svc), and **emails** (email messages); more types
   (report, media, …) are added later — each owning service emits its doc. Per-type **doc shape** (title / text
   / fields) is defined per type as they're added.
4. ✅ **Cross-account search — DECIDED: no (account-scoped only).** Search is **always scoped to the caller's
   account** — **no cross-account search, including for staff**, for now. (Cross-account support search can be
   revisited later — scoped + audited — if a real need arises.)
5. ✅ **GDPR forget — DECIDED: automatic via the change/delete-event pipeline.** The index is a **projection**,
   not a system of record, so it needs **no separate forget mechanism**: when the source is forgotten / deleted,
   the owning service emits a `*.deleted` (or a contact-forget tombstone change) and the **indexer removes /
   redacts the doc** on the normal flow. *(Caveat: the index **does** hold a PII copy, so it **is** in scope —
   erasure is just handled by construction; the only exposure is the bounded **eventual-consistency window**
   between source erasure and de-index, plus the short cache TTL.)*
6. ✅ **Query audit — DECIDED: yes, but fully configurable.** Audit **who searched what** (abuse detection /
   GDPR Art 30), but it is a **runtime-configurable** control — per environment (and account-overridable):
   **on/off**, **scope** (e.g. metadata-only `who + when + type + result-count` vs. **full query text**), and a
   **retention TTL** (audit records age out — the *audit log* is the one thing here that **is** TTL'd, unlike the
   index). Default = **on, metadata-only, short TTL** (capture-the-fact without warehousing query strings).
7. ✅ **Relevance + features — DECIDED.** **Phonetic ("soundex-like") matching by default** + **always
   case-insensitive**; **fuzzy / typo tolerance** on. **No exact-match unless the caller opts in** (`exact=true`
   / quoted term) — then it's a verbatim, case-insensitive phrase match (still no case sensitivity). Built on
   OpenSearch analyzers: a **`phonetic`** analyzer (`phonetic` token filter — soundex/metaphone) + **`lowercase`**
   normalizer on every field; an **`exact`** sub-field (`keyword`, lowercase-normalized) for opt-in phrase match.
   Per-type **field weighting**, **highlighting**, and **faceting** are part of this (tuned per type as types
   are added).

# Requirements (traceable register)

The traceable requirement register for the **search service** (the sections above are the rationale; this is
the coded list). IDs are stable handles (**`search-N.M`**) — cite them in code, tickets, and tests.
**Priority:** **A** = MVP, **B** = core / hardening, **C** = later. One level of sub-requirements; a group's
priority is its floor. **Boundaries:** search owns the **index + query + cache**; the **owning services** are
the SoT and **emit index docs**; analytics / report / monitor are separate planes.

## search-1.0 Indexing (ingest) — A
- **search-1.1** Consume `*.changed` / `*.deleted` events (Kafka) → **upsert / delete** OpenSearch docs — A
- **search-1.2** Each doc carries **`id` · `type` · `accountId` · `minAccess`** + searchable fields (owning service stamps them) — A
- **search-1.3** **Eventually consistent** — the index lags the SoT by the pipeline; the SoT is the owning service — A
- **search-1.4** **Reindex / backfill / reconcile** — rebuild from source; **the drift / missed-delete safety net** (not a TTL) — B
- **search-1.5** **No doc TTL** — index docs mirror the **source lifecycle** (delete on source delete/forget, not time); a TTL would wrongly drop live records. Only the **Redis result cache** is TTL'd — A

## search-2.0 Query — A
- **search-2.1** Text + filters (type / date / …) → **ranked** results; pagination — A
- **search-2.2** **Recent-search cache** (Redis) — key = `query + account + role + filters`, short TTL, refresh on hit — B
- **search-2.3** **Phonetic + case-insensitive by default** — soundex-like (`phonetic` token filter) matching, **always case-insensitive** (`lowercase` normalizer); fuzzy/typo tolerance on *(gap #7)* — A
  - **search-2.3.1** **Exact match is opt-in** — `exact=true` / quoted term → verbatim phrase match against a `keyword` sub-field (still case-insensitive); default search is **not** exact
- **search-2.4** **Relevance tuning** — per-type field weighting, highlighting, faceting (tuned per type as types are added) *(gap #7)* — B

## search-3.0 Access control — A
- **search-3.1** **Per-query account + role filter** — `accountId ∈ caller's accounts` **AND** `minAccess ≤ role`, injected **server-side** — A
- **search-3.2** **Client cannot widen** — nothing the client sends grows what it sees (filter is authoritative) — A
- **search-3.3** **Re-authorized per request** — computed from the current session; **switch / role-change / logout invalidates** the user's cached results — A
- **search-3.4** **No cross-account search** — always scoped to the caller's account (cross-account staff search deferred) *(gap #4)* — A

## search-4.0 Searchable types — A
- **search-4.1** Owning services **emit their index doc** — v1: **[campaign](../campaign/SPECS.md)** (campaigns), **[contact](../contact/SPECS.md)** (contacts + segments), **[email](../email/SPECS.md)** (emails) — A
- **search-4.2** **v1 types — `campaign` · `contact` · `segment` · `email`**; more added later; per-type doc shape defined per type *(gap #3)* — A

## search-5.0 Privacy & compliance — A
- **search-5.1** **PII-bearing index** — encrypted (OpenSearch SSE-KMS) + tenant-isolated — A
- **search-5.2** **GDPR forget = automatic** — the index is a projection; a source delete / forget emits `*.deleted` → the indexer **removes / redacts** the doc (no separate forget mechanism); only the **eventual-consistency window** is exposure *(gap #5)* — A
- **search-5.3** **Query audit (configurable)** — who searched what; **runtime config per env (account-overridable)**: on/off, **scope** (metadata-only `who+when+type+count` vs. full query text), **retention TTL**; default **on / metadata-only / short TTL** *(gap #6)* — B
  - **search-5.3.1** Audit records **age out by TTL** — the audit log is TTL'd (unlike the index); disabling audit stops capture, it doesn't widen the index — B
- **search-5.4** **No PHI** by [AUP](../account/specs/SPECS.md) — A

## search-6.0 Architecture & infra — A
- **search-6.1** **OpenSearch** index; **Kafka** ingest; **Redis** cache; **SQS** (+ DLQ) for the indexer — A
- **search-6.2** **Index-then-query** (not per-query scatter-gather) *(gap #1)* — A
- **search-6.3** **API, not WebSocket** (request/response; streaming/type-ahead later) *(gap #2)* — A
- **search-6.4** Search owns **no source data** — index + query + cache only — A

## search-7.0 Service & Job topology — B
- **search-7.1** **Domain bases** — `SearchService extends Service` + `SearchJob extends Job` hold the shared code (OpenSearch client · **mandatory RBAC query-filter** · index-doc model + analyzers · Redis cache · Kafka/SQS); concrete roles extend the domain base — B
- **search-7.2** **`SearchQueryService` extends `SearchService`** — the `GET /search` API (Redis-first → OpenSearch with the RBAC filter, re-authorized per request) — A
- **search-7.3** **`SearchIndexerConsumer` extends `SearchConsumer`** (Kafka ← `*.changed`/`*.deleted`, via `Kafka.subscribeEvents`) — upsert/delete docs + handle **GDPR forget** (drop/redact indexed PII). **Implemented as a long-running ECS `Consumer`, not a Lambda `Job`** as originally written here — the platform's `makeJob` trigger support is `"queue"`/`"table"` only, with no Lambda↔MSK event-source-mapping anywhere on the platform; `Kafka.subscribeEvents` + a `Consumer` is the supported primitive for a Kafka firehose reader, matching `AnalyticsIngestConsumer`'s precedent — A
- **search-7.4** **`SearchReindexJob` extends `SearchJob`** (EventBridge/operator) — rebuild/backfill on mapping/analyzer change, zero-downtime alias swap — B
- **search-7.5** Indexer **acts on every event** (indexes all, drops nothing) → a **`Consumer`** (see search-7.3's rationale for why not a `Job`) — A

# Endpoints (first cut)

A first pass, in [`@repo/endpoint`](../../../packages/endpoint/SPECS.md) style — service-prefixed `/search/*`.
**Ingest is not HTTP** — index docs arrive via **Kafka** change events; these endpoints are the query path.

**Access column:** **`minAccess`** — **`-`** public · account ladder **`SENDER`<`USER`<`BILLING`<`ACCOUNT`** ·
staff **`SUPPORT`<`APPLICATION`<`ROOT`** · **`Internal`** = VPC-only S2S.

| Method | URI | Purpose | Access | Req |
|---|---|---|---|---|
| GET | `/search` | Query — `?q=` + filters (`type`, `date`, paging, **`exact=true`**); phonetic + case-insensitive by default; **account + role filtered**, cached | USER | search-2.1/2.3/3.1 |
| GET | `/search/suggest` | Type-ahead suggestions (same RBAC filter) — *(later)* | USER | search-2.3 |
| POST | `/search/internal/reindex` | S2S — rebuild an index / backfill a type from source | Internal | search-1.4 |
| GET, PUT | `/search/config` | Read / set runtime config (indexed types, weights, **query-audit on/off · scope · TTL**) | ROOT | search-4.2/5.3 |
| GET | `/search/health` | Liveness / readiness (indexer lag + OpenSearch) | - | search-6.1 |

# eof
