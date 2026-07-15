#
# Monitor Service
#

# Objective

The platform's **operational observability** plane: a single place to see the running
state of every service, queue, job, and datastore; to follow one request across services;
to alarm on the things that need a human; and to expose all of it to the app **without
hammering (and paying for) CloudWatch on every read**.

Monitor exists because the platform is a **fleet of independent services, queues, and Lambda jobs** spread across
ECS Fargate, SQS, DynamoDB, and Redis — health is **emergent**, not something any one service can report about
itself. Its job is to be the **single operational lens** over that fleet: turn the **metrics, logs, traces, and
resource-state changes** every service emits into **"is the system healthy right now, and what happened to *this
request*?"** — answerable by an on-call human in seconds, and by the app cheaply. It deliberately stays on the
**operational / infrastructure** side of the line (latency, error rates, queue depth, cold starts, did-the-job-run)
and leaves **business engagement** (delivered / clicked / converted) to [analytics](../analytics/SPECS.md), so the
two planes never collide.

The load-bearing ideas:
* **enrich-at-source, stream out** — monitor **never queries another service's operational store**; it consumes
  the **metrics / logs / traces / state-changes those services emit** (the same discipline analytics follows for
  engagement), so adding a service to the fleet adds it to the lens for free;
* **request correlation as a first-class spine** — a **transaction id** propagated across every hop, so a single
  failing request `abc` can be **followed end-to-end** through the services it touched, not reconstructed from
  scattered logs;
* **a read API + cache in front of CloudWatch** — the app reads metrics / timelines **Redis-first,
  CloudWatch-fallback**, so dashboards don't turn observability into a **per-read CloudWatch bill**;
* **a replayable resource-topology timeline** — services, queues, jobs, and DBs and their **state over time**,
  plus a **scheduled-job run ledger** (EventBridge Scheduler keeps no native run history — so "did the 2am job
  run?" is answerable);
* **alarms that reach a human** — threshold definitions + evaluation + fan-out to **SNS / Slack**, with routing
  targets and dashboard access gated by the `Access` ladder ([auth](../auth/specs/SPECS.md));
* **hot window, not an archive** — monitor targets the **~2-week operational trend window**; long-term /
  compliance retention and cold archival are explicitly out of scope.

# Role & boundaries (read this first)

Monitor answers **"is the system healthy, and what happened to *this request*?"** It is the
**operational/infrastructure** plane — latency, error rates, CPU/memory, queue depth, cold
starts, traces, logs, resource state. It is explicitly **not** the business-metrics plane.

The split that keeps these from colliding:

| Plane | Question it answers | Owner |
|---|---|---|
| **Operational** (this service) | Is dispatch up? p99 latency? queue backing up? did the 2am job run? where did request `abc` fail? | **monitor** |
| **Business / engagement** | delivered / clicked / opted-out / converted, by account / campaign / contact | **analytics** |
| **User-facing report files** | "generate me a CSV/PDF of X on a schedule" | **report** |
| **Content search** | find a contact / campaign / message by text | **search** |

What Monitor **owns**:
* Ingestion + storage of **metrics, logs, traces, and resource-state changes** for the trend window.
* **Transaction-id (request) correlation** across services and the rules for propagating it.
* **Alarms**: threshold definitions, evaluation, and fan-out to SNS / Slack.
* A **resource-topology timeline** — services, queues, jobs, DBs and their state over time, replayable.
* A **scheduled-job run ledger** (EventBridge Scheduler has no native run history — see below).
* A **read API + cache** so the app reads metrics/timelines cheaply (Redis-first, CloudWatch-fallback).
* Embedded / managed **Grafana** for ops users who have no AWS console access.

What Monitor **delegates / does not do**:
* **Does not** ingest channel webhooks or compute engagement metrics → **analytics**.
* **Does not** query operational stores of other services directly → it consumes their *emitted*
  metrics/logs/traces (same "enrich at source, stream out" rule analytics follows).
* **Does not** generate downloadable report files → **report** (which may *pull* monitor's API).
* **Does not** own identity; alarm-routing targets and dashboard access are gated by the `Access` ladder (**auth**).

# Out of scope (deferred)

* **Long-term / compliance retention** of logs & metrics beyond the trend window (~2 weeks).
  Cold archival (S3 + lifecycle) is a later concern; monitor targets the *hot operational* window.
* **SLO/error-budget burn policy** as a product feature — start with raw alarms; formalize SLOs later.
* **Synthetic canaries / uptime probing** from outside AWS — later.
* **Timestream** for timeline storage — **RETIRED** (do not reintroduce; see Architecture).

# Core concepts

* **Transaction id** — a per-request correlation id (`x-transactionid`) that threads one inbound
  request through every service and log line it touches. Distinct from AWS X-Ray's trace id
  (`X-Amzn-Trace-Id`), which correlates at the *infrastructure* hop level; monitor keeps both and
  links them.
* **Metric** — a numeric time series (latency, error count, queue depth, CPU, memory, invocations).
* **Log** — a structured log line, ideally carrying `transactionId` + `accountId` for correlation.
* **Trace** — an X-Ray distributed trace: the span tree for one request across services.
* **Alarm** — a named threshold rule over a metric, with a state (OK / ALARM / INSUFFICIENT) and
  routing (SNS topic, Slack channel).
* **Topology snapshot** — point-in-time state of resources (service desired/running count, queue
  depth, job status, DB connections/CPU) used to render and **replay** the live dashboard.
* **Job run** — one execution record of a scheduled job: schedule name, start, end, duration,
  status, error, transactionId. The ledger of these gives "did it fire, and did it succeed?".

# Architecture

**Ingest by streaming, never by polling.** Polling CloudWatch for dashboards is the cost trap the
original brief calls out — so data is *pushed* to monitor's stores and the API reads those.

```
                          ┌─────────────────────────── monitor ───────────────────────────┐
 CloudWatch Metrics ──Metric Streams──► Kinesis Firehose ──► S3 + OpenSearch  (metrics, hot)
 Service/Lambda logs ──subscription───► Firehose ──────────► OpenSearch       (logs, searchable)
 X-Ray ───────────────(traces)────────────────────────────► X-Ray + trace index by transactionId
 EventBridge (resource-change + ECS/Batch state) ──► SQS ──► worker ──► topology timeline (DynamoDB)
 Scheduled-job targets ──run record──► SQS ─────────► worker ──► job-run ledger (DynamoDB + TTL)
                          │                                                                  │
                          │   Read API (ECS/Fastify)  ◄── Redis cache (TTL) ◄── stores       │
                          │        │                                                          │
                          │        └─► CloudWatch GetMetricData ONLY on cache miss ──► cache  │
                          └──────────────────────────────────────────────────────────────────┘
                                   app  ◄── API          ops users ◄── Managed Grafana
```

* **Metric Streams → Firehose** (not `GetMetricData` polling) for near-real-time metrics at low cost.
* **Log subscription filters → Firehose → OpenSearch** so logs are searchable by `transactionId`/`accountId`.
* **EventBridge** captures resource-change + ECS/Batch task-state events → a worker folds them into the
  **topology timeline** so the dashboard can be *replayed* (queue sizes, cpu, mem, counts over time).
* **Read path is Redis-first**: a query checks Redis (cache key = query+window), refreshes TTL, returns;
  only on a miss does it touch CloudWatch/OpenSearch and then **populate the cache** — this is the
  "don't pay CloudWatch per read" requirement, realized.

# Requirements

## Tracing & correlation

The **transaction id** is the portable correlation key that threads one request through every hop it touches
(HTTP → events → jobs → fan-out), independent of AWS X-Ray. It works identically in local dev and AWS — only
the log *sink* differs (Console log files ↔ CloudWatch/OpenSearch). X-Ray is a complementary prod-only layer.

### Mechanism — implemented in the base runtime (`@repo/services` / `@repo/common`)
* **Ambient context, not threaded params** — `RequestContext` (a Node `AsyncLocalStorage`) carries
  `{ transactionId }` across `await`s. Each entry point enters a context; everything inside reads it. ✅
* **Every log line is stamped** — `Trace` reads an ambient context provider (wired by `Application` to
  `RequestContext`) and adds a **`txn`** field to its JSON record. `id` stays the process/service-instance id;
  `txn` is the request/event correlation id. No per-call-site logger threading. ✅
* **Inbound HTTP** — `Service.processEndpoint` reuses the caller's `x-transactionid` (else mints one),
  **echoes it on the response**, runs the request inside `RequestContext`, and sets `auth.transactionId`. ✅
* **Client** — the web `RestfulService` sends `x-transactionid` on every call and surfaces the id on the
  reply (`Reply.transactionId`) + as the response header (visible in devtools) for self-service troubleshooting. ✅
* **Propagation on every hop** (the id survives whatever transport): ✅
  * **S2S HTTP** — `RestfulService` forwards the ambient id (server provider → `RequestContext`); an explicit
    header still wins; the browser (no provider) mints its own.
  * **Kafka** — `publishEvent` stamps `envelope.source.transactionId` + a message header; `runConsumer`
    re-enters a `RequestContext` from it, so a consumer's logs + any events IT emits stay on the chain.
  * **SQS** — `send` stamps a **`transactionId` message attribute** (out-of-band, no body/envelope change);
    `Sqs.transactionId(msg)` reads it back and the consumer wraps processing in `RequestContext`.
  * **Jobs (Lambda)** — `Job.invoke` extracts the id from the trigger (SQS record attribute / EventBridge
    `detail`) and wraps the handler, so a queue/event-started job inherits the id (and its fan-out keeps it).
* **Fallback** — an entry point with no upstream id simply mints/omits one; nothing breaks.

### Prod infra (planned / partially enabled)
* **Inject at the API Gateway** — `x-transactionid: $context.requestId` via integration request mapping
  (no code) so the edge always supplies one. ⏳ (the base already reads/echoes/generates it regardless)
* **X-Ray** active tracing is enabled per service via the manifest `tracing` flag; the AWS-SDK instrumentation
  (`aws-xray-sdk` in `ClientUtils`) is still to wire. Bridge to our id by **annotating the root segment with
  `transactionId`** so X-Ray is searchable by it. X-Ray gives the service map + latency; it does **not** trace
  Kafka hops — the transaction id does. ⏳
* **Logs → OpenSearch** — subscribe all service/Lambda log groups → Firehose → OpenSearch; searchable by
  `txn` / `accountId`. Locally this is the Console's log-merge; in AWS it's CloudWatch **Logs Insights**
  (`fields @timestamp, name, level, message | filter txn = "…" | sort @timestamp`). ⏳

### The payoff
Given a transaction id, monitor (or the Console, or Logs Insights) assembles the **full cross-service
timeline** — every log line, the services/queues it traversed, and (in prod) the X-Ray span tree.

## Metrics
* Ingest via **Metric Streams → Firehose** — never poll for dashboard reads.
* Cover the standard infra dimensions: request rate, error rate, p50/p95/p99 latency, queue depth +
  age-of-oldest-message, Lambda invocations/errors/throttles/cold starts, ECS cpu/mem/running count,
  DB connections/cpu/replica lag.
* Trend window is **per-environment configurable** (e.g. **dev ~3 days, prod ~2 weeks**); older data ages out
  (cold archival is out of scope above).

## Logs
* **Subscribe** to all service/Lambda log groups; ship to OpenSearch for search.
* Log lines are the structured `Trace` JSON record: `{ level, time, name, id, txn?, message, args? }` — `txn`
  is the transaction id (present inside a request/event context), `name` is the service, `id` the process
  instance. Correlation keys: **`txn`** + `accountId` (where the message includes it).
* Searchable by transaction id (`txn`), account, service (`name`), level, time window.

## Alarms & alerting
* Define **threshold alarms** on any ingested metric (e.g. DLQ depth > N, error rate > x%, p99 > Nms).
* Alarm state changes fan out to **0-N configurable routes per threshold** — **Slack channel(s)**, **SNS**, and
  an **application-level** route — so different topics/severities reach the right place (e.g. a **high-volume-queue**
  alarm → the **CS** channel; **app-level** errors → the **devops** channel). *(Slack delivery = CloudWatch →
  SNS → SQS → worker → Slack, the platform's standard worker pattern — gap #3.)*
* Alarms are **declared in the owning service's manifest** where possible (so they live with the resource),
  with monitor providing cross-cutting/composite alarms.

## Security monitoring & breach detection
Monitor is also the **security-event detection + alerting** plane. It ingests the security `AuditEvent`s
**auth** emits (failed logins, lockouts, **IP allow/deny blocks**, adaptive/anomalous challenges,
impersonation start/stop, role / grant changes, key mint/use, bulk PII export) alongside infra logs/metrics,
and runs **security alarms** that fan out to a **dedicated security on-call** route (separate from ops noise):

* **Brute-force / credential-stuffing** — failed-login or lockout rate per account / per IP / global.
* **Geo / IP anomaly clusters** — spikes in impossible-travel or new-country challenges; **IP deny-list hit
  surges** (per [risk → IP allow/deny + risk challenges](../auth/specs/RISK.md)).
* **Privilege anomalies** — unexpected staff/admin escalation, off-hours impersonation, grant-issuance bursts.
* **Data-exfil signals** — large/bulk PII export, mass record reads, unusual download volume.
* **Probing** — clustered authz `403`s, webhook-signature failures (forged payment/webhook attempts).

**Breach detection is mostly PROCESS, not a product feature.** Monitor's job is **detect → alert → preserve
the evidence trail** (the immutable, **hashed** auth audit + logs correlated by `transactionId`). Deciding an
alert **is a reportable breach**, and the **GDPR Art 33/34 (72-hour) / CCPA** notification, is a documented
**incident-response runbook** owned by **security + legal / DPO** — the thing to "have in place," not code:

* **Assess → contain → notify** — triage; contain (revoke sessions/keys, **bump the revocation epoch**, block
  IPs); scope it from the audit trail; then run the **notification decision** (regulator ≤ 72 h, affected data
  subjects without undue delay) per the runbook.
* Monitor **supports** this (alerting, timeline replay, evidence) but does **not** own the legal decision or
  the regulator/customer communication.
* **Retention caveat** — breach forensics may need logs **beyond** the ~2-week hot window; pair with the
  deferred **cold archival** (S3 + lifecycle) and the auth audit's own retention.

## Resource topology & replay
* Maintain a **live dashboard** of services, queues, jobs, and database state (cpu, mem, storage, depth).
* Show **interconnections** between services and **replay** how state changed over time (queue grew, cpu
  spiked, instance count scaled) — driven by the EventBridge-sourced topology timeline.

## Scheduled-job run history  *(the deferred Scheduler ledger — now owned here)*
* EventBridge Scheduler has **no native run history**, so monitor owns a **job-run ledger**: each
  scheduled target emits a run record (`scheduleName`, `group`, `start`, `end`, `durationMs`, `status`,
  `error?`, `transactionId`) to a monitor ingestion queue; a worker persists it to **DynamoDB with TTL**.
* Exposes **list/get** over the ledger (by schedule, by status, by window) so the app can answer
  "did the every-30-min job fire? did the first-of-month job succeed?" — complementing the Scheduler
  facade's `list`/`get`/`pause`/`resume` (which show *configuration*, not *outcomes*).
* Surfaces failed/missed runs as an **alarm** source.

## Cost control & caching
* **Redis cache** in front of every read: cache CloudWatch/OpenSearch query results with a TTL keyed by
  (query, window); serve from cache and only hit the source on a miss, then backfill the cache.
* Prefer **streamed/stored** data over live API calls for anything a dashboard polls.

## API
* A REST API (generated from `@repo/endpoint` definitions, like every service) exposing metrics,
  timelines, traces-by-transaction-id, alarm state, topology snapshots, and the job-run ledger.
* Results are **RBAC-scoped**: an account/user only sees what their `Access` role permits.

## Dashboards (Grafana)
* **AWS Managed Grafana** for ops users who **do not** have AWS console access — read-only operational
  dashboards over the same stores (OpenSearch/CloudWatch data sources).

## Multi-tenancy & access
* Operational data is largely platform-wide, but anything account-scoped (per-account error rates,
  per-account job runs) must carry `accountId` and be filtered by the requester's `Access` role.

## Audit
* Alarm definition changes and alert-routing changes are **audited** (who/when/what), consistent with
  the platform `AuditEvent` shape.

# Service & Job topology

**Convention (platform-wide).** Each service layers **framework base → domain base → concrete role**. A **domain
Service base** (`MonitorService extends Service`) and a **domain Job base** (`MonitorJob extends Job`) hold the
**shared domain code** — the **store / query clients** (OpenSearch · CloudWatch `GetMetricData` · X-Ray ·
DynamoDB topology + ledger), the **Redis cache**, the **alert-routing factory** (PagerDuty / Slack / SNS), the
**breach-detection rules**, and **RBAC / tenancy** — so every concrete role inherits it. Monitor's distinctive
trait: **bulk ingestion is MANAGED** (Metric Streams + log subscriptions → **Kinesis Firehose** → OpenSearch) —
so, unlike [realtime](../realtime/SPECS.md), monitor needs **no `Consumer`**; its custom compute is a **Read API
`Service`** + a few **event-driven `Job`s**.

```
Application
├── Service (Fastify, long-running — ECS)
│     └── MonitorService          (domain base — store/query clients (OpenSearch · CloudWatch · X-Ray · DynamoDB topology+ledger) · Redis cache · alert-routing factory · breach-detection rules · RBAC/tenancy; not deployed alone)
│           └── MonitorApiService   (the Read API: metrics/logs/traces queries (Redis-FIRST) · topology replay · job-run ledger reads · alarm config · security-event reads · config/health)
└── Job (Lambda, event-driven)
      └── MonitorJob               (domain base — store clients · idempotency)
            ├── MonitorTopologyJob   (SQS ← EventBridge resource-change + ECS/Batch state — fold into the topology timeline (DynamoDB), replayable)
            ├── MonitorLedgerJob     (SQS — scheduled-job run records → the job-run ledger (DynamoDB + TTL))
            ├── MonitorAlertJob      (SNS/SQS ← CloudWatch alarms — route/format alerts to on-call (PagerDuty/Slack/SNS); dedupe/escalate)
            └── MonitorSecurityJob   (consume auth's hashed security AuditEvents — breach-detection rules → alert + security on-call routing)
   MANAGED ingestion (NOT our compute): CloudWatch Metric Streams + log subscriptions → Kinesis Firehose → S3 + OpenSearch · X-Ray traces.
   (optional Firehose transform Lambda for enrich / PII-scrub.)
```

**Services (HTTP, ECS Fargate)**

| Class | Extends | Role |
|---|---|---|
| **`MonitorService`** | `Service` | **Domain base** — store/query clients · Redis cache · alert-routing factory · breach-detection rules · RBAC/tenancy; **not deployed alone**. |
| **`MonitorApiService`** | `MonitorService` | The **Read API** — metrics / logs / traces queries (**Redis-first**, CloudWatch `GetMetricData` only on miss), **topology replay**, **job-run ledger** reads, alarm config, security-event reads, config/health. The surface app + ops + Grafana read. |

**Jobs (Lambda, event-driven)** — each extends `MonitorJob`:

| Class | Trigger | Role | Req |
|---|---|---|---|
| **`MonitorTopologyJob`** | SQS ← EventBridge (resource-change + ECS/Batch task-state) | Fold state events into the **topology timeline** (DynamoDB) so the dashboard can be **replayed** | monitor-6.0 |
| **`MonitorLedgerJob`** | SQS | Record scheduled-job **run records** → the **job-run ledger** (DynamoDB + TTL) | monitor-7.0 |
| **`MonitorAlertJob`** | SNS / SQS ← CloudWatch alarms | **Route / format alerts** to on-call (PagerDuty / Slack / SNS) via the factory; dedupe + escalate | monitor-4.0 |
| **`MonitorSecurityJob`** | event stream ← [auth](../auth/specs/SPECS.md) security events | Consume auth's **hashed security `AuditEvent`s** → **breach-detection** rules → alert + security on-call routing | monitor-5.0 |

> **Why no `Consumer`** (contrast realtime): monitor's high-volume metric/log ingestion rides **managed Kinesis
> Firehose** (Metric Streams + log subscriptions → OpenSearch) — AWS runs that pipeline, so there's no custom
> consume-loop to own. The custom compute is the **Read API** + **event-driven `Job`s** (topology, ledger, alert,
> security). **Read is Redis-first** (`monitor-8.0`) so dashboards don't pay CloudWatch per read; **~2-week
> retention** is **managed** (OpenSearch ISM + DynamoDB TTL + S3 lifecycle) — **no sweep job**. **Detection ≠
> the record:** monitor *detects + alerts* on security events; the **immutable trail** is the
> [audit](../audit/SPECS.md) service. The breach 72-h *notification process* is the [RUNBOOK](../../../docs/RUNBOOK.md),
> not monitor code.

# AWS Services and Other Dependencies

**AWS services**
* **CloudWatch** + **CloudWatch Logs** — metric/log source (read on cache-miss only).
* **CloudWatch Metric Streams → Kinesis Firehose** — push-based metric ingestion (no polling).
* **Kinesis Firehose** — delivery of metric streams + log subscriptions → S3 / OpenSearch.
* **EventBridge** — resource-change + ECS/Batch task-state events → the topology timeline.
* **X-Ray** — distributed tracing, linked to `transactionId`.
* **OpenSearch** — log + metric search (the trend-window hot store).
* **S3** — Firehose landing (+ the deferred cold archival).
* **DynamoDB** (+ **TTL**) — topology timeline + the scheduled-job run ledger.
* **Redis (ElastiCache)** — read-through cache for the API (cost control).
* **SQS** (+ **DLQ**) — ingestion buffers (topology events, job-run records).
* **SNS** — alarm fan-out.
* **AWS Managed Grafana** — ops dashboards for non-AWS users.
* *(retired:* ~~AWS Timestream~~ — OpenSearch + DynamoDB cover the hot trend window; do **not** reintroduce.*)*

**Third-party libraries / services**
* **Slack** — alarm/alert delivery channel (via SNS→Lambda formatter or AWS Chatbot — see Gaps).
* **Grafana** — dashboards, consumed as **AWS Managed Grafana**.

**Internal (`@repo/*`)**
* `@repo/services` (CloudWatch, Firehose, OpenSearch, Dynamo, Cache, Sqs, Sns, X-Ray), `@repo/endpoint` (`Access` + API generation), `@repo/common` (`Type`, `Trace` / `transactionId`).
* Consumes **[auth](../auth/specs/SPECS.md)**'s hashed `AuditEvent`s (security monitoring) + RBAC; **does not** query other services' stores — it consumes their **emitted** metrics/logs/traces.

# Compliance & standards mapping

How **this monitor service's** controls map to **OWASP Top 10 (2021)**, **ISO/IEC 27001:2022** (Annex A),
**SOC 2 Type 2** (TSC), **HIPAA** (if PHI), **GDPR**, and **CCPA/CPRA**. Clause refs are **indicative**; this is
a **design-intent** self-assessment. **Monitor *is* the platform's OWASP A09 (security logging & monitoring)
control** + the **breach-detection** plane. There is **no PCI** surface (no payment data) and **no
messaging-law** surface. **HIPAA** is ➖ (logs hold no PHI by [AUP](../account/specs/SPECS.md) + PII-scrubbing;
the breach process maps to §164.308(a)(6)). It consumes **[auth](../auth/specs/SPECS.md)**'s hashed,
tamper-evident audit; identity/RBAC live in auth; residency is the platform
[AWS topology](../../../packages/services/src/aws/SPECS.md). **Breach *notification* decisions are a security +
legal / DPO runbook — not code.**

**Legend:** ✅ meets/exceeds · ⚠️ partial / open — see Gaps · ➖ n/a

| Monitor control | OWASP T10 | ISO 27001:2022 | SOC 2 (TSC) | HIPAA (if PHI) | GDPR | CCPA | |
|---|---|---|---|---|---|---|---|
| **Security logging & monitoring** — ingest, alarm, retain the operational + security signal (the A09 control itself) | A09 | A.8.15 / A.8.16 | CC7.2 / CC7.3 | §164.308(a)(1)(ii)(D) | Art 32 | ➖ | ✅ |
| **Breach detection → alert → preserve evidence** — supports GDPR 72-h (decision = runbook) | A09 | A.5.24–.28 | CC7.3 / CC7.4 | §164.308(a)(6) | Art 33 / 34 | §1798.82 | ✅ detect/alert |
| **RBAC-scoped reads** — dashboards / API gated by `Access`; account sees only its own | A01 | A.8.3 | CC6.1 / CC6.3 | ➖ | Art 32 | ➖ | ✅ |
| **No PII** — opaque UUIDs only (`contactId` / `accountId` / `userId`) + `transactionId`; scrubbed at source | A09 | A.8.11 / A.8.12 | CC6.x / Privacy | §164.502(b) | Art 5(1)(c) | §1798.100 | ✅ UUIDs only |
| **Encryption** — at rest (OpenSearch / DDB / S3 / Firehose SSE-KMS) + in transit | A02 | A.8.24 | CC6.1 | §164.312(a)(2)(iv) / (e) | Art 32 | ➖ | ✅ |
| **Tenant isolation** — account-scoped signals carry `accountId`, filtered by `Access` | A01 | A.8.3 | CC6.1 | ➖ | Art 32 | ➖ | ✅ |
| **Tamper-evident audit** — relies on auth's hashed, append-only, verify-on-read audit | A08 | A.8.15 | CC7.1 | §164.312(b) / (c) | Art 32 | ➖ | ✅ via auth |
| **Retention / storage limitation** — ~2-week hot window; cold archival deferred | A09 | A.5.33 / A.8.10 | CC6.x | ➖ | Art 5(1)(e) | §1798.100 | ⚠️ window TBD — see Gaps |
| **Alert egress hygiene** — Slack / SNS alerts carry metadata, **not** PII | A09 | A.5.34 / A.8.16 | CC7.2 | ➖ | Art 32 | ➖ | ✅ |
| **Alarm + routing changes audited** — who / when / what (`AuditEvent`) | A09 | A.8.15 | CC7.2 | §164.312(b) | ➖ | ➖ | ✅ |

# Gaps & open decisions

*The one review list.* ✅ = resolved/decided · ⚠️ = **open — needs attention**.

1. ✅ **Trend window — DECIDED: per-environment configurable.** e.g. **dev ~3 days, prod ~2 weeks** — set per
   environment (longer is just cost). Per-signal tuning (shorter for high-cardinality logs, longer for coarse
   metrics) is an allowed refinement within that.
2. ✅ **Job-run emission — DECIDED: self-emit via the base `Job`.** Targets emit their own run records (the base
   `Job` lifecycle wraps the handler) — richer than inferring from CloudWatch invocation metrics + Scheduler
   config (captures `error` / `transactionId`), and worth the small per-target cost.
3. ✅ **Slack delivery — DECIDED: the same SQS → Job/worker pattern.** CloudWatch alarm → **SNS → SQS → worker**
   that applies the routing layer (`monitor-4.4`) and posts to Slack (**Incoming Webhook / Web API
   `chat.postMessage`**). Reuses the platform's standard worker pattern (retries + DLQ, full message
   formatting) and supports the **0-N-channels-by-tag** routing that **AWS Chatbot can't** — so **not** Chatbot,
   **not** a bespoke SNS→Lambda.
4. ✅ **Alarm ownership — DECIDED (hybrid by type; routing decoupled).** **Single-resource** alarms (a service's
   own DLQ depth, Lambda error rate, ECS cpu, DB conns) live in the **owning service's `ResourceManifest`** —
   versioned + deployed **with the resource** (no drift), thresholds owned by the team that knows "normal."
   **Cross-cutting / composite / security / job-ledger** alarms (whole-path p99, multi-service correlations,
   brute-force across accounts, "the 2am job didn't fire") live in **monitor** — it has the cross-service view.
   **Routing is always monitor's and decoupled from the definition** (`monitor-4.4`): the manifest declares
   *that* an alarm fires (name + threshold + severity/tags); monitor maps name/severity/tags → the 0-N channels —
   so routing changes (new channel, reorg) **never redeploy a service**.
5. ✅ **Topology replay granularity — DECIDED: adaptive, per-type sampling.** A **low baseline snapshot rate**
   when calm; when a signal crosses a **threshold** (queue depth/age rising, cpu/mem spike, scaling event,
   error/alarm flip) the rate **ramps up** for that resource to capture the interesting window at high fidelity,
   bounded by a **not-to-exceed cap** (a floor interval so cost can't run away), then **decays** after a
   cooldown. Configured **per resource *type*** — SQS (depth/age) · ECS (cpu/mem/scaling) · DynamoDB
   (throttles/capacity) · Lambda (errors/throttles/concurrency) · S3 (rarely changes → stays coarse) — with
   **per-resource override**. **Significant state changes** (scale, task crash, alarm flip) are **always
   event-sourced** regardless of rate (and trigger the ramp). High fidelity *when it matters*, low cost otherwise.
6. ✅ **No PII in monitor — DECIDED.** Monitor stores **no PII** — only **opaque UUIDs** (`contactId` /
   `accountId` / `userId`) + `transactionId`. Enforced by **scrub-at-source** (the emitting service never logs
   raw PII; a Firehose transform is the backstop). Monitor's GDPR surface is therefore minimal — the UUIDs are
   **unlinkable to a person** without the contact/auth stores.

# Requirements (traceable register)

The traceable requirement register for the **monitor service** (the narrative `# Requirements` sections above
are the rationale; this is the coded list). IDs are stable handles (**`monitor-N.M`**) — cite them in code,
tickets, and tests. **Priority:** **A** = MVP, **B** = core / hardening, **C** = later. One level of
sub-requirements; a group's priority is its floor. **Boundaries:** monitor is the **operational plane**
(infra health + request correlation + security detection) — **[analytics](../analytics/SPECS.md)** owns
business/engagement, **[report](../report/SPECS.md)** owns downloadable files, **search** owns content search.
Monitor **consumes emitted** metrics/logs/traces — it never queries other services' stores.

## monitor-1.0 Tracing & correlation — A
- **monitor-1.1** Inject **`x-transactionid`** at API Gateway (`$context.requestId` via integration mapping — no code) — A
- **monitor-1.2** **X-Ray** active tracing (`X-Amzn-Trace-Id`) per service (manifest `tracing` flag); link to `transactionId` — A
- **monitor-1.3** **Propagate** `x-transactionid` downstream (HTTP / SQS attr / event detail); base `Application`/`Trace` **falls back** to a generated id — A
- **monitor-1.4** Assemble the **full cross-service timeline** for a transaction id (logs + spans + path traversed) — A

## monitor-2.0 Metrics — A
- **monitor-2.1** Ingest via **Metric Streams → Firehose** — **never poll** for dashboard reads — A
- **monitor-2.2** Standard infra dimensions — rate, error rate, p50/95/99, queue depth + age-of-oldest, Lambda inv/err/throttle/cold-start, ECS cpu/mem/count, DB conns/cpu/replica-lag — A
- **monitor-2.3** **Per-environment trend window** (e.g. dev ~3 d / prod ~2 wk), **configurable**; older data ages out *(gap #1)* — B

## monitor-3.0 Logs — A
- **monitor-3.1** **Subscribe** all service/Lambda log groups → **OpenSearch** — A
- **monitor-3.2** Lines carry **`transactionId` + opaque UUIDs** (`accountId` / `contactId` / `userId`); **no PII** — scrub-at-source *(gap #6)* — A
- **monitor-3.3** Searchable by transaction id / account / service / level / window — A

## monitor-4.0 Alarms & alerting — A
- **monitor-4.1** **Threshold alarms** on any ingested metric (DLQ depth, error rate, p99…) — A
- **monitor-4.2** State-change **fan-out** — CloudWatch alarm → **SNS → SQS → worker → Slack** (Incoming Webhook / Web API), the platform's standard worker pattern (retries + DLQ) *(gap #3)* — A
- **monitor-4.3** **Alarm ownership** — **single-resource** alarms in the **owning service's `ResourceManifest`** (versioned with the resource); **cross-cutting / composite / security / job-ledger** alarms in **monitor** *(gap #4)* — B
- **monitor-4.4** **Routing layer — monitor-owned, decoupled from the definition.** Keyed by alarm **name / severity / tags** → **0-N** destinations (**Slack channel(s)** · **SNS** · **application-level**): a service declares *that* an alarm fires, monitor decides *who hears it* (high-volume-queue → **CS**; app errors → **devops**; security → the on-call, `monitor-5.2`). Routing changes never redeploy a service — A

## monitor-5.0 Security monitoring & breach detection — A
- **monitor-5.1** Ingest **auth security `AuditEvent`s** (failed login, lockout, IP block, anomalous challenge, impersonation, grant/key changes, bulk PII export) — A
- **monitor-5.2** **Security alarms** on a **dedicated security on-call** route (separate from ops) — brute-force, geo/IP anomaly, privilege anomaly, data-exfil, probing — A
- **monitor-5.3** **Detect → alert → preserve evidence** (hashed audit + correlated logs); the **notification decision** (GDPR Art 33/34) is a security + legal **runbook**, not code — A
- **monitor-5.4** Breach forensics may need logs **beyond** the hot window → pair with deferred **cold archival** — B

## monitor-6.0 Resource topology & replay — B
- **monitor-6.1** **Live dashboard** of services / queues / jobs / DB state (cpu / mem / storage / depth) — B
- **monitor-6.2** Interconnections + **replay** of state over time (operational state only — no PII; bounded by the trend window), driven by the **EventBridge** topology timeline — B
- **monitor-6.3** **Adaptive, per-type sampling** — low baseline rate → **threshold-triggered ramp-up** (to a **not-to-exceed** cap) → decay on cooldown; configured **per resource type** (SQS/ECS/DynamoDB/Lambda/S3) + per-resource override; **significant changes always event-sourced** *(gap #5)* — B

## monitor-7.0 Scheduled-job run ledger — B
- **monitor-7.1** Run record per target (`scheduleName` / `group` / `start` / `end` / `durationMs` / `status` / `error?` / `transactionId`) → **DynamoDB + TTL**; **self-emit via the base `Job`** *(gap #2)* — B
- **monitor-7.2** **list / get** over the ledger (by schedule / status / window) — B
- **monitor-7.3** Failed / missed runs as an **alarm** source — B

## monitor-8.0 Cost control & caching — A
- **monitor-8.1** **Redis read-through** in front of every read (key = query + window, TTL); CloudWatch / OpenSearch only on **miss**, then backfill — A
- **monitor-8.2** Prefer **streamed/stored** data over live API calls for anything a dashboard polls — A

## monitor-9.0 Read API — A
- **monitor-9.1** REST API (from `@repo/endpoint`) — metrics, timelines, **traces-by-transaction-id**, alarm state, topology, job-run ledger — A
- **monitor-9.2** **RBAC-scoped** results (`Access` role) — A

## monitor-10.0 Dashboards (Grafana) — B
- **monitor-10.1** **AWS Managed Grafana** — read-only ops dashboards for users without AWS-console access — B

## monitor-11.0 Multi-tenancy & access — A
- **monitor-11.1** Account-scoped signals carry `accountId`, **filtered by the requester's `Access`** role — A

## monitor-12.0 Audit — B
- **monitor-12.1** **Alarm-definition + alert-routing changes audited** (`AuditEvent`) — B

## monitor-13.0 Infra footprint — A
- **monitor-13.1** CloudWatch (+ Metric Streams) · Firehose · OpenSearch · X-Ray · EventBridge — A
- **monitor-13.2** DynamoDB (+ TTL) · Redis · SQS (+ DLQ) · SNS · S3 · AWS Managed Grafana — A

## monitor-14.0 Service & Job topology — B
- **monitor-14.1** **Domain bases** — `MonitorService extends Service` + `MonitorJob extends Job` hold the shared code (store/query clients · Redis cache · alert-routing factory · breach-detection rules · RBAC/tenancy); **concrete roles extend the domain base** — B
- **monitor-14.2** **`MonitorApiService`** — the Redis-first Read API (metrics/logs/traces · topology replay · ledger · alarm config · security-event reads) — A
- **monitor-14.3** **Jobs extend `MonitorJob`** — `MonitorTopologyJob` / `MonitorLedgerJob` / `MonitorAlertJob` / `MonitorSecurityJob` — A
- **monitor-14.4** **No `Consumer`** — bulk metric/log ingestion is **managed Firehose** (Metric Streams + log subscriptions → OpenSearch); monitor's custom compute is the Read API + event-driven Jobs — A
- **monitor-14.5** **No retention sweep job** — ~2-week window is managed (OpenSearch ISM + DynamoDB TTL + S3 lifecycle) — B
- **monitor-14.6** **`MonitorSecurityJob` detects + alerts**; the immutable record is [audit](../audit/SPECS.md), the 72-h notification process is the [RUNBOOK](../../../docs/RUNBOOK.md) — A

# Endpoints (first cut)

A first pass at the endpoint surface, in [`@repo/endpoint`](../../../packages/endpoint/SPECS.md) style — all
service-prefixed **`/monitor/*`**. These are the **read + config** surface; reads are **Redis-first** (cache →
source on miss) and **RBAC-scoped** (`Access`).

> **Ingestion is not HTTP.** Metrics arrive via **Metric Streams → Firehose**, logs via **subscription →
> Firehose → OpenSearch**, topology + job-runs via **EventBridge / SQS** (the base `Job` self-emits run
> records). There is **no public ingest route**; these endpoints serve the **app + Grafana**. (Managed Grafana
> reads the OpenSearch/CloudWatch data sources directly, not this API.)

**Access column:** **`minAccess`** on the `Access` ladder — **`-`** = public · account ladder
**`SENDER`<`USER`<`BILLING`<`ACCOUNT`** · staff ladder **`SUPPORT`<`APPLICATION`<`ROOT`** · **`⬆`** = step-up ·
**`Internal`** = VPC-only S2S. Account-scoped reads return only the caller's account; **platform-wide
operational** data requires staff (`SUPPORT`+).

### Metrics, logs & traces (monitor-1, 2, 3, 9)
| Method | URI | Purpose | Access | Req |
|---|---|---|---|---|
| GET | `/monitor/metrics` | Query metrics (dimensions, window, granularity) — cache-first | SUPPORT · USER (own account) | monitor-2.2/9.1 |
| GET | `/monitor/logs` | Search logs (by `transactionId` / account / service / level / window) | SUPPORT · USER | monitor-3.3 |
| GET | `/monitor/traces/{transactionId}` | **Full cross-service timeline** for a request (logs + spans + path) | SUPPORT · USER | monitor-1.4 |
| GET | `/monitor/traces` | Search traces (window / service / status) | SUPPORT | monitor-1.4 |

### Alarms & routing (monitor-4)
| Method | URI | Purpose | Access | Req |
|---|---|---|---|---|
| GET | `/monitor/alarms` | List alarms + current state (OK / ALARM / INSUFFICIENT) | SUPPORT | monitor-4.1 |
| GET | `/monitor/alarms/{id}` | Alarm detail + state history | SUPPORT | monitor-4.1 |
| POST | `/monitor/alarms` | Create a **composite / cross-cutting** alarm (single-resource alarms live in the service manifest) | APPLICATION | monitor-4.1/4.3 |
| PATCH | `/monitor/alarms/{id}` | Edit threshold / severity / tags | APPLICATION | monitor-4.1 |
| DELETE | `/monitor/alarms/{id}` | Remove a monitor-owned alarm | APPLICATION ⬆ | monitor-4.1 |
| GET, PUT | `/monitor/routing` | The **routing layer** — map alarm name / severity / tags → **0-N** targets (Slack channels · SNS · app-level) | APPLICATION | monitor-4.4 |

### Topology & replay (monitor-6)
| Method | URI | Purpose | Access | Req |
|---|---|---|---|---|
| GET | `/monitor/topology` | Current topology snapshot (services / queues / jobs / DB state) | SUPPORT | monitor-6.1 |
| GET | `/monitor/topology/replay` | **Replay** state over a window (`at=` instant or range) within the trend window | SUPPORT | monitor-6.2 |
| GET, PUT | `/monitor/topology/sampling` | Read / set the **adaptive per-type sampling policy** (baseline · triggers · cap · cooldown) | APPLICATION | monitor-6.3 |

### Scheduled-job run ledger (monitor-7)
| Method | URI | Purpose | Access | Req |
|---|---|---|---|---|
| GET | `/monitor/jobs/runs` | List run records (by schedule / status / window) — "did it fire? did it succeed?" | SUPPORT · USER | monitor-7.2 |
| GET | `/monitor/jobs/runs/{id}` | A single run record (`start`/`end`/`durationMs`/`status`/`error?`/`transactionId`) | SUPPORT · USER | monitor-7.2 |

### Internal / S2S & ops
| Method | URI | Purpose | Access | Req |
|---|---|---|---|---|
| POST | `/monitor/internal/job-runs` | S2S run-record intake — the base `Job` self-emits here (or via SQS) | Internal | monitor-7.1 |
| GET | `/monitor/internal/metrics` | S2S metric/timeline query (e.g. [report](../report/SPECS.md) pulls) | Internal | monitor-9.1 |
| GET, PUT | `/monitor/config` | Read / set the service's own runtime config (AppConfig-backed) | ROOT | monitor-13.1 |
| GET | `/monitor/health` | Liveness / readiness of the read-API fleet | - | monitor-13.1 |

# eof
