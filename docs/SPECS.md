#
# rupng — Platform Specification (high level)
#

> **Scope.** This is the **map**, not the territory — a high-level overview of what the platform is,
> how it's built, and the rules it lives by. Each service and package carries its **own detailed spec**;
> this document links out to them (see [Spec index](#spec-index)) and stays deliberately shallow.

---

# What it is

A **multi-vertical marketing & engagement platform** — one hub to **reach, engage, and convert audiences
across many channels and many industries**. It unifies **outbound** (and **inbound** for SMS) communication
across **text / SMS, email, print / direct mail, social media, and voice** *(automated calls — planned)*, is
**workflow-driven** (account-defined automations orchestrate the channels), and **marketplace-extensible**
(third-party integrations plug in as workflow nodes and data sources).

It is **multi-vertical**, leading with **political** and **e-commerce**, and serving **nonprofit** and
general **marketing** alongside them. Channel behavior is unified behind two primitives — **`send`**
(1:1 addressed, consent-bound) and **`publish`** (1:many broadcast) — so a campaign or workflow targets
channels uniformly. See [CHANNELS.md](../apps/CHANNELS.md).

> **Planned channels (later consideration — not in the initial set):** **push** (mobile + web — needs OS opt-in;
> mobile requires a native app, web push rides the SPA) and **WhatsApp / RCS**. All fit the existing `send`
> channel model (provider factory + L1/L2 queues + `canSend`) — deferred, not designed out. **Voice**
> ([robocalls · IVR survey calls](../apps/core/voice/SPECS.md) — texting's cousin; reuses the channel stack, adds
> STIR/SHAKEN + abandoned-call + IVR) is listed among the channels above but its build remains a
> **product / marketing decision**.

# Product tenets

* **Workflow-driven** — automations (if/else, switch, loops, delays, channel sends, integration calls,
  sandboxed code) are the backbone of how work happens, not a bolted-on feature.
* **Marketplace-extensible** — CRMs, accounting, storage, chat, commerce, and survey tools connect as
  first-class integrations that feed and act within workflows.
* **Open & API-first** — every capability is a **public, versioned API** (the `/v1` facade over the service
  endpoints), so external systems collaborate **in both directions**: **ingest** (inbound webhooks ·
  [marketplace](../apps/core/marketplace/SPECS.md) connectors · Zapier *actions*) brings data + events **in**, and
  **egress** (triggers · outbound webhooks · exports) pushes **send + response activity** **out**. Egress is
  **governed** — gated by feature-flag × the connecting user's permissions, throttled, and bound by the
  **egress erasure boundary** (once data leaves to a third party the account chose, the account is the controller
  downstream).
* **Multi-vertical by configuration** — vertical packs (templates, compliance, routing) rather than forks.
* **Compliance-first** — **full adherence to channel + security standards is built into the core flows, not
  bolted on**: **texting** (TCPA · 10DLC / TCR · CTIA), **email** (CAN-SPAM · CASL · Gmail / Yahoo bulk-sender),
  and **security / privacy** (SOC 2 · ISO 27001 · GDPR · CCPA). The regulated bits — **consent, KYC, suppression,
  quiet hours, data rights** — **gate** the flow (the **`canSend()`** check runs before *every* send), so every
  message goes out **in adherence to these standards and transmitted securely** (TLS in transit · KMS at rest).
* **Explore now, send later** — the platform is usable immediately in **sandbox**; heavy approvals
  (carrier KYC, domain auth) run in the background per channel.
* **Fast, reliable & measurable** — **high-throughput, fair-share** sending (the **`WorkQueue`** governor — one
  account can't starve another; **backpressure, not drops**) with **at-least-once + idempotent** delivery
  (retry → DLQ, no double-send), and **full insight into send *and* response activity** — delivery / engagement /
  reply analytics + **multi-touch attribution** ([analytics](../apps/core/analytics/SPECS.md)), **live status**
  ([realtime](../apps/core/realtime/SPECS.md)), and **ops / SLA** visibility ([monitor](../apps/core/monitor/SPECS.md)).
  Every message is fast, dependable, and **measurable end-to-end**.

# Architecture

* **Microservice architecture**, **AWS-native**, in a **TypeScript monorepo** (Turborepo + npm
  workspaces). Services are thin **Fastify** apps on **ECS Fargate** and **Lambda**, fronted in the cloud by
  **API Gateway** (prefix-routes `/<service>/*`) + **CloudFront** (serves the React SPA from S3). A
  **local-only [`webproxy`](../apps/core/webproxy/SPECS.md)** emulates that edge for development — it is **never
  deployed**.
* **One endpoint definition** drives client, server, and API docs (no drift) — see
  [`@repo/endpoint`](../packages/endpoint/SPECS.md).
* **Result-based, non-throwing** interfaces across shared libraries — operational failures are returned
  (`Type.Result<T>`), not thrown.
* **Event-driven** between services — a Kafka entity-topic + typed `Event<T>` envelope for the
  event bus, SQS (with a fair-share work-queue template) for per-service work, EventBridge for schedules.

# Tech stack (cloud → front end)

| Layer | Choice |
|---|---|
| **Infrastructure as code** | AWS **CDK** (TypeScript); **LocalStack** for local/dev parity |
| **Compute** | **Fastify** services on **ECS Fargate** + **Lambda** (event/edge/sandbox runners) |
| **Language / runtime** | **TypeScript** (strict) on **Node** — same language cloud-to-client |
| **Database (per service)** | A service picks the fit: **DynamoDB** (key-value, scale) **or** **RDS / PostgreSQL** (relational) |
| **Other data stores** | **OpenSearch** (search), **S3** (objects), cache |
| **Messaging & events** | **Kafka** (entity-topic + typed `Event`), **SQS** (fair-share `WorkQueue`), **EventBridge** + Scheduler |
| **AI / LLM** | **Bedrock + Anthropic + OpenAI** behind a single adapter — [`@repo/ai`](../packages/ai/README.md) |
| **Media** | **MediaConvert** (transcode) — [media service](../apps/core/media/SPECS.md) |
| **Identity & access** | **Cognito** + RBAC role ladders (account + staff) |
| **Front end** | **React** web app, served/proxied at the edge — [web](../apps/core/web/SPECS.md), [webproxy](../apps/core/webproxy/SPECS.md) |
| **Build / mono-repo** | **Turborepo** + npm workspaces |

# Cross-cutting platform packages

`@repo/endpoint` (the API contract), `@repo/services` (AWS facades + `Result` + fair-share queue),
`@repo/common` (types + utils), `@repo/ai` (LLM adapters),
`@repo/cloud-manifest` (infra description). See the [Spec index](#spec-index).
*(The workflow engine is no longer a package — it lives in the [workflow service](../apps/core/workflow/SPECS.md)'s `src/`.)*

# Time, scheduling & timezones (platform-wide)

Anything with a date/time — **report schedules + windows, campaign sends, TCPA quiet hours, recurrences,
cron** — follows one discipline, because timezone bugs are the classic scheduling failure:

* **Persist + compute in UTC.** All stored timestamps are UTC (`Type.ISODateTime` / `EpochMilliseconds`,
  `…Z`). A service runs in its own zone — that zone is **never** used for scheduling.
* **Store an explicit IANA timezone** with any *user-facing* scheduled time, recurrence, window, or
  quiet-hour — never a bare local time, a fixed UTC offset, or "the viewer's tz".
* **Compute occurrences in that zone → fire on the resulting UTC instant** (DST-correct via the IANA
  zone). "3 PM Eastern" stays 3 PM local across EST↔EDT; the UTC instant shifts — which is why a fixed
  offset / fixed-UTC schedule is wrong (it drifts an hour twice a year).
* **Relative windows resolve at run time** to concrete UTC `{ start, end }` and are **stamped** on the
  record, so every run is reproducible + auditable.
* **Always display the zone** ("3:00 PM America/New_York (EDT)") so 3PM Eastern is never misread as 3PM
  Pacific.

Authoritative treatment + worked example: **[report spec → Timezone discipline](../apps/core/report/SPECS.md)**.
When the shared scheduling path (`@repo/services` `Scheduler` / EventBridge Scheduler) is built, this lives there.

# Events & messaging — the inter-service bus (platform-wide)

**Kafka (MSK) is the single inter-service communication bus** — the one event spine every service publishes
to and subscribes from (entity changes, analytics, realtime fan-out), never a per-service queue-bus. A
service never calls another service synchronously to announce that something happened; it **emits an event**,
and any number of consumers react independently. The **`Events.Envelope` is universal** — the *same* body
carries the event over **Kafka** (inter-service), the **WebSocket** push frame (server → client), and
**outbound webhooks** (service → third party). Defined once, it flows service → Kafka → WebSocket → client
pub/sub bus (and → webhook) **without being reshaped** at any hop.

**An event = an `object` + a `verb` + a typed `payload`, wrapped in one `Envelope`.** The vocabulary lives in
**[`@repo/events`](../packages/events/README.md)** — the shared base both `@repo/endpoint` (the API/event contract)
and `@repo/cloud-manifest` (the pub/sub bindings) build on, so it has one home and can't drift.

* **`object`** — `Events.Object`: the **entity/noun** the event is about, `<service>.<noun>`
  (`contact.contact`, `media.asset`). **This is the Kafka topic and the pub/sub binding.** The owning service
  defines its objects.
* **`verb`** — `Events.Verb`: the **universal** lifecycle set `created | updated | deleted | purged`. The
  discriminator a consumer switches on within a topic.
* **`action`** — `Events.Action` = `${object}.${verb}` (`contact.contact.updated`), **materialized on the
  envelope** so a sink can filter by full action, by object alone, or by verb alone (`actionOf`/`objectOf`/
  `verbOf`). Access is keyed by action — `created` and `purged` of the same object can have different floors.
* **`payload`** — each **object** has **one defined TypeScript interface** for its body (a **1:1 object ↔
  payload** contract — `PayloadFor<O>`, declared by the owning service). **Fat by design** — *event-carried
  state transfer*: the event carries the **full state** a consumer needs, so consumers stay autonomous and
  never call back (no read-amplification, clean replay).
* **`Events.Envelope`** wraps it: `version`, unique **`eventId`** (idempotency/dedup), `occurredAt`,
  `accountId`, `actor` / `target` / `source` / `outcome`, PII-light `context`, **`object`** + **`verb`** +
  **`action`**, and the typed **`data`** (the payload). `Events.Of<O>` narrows it to one object with a
  required, typed `data`.

**One topic per entity/noun — subscribers take only what they care about.** Kafka filters by **topic**, not by
message field, so the topic *is* the unit of subscription. The topic **is** `Events.Object` (`<service>.<noun>`)
— owned by the publishing service and **keyed by the entity id** so an entity's events stay ordered. A consumer
subscribes **only to the objects it needs** and switches on the **verb** within (one topic carries
created/updated/deleted for that noun). It does **not** subscribe to a firehose and filter in-process. Because
the topic *is* the `Events.Object` enum value, there's no separate topic registry to drift against the action
vocabulary. (`Events.Stream.BEHAVIOR` / `ENGAGEMENT` are the exception: high-volume **analytics ingestion**
streams whose **sole** consumer is analytics — broad on purpose, not entity state-change.)

> **Why object-grain, not per-verb?** Kafka orders only *within* a topic-partition. If `created`/`updated`/
> `deleted` were separate topics, an entity's lifecycle would split across them with no ordering — the many
> state-sync consumers (caches, search, read models) **must** apply changes in order or corrupt their copy.
> Keeping all verbs on the one entity topic (keyed by id) gives per-entity ordering for free. A consumer that
> only cares about, say, `created` subscribes to the object topic and ignores the other verbs — a trivial
> in-process `switch`, *not* a firehose (it already wanted that entity). Per-verb topics would also 4× the
> topic count and lose ordering. (Promote a single verb to its own topic only as a deliberate exception.)

**Two classes — don't conflate them.** **Kafka is broadcast state-change** (1 publisher → 0..N subscribers,
near-real-time, the entity's representation). The **second class is point-to-point work** — a command/job for
one worker pool — and that rides the **SQS `WorkQueue`** (manifest `owns.queues` + a job), *not* the event bus.
Use Kafka to *announce* a change; use a queue to *hand someone work*.

**A service declares its wiring in its manifest, not in code.** `publishes` / `subscribes`
([CloudManifest](../packages/cloud-manifest/docs/MANIFEST.md)) bind the service to topics — each `topic` is an
`Events.Object` (entity) or `Events.Stream` (analytics); **direction is implied by which array** (no `mode`
flag), and the CDK derives the IAM grants + consumer groups. The manifest names the *pipe*; the
`object`+`verb`+payload is the *contract* that flows through it.

* **Ordering & idempotency.** Events on a topic are **keyed** (per-entity / per-account) for ordering;
  `eventId` lets every sink dedupe, and an optional sequence lets a consumer drop a stale/out-of-order event.
* **PII & the audit mirror.** Fat payloads can be PII-dense, so they ride **access-controlled** topics. The
  **[audit](../apps/core/audit/SPECS.md)** mirror persists only the **PII-light** envelope metadata (ids, action,
  outcome — never the fat `data`), so the immutable trail survives a GDPR forget. See [Security](#security--compliance).
* **Realtime gating.** Per-action metadata (`Events.canConsume(role, action)`) is the floor role to *receive*
  an event; the [realtime service](../apps/core/realtime/SPECS.md) gates browser push on it.

Authoritative treatment: **[`@repo/events`](../packages/events/README.md)** (the vocabulary — `Object`, `Verb`,
`Action`, `Envelope`, the object ↔ payload contract, `canConsume`), **[`@repo/services` aws/SPECS.md → Entity
state-change events](../packages/services/src/aws/SPECS.md)** (how a service publishes — fat payload, keying,
don't-GET-before-publish, CDC), and **[`/cloud` SPECS.md → Publishers & subscribers](../cloud/SPECS.md)** (the
manifest bindings).

The vocabulary, envelope, transports, and bus are all in place:
* **`@repo/events`** — `Object`/`Verb`/`Stream`/`Action`, `Envelope` (`object`+`verb`+`action`+typed `data`),
  the `PayloadFor<O>` contract, `canConsume`.
* **Kafka facade** ([`Kafka.ts`](../packages/services/src/aws/Kafka.ts)) — `publishEvent(envelope)` /
  `subscribeEvents(group, object, …)` carry `Events.Envelope` on `Events.Object` topics (keyed by `target.id`,
  routing fields in headers); `publishStream`/`subscribeStream` for analytics; raw `publish*`/`subscribe*` remain.
* **Universal body** — `Type.MessageEnvelope` is removed; the WebSocket push frame
  ([`WebsocketService`](../apps/core/web/src/model/service/WebsocketService.ts)) and outbound webhooks carry
  `Events.Envelope`; the client bus re-publishes it whole, routed by `action`.

## Event-bus code follow-ups

* **Per-object payloads** — only `media.asset` is defined as the worked example; each owning service declares
  its entity's `PayloadFor<O>` (via `EventPayloads` augmentation) as it's built (defaults to `unknown` until then).
* **`/cloud` synth of Kafka topics/bindings** — `publishes`/`subscribes` (`Events.Object`/`Stream`) have no
  `ServiceStack` synth code yet (topic provisioning, MSK IAM for the role, consumer-group config).
* **`audit`** is still a stub (no `package.json`), so `AuditModel` isn't compiled — it adopts the `object`+`verb`
  envelope when it becomes a real package.

# Workflow & marketplace (the automation backbone)

* **Workflow** — a durable, versioned interpreter over a node graph: triggers, logic gates, delays,
  `send`/`publish` channel nodes, integration nodes, AI nodes, and a **sandboxed code node** (isolated
  Lambda runner, zero-permission role). The **[workflow service](../apps/core/workflow/SPECS.md)** —
  decider, not doer (enqueues side effects to the owning service); the engine design is in its
  [README](../apps/core/workflow/README.md).
* **Marketplace** — the catalog + credential vault + connectors that bring external systems (CRM,
  accounting, storage, chat, commerce, surveys) **into** workflows as inputs and actions.
  [marketplace spec](../apps/core/marketplace/SPECS.md).

# Security & compliance

> **Platform-wide overview:** [SECURITY_COMPLIANCE.md](SECURITY_COMPLIANCE.md) unifies what we cover and how
> (with per-service pointers) + the architecture-impacting gaps. This section is the summary.

**Target certifications / regimes:**

* **SOC 2 Type II** — operating-effectiveness of security/availability/confidentiality controls over time.
* **ISO 27001** — a certified Information Security Management System.
* **GDPR** — lawful basis, data-subject rights (access, erasure/forget, portability), data residency.
* **CCPA / CPRA** — California consumer rights (know / delete / correct, opt-out of sale/share); we go
  further with **opt-in** for any data sale/sharing. See [auth → Data sale / sharing](../apps/core/auth/specs/SPECS.md).
* **PCI-DSS v4.0** — for the **billing/payment** surface only. Scope is **deliberately minimized**:
  **Stripe tokenization / Elements keeps PAN out of our systems** (target **SAQ-A**), so card data never
  transits or persists in our services. See [account → PCI](../apps/core/account/specs/SPECS.md).

**Domain-regulatory (messaging):** **TCPA** (consent, STOP, quiet hours), **10DLC / TCR** carrier brand
& campaign registration, **CAN-SPAM** (email), and channel-specific provider rules.

**Engineering practices that back the above:**

* **Secrets in KMS + Secrets Manager**, never in env or code; **per-environment KMS CMK** (semi-annual
  rotation; BYOK / collab envelope encryption uses the per-env CMK — per-room DEKs isolate — and a per-account
  customer-held key is **deferred**, see [cloud](../cloud/SPECS.md)); Bedrock via IAM (no key).
* **Least-privilege IAM**; environment isolation (never two environments on one AWS account).
* **Audit & change history — two layers (don't conflate).** Security-relevant **actions** (login, access, role /
  permission change, export, config / consent change, integration connect, money, `staff.impersonate`) are emitted
  via the shared **`Application.audit()`** to the central **[audit](../apps/core/audit/SPECS.md)** service —
  **PII-light** (ids, not values) + **immutable (WORM)** + long retention + legal hold, so it survives a GDPR
  forget. **Field-level change history** (per-field `{before, after}` + compare/revert) is **co-located** with
  each owning service — **PII-dense** + **purges on forget**. **Audit = *that* it happened; change-history =
  *how the fields changed*.** AWS **CloudTrail** is the infra/control-plane peer.
* **Data residency — separate AWS account per market (jurisdiction).** The **EU market runs in its own AWS
  account, EU-region**, so EU PII **stays in-jurisdiction** and never lands in the US account. **No
  cross-*jurisdiction* flows** — market PII never crosses to another jurisdiction (no US↔EU live, backup, log,
  or analytics). **Live serving is single-region.** **Within a jurisdiction**, **DR backup *may* replicate to a
  paired region** (e.g. `us-east`→`us-west`: S3 CRR + hourly DynamoDB copy → **RPO ≈ 1 h**; a future warm-passive
  uses same-jurisdiction Global Tables) — surviving a full-region loss **without** PII leaving the jurisdiction.
  See [cloud → Resilience & DR](../cloud/SPECS.md), [AWS → Region & account topology](../packages/services/src/aws/SPECS.md),
  and [auth → data residency](../apps/core/auth/specs/SPECS.md).
* **Auth posture** — Cognito, enforced MFA + adaptive step-up, **enumeration-neutral** auth surfaces,
  role-keyed device trust, optional account **SSO-only**. See [auth](../apps/core/auth/specs/SPECS.md),
  [access-flows](../apps/core/auth/specs/ACCESS-FLOWS.md), [risk](../apps/core/auth/specs/RISK.md).
* **Consent everywhere** — even survey/registration over SMS honor consent + STOP + quiet hours.
* **PII minimization + erasure** — GDPR forget purges PII and keeps only opaque ids in the analytics lake.
* **Egress erasure boundary** — once PII **leaves our system** to a third party the account chose (a
  [marketplace](../apps/core/marketplace/SPECS.md) integration, **[Zapier](../apps/integrations/zapier/SPECS.md)**, an
  outbound webhook, an export), our erasure duty is **stop sending + disclose** — **not** reach-in-and-delete; we
  **cannot recall** data already delivered. The **account is the controller** for downstream erasure in their
  connected systems, **accepted up front** (accept-to-enable + the sub-processor / data-egress acknowledgment,
  with the **EU→US cross-border SCC gate** for EU accounts). Internally, **contact-forget** stops future egress +
  purges our own copies.

# Analytics, attribution & observability

* **Analytics** — an event lake plus **multi-touch attribution** across channels (PII-minimized).
  [analytics spec](../apps/core/analytics/SPECS.md).
* **Observability / monitoring** — service health, job-run ledger, alerting (~2-week ops window).
  [monitor spec](../apps/core/monitor/SPECS.md).
* **Audit trail** — the **immutable, PII-light, long-retention** record of *who did what* (distinct from
  monitor's ops telemetry and from per-service change history). [audit spec](../apps/core/audit/SPECS.md).

---

# Spec index

**Foundations & ops**
* [Get started](GETSTARTED.md) · [DEVELOP](DEVELOP.md) · [cloud / IaC](../cloud/SPECS.md) · [local](../cloud/local/README.md) · [RUNBOOK](RUNBOOK.md) — incident response · breach 72h · time commitments

**Channels (cross-cutting)**
* [CHANNELS.md](../apps/CHANNELS.md) — send vs. publish, omnichannel hub

**Core services** (`apps/core/*`)
* [auth](../apps/core/auth/specs/SPECS.md) — incl. [access-flows](../apps/core/auth/specs/ACCESS-FLOWS.md), [risk](../apps/core/auth/specs/RISK.md)
* [account](../apps/core/account/specs/SPECS.md) — incl. [PRICING](../apps/core/account/specs/PRICING.md) · [registration / TCR](../apps/core/registration/SPECS.md)
* [contact](../apps/core/contact/SPECS.md) · [campaign](../apps/core/campaign/SPECS.md) · [dispatch](../packages/services/DISPATCH.md) · [links](../apps/core/links/SPECS.md) — tracked links / QR / PURL
* Channels: [texting](../apps/core/texting/SPECS.md) · [email](../apps/core/email/SPECS.md) · [social](../apps/core/social/SPECS.md) · [print](../apps/core/print/SPECS.md) · [survey](../apps/core/survey/SPECS.md) · [voice](../apps/core/voice/SPECS.md) *(planned)*
* [workflow](../apps/core/workflow/SPECS.md) — the automation engine (+ engine design [README](../apps/core/workflow/README.md)) · [marketplace](../apps/core/marketplace/SPECS.md) · [media](../apps/core/media/SPECS.md) · [search](../apps/core/search/SPECS.md)
* [analytics](../apps/core/analytics/SPECS.md) · [report](../apps/core/report/SPECS.md) · [monitor](../apps/core/monitor/SPECS.md) — ops telemetry · [audit](../apps/core/audit/SPECS.md) — immutable action-level trail
* [web](../apps/core/web/SPECS.md) · [webproxy](../apps/core/webproxy/SPECS.md) · [app](../apps/core/app/SPECS.md) — web BFF (bootstrap config / flags / aggregation) · [realtime](../apps/core/realtime/SPECS.md) — Kafka → browser push · [collab](../apps/core/collab/SPECS.md) — live rooms (chat / tiptap)

**Integrations** (`apps/integrations/*`) — account-connected external systems (marketplace / Zapier governance)
* CRM / sync: [hubspot](../apps/integrations/hubspot/SPECS.md)
* Commerce (inbound trigger + conversion): [shopify](../apps/integrations/shopify/SPECS.md)
* Ops / command surface: [slack](../apps/integrations/slack/SPECS.md) · automation bridge: [zapier](../apps/integrations/zapier/SPECS.md)
* Donation platforms: [actblue](../apps/integrations/actblue/SPECS.md) · [winred](../apps/integrations/winred/SPECS.md)
* Political / nonprofit CRMs: [ngpvan](../apps/integrations/ngpvan/SPECS.md) · [nationbuilder](../apps/integrations/nationbuilder/SPECS.md) · [i360](../apps/integrations/i360/SPECS.md) · [blackbaud](../apps/integrations/blackbaud/SPECS.md)
* Storage (report-delivery destinations): [dropbox](../apps/integrations/dropbox/SPECS.md) · [google-drive](../apps/integrations/google-drive/SPECS.md)

**Shared packages** (`packages/*`)
* [endpoint](../packages/endpoint/SPECS.md) · [services](../packages/services/README.md) (+ [DATABASE](../packages/services/DATABASE.md)) · [ai](../packages/ai/README.md) · [cloud-manifest](../packages/cloud-manifest/README.md)
