#
# Infrastructure definition
#

/cloud
/packages
    /cloud-manifest

# Objective

The **platform infrastructure** — how every service is **built, wired, governed, and made compliant** on AWS.
Two layers split the concern: the **[AWS topology & facade conventions](../packages/services/src/aws/SPECS.md)**
own *how a service uses AWS* (the **region / residency model**, the `WorkQueue` fair-share primitive, the Kafka
event envelope, S3 layout, the WebSocket registry, AppConfig); **this spec** owns *how the platform is built and
governed* — the **IaC pattern** (manifests → CDK, below) plus the **cross-cutting requirements, compliance, and
resilience** every service inherits. The synthesis below is derived from the cross-cutting needs that recur
across the [service specs](../docs/SPECS.md).

# Platform infrastructure tenets

The non-negotiables that recur across **every** service spec:

* **Data residency = jurisdiction · served single-region · DR cross-region *within* jurisdiction.** A
  **market = a jurisdiction** (US, EU, …) in its **own account**, **served from one region, multi-AZ** (no
  cross-region *live* traffic). **DR backups replicate to a SECOND region in the same jurisdiction** (e.g.
  `us-east-1` → `us-west-2`; `eu-west-1` → `eu-central-1`) — surviving a full-region loss **without** data
  leaving the jurisdiction. **Cross-*jurisdiction* (US ↔ EU) is forbidden — live *or* backup.** *(GDPR Art 44–49
  governs leaving the **EU/EEA**, not staying in one region — so same-jurisdiction cross-region DR is
  compliant.)* The model lives in the [AWS topology](../packages/services/src/aws/SPECS.md); **`/cloud`
  enforces it** — region pinned per account, and the **only** permitted cross-region flow is **encrypted DR
  backup to the jurisdiction's paired region** (everything else cross-region is rejected). *(Drives texting /
  email / realtime / contact / collab.)*
* **Encryption everywhere.** **KMS at rest** on *every* stateful resource (DynamoDB · S3 · OpenSearch · SQS ·
  Redis), **TLS / WSS in transit**; **envelope encryption** (account CMK) where BYOK applies (collab). The
  manifest **defaults resources to encrypted** — opting out is explicit + reviewed.
* **Tenant isolation — reseller / white-label day-one.** Data is **tenant-keyed**; **buckets are by purpose,
  never per-tenant** (aws-topology rule); per-tenant **config / credentials / branding.**
* **Least privilege by construction.** The manifest's `uses` + access-intent **derives IAM** — **no hand-written
  policies**; a service can touch only what it declares.
* **Config-driven, not redeploy.** Runtime knobs (queue mappings, rate limits, push-sets, feature flags) live in
  **AppConfig** — tunable without a deploy.
* **One streaming backbone.** **Kafka (MSK)** is the single event spine (entity events, analytics, realtime
  fan-out) — not a per-service bus.

# Services define a `manifest`, not CDK

Each service exports a typed resource manifest — service-agnostic, no CDK/AWS coupling. Keep it in a dedicated entry (`src/CloudManifest.ts`, exposed as the package's `./manifest` subpath) so the CDK synth pulls only the manifest, not the service's runtime code:


// packages/cloud-manifest — the shared contract
export interface ResourceManifest {
  service: string;
  owns: {
    tables?:  TableSpec[];     // { key, partitionKey, sortKey?, ttlAttr?, stream? }
    queues?:  QueueSpec[];     // { key, fifo?, dlq?, visibilityTimeout? }
    buckets?: BucketSpec[];    // { key, public?, lifecycleDays? }
    secrets?: SecretSpec[];    // { key }
  };
  uses?: ResourceRef[];        // resources OWNED by other services, + access intent
}
export interface ResourceRef {
  service: string; kind: 'queue'|'bucket'|'table'|'secret'; key: string;
  access: 'read' | 'write' | 'readwrite' | 'send' | 'consume';
}

// apps/core/contact/src/CloudManifest.ts
export const manifest: ResourceManifest = {
  service: 'contact',
  owns: {
    tables:  [{ key: 'contacts', partitionKey: 'accountId', sortKey: 'contactId' }],
    queues:  [{ key: 'import', dlq: true }],
    buckets: [{ key: 'imports', lifecycleDays: 30 }],
  },
  uses: [{ service: 'media', kind: 'bucket', key: 'media', access: 'read' }],
};

* `Declare access intent`, not just resources. Because the manifest says "I consume this queue" / "read that bucket," the CDK app can derive least-privilege IAM automatically — you never hand-write policies. The declaration drives resource + permission + (below) env injection.
* `Owner vs reference`. A resource is owned by exactly one service (owns); another service that needs it uses uses (a reference). CDK grants the consumer's role access to the owner's resource. Clear ownership + controlled cross-service access.

# /cloud consumes manifests → synthesizes stacks

The CDK app imports every manifest and builds:

* A stack per service (independent deploy, isolated blast radius) from its owns.
* A shared platform stack for foundational/shared things (VPC, the shared event bus, OpenSearch, the dispatch queues) that service stacks reference.
* Wires the uses refs into IAM grants + env injection.

// /cloud/src/app.ts (sketch)
import { manifest as contact } from '@repo/contact/cloud';
import { manifest as media }   from '@repo/media/cloud';
for (const m of [contact, media, ...]) new ServiceStack(app, m, { env });

## The runtime handoff (the part that matters most): IDs back to services
Don't make services discover resources by querying AWS at runtime. Two complementary mechanisms, both keyed by logical key (`'import'`, `'contacts'`) so the service never hardcodes physical names:

1. CDK injects identifiers as env vars into the service's compute (the cleanest for your Application/Job base). When CDK creates the resource, it both grants IAM and sets the env var on the Lambda/ECS task:

`queue.grantConsumeMessages(serviceRole);`
`fn.addEnvironment('QUEUE_IMPORT_URL', queue.queueUrl);   // CDK-injected`
The service reads it via a typed resolver from cloud-manifest:

`Cloud.queueUrl('import')   // → process.env.QUEUE_IMPORT_URL`
`Cloud.tableName('contacts')`

2. `SSM Parameter Store` as the registry for anything not injectable or shared across services: CDK publishes each resource's physical id under a convention path `/{env}/{service}/{kind}/{key};` services resolve logical keys at boot (cached) — fits the config-at-startup pattern in your Application base.

The shared naming/convention helpers live in cloud-manifest and are used by both sides — CDK to name/publish, the service to resolve — so they can't drift:

// packages/cloud-manifest
export const physicalName = (env, svc, kind, key) => `${env}-${svc}-${kind}-${key}`;
export const ssmPath      = (env, svc, kind, key) => `/${env}/${svc}/${kind}/${key}`;

(For maximum simplicity you can even skip SSM and rely purely on deterministic convention naming — both CDK and the service compute the same physical name from physicalName(...). Env injection is still nicer for Lambda; convention is the zero-plumbing fallback.)

# Publishers & subscribers — what's actually on the wire

A manifest's `publishes` / `subscribes` bind a service to a Kafka **topic**. The topic **is** the event
identity from **`@repo/events`** — never a hand-typed literal — so a publisher and a subscriber can't drift:

* **One topic per entity** — `Events.Object` (`<service>.<noun>`, e.g. `contact.contact`, `media.asset`),
  owned by the publishing service and **keyed by entity id** for ordering. A subscriber takes only the objects
  it cares about (Kafka filters by topic) and switches on the **`verb`** within. *Plus* a couple of broad
  **`Events.Stream`** analytics streams (`BEHAVIOR` / `ENGAGEMENT`) whose sole consumer is analytics.
* **The body** — an **`Events.Envelope`** (`@repo/events`): `{ version, eventId, occurredAt, accountId, actor,
  object, verb, action, target, source, outcome, context?, data }`. `object` matches the topic, `verb` is the
  lifecycle, **`action`** = `${object}.${verb}` is materialized so a sink can filter on action / object / verb
  independently, and **`data`** is the object's fat, typed payload (`PayloadFor<O>`).

So: **topic = the entity stream · `Events.Envelope` = the body · `verb`/`action` = the type within.** A
subscriber routes by `verb` (or `action`), gating visibility with `Events.canConsume(role, action)`. The
**audit mirror** keeps only the PII-light metadata (never the fat `data`) — which is what lets the *same* event
fan out to realtime, workflow, audit, and analytics.

| Topic kind | Name | Carries | Producers → consumers |
|---|---|---|---|
| **`Events.Object`** | `<service>.<noun>` (e.g. `media.asset`) | that entity's `created/updated/deleted/purged` + typed `data` | owner → the services that need that entity (caches · search · realtime · workflow) |
| **`Events.Stream.BEHAVIOR`** | `platform.behavior` | in-app product/behavior events | app BFF → analytics |
| **`Events.Stream.ENGAGEMENT`** | `platform.engagement` | channel engagement (sent/delivered/clicked/converted) | channels → analytics |

> **Rule:** a manifest binds to `Events.Object` / `Events.Stream` and never a literal; producers/consumers
> handle events by `object`+`verb` and never a retyped string. Because the topic *is* the `Events.Object` enum
> value, topic and action vocabulary share **one** source of truth — the manifest, publisher, subscriber,
> realtime push-filter, and web client can't mismatch. (Web never touches Kafka — it receives filtered events
> over the realtime WebSocket and dispatches by the same `object`/`verb`.)

# Don't over-abstract — give it an escape hatch
The manifest DSL will cover the common 90% (tables/queues/buckets/secrets/keys). It will never cover 100% of CDK, and you shouldn't try — that way lies reinventing CDK. So let a service also export raw CDK construct functions for bespoke needs (`src/CloudManifest.cdk.ts`) that `/cloud` composes alongside the manifest. Manifest for the routine, raw CDK for the exotic.


# Platform architecture

## Topology & request flow

The end-to-end shape — **edge → API → compute (in VPC) → data**, plus the **async / event** plane. One AWS
account per `env × market` (region pinned); everything below is **inside that account's VPC** unless noted.

```
                                   ┌─────────── INTERNET ───────────┐
                                   │                                 │
                              Route 53  (DNS · ACM certs · whitelabel custom domains)
                                   │                                 │
              ┌────────────── static web ──────────────┐     ┌──── API / WebSocket ────┐
              ▼                                         ▼     ▼                          │
        CloudFront ──► S3 (React SPA, via Amplify)   AWS WAF + AWS Shield  (rate / bot / DDoS, at the edge)
        (+ WAF/Shield, the email open-pixel edge)            │
                                                     API Gateway   REST `/<service>/*`  ·  WebSocket (push)
                                                             │
                         ┌───────────────────────────────────┴───────────────────────────┐
                         │ Lambda-backed routes                          container routes  │  (VPC Link)
                         ▼                                                                 ▼
                      Lambda                                                          ALB (internal)
              (event / edge / sandbox                                                      │
               workers · light API)                                                       ▼
                         │                                                        ECS Fargate services
                         │                                                        (Fastify · collab · media)
                         └───────────────────────────┬─────────────────────────────────┘
            ══════════════════════════════ VPC · private subnets ══════════════════════════════
                                                     │  (VPC endpoints → AWS APIs, no public egress)
        ┌───────────────┬───────────────┬────────────┴───────┬──────────────────┬────────────────┐
        ▼               ▼               ▼                    ▼                  ▼                ▼
    DynamoDB        RDS / Aurora    OpenSearch          ElastiCache (Redis)     S3            (Bedrock,
    (per-svc KV)   (relational)     (search index)      cache · locks ·        objects ·     MediaConvert
                                                        rate · WorkQueue       lake · snaps   via endpoints)

   ASYNC / EVENT PLANE (in-VPC):
     • SQS (+ DLQ)            per-service work + the two-level send queues (L1 fair-share → L2 per-provider)
     • MSK (Kafka)           the entity-event backbone — svc↔svc, analytics, realtime fan-out
     • EventBridge Scheduler cron · scheduled sends · drips · reports

   CROSS-CUTTING (all services):
     Cognito (identity · WS $connect auth) · Secrets Manager + KMS (per-env CMK) · AppConfig (runtime config)
     CloudWatch (logs/metrics/alarms/RUM) · X-Ray (tracing · transactionId) · CloudTrail (audit)
```

**Layer by layer:**

* **DNS — Route 53 (+ ACM).** Resolves the app + API + **whitelabel custom domains**; ACM issues/renews the
  TLS certs. Per-market account = its own hosted zones in-region.
* **Edge — CloudFront + AWS WAF + AWS Shield.** The **static React SPA** is served from **S3 via Amplify**
  through CloudFront; the **API / WebSocket** ingress is fronted by **WAF** (rate-based + bot rules) and
  **Shield** (DDoS). The **email open-pixel** firehose is its own CloudFront/Lambda@Edge behind WAF. **Public
  ingress is *only* here** — nothing else faces the internet.
* **API — API Gateway.** **REST**, **prefix-routed `/<service>/*`** to the owning service; **WebSocket** for
  realtime server→client push (`$connect` auth via Cognito/ticket). Routes resolve to either **Lambda**
  (Lambda-backed) or, via a **VPC Link → internal ALB**, to **ECS Fargate** (container-backed).
* **Compute — ECS Fargate (behind an internal ALB) + Lambda.** **Fargate** runs the long-running **Fastify**
  services and the **stateful** ones (collab Hocuspocus rooms, media ffmpeg); the **ALB** load-balances across
  tasks (health checks, per-service target groups), reached from API Gateway via **VPC Link**. **Lambda** runs
  event/edge/sandbox workers + lighter API handlers. **Autoscaling** per service.
* **Network — VPC, private subnets, VPC endpoints.** Compute + data live in **private subnets**; only the ALB
  (internal) + the edge touch ingress. **VPC endpoints** keep S2S calls to AWS APIs **off the public internet**
  (no NAT egress for service traffic). The **`Internal` access tier** every service endpoint cites = **VPC-only**.
  Admin access is **SSM Session Manager**, not public SSH/bastion.
* **Data — DynamoDB · RDS/Aurora · OpenSearch · ElastiCache (Redis) · S3.** A service picks its store
  (DynamoDB default; RDS where relational); **OpenSearch** is the search plane; **Redis** is the
  cache / locks / rate-limiter / **`WorkQueue`** primitive; **S3** holds objects, the analytics lake, and DR
  snapshots. **All KMS-encrypted (per-env CMK).**
* **Async / events — SQS · MSK (Kafka) · EventBridge Scheduler.** SQS (+ DLQ) carries per-service work + the
  texting two-level send queues; **MSK** is the one **event backbone**; **EventBridge Scheduler** fires
  cron / scheduled sends / drips / reports.
* **Cross-cutting — Cognito · Secrets Manager + KMS · AppConfig · Bedrock · MediaConvert · CloudWatch / X-Ray /
  CloudTrail.** Identity, secrets/keys, runtime config, AI, transcode, and the observability/audit stack —
  available to every service via the `@repo/services` facades.

## The shared platform stack

Foundational resources every service references (one stack, deployed once per account; service stacks reach them
via the manifest `uses` refs → IAM + env injection derived):

* **VPC** — private subnets, **VPC endpoints** (S2S stays off the public internet), security groups.
* **MSK (Kafka)** — the **streaming backbone** (entity events, analytics, realtime fan-out).
* **OpenSearch** — the search index plane ([search](../apps/core/search/SPECS.md)).
* **ElastiCache (Redis)** — the **`WorkQueue`** fair-share + token-bucket primitive ([dispatch](../packages/services/DISPATCH.md)), presence / locks / caches.
* **AppConfig** — runtime config. **EventBridge Scheduler** — scheduled sends / drips / reports.
* **The `contact-forget` fan-out** (SQS/SNS) — the GDPR-erasure topic services subscribe to.

## Account & region model (env × market)

Two axes:
* **Environment** — `dev` / `staging` / `production`, **one AWS account each** (the `.aws` profiles below).
* **Market** — a residency region (US, EU, …). A **market is a single region, multi-AZ**; a new market is a
  **new account** (no cross-region). The matrix is **(env × market)** but **not fully populated**: **US has
  dev / staging / production**; **EU is production-only** — the **same CDK stack**, tested in **US dev/staging**,
  deployed to **EU prod** (saves the cost of EU non-prod). An **EU dev account** is stood up **only if
  EU-specific services** (functionality not present in the US) need a dev environment *(gap #2)*.

## Network & isolation — the VPC

One **VPC per account**, spread across **≥ 2 AZs** (the multi-AZ DR base), with **three subnet tiers**:

```
 VPC (per account · region pinned)            AZ-a            AZ-b            (AZ-c)
   ├─ PUBLIC subnets         NAT gateway ──────┤───────────────┤        (egress only; no app here)
   ├─ PRIVATE-APP subnets    internal ALB + ECS Fargate + Lambda-ENIs   (compute)
   └─ PRIVATE-DATA subnets   RDS/Aurora · ElastiCache · OpenSearch      (isolated; no internet route)
```

* **Subnet tiers**
  * **Public** — **only** the **NAT gateway** (egress for private subnets when unavoidable) + the edge's
    managed pieces. **No application** runs here.
  * **Private-app** — the **internal ALB**, **ECS Fargate** tasks, **Lambda ENIs**. No inbound from the
    internet; reached only via API Gateway → **VPC Link** → ALB.
  * **Private-data (isolated)** — **RDS/Aurora · ElastiCache (Redis) · OpenSearch**; **no internet route at all**.
    *(DynamoDB / S3 are not in-VPC — reached via gateway endpoints.)*
* **VPC endpoints, not NAT, for AWS APIs** — **Gateway endpoints** for **S3 + DynamoDB** (free), **Interface
  endpoints (PrivateLink)** for **SQS · SNS · KMS · Secrets Manager · ECR · CloudWatch · AppConfig · Bedrock**.
  Keeps S2S **off the public internet** and **minimizes NAT** (NAT only for genuine outbound, e.g. a provider's
  HTTPS API).
* **Security groups per tier (least-privilege chain)** — `ALB-SG` accepts from API Gateway VPC Link only;
  `app-SG` accepts from `ALB-SG` only; `data-SG` accepts from `app-SG` only on the engine port. No tier is
  broadly open.
* **The `Internal` access tier** every service endpoint cites = **VPC-only S2S** (not internet-reachable).
* **Public ingress is *only* the WAF/Shield edge** (web, email open-pixel, survey forms, provider webhooks) —
  nothing else faces the internet. **Admin = SSM Session Manager** (no public SSH / bastion).

### Subnet & AZ recommendations (dev vs prod)

| | **dev** | **production** |
|---|---|---|
| **AZs** | **2** | **3** |
| **VPC CIDR** | `/16` (e.g. `10.10.0.0/16`) | `/16` (e.g. `10.30.0.0/16`) |
| **public** subnet / AZ (NAT) | `/26` | `/24` |
| **private-app** / AZ (ALB·Fargate·Lambda) | `/22` (~1k IPs) | **`/20` (~4k IPs)** |
| **private-data** / AZ (RDS·Redis·OpenSearch) | `/24` | `/24` |
| **NAT gateways** | **1** (shared — accept egress SPOF) | **1 per AZ** (egress survives AZ loss) |
| **subnets total** | 6 (2 AZ × 3 tiers) | 9 (3 AZ × 3 tiers) |

* **Prod = 3 AZs, dev = 2.** Prod 3 for real HA (lose one AZ → keep 2/3 capacity; RDS/Redis/OpenSearch span all
  three). **Dev 2 (not 1)** so it **faithfully rehearses multi-AZ + the DR drill it hosts** (`cloud-10.4`) — a
  1-AZ dev hides AZ-assumption bugs. (`staging` = 2 AZs, single NAT, like dev.)
* **Non-overlapping `/16` per account** (`dev 10.10` · `staging 10.20` · `prod 10.30` · `prod-eu 10.40`) — so
  **future VPC peering / Transit Gateway needs no renumbering.** Keep `/16` even in dev (cheap, room to grow).
* **Size the app tier generously (`/20` prod).** **Fargate tasks + Lambda ENIs + interface-endpoint ENIs all
  consume private IPs** — an undersized app subnet causes **"cannot assign IP" failures under autoscale** (a real
  outage when you most need to scale). Gateway endpoints (S3/DDB) are free + use **no** IPs; **interface
  endpoints = 1 ENI/AZ each** — count them in the budget.
* **NAT: per-AZ in prod** (an AZ loss doesn't kill egress for the others), **single in dev** (NAT GWs are
  ~$32/mo each — accept the dev SPOF). Heavy **VPC-endpoint** use keeps NAT traffic to genuine outbound only.

## Edge & DNS

* **CloudFront** (web via **Amplify**, the email open-pixel edge) + **WAF + Shield** (rate-limit / bot / DDoS).
* **Route 53 + ACM** — **whitelabel custom domains** (web + email sending identities + links short-domains) and
  **DKIM / SPF / DMARC** verification for sending identities.

## Compute

* **ECS Fargate** — stateful / long-running (the Fastify services, **collab** Hocuspocus rooms, **media** ffmpeg).
* **Lambda** — stateless workers + edge. **API Gateway** — REST + **WebSocket**. **Autoscaling** per service;
  **per-queue concurrency** (e.g. texting L2 worker pools).

## Observability

* **CloudWatch** (logs / metrics / alarms / **RUM**) + **X-Ray** (tracing) + **CloudTrail** (infra audit).
* A **`transactionId`** correlates web RUM → BFF → backend; telemetry feeds the
  **[monitor](../apps/core/monitor/SPECS.md)** service.

## Threat detection *(later)*

* **AWS GuardDuty — a LATER requirement** (not in the initial build). Enable it **per account** (commercial
  *and* any GovCloud/Federal account) for managed threat detection across **CloudTrail, VPC Flow Logs, and DNS
  logs** — surfacing credential misuse, recon/port-scans, crypto-mining, and anomalous API calls that the
  edge **WAF/Shield** (which only guard public ingress) can't see east-west. Findings route to
  **[monitor](../apps/core/monitor/SPECS.md)**'s security path / Security Hub. Today threat detection is
  edge-WAF + app-level breach alarms only; GuardDuty closes the **infra / east-west** gap. *(See
  [SECURITY_COMPLIANCE.md](../docs/SECURITY_COMPLIANCE.md) gap #2.)*

## Resilience & DR

DR combines **multi-AZ** (AZ failure) with **cross-region backup *within the jurisdiction*** (full-region loss)
— but **no live cross-region serving** (no hot replica; residency keeps traffic single-region):
* **Multi-AZ** for every stateful tier — survives an AZ outage with no data loss.
* **Cross-region backup to the jurisdiction's paired region** (same jurisdiction only): **AWS Backup
  cross-region copy**, **DynamoDB PITR + cross-region backup**, **S3 cross-region replication (CRR)**, RDS
  cross-region snapshots — survives a **full-region loss**; restore in the paired region.
* **KMS multi-region keys** so the paired region can **decrypt** the backups (ties gap #3).
* **DLQ + redrive** on every queue (the backpressure / poison-message story the channel specs rely on).
* **RPO ≈ replication cadence** to the paired region; **RTO = restore-in-paired-region** — it's **restore, not
  instant failover** (residency + cost rule out a hot cross-region replica). **Explicit per-tier/per-scenario
  RTO/RPO targets, the roll-over runbook, and the drill cadence live in the platform DRP → [DR.md](../docs/DR.md)**
  (production: **RPO ≤ 1 h, RTO ≤ 4 h** cold-passive). *(resolves gap #1's "targets TBD".)*

### Backup cadence — continuous where it counts, off the hot path

The thing that stresses ops is a **full-scan dump job** — we don't do those. Everything is **change-stream or
per-object async**, invisible to live traffic, so cadence is **not a stress dial**:

**Two RPOs — in-region (continuous) vs cross-region DR (the copy cadence):**
* **S3** — **in-region** versioning (continuous); **cross-region CRR continuous, RPO ≈ minutes** (<15 min with
  S3 RTC). Per-object async — no hot-path impact.
* **DynamoDB** — **in-region PITR continuous, RPO ≈ seconds** (restore to any second / 35 d); but **cross-region
  has no native PITR** → **AWS Backup hourly copy → cross-region DR RPO ≈ 1 h** (AWS Backup's **1-hour floor**).
  *(Global Tables would give continuous cross-region, but it's a **live** replica — **not used in cold-passive**;
  **warm-passive adopts it**, same-jurisdiction, for **RPO ~seconds** — see Active-passive.)*
* **RDS/Aurora** (if used) — in-region tx-log continuous (~5-min RPO); cross-region backup ~minutes / hourly snapshot copy.
* **OpenSearch / other scheduled copies** — hourly snapshot → S3 → CRR (and OpenSearch is rebuildable anyway).

**Net: cross-region DR RPO ≈ 1 hour** — **DynamoDB-bound** (hourly copy); S3 is better (~minutes). **Hourly is
the *right* cross-region cadence for cold-passive** (AWS Backup's floor; sub-hourly would mean a live replica =
warm). In-region restore is seconds–minutes; a future **warm-passive** tightens the cross-region RPO to
**~seconds** via **DynamoDB Global Tables** (continuous, same-jurisdiction).

**Rebuildable tiers — NOT backed up (DR by reconstruction):**
* **Redis / ElastiCache** — ephemeral (counters / locks / caches; truth is in DynamoDB) → **cold start**.
* **OpenSearch** — a **projection** ([search](../apps/core/search/SPECS.md)) → **reindex from source**, not restore.
* **Kafka / MSK** — transient, **idempotently re-consumed**; in-flight loss bounded by consumer lag.
* **AppConfig / config** — **config is code (IaC)** → **redeploy** from CDK/git in the paired region (deterministic),
  not restored as data.

> **Principle: back up the systems of record; reconstruct everything derived.** Keeps the backup surface small
> + the cross-region cost low.

### Active-passive roll-over

DR is **active-passive within the jurisdiction** — the primary region is **active** (all live traffic); the
same-jurisdiction paired region is **passive** (replicated backups + reproducible IaC, **no live serving**).
**No active-active** (that's cross-region live → residency + cost).

```
 ACTIVE (e.g. us-east-1)                      PASSIVE (e.g. us-west-2 — same jurisdiction)
   live traffic ─► services                    warm: minimal stack  ·  cold: infra-on-demand
   DynamoDB ─PITR + backup copy───────────────► restorable
   S3 ────────CRR (continuous)────────────────► replicated bucket
   config = IaC ─cdk deploy────────────────────► reproducible (not "restored")
                    Route 53  ──detect + APPROVED cutover──►  promote passive
```

* **Cold-passive for `dev` + `production` only (not `staging`) — warm later.**
  * **Cold (start here)** — the paired region holds **backups + reproducible IaC only**; on disaster (or a
    drill) **deploy the stack + restore data**. **`dev`** carries a passive so the **DR runbook is developed +
    rehearsed cheaply**; **`production`** carries it for real; **`staging` is skipped** (transient pre-prod,
    rebuildable, not business-critical). **Measure the real RTO** via the quarterly drill rather than guessing.
  * **Warm (future)** — passive stack **pre-deployed at minimal scale** + **continuous cross-region
    replication**: **DynamoDB Global Tables** (**same-jurisdiction**, active-active — *write only to the active
    side*) → **RPO ~seconds** (vs cold's ~1 h hourly copy); S3 is already continuous (CRR). Failover = **scale
    up + cutover in minutes**. **Upgrade prod to warm later** *if the measured cold RTO — or a sub-1h RPO need —
    demands it.* Cost: Global Tables **~doubles DDB write + storage** (the warm premium); same-jurisdiction only
    (never cross-jurisdiction).
* **Roll-over runbook:** (1) promote / scale the passive stack; (2) **S3 already replicated** (CRR), **restore
  DynamoDB** (PITR / backup copy), **reindex OpenSearch**, **redeploy config**; (3) **Route 53 cutover** to
  passive; (4) ephemeral tiers **cold-start** (Redis counters, Kafka consumers resume).
* **Manual / approved cutover — NOT auto.** A full-region failure is rare, and a **false-positive auto-failover
  is worse than the outage** (split-brain / flapping). Route 53 health checks **detect + alert**; the **promote
  is gated behind an approved runbook.**
* **Roll-back** — when the primary recovers, **reverse-replicate** and fail back in a **maintenance window**.
* **Quarterly DR drill (the runbook).** Each quarter, **execute the roll-over runbook** against the cold-passive
  region — both to **prove it works** and to **measure actual RTO** (the empirical target, not a guess). An
  **untested DR plan is not a DR plan.**

## Cost allocation & tagging

Cost is sliced by **tags CDK applies automatically** (app + stack level → every resource inherits; mandatory, no
drift) plus the **account** dimension (the `env × market` accounts give per-account cost free via Organizations
consolidated billing). **Mandatory tag set:**

| Tag | Values | Slices cost by |
|---|---|---|
| **`service`** | `contact` · `texting` · … · `platform` (shared stack) | **per-service** (from the manifest — the key one) |
| **`env`** | `dev` · `staging` · `production` | environment |
| **`market`** | `us` · `eu` · … | jurisdiction / region |
| **`managedBy`** | `cdk` | governance — spot manual / untagged resources |
| `component?` | `table` · `queue` · `bucket` · `fn` · … | finer within a service |
| `costCenter?` | … | chargeback (if used) |

* **Activate** the user-defined tags as **Cost Allocation Tags** in the **Organizations payer account** (they
  only surface in Cost Explorer / CUR once activated). Use **Cost Categories** for business rollups
  ("all prod", "EU", "texting across envs").
* **Enforce** with a **CDK Aspect** (synth **fails** on a missing mandatory tag) + an **Organizations Tag Policy** —
  tags applied at the CDK root can't drift.
* **Per-tenant cost is NOT tag-derived.** Resources are **shared across tenants** (multi-tenant tables; buckets
  by purpose, never per-tenant — aws-topology), so there's no per-tenant resource to tag. **Per-tenant cost
  comes from application usage metering** (the `metered` signals — texting segments, marketplace usage, …)
  attributed in **billing / analytics**, not resource tags. *(Tags answer "what does **texting** cost?";
  metering answers "what does **account X** cost?".)*

# Compliance & standards mapping

How **platform-infrastructure** controls map to **OWASP Top 10 (2021)**, **ISO/IEC 27001:2022** (Annex A),
**SOC 2** (TSC), **GDPR**, and **CCPA/CPRA**. Infra holds **no PII directly** — it's the **substrate** that makes
every service's compliance possible (encryption, residency, isolation, audit). **HIPAA ➖** (no PHI by
[AUP](../apps/core/account/specs/SPECS.md)); **PCI** minimized — payment data never enters our infra
(Stripe Elements → **SAQ-A**, web-6.5).

**Legend:** ✅ meets/exceeds · ⚠️ partial / open — see Gaps · ➖ n/a

| Infra control | OWASP T10 | ISO 27001:2022 | SOC 2 (TSC) | GDPR | CCPA | |
|---|---|---|---|---|---|---|
| **Data residency (jurisdiction)** — region pinned per market; **only** cross-region flow = encrypted DR backup to the **same-jurisdiction paired region**; never cross-jurisdiction | A04 | A.5.31 / A.8.3 | CC6.1 | Art 44–49 | §1798.140 | ✅ CDK-enforced |
| **Encryption at rest + transit** — KMS on all stateful (DDB/S3/OpenSearch/SQS/Redis); TLS/WSS; manifest defaults encrypted | A02 | A.8.24 | CC6.1 | Art 32 | ➖ | ✅ |
| **Tenant isolation** — tenant-keyed data; buckets by purpose (never per-tenant); per-tenant creds/branding | A01 | A.8.3 | CC6.1 | Art 32 | §1798.100 | ✅ |
| **Least-privilege IAM** — derived from the manifest `uses`; no hand-written policies | A01 | A.8.2 / A.5.15 | CC6.1 / CC6.3 | Art 32 | ➖ | ✅ by construction |
| **Network isolation** — VPC + private subnets + VPC endpoints; `Internal` = VPC-only S2S | A01 / A05 | A.8.20–22 | CC6.1 | Art 32 | ➖ | ✅ |
| **Secrets management** — Secrets Manager + KMS; per-tenant creds; no secrets in code/bundle; **rotation twice a year** (platform auto-rotate · BYO keys = reminder emails) | A02 / A05 | A.8.24 / A.5.17 | CC6.1 | Art 32 | ➖ | ✅ |
| **Audit** — **CloudTrail** (infra) + per-service audit logs | A09 | A.8.15 | CC7.2 | Art 30 | ➖ | ✅ |
| **Edge protection** — WAF + Shield on all public ingress | A05 | A.8.23 | CC7.1 | Art 32 | ➖ | ✅ |
| **Backup / DR** — multi-AZ + cross-region backup to the paired region (**S3 CRR continuous ~min · DynamoDB hourly via AWS Backup → cross-region RPO ≈ 1 h**) + DLQ redrive | ➖ | A.8.13 / A.5.30 | A1.2 / CC7.x | Art 32 | ➖ | ✅ RPO ≈ 1 h · RTO drill-measured |
| **GDPR-erasure infra** — `contact-forget` fan-out + retention **TTLs** (manifest `ttlAttr`) | A04 | A.8.10 | (Privacy) | Art 17 | §1798.105 | ✅ |
| **No PHI / PCI minimized** — no PHI by AUP; payment data never in-infra (Stripe SAQ-A) | ➖ | A.5.34 | (Privacy) | Art 9 | ➖ | ✅ |

> **Design-intent mapping** — how the platform is *intended* to satisfy each control, not an attestation.

# Requirements (traceable register)

Cross-cutting infrastructure requirements (IDs **`cloud-N.M`**). **Priority:** **A** = MVP, **B** = core /
hardening, **C** = later. **Boundary:** `cloud` owns IaC + the shared stack + governance; *how a service uses
AWS* (facades, residency model, WorkQueue, S3 layout) is the [AWS topology](../packages/services/src/aws/SPECS.md).

## cloud-1.0 IaC & manifests — A
- **cloud-1.1** Each service exports a typed **`ResourceManifest`** (`owns` + `uses`/access-intent) — **no CDK in service runtime code** — A
- **cloud-1.2** CDK synth = **stack-per-service** (isolated blast radius) + a **shared platform stack** — A
- **cloud-1.3** **Least-privilege IAM derived** from `uses` refs (no hand-written policies) — A
- **cloud-1.4** **Runtime ID handoff** — env injection + SSM convention; services resolve **logical keys** (`Cloud.queueUrl('import')`) — A
- **cloud-1.5** **Escape hatch** — raw CDK (`src/CloudManifest.cdk.ts`) for the exotic 10% — B

## cloud-2.0 Account & region model — A
- **cloud-2.1** **One account per (env × market)**; region **pinned per account** — A
- **cloud-2.2** Market = **single region (live), multi-AZ**; new market = **new account**; **DR backup replicates to the jurisdiction's paired region**; **no cross-*jurisdiction*** (live or backup) *(gap #2)* — A
- **cloud-2.3** CDK **rejects cross-region constructs** — A
- **cloud-2.4** **EU = production-only** (default) — the shared stack is tested in **US dev/staging** + deployed to **EU prod**; an **EU dev account** only if **EU-specific services** (absent in the US) require one *(gap #2)* — B

## cloud-3.0 Network & isolation — A
- **cloud-3.1** **VPC across ≥ 2 AZs, 3 subnet tiers** — public (**NAT only**) · private-app (**ALB / Fargate / Lambda**) · private-data (**RDS / Redis / OpenSearch**, isolated); **gateway endpoints** (S3 / DynamoDB) + **interface endpoints** (SQS / KMS / Secrets / …) to keep S2S off the public internet + **minimize NAT**; **per-tier security groups** (ALB→app→data, least-privilege) — A
- **cloud-3.2** **`Internal` tier = VPC-only**; public ingress **only** via the WAF/Shield edge — A
- **cloud-3.3** **Admin access via SSM Session Manager** — no public SSH / bastion; no inbound admin ports — B
- **cloud-3.4** **AZ + CIDR sizing** — **prod = 3 AZs, dev/staging = 2**; **non-overlapping `/16` per account** (future peering, no renumber); **app subnets sized generously** (`/20` prod — Fargate + Lambda + interface-endpoint ENIs burn IPs → avoid "no-IP" autoscale failures); **NAT per-AZ in prod**, single in dev — B

## cloud-4.0 Shared platform stack — A
- **cloud-4.1** VPC · **MSK (Kafka backbone)** · **OpenSearch** · **Redis** (WorkQueue / locks / cache) · **AppConfig** · **EventBridge Scheduler** · **`contact-forget`** fan-out — A

## cloud-5.0 Data stores & encryption — A
- **cloud-5.1** **KMS at rest** on all stateful (DDB / S3 / OpenSearch / SQS / Redis); manifest **defaults encrypted** — A
- **cloud-5.2** **DynamoDB PITR**; **S3 versioning**; per-item **TTLs** (`ttlAttr`) for retention — A
- **cloud-5.3** **Buckets by purpose, never per-tenant** (aws-topology) — A
- **cloud-5.4** **KMS CMK = per-environment** — one CMK **per env** (per env-account → naturally per-region / jurisdiction); a **multi-region key** so the paired region can **decrypt cross-region DR backups** (`cloud-10.2`); **BYOK / collab envelope encryption uses the per-env CMK** (per-room DEKs still isolate rooms; master key is **per-env, not per-account**) *(gap #3)* — A

## cloud-6.0 Compute — A
- **cloud-6.1** **ECS Fargate** (stateful / long-running) behind an **internal ALB** (API Gateway → **VPC Link** → ALB → Fargate; per-service target groups + health checks) + **Lambda** (workers / edge / light API) + **API Gateway** (REST `/<service>/*` + WebSocket) — A
- **cloud-6.2** **Autoscaling** per service; **per-queue concurrency** — B

## cloud-7.0 Edge & DNS — A
- **cloud-7.1** **CloudFront + WAF + Shield** on public surfaces; **Amplify** for web — A
- **cloud-7.2** **Route 53 + ACM**; whitelabel custom domains + **DKIM/SPF/DMARC** — B

## cloud-8.0 Secrets & IAM — A
- **cloud-8.1** **Secrets Manager + KMS**; per-tenant credentials; **no secrets in code / bundles** — A
- **cloud-8.2** **Platform secret rotation — twice a year (semi-annual)** — **platform-owned** secrets auto-rotate via **Secrets Manager rotation**; off-cycle rotation on suspected compromise *(gap #4 — DECIDED)* — B
- **cloud-8.3** **Account (BYO) key rotation — semi-annual reminder emails** — **account-owned** keys (BYO provider creds / OAuth — texting / marketplace) are the **customer's to rotate**, so we **can't** auto-rotate them; instead the platform **emails the account ~twice a year prompting rotation** (the reminder is owned by **[account](../apps/core/account/specs/SPECS.md) / [marketplace](../apps/core/marketplace/SPECS.md)**, sent via email) *(gap #4)* — B

## cloud-9.0 Observability — A
- **cloud-9.1** **CloudWatch** (logs / metrics / alarms / RUM) + **X-Ray** + **CloudTrail** — A
- **cloud-9.2** **`transactionId`** correlation web → BFF → backend → **[monitor](../apps/core/monitor/SPECS.md)** — B
- **cloud-9.3** **AWS GuardDuty — threat detection (LATER)** — enable **per account** (incl. any GovCloud/Federal) over CloudTrail / VPC Flow Logs / DNS logs; findings → **[monitor](../apps/core/monitor/SPECS.md)** security path / Security Hub. Closes the **infra / east-west** detection gap the edge WAF/Shield can't cover *(see [SECURITY_COMPLIANCE.md](../docs/SECURITY_COMPLIANCE.md) gap #2)* — **C**

## cloud-10.0 DR, backup & resilience — A
- **cloud-10.1** **Multi-AZ** every stateful tier — A
- **cloud-10.2** **PITR / versioning / snapshots** + **cross-region backup copy** (AWS Backup / DDB / **S3 CRR**) to the paired region + **KMS multi-region keys** (decrypt in DR region) + **DLQ + redrive** — A
- **cloud-10.3** **DR = multi-AZ + cross-region backup to the jurisdiction's paired region** (survives full-region loss; **same-jurisdiction only**) — **restore, not live failover**; **RPO = 1 h** (cross-region); **RTO** = drill-measured *(gap #1)* — A
- **cloud-10.4** **Active-passive roll-over — cold, dev + prod only** — passive = the same-jurisdiction paired region (backups + reproducible IaC, **no live serving**); **cold-passive for `dev` + `production`** (deploy + restore on failover), **`staging` skipped** (transient / rebuildable); **upgrade prod to warm later** if the measured RTO misses the SLA; **manual / approved cutover** (Route 53 **detect**, promote **gated**, no auto-failover) *(gap #1)* — A
- **cloud-10.6** **Quarterly DR drill** — execute the roll-over runbook against the cold-passive region **each quarter** to **validate it + measure actual RTO** (the empirical target) *(gap #1)* — A
- **cloud-10.5** **Backup cadence** — **in-region continuous** (S3 versioning, **DynamoDB PITR ~seconds**, RDS tx-log); **cross-region: S3 CRR continuous (~min)** + **DynamoDB hourly AWS Backup copy** → **cross-region DR RPO = 1 h** (DDB-bound; **no Global Tables** — that's a live replica); **rebuildable tiers** (Redis / OpenSearch / Kafka / config) **reconstructed, not backed up** — A

## cloud-11.0 Compliance & data governance — A
- **cloud-11.1** **Residency enforced in CDK** (region pin + cross-region reject) — A
- **cloud-11.2** **GDPR-erasure infra** — `contact-forget` fan-out + retention TTLs — A
- **cloud-11.3** **Audit** — CloudTrail + per-service audit — A
- **cloud-11.4** **No PHI** (AUP); **PCI minimized** (Stripe SAQ-A — no payment data in-infra) — A

## cloud-12.0 CI/CD & environments — B
- **cloud-12.1** **Env-per-branch**; CDK deploy per env (**prod approval-gated**); web via Amplify — B
- **cloud-12.2** **LocalStack** for local dev (Pro; Kafka via Redpanda side-container) — A
- **cloud-12.3** **Manual deployment initially** — the manual CDK deploy commands (prod approval-gated) + Amplify for web; a **formal CI/CD pipeline is deferred** until cadence/team warrant it *(gap #6 — DECIDED)* — C

## cloud-13.0 Cost & tagging — B
- **cloud-13.1** **Cost-allocation tagging standard** — mandatory CDK-applied **`service` · `env` · `market` · `managedBy`** (+ optional `component` / `costCenter`); activated as Cost Allocation Tags in the payer account; **Cost Categories** for rollups; the **1–10 sizing** knob per env *(gap #5)* — B
- **cloud-13.2** **Enforced + tenant-cost split** — a **CDK Aspect fails synth** on a missing mandatory tag (+ Organizations Tag Policy); **per-tenant cost is NOT tag-derived** (shared resources) → from **usage metering** (billing/analytics), not tags *(gap #5)* — B

# Gaps & decisions

*The one review list.* ✅ = resolved/decided · ⚠️ = **open — needs attention**.

1. ✅ **DR posture — DECIDED: cold-passive (dev + prod), RPO = 1 h, quarterly-measured RTO.** **Active-passive**
   cross-region within the jurisdiction; **cold-passive for `dev` + `production`** (`staging` skipped) — backups +
   IaC, **deploy + restore** on failover. **RPO = 1 hour** (cross-region, **DynamoDB-bound** — hourly AWS Backup
   copy; S3 ~minutes via CRR; in-region restore is seconds–minutes). **RTO is measured by a quarterly DR drill**
   (the runbook establishes the *real* number; dev is where it's rehearsed). **Upgrade prod to warm-passive
   later** *if* the measured RTO (or a tighter RPO need) demands it. Manual / approved cutover.
2. ✅ **Market-account matrix — DECIDED: US full, EU prod-only.** US has **dev / staging / production**; **EU is
   production-only** — the **same CDK stack**, tested in US dev/staging, deployed to EU prod (saves EU non-prod
   cost). **Exception:** stand up an **EU dev account** only if **EU-specific services** (functionality not
   available in the US) need a dev environment.
3. ✅ **KMS — DECIDED: per-environment CMK.** One CMK **per env** (per env-account → per-region / jurisdiction),
   a **multi-region key** so the paired DR region can **decrypt** cross-region backups. **BYOK / collab envelope
   encryption also uses the per-env CMK** (per-room DEKs isolate rooms; master key per-env, **not** per-account)
   — simpler than per-account key sprawl. *(Tradeoff: this is **not customer-held** BYOK — the customer can't
   independently revoke; revisit a **per-account** customer-managed key only if a contract requires it.)*
4. ✅ **Secret rotation — DECIDED: twice a year (semi-annual).** **Platform-owned** secrets **auto-rotate** via
   Secrets Manager (off-cycle on suspected compromise). **Account-owned BYO keys** (provider creds / OAuth) are
   the customer's — we **can't** rotate them, so we **email accounts ~semi-annually prompting rotation**
   (`cloud-8.3`; owned by account / marketplace).
5. ✅ **Cost-allocation tagging — DECIDED.** Mandatory CDK-applied **`service` · `env` · `market` · `managedBy`**
   (+ optional `component` / `costCenter`), **enforced by a CDK Aspect** (fail-synth on missing) + Organizations
   Tag Policy, activated as Cost Allocation Tags + Cost Categories for rollups. **Per-tenant cost ≠ tags**
   (shared resources) → **usage metering** (billing/analytics). *(Open follow-on: budgets / anomaly alerts.)*
6. ✅ **Deployment — DECIDED: manual initially.** Keep the **manual CDK deploy commands** (per-env, prod
   approval-gated) + **Amplify** for web; a **formal CI/CD pipeline is deferred** until the cadence/team warrant
   it (`cloud-12.3`). Manual is fine at current scale and keeps the surface simple.
7. ✅ **IaC pattern — DECIDED.** Manifest → CDK; least-privilege **derived** from `uses`; stack-per-service +
   shared platform stack; logical-key runtime handoff; raw-CDK escape hatch.
8. ✅ **Residency — DECIDED: jurisdiction-based.** Served **single-region** per market; **DR backups replicate
   cross-region *within the same jurisdiction*** (US→US, EU→EU); **cross-*jurisdiction* forbidden** (live or
   backup). CDK pins the region and permits **only** the encrypted DR-backup cross-region flow.

# ──────────────────────────────────────────────────────────────────────────────
# Building & deploying (runbook)
# ──────────────────────────────────────────────────────────────────────────────

The operational guide: build, then deploy to a real AWS environment (dev/staging/prod)
or to **LocalStack** for local development. All commands run from `/cloud` unless noted.

## Environments

The target is chosen with **CDK context**, `-c env=<name>` (default `dev`). It drives
resource naming, the 1–10 sizing, and per-environment config.

| env          | `-c env=`    | name prefix   | target                 |
|--------------|--------------|---------------|------------------------|
| `local`      | `local`      | `local-`      | LocalStack (Docker)    |
| `dev`        | `dev`        | `dev-`        | AWS dev account        |
| `staging`    | `staging`    | `staging-`    | AWS staging account    |
| `production` | `production` | `production-` | AWS production account |

## Prerequisites

- **Node** — `npm install` at the repo root (installs the CDK app's deps too).
- **AWS CLI v2** + configured profiles for real deploys (see *.aws config* below).
- **Docker** — for local development (LocalStack + dependent containers).
- **cdklocal** (`aws-cdk-local`) — installed as a dev dependency; used by the `local:*` scripts.

## Build

```bash
npm install            # repo root — once
cd cloud
npm run build          # tsc typecheck of the CDK app
npm run synth:dev      # synthesize CloudFormation only (no deploy)
```

### Service runtimes — compiled, run on `node`

Node services are **esbuild-bundled** (not run via `tsx`) so production runs plain `node`:

| Target | Entry | Build | Artifact | Runtime |
|--------|-------|-------|----------|---------|
| **ECS / Fargate** | `src/index.ts` (Fastify server) | `npm run build` | `bin/index.js` | `node bin/index.js` (the Dockerfile CMD) |
| **Lambda** | `src/lambda.ts` (exports `handler`) | `npm run build:lambda` | `bin/lambda.js` | Lambda invokes `lambda.handler` |

For a Lambda service, set the `JobSpec.handler` to `"lambda.handler"`; the CDK asset is
`apps/<domain>/<service>/bin` (resolved by `ServiceStack.functionCode()`). Bundles inline the
`@repo/*` workspace packages; `ajv`/`ajv-formats` stay **external** and resolve from
`node_modules` at runtime — used normally for endpoint + webhook JSON validation. They ship
in the ECS image; for a Lambda, include them in the function package (or a layer).

## Deploy to an AWS environment

Deploys target whatever AWS account your **active credentials/profile** resolve to —
select the account with a per-environment profile. Bootstrap once per account+region.

```bash
# one-time per account/region:
AWS_PROFILE=rup-dev      npm run bootstrap:dev

AWS_PROFILE=rup-dev      npm run diff:dev        # preview the change set
AWS_PROFILE=rup-dev      npm run deploy:dev
AWS_PROFILE=rup-staging  npm run deploy:staging
AWS_PROFILE=rup-prod     npm run deploy:prod     # prompts for approval (dev/staging auto-approve)
```

The CDK app reads the account/region from `CDK_DEFAULT_ACCOUNT` / `CDK_DEFAULT_REGION`,
which the CDK CLI populates from the active profile (region defaults to `us-east-1`).

## Local development (LocalStack)

Full guide: [`./local/README.md`](./local/README.md). Quick version:

```bash
export LOCALSTACK_AUTH_TOKEN=...     # LocalStack Pro token
npm run local:up                     # LocalStack + dependent containers
npm run local:bootstrap              # once per fresh container
npm run local:deploy                 # cdklocal deploy -c env=local
# ...
npm run local:destroy                # tear down stacks
npm run local:down                   # stop containers + wipe the volume
```

LocalStack needs **no real AWS credentials** — `cdklocal` uses dummy `test`/`test`.

## Dependent services for local

Some managed services aren't emulated by LocalStack and run as **side containers** (in
[`local/docker-compose.yml`](./local/docker-compose.yml), started by `npm run local:up`).
The CDK skips the managed versions under `env=local` and logs each skip at synth time.

| Managed (cloud)              | Local stand-in              | Why                          |
|------------------------------|-----------------------------|------------------------------|
| **MSK (Kafka)**              | Redpanda container `:9092`  | LocalStack MSK is unreliable |
| MediaConvert / RUM / Amplify | — (skipped)                 | no LocalStack support        |

Everything else (S3, SQS, SNS, DynamoDB, Lambda, API Gateway, KMS, Secrets, RDS,
ElastiCache, OpenSearch, Cognito, CloudFront, EventBridge, ECS, Batch, …) is emulated
inside **LocalStack Pro**.

## Environment variables

| Variable | Used by | Purpose |
|----------|---------|---------|
| `AWS_PROFILE` | deploy tooling | selects the AWS account/credentials (one profile per env) |
| `CDK_DEFAULT_ACCOUNT` / `CDK_DEFAULT_REGION` | CDK CLI | target account/region (CLI sets from the profile; region falls back to `us-east-1`) |
| `AWS_REGION` | CLI / SDK | region for the AWS CLI and service SDK clients |
| `LOCALSTACK_AUTH_TOKEN` | local | LocalStack **Pro** token (for RDS/OpenSearch/Cognito/… emulation) |
| `AWS_ENDPOINT_URL` | local **runtime** | points a service's AWS SDK clients at LocalStack (`http://localhost:4566`) — read by `sdkConfig()` in `@repo/services` |
| `KAFKA_BROKERS` | local **runtime** | the Kafka side-container (`localhost:9092`), MSK's local stand-in |
| `ENVIRONMENT` | runtime (CDK-injected) | the env a service is running as; consumed by `CloudResolver` |

Deploy-time vars (`AWS_PROFILE`, `CDK_DEFAULT_*`) are for *you/CI* running CDK. Runtime
vars (`AWS_ENDPOINT_URL`, `KAFKA_BROKERS`, `ENVIRONMENT`) are what *services* read — the
CDK injects the resource identifiers; you set the local ones in your shell/compose.

## .aws config

Real deploys use standard AWS CLI profiles — one per environment/account. Prefer **IAM
Identity Center (SSO)**:

```ini
# ~/.aws/config
[profile rup-dev]
sso_session = rumbleup
sso_account_id = 111111111111
sso_role_name = AdministratorAccess
region = us-east-1

[profile rup-staging]
sso_session = rumbleup
sso_account_id = 222222222222
sso_role_name = AdministratorAccess
region = us-east-1

[profile rup-prod]
sso_session = rumbleup
sso_account_id = 333333333333
sso_role_name = AdministratorAccess
region = us-east-1

[sso-session rumbleup]
sso_start_url = https://rumbleup.awsapps.com/start
sso_region = us-east-1
```

**The account IDs are the critical wiring.** Each profile's `sso_account_id` is the
12-digit AWS account number for that environment — it's what binds `rup-dev` to your dev
account, `rup-prod` to prod, and so on. CDK reads it back as `CDK_DEFAULT_ACCOUNT` at
deploy time, so the stack lands in the correct account. Get them wrong and you deploy to
the wrong place.

| Field | Where it goes | What to set it to |
|-------|---------------|-------------------|
| `sso_account_id` | each `[profile …]` in `~/.aws/config` | the **12-digit account id** for that env (a *different* id for dev / staging / prod) |
| `sso_role_name`  | each `[profile …]` | the Identity Center permission set you assume in that account (e.g. `AdministratorAccess`) |
| `region`         | each `[profile …]` | the deploy region for that env |
| `sso_start_url`  | the `[sso-session …]` block | your org's Identity Center portal URL |
| `sso_region`     | the `[sso-session …]` block | the region Identity Center is hosted in |

**Where to find the account IDs:** the **IAM Identity Center** access portal (the start
URL lists every account with its id), **AWS Organizations**, or after login via
`aws sts get-caller-identity --profile rup-dev` (the `Account` field). Replace the
placeholder ids above (`111111111111`, `222222222222`, `333333333333`) with your real
per-environment account ids — and never point two environments at the same account.

```bash
aws sso login --profile rup-dev      # then: AWS_PROFILE=rup-dev npm run deploy:dev
```

Static keys (if not using SSO) go in `~/.aws/credentials` under matching `[rup-dev]` etc.
**LocalStack uses no real profile** — leave it out of the `local:*` flow entirely.

