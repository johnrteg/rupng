#
# rupng — Platform Specification (high level)
#

> **Scope.** This is the **map**, not the territory — a high-level overview of what the platform is,
> how it's built, and the rules it lives by. Each service and package carries its **own detailed spec**;
> this document links out to them (see [Spec index](#spec-index)) and stays deliberately shallow.

---

# What it is

A **multi-channel (omnichannel) messaging platform** — a single hub for **outbound** (and **inbound**
for SMS) communication across **text / SMS, email, voice, push, WhatsApp / RCS, print / direct mail,
and social media**. It is **workflow-driven** (account-defined automations orchestrate the channels)
and **marketplace-extensible** (third-party integrations plug in as workflow nodes and data sources).

It is **multi-vertical**, leading with **political** and **e-commerce**, and serving **nonprofit** and
general **marketing** alongside them. Channel behavior is unified behind two primitives — **`send`**
(1:1 addressed, consent-bound) and **`publish`** (1:many broadcast) — so a campaign or workflow targets
channels uniformly. See [CHANNELS.md](apps/CHANNELS.md).

# Product tenets

* **Workflow-driven** — automations (if/else, switch, loops, delays, channel sends, integration calls,
  sandboxed code) are the backbone of how work happens, not a bolted-on feature.
* **Marketplace-extensible** — CRMs, accounting, storage, chat, commerce, and survey tools connect as
  first-class integrations that feed and act within workflows.
* **Multi-vertical by configuration** — vertical packs (templates, compliance, routing) rather than forks.
* **Compliance-first** — the regulated bits (consent, KYC, data rights) are built into the core flows.
* **Explore now, send later** — the platform is usable immediately in **sandbox**; heavy approvals
  (carrier KYC, domain auth) run in the background per channel.

# Architecture

* **Microservice architecture**, **AWS-native**, in a **TypeScript monorepo** (Turborepo + npm
  workspaces). Services are thin **Fastify** apps on **ECS Fargate** and **Lambda**, fronted in the cloud by
  **API Gateway** (prefix-routes `/<service>/*`) + **CloudFront** (serves the React SPA from S3). A
  **local-only [`webproxy`](apps/core/webproxy/SPECS.md)** emulates that edge for development — it is **never
  deployed**.
* **One endpoint definition** drives client, server, and API docs (no drift) — see
  [`@repo/endpoint`](packages/endpoint/README.md).
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
| **AI / LLM** | **Bedrock + Anthropic + OpenAI** behind a single adapter — [`@repo/ai`](packages/ai/README.md) |
| **Media** | **MediaConvert** (transcode) — [media service](apps/core/media/SPECS.md) |
| **Identity & access** | **Cognito** + RBAC role ladders (account + staff) |
| **Front end** | **React** web app, served/proxied at the edge — [web](apps/core/web/SPECS.md), [webproxy](apps/core/webproxy/SPECS.md) |
| **Build / mono-repo** | **Turborepo** + npm workspaces |

# Cross-cutting platform packages

`@repo/endpoint` (the API contract), `@repo/services` (AWS facades + `Result` + fair-share queue),
`@repo/common` (types + utils), `@repo/workflow` (the automation model), `@repo/ai` (LLM adapters),
`@repo/cloud-spec` (infra description). See the [Spec index](#spec-index).

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

Authoritative treatment + worked example: **[report spec → Timezone discipline](apps/core/report/SPECS.md)**.
When the shared scheduling path (`@repo/services` `Scheduler` / EventBridge Scheduler) is built, this lives there.

# Events & messaging (platform-wide)

Something-happened facts move over three transports — **Kafka** (service ↔ service), the **WebSocket**
push frame (server → client), and the **client pub/sub bus** (component ↔ component) — and they all carry
**one body**: `Type.MessageEnvelope` from `@repo/common`. An event is defined once and flows end-to-end
without being reshaped at any hop.

* **One envelope.** `{ type, data, … }` — `type` is the verb to switch on (`"contact.updated"`), `data`
  is the typed payload; `key` / `id` / `time` / `source` / `transactionId` / `version` / `seq` / `changed`
  are optional metadata each layer fills in as it has it. Lives in `@repo/common` because it's the only
  package all transports share, and it's **dependency-free** — no AWS types leak into the web bundle.
* **Fat state-change events.** One keyed topic **per entity**, **keyed by entity id** (so an entity's
  events stay ordered), the verb in `type`, and the **full entity snapshot** in `data` — consumers never
  call back for "the rest". `key` is required on Kafka (partition/ordering); optional on the other transports.
* **PII stays off widely-consumed topics.** Fat events use **opaque ids**, not PII, on any broadly-subscribed
  or access-control topic (see [Security](#security--compliance)).
* **The bus is the dispatcher, not a reshaper.** A server event arrives on the socket as a `MessageEnvelope`
  and is re-published **whole** on the client bus (routed by `type`), so subscribers see `id`/`time`/`source`,
  not just `data`. UI-origin signals (theme, route) ride the same bus, same envelope.

Authoritative treatment: **[`@repo/services` aws/SPECS.md → Entity state-change events](packages/services/src/aws/SPECS.md)**
(Kafka conventions) and **[`@repo/common` SPECS.md](packages/common/src/SPECS.md)** (the `MessageEnvelope` type).

# Workflow & marketplace (the automation backbone)

* **Workflow** — a durable, versioned interpreter over a node graph: triggers, logic gates, delays,
  `send`/`publish` channel nodes, integration nodes, AI nodes, and a **sandboxed code node** (isolated
  Lambda runner, zero-permission role). [workflow spec](packages/workflow/README.md).
* **Marketplace** — the catalog + credential vault + connectors that bring external systems (CRM,
  accounting, storage, chat, commerce, surveys) **into** workflows as inputs and actions.
  [marketplace spec](apps/core/marketplace/SPECS.md).

# Security & compliance

**Target certifications / regimes:**

* **SOC 2 Type II** — operating-effectiveness of security/availability/confidentiality controls over time.
* **ISO 27001** — a certified Information Security Management System.
* **GDPR** — lawful basis, data-subject rights (access, erasure/forget, portability), data residency.

**Domain-regulatory (messaging):** **TCPA** (consent, STOP, quiet hours), **10DLC / TCR** carrier brand
& campaign registration, **CAN-SPAM** (email), and channel-specific provider rules.

**Engineering practices that back the above:**

* **Secrets in KMS + Secrets Manager**, never in env or code; **per-account BYOK** keys KMS-encrypted;
  Bedrock via IAM (no key).
* **Least-privilege IAM**; environment isolation (never two environments on one AWS account); audit
  logging of security-relevant events.
* **Auth posture** — Cognito, enforced MFA + adaptive step-up, **enumeration-neutral** auth surfaces,
  role-keyed device trust, optional account **SSO-only**. See [auth](apps/core/auth/SPECS.md),
  [LOGIN](apps/core/auth/specs/LOGIN.md), [REGISTRATION](apps/core/auth/specs/REGISTRATION.md).
* **Consent everywhere** — even survey/registration over SMS honor consent + STOP + quiet hours.
* **PII minimization + erasure** — GDPR forget purges PII and keeps only opaque ids in the analytics lake.

# Analytics, attribution & observability

* **Analytics** — an event lake plus **multi-touch attribution** across channels (PII-minimized).
  [analytics spec](apps/core/analytics/SPECS.md).
* **Observability / monitoring** — service health, job-run ledger, alerting.
  [monitor spec](apps/core/monitor/SPECS.md).

---

# Spec index

**Foundations & ops**
* [README](README.md) · [DEVELOP](DEVELOP.md) · [cloud / IaC](cloud/README.md) · [local](cloud/local/README.md)

**Channels (cross-cutting)**
* [CHANNELS.md](apps/CHANNELS.md) — send vs. publish, omnichannel hub

**Core services** (`apps/core/*`)
* [auth](apps/core/auth/SPECS.md) — incl. [LOGIN](apps/core/auth/specs/LOGIN.md), [REGISTRATION](apps/core/auth/specs/REGISTRATION.md)
* [account](apps/core/account/SPECS.md) — incl. [PRICING](apps/core/account/PRICING.md) · [registration / TCR](apps/core/registration/SPECS.md)
* [contact](apps/core/contact/SPECS.md) · [campaign](apps/core/campaign/SPECS.md) · [dispatch](apps/core/dispatch/SPECS.md) · [links](apps/core/links/SPECS.md) — tracked links / QR / PURL
* Channels: [texting](apps/core/texting/SPECS.md) · [email](apps/core/email/SPECS.md) · [social](apps/core/social/SPECS.md) · [print](apps/core/print/SPECS.md) · [survey](apps/core/survey/SPECS.md)
* [marketplace](apps/core/marketplace/SPECS.md) · [media](apps/core/media/SPECS.md) · [search](apps/core/search/SPECS.md)
* [analytics](apps/core/analytics/SPECS.md) · [report](apps/core/report/SPECS.md) · [monitor](apps/core/monitor/SPECS.md)
* [web](apps/core/web/SPECS.md) · [webproxy](apps/core/webproxy/SPECS.md) · [app](apps/core/app/SPECS.md) — web BFF (bootstrap config / flags / aggregation) · [realtime](apps/core/realtime/SPECS.md) — Kafka → browser push · [collab](apps/core/collab/SPECS.md) — live rooms (chat / tiptap)

**Shared packages** (`packages/*`)
* [endpoint](packages/endpoint/README.md) · [services](packages/services/README.md) (+ [DATABASE](packages/services/DATABASE.md)) · [workflow](packages/workflow/README.md) · [ai](packages/ai/README.md) · [cloud-spec](packages/cloud-spec/README.md)
