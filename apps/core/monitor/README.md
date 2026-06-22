#
# Monitor Service
#

# Objective

The platform's **operational observability** plane: a single place to see the running
state of every service, queue, job, and datastore; to follow one request across services;
to alarm on the things that need a human; and to expose all of it to the app **without
hammering (and paying for) CloudWatch on every read**.

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
* **Inject transaction id at the API Gateway** — `x-transactionid: $context.requestId` via integration
  request mapping (no code). Confirmed approach.
* **X-Ray** active tracing injects `X-Amzn-Trace-Id` automatically across compute (already enabled per
  service via the manifest `tracing` flag).
* Services **propagate** `x-transactionid` on every downstream call (HTTP, SQS message attr, event detail);
  the base `Application`/`Trace` **falls back to a generated id** if none is present.
* Given a transaction id, monitor can assemble the **full cross-service timeline**: logs + spans + the
  services/queues it traversed.

## Metrics
* Ingest via **Metric Streams → Firehose** — never poll for dashboard reads.
* Cover the standard infra dimensions: request rate, error rate, p50/p95/p99 latency, queue depth +
  age-of-oldest-message, Lambda invocations/errors/throttles/cold starts, ECS cpu/mem/running count,
  DB connections/cpu/replica lag.
* Trend window retained ~**2 weeks** (TBD); older data ages out (out of scope above).

## Logs
* **Subscribe** to all service/Lambda log groups; ship to OpenSearch for search.
* Every log line should carry `transactionId` + `accountId` where available (correlation keys).
* Searchable by transaction id, account, service, level, time window.

## Alarms & alerting
* Define **threshold alarms** on any ingested metric (e.g. DLQ depth > N, error rate > x%, p99 > Nms).
* Alarm state changes fan out to **SNS** and **Slack** (Slack via SNS→Lambda or chatbot).
* Alarms are **declared in the owning service's manifest** where possible (so they live with the resource),
  with monitor providing cross-cutting/composite alarms.

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

# Services to utilize

* **CloudWatch** + **CloudWatch Logs** — metric/log source (read on cache-miss only).
* **CloudWatch Metric Streams → Kinesis Firehose** — push-based metric ingestion (no polling).
* **EventBridge** — resource-change + ECS/Batch task-state events feeding the topology timeline.
* **X-Ray** — distributed tracing; linked to `transactionId`.
* **OpenSearch** — log + metric search/analytics (the trend-window hot store).
* **DynamoDB** (+ TTL) — topology timeline + scheduled-job run ledger.
* **Redis / ElastiCache** — read-through cache for the API (cost control).
* **SQS** (+ DLQ) — ingestion buffers for topology events and job-run records.
* **SNS** (+ Slack) — alarm fan-out.
* **AWS Managed Grafana** — ops dashboards for non-AWS users.
* ~~AWS Timestream~~ — **RETIRED**; OpenSearch + DynamoDB cover the hot trend window.

# Open decisions

1. **Trend-window length & per-signal retention** — confirm ~2 weeks; possibly shorter for high-cardinality
   logs vs longer for coarse metrics.
2. **Job-run emission mechanism** — do targets emit run records themselves (the base `Job` lifecycle wraps
   its handler), or does monitor infer runs from CloudWatch invocation metrics + Scheduler config?
   Self-emission is richer (captures `error`/`transactionId`); inference needs no target changes.
   Leaning self-emit via the base `Job`.
3. **Slack delivery** — SNS→Lambda formatter vs AWS Chatbot.
4. **Alarm ownership split** — which alarms live in each service's manifest vs centrally in monitor.
5. **Topology replay granularity** — event-sourced (every state change) vs periodic snapshots; trade
   fidelity against storage/cost.
