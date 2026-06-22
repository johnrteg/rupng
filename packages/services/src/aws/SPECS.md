#
# `@repo/services` — AWS facade conventions
#

Conventions for the AWS/service facades in this directory. Detail per store lives in
[`../../DATABASE.md`](../../DATABASE.md); this file holds cross-facade naming standards.

---

# Region & account topology (data residency)

The deployment boundary is the **AWS account**, and **markets are isolated by account + region** — the
basis for **data residency** (GDPR Ch. V).

* **Separate AWS account per market.** Each market is its own AWS account. (Consistent with the platform
  rule **never point two deploy-environments at one AWS account** — see the AppConfig note below.)
* **EU market = its own AWS account, EU-approved region.** The **EU market runs in a dedicated AWS account
  with *all* services deployed in an EU-approved (EU) region/data center**, so EU data subjects'
  identity/PII **stays in-region** and never lands in the US (or any non-EU) account.
* **No cross-region flows.** Data does **not** cross regions. Specifically **disallowed** for anything
  carrying market PII:
  * **DynamoDB Global Tables** / cross-region replicas,
  * **S3 Cross-Region Replication** and cross-region bucket reads,
  * **Kafka / MSK** mirroring or consumers in another region,
  * **cross-region backups / snapshots** (keep backups in-region),
  * **logs, metrics, analytics, or the event lake** shipped to an out-of-region account.

  Each market account is **self-contained** — its services, stores, queues, backups, and observability all
  live **in that account's region**. Cross-region is the explicit exception requiring a documented lawful
  basis, not a default.

> This is the topology behind [auth → data residency](../../../../apps/core/auth/specs/SPECS.md) and the
> platform [SPECS → Security & compliance](../../../../docs/SPECS.md). Region/account selection is a
> **cloud-manifest / CDK** concern (the physical-name resolver already picks the account+region); the facades
> here are region-agnostic and operate within whatever account they're deployed to.

---

# Redis (Cache) key naming standard

Redis itself restricts almost nothing about keys — they're **binary-safe strings up to 512 MB**, with
**no reserved structure**. So the standard below is **convention, enforced by us**: in a microservice
architecture multiple services often share one ElastiCache cluster, and un-namespaced keys collide,
leak across tenants, and can't be invalidated cleanly.

## Build keys with the facade — don't concatenate

The convention is **encoded in the [`Cache`](Cache.ts) facade**, so callers pass **structured parts**
and never hand-build the string. The format lives in **one place** (`Cache.key`), so it can change later
without touching call sites. `get` / `set` / `del` accept `Cache.KeyParts` directly:

```ts
import { Cache } from "@repo/services";
import type { Type } from "@repo/common";

// set a tenant-scoped cached contact (TTL 300s) — pass the object; the facade JSON.stringifies it
await this.cache.set(
    { purpose: Cache.Purpose.CACHE, accountId, entity: "contact", id: contactId },
    contact, 300 );

// read it back — the facade JSON.parses; type the result with the generic
const hit : Type.Result<Contact | null> = await this.cache.get<Contact>(
    { purpose: Cache.Purpose.CACHE, accountId, entity: "contact", id: contactId } );

// or build a string when you need it raw (e.g. for a Lua/SCAN call on `.client`)
const rateLimitKey : string = this.cache.key( { purpose: Cache.Purpose.RATE, accountId,
                                                hashTagAccount: true, entity: "min", id: window } );
```

The facade owns **serialization** (`set` JSON.stringifies a `Type.Json` value, `get<T>` JSON.parses) and
the **key format** — it fills `namespace` (= `SERVICE_NAME`) and `version` (= `"v1"`) from its
constructor (overridable via the `keyspace` arg); you supply `purpose` / `accountId?` / `entity` / `id` /
`field?`.

## The standard (what the facade emits)

```
<namespace>:<version>:<purpose>:[acct:<accountId>:]<entity>:<id>[:<field>]
```

* **`<namespace>`** — owning service id (`auth`, `texting`, …); collision-safe on a shared cluster.
* **`<version>`** — key-schema version (`v1`). A shape change is a prefix bump (`v1`→`v2`).
* **`<purpose>`** — `Cache.Purpose`: `cache` · `sess` · `lock` · `rl` · `idx`.
* **`acct:<accountId>`** — tenant scope (multi-tenant isolation + per-account invalidation). Omit only for
  inherently-global values, or ones already account-bound by their own id (e.g. a session).
  `hashTagAccount: true` emits `{acct:<accountId>}` to co-locate an account's keys on one cluster shard.
* **`<entity>:<id>[:<field>]`** — the thing + its **opaque** id (UUID / internal id), optional field.

| `KeyParts` | Emitted key |
|---|---|
| `{ purpose: SESSION, entity: "user", id: sessionId }` | `auth:v1:sess:user:<sessionId>` |
| `{ purpose: CACHE, accountId, entity: "contact", id }` | `texting:v1:cache:acct:<accountId>:contact:<id>` |
| `{ purpose: LOCK, accountId, entity: "campaign", id }` | `dispatch:v1:lock:acct:<accountId>:campaign:<id>` |
| `{ purpose: RATE, accountId, hashTagAccount: true, entity: "min", id: window }` | `gateway:v1:rl:{acct:<accountId>}:min:<window>` |

## Rules

The builder owns the **structure** — single `:` delimiter, segment ordering, namespace + version
prefix, and the `{acct:…}` hash-tag form. The **caller still owns the segment *values*:**

* **No PII in keys.** Keys surface in logs, `SLOWLOG`, `MONITOR`, and metrics — pass opaque ids, never
  email / phone / name.
* **lowercase, no `:` inside a value** (a stray `:` would add a phantom segment); kebab-case within a
  segment if needed.
* **Keep ids short** but descriptive — short keys cost less memory and hash faster.

## Operational

* **Always set a TTL on `cache` keys** — `Cache.set( key, value, ttlSec )`. Unbounded cache keys are
  how Redis fills up. (Locks, rate-limit windows, and sessions are TTL'd too.)
* **Never `KEYS *` in production** — it blocks the server. To sweep by prefix (e.g. invalidate an
  account) use **`SCAN`** with `MATCH <prefix>:*` via `Cache.client` — build the prefix with
  `cache.key(...)` up to the account segment.
* **Cluster mode — hash tags `{…}`.** ElastiCache cluster mode / Serverless shards by key hash. Set
  `hashTagAccount: true` **only** when several of an account's keys must live on the **same shard** for a
  multi-key `MULTI` / Lua / pipeline (e.g. rate-limit buckets). Otherwise omit it — hash tags hurt
  distribution.

See the [`Cache`](Cache.ts) facade.

---

# AppConfig configuration layout

AppConfig has a fixed hierarchy — **Application → Environment → Configuration Profile → (versioned)
Configuration**. The convention maps our services + provider factories onto it so every config has one
obvious home, independent versioning, and per-piece rollback.

## The mapping

| AppConfig concept | We use it for | Value |
|---|---|---|
| **Application** | the **service** | the service id (`SERVICE_NAME`) — `texting`, `email`, `auth`. One application per microservice. |
| **Environment** | the **in-account deploy target** (AppConfig requires one to deploy to) | usually a single **`default`**; or deployment **rings** (`canary`→`production`), **regions**, or **cells**. |
| **Configuration Profile** | one **config document per concern** | `settings`, `flags`, and `provider-<id>` (below). |
| **Hosted version** | the document's history | bump = new version; deploy/rollback per profile. |

> **AppConfig Environment is *not* dev/staging/prod.** Those are the **AWS account boundary** — the
> platform rule is *never point two deploy-environments at the same AWS account*, so each account already
> *is* one deploy-environment. AppConfig still **requires** an Environment as the deploy target, so use it
> for what the account boundary doesn't give you: **deployment rings** (deploy to `canary`, watch its
> CloudWatch monitors, then promote to `production`), **per-region**, or **per-cell** rollout — each with
> independent monitors + rollback. If you need none of those, a single **`default`** environment is correct.
> (The facade's `latest()` defaults the environment to `process.env.APPCONFIG_ENV ?? "default"` — a name
> distinct from any dev/staging/prod label. Set `APPCONFIG_ENV` only when the account uses rings/regions/cells.)

## Profiles per service

* **`settings`** — service-wide, non-secret runtime settings (freeform JSON).
* **`flags`** — feature flags (use the AppConfig **FeatureFlags** profile type).
* **`provider-<id>`** — **one profile per concrete provider** in a factory service: `provider-twilio`,
  `provider-bandwidth`, `provider-ses`, `provider-sendgrid`, … Each gets its **own version history and
  its own deploy/rollback** (the control-plane methods take a `profileId`), so you can roll back *one*
  provider without touching the others — small blast radius.
* **`providers`** *(optional index)* — which providers are enabled + routing weights, for the factory
  to read first before loading each `provider-<id>`.

> **Why a profile per provider** (not one big `providers` doc with sub-keys): independent
> version/deploy/rollback and a clear blast radius per provider. Use the single-doc form only if you
> *want* providers to version and roll back together.

## Document conventions (the JSON)

* **Root is always a JSON object** (extensible) — never a bare array or scalar.
* **First field `schemaVersion`** (int) for app-side shape evolution; bump it with a breaking change.
* **No secrets in AppConfig.** It is **non-secret runtime config only**. Provider credentials live in
  **Secrets Manager / KMS**; a provider profile carries a **reference** (`secretName` / `secretArn`)
  plus non-secret tunables — never the key itself.

### Examples

`texting` application → `settings` profile:
```json
{
  "schemaVersion": 1,
  "defaultProvider": "twilio",
  "quietHours": { "start": "21:00", "end": "08:00" },
  "sampling": { "events": 0.1 }
}
```

`texting` application → `provider-twilio` profile:
```json
{
  "schemaVersion": 1,
  "enabled": true,
  "weight": 70,
  "secretName": "texting/twilio",
  "endpoint": "https://api.twilio.com",
  "limits": { "perSecond": 100, "perDay": 1000000 },
  "retry": { "maxAttempts": 3, "backoffMs": 200 }
}
```

`texting` application → `providers` index profile (optional):
```json
{
  "schemaVersion": 1,
  "enabled": ["twilio", "bandwidth"],
  "routing": { "twilio": 70, "bandwidth": 30 }
}
```

## How the provider factory uses it

The factory reads the `providers` index (or probes each known `provider-<id>`) to learn which providers
are enabled and their weights, then loads each `provider-<id>` profile and instantiates the concrete
provider with its tunables (resolving `secretName` → Secrets Manager for credentials). On a runtime
config change — see the **Kafka runtime-change notification** note in [`AppConfig`](AppConfig.ts) — the
factory re-reads and rebuilds, rather than waiting for the next poll.

## Naming rules

* **Application** = service id, **lowercase** (matches `SERVICE_NAME`).
* **Profile names** lowercase, **kebab-case**, **no slashes / spaces** (AppConfig name constraints) —
  hence `provider-twilio`, not `provider/twilio`.
* The cloud-manifest **logical appConfig key** is typically the service id; the facade resolves it to the
  AppConfig **application id**.
* **Data-plane vs control-plane identifiers:** the read methods ([`latest`](AppConfig.ts) / `json`) take
  the profile **name** (above); the control-plane methods (`listVersions` / `deploy` / `rollback`) take
  the profile **id** and environment **id** (AWS-assigned), not the names.

---

# Entity state-change events (Kafka)

> **Canonical model:** an event is an **`Events.Action`** (`service.noun.verb`) carrying a **1:1 typed
> payload**, wrapped in **`Events.Envelope`** (`@repo/endpoint`), published to a topic named from the
> **`Topics`** registry, with the binding declared in the service's **manifest** (`publishes`/`subscribes`).
> See [root SPECS → Events & messaging](../../../../docs/SPECS.md). The **mechanics in this section stay valid**
> (fat payload, keying/ordering, don't-GET-before-publish, CDC) — only the terminology maps onto it:
> `type` → **`action`**, `data` → the **typed payload**, `Kafka.Event`/`MessageEnvelope` → **`Events.Envelope`**,
> and "one topic per entity" → a `Topics` stream **keyed** by entity/account id for ordering (many actions ride
> one topic). The `Kafka` facade is mid-migration to this (see root SPECS → *Event-bus code follow-ups*).

When an entity is **created / modified / deleted**, the owning service publishes a state-change event so
other services (search index, cache, analytics, read models, workflows) can react. Key the topic by the
entity id and `switch` on the **action** in the consumer (never a topic-per-verb; that loses per-entity
ordering). Use `publishEvent` / `subscribeEvents`.

The event body is **`Events.Envelope`** — the same body the WebSocket push frame and the client pub/sub bus
carry — with `key` re-required (Kafka needs it as the partition key). Define an event once; it flows service →
Kafka → WebSocket → client bus unreshaped.

## Envelope (metadata) — required for state-change events

A lightweight **[CloudEvents](https://cloudevents.io/)**-style envelope. For state-change events treat
these as **required** (the `Kafka.Event` type marks some optional for general use):

| Field | Meaning |
|---|---|
| `type` | `<entity>.<verb>` — `contact.created` · `contact.updated` · `contact.deleted` |
| `key` | the entity **UUID** → Kafka partition key (per-entity ordering) |
| `id` | unique **event** UUID → consumer **idempotency / dedup** |
| `time` | ISO-8601 occurred-at |
| `source` | emitting service id |
| `transactionId` | correlation id, propagated across services (tracing) |
| `version` | payload **schema** version (int) — lets consumers handle evolution |
| `seq` *(recommended)* | the entity's optimistic-concurrency / version number → drop **stale / out-of-order** events |
| `minAccess` *(if pushable)* | the object's minimum `Access.Role` to *see* it (role string). Stamp it on any event eligible for client push — the [realtime service](../../../../apps/core/realtime/SPECS.md) gates browser delivery on it (`Access.isAllowed`), so the **owning** service declares the bar |

Mirror `type` / `id` / `transactionId` / `accountId` into **Kafka headers** too, so a consumer can filter
at the broker without deserializing the body.

## Payload (`data`) — default to **fat events** (event-carried state transfer)

* **`created` / `updated`** — include the **full current entity snapshot**, not just the changed fields.
  Fat events keep consumers **autonomous** (no call-back `GET`), avoid **read amplification** (N consumers
  stampeding the source — brutal on replay/backfill), survive source downtime, and replay cleanly. A thin
  "id only" event also risks the consumer's later `GET` seeing a *newer* state than the event meant.
* **`updated`** — *may* add **`changed: string[]`** (the field names that changed) so a consumer can
  cheaply skip events it doesn't care about — **but still ship the full snapshot**.
* **`deleted`** — just `{ id }` (+ optional `deletedAt` / `reason`). This is the tombstone, and what drives
  downstream purge (e.g. GDPR forget).

> **Thin events** (id only, consumer GETs on demand) are the exception — reserve them for very large
> objects or strictly PII-sensitive, widely-consumed topics. **Default is fat.**

## Don't do a wasteful `GET` before publishing

The writer already has the new state — capture it from the **write itself**, never a separate read:

* **DynamoDB `UpdateItem`** → set **`ReturnValues: "ALL_NEW"`**; the update returns the complete new item
  in the **same call**. Publish that.
* **RDS** → `UPDATE … RETURNING *` returns the full row in the same statement.
* **Or decouple via CDC** → **DynamoDB Streams** delivers `NEW_AND_OLD_IMAGES`; a small Lambda publishes the
  event off the stream — you can't forget to publish, and the write path stays clean (`changed[]` is then a
  diff of old vs new image).

## Caveats

* **Ordering** — key by entity id (one partition per entity); `seq` lets a consumer discard a stale event
  that arrives after a newer one (matters when reading via GSI / replica).
* **PII on the bus** — fat events put entity PII on Kafka: keep these topics access-controlled, set
  retention deliberately, and have analytics consumers strip PII into the opaque-id lake (per the GDPR
  posture). PII-sensitivity is the main reason to consider a thin event for a given topic.

See the [`Kafka`](Kafka.ts) facade: `publishEvent(envelope)` / `subscribeEvents(group, object, …)` carry an
`Events.Envelope` (`@repo/system`) on `Events.Object` topics; `publishStream`/`subscribeStream` for analytics.

---

# WorkQueue — fair-share work + per-account rate limiting

[`WorkQueue`](WorkQueue.ts) is the multi-tenant **fair-share** pattern for any service that digests
per-account work (webhook ingestion, workflow steps, dispatch jobs). It composes two SQS queues behind
one API: a **priority** queue (standard SQS, system/time-sensitive work) and a **fair** queue (SQS
**FIFO**, `MessageGroupId = accountId`).

## How it's used

A service owns the two queues in its manifest (a standard `…-priority` and a FIFO `…-fair`), then:

```ts
import { Service, WorkQueue } from "@repo/services";
import type { Type } from "@repo/common";

class IngestService extends Service {
    private _work? : WorkQueue;
    protected get work() : WorkQueue {
        return this._work ??= new WorkQueue( this.cloud, {
            fairKey     : "ingest-fair",       // FIFO queue (fifo: true)
            priorityKey : "ingest-priority",   // optional standard queue
            fairWeight  : 0.2,                 // fair gets first dibs ~every 5th cycle (anti-starvation)
        } );
    }

    // PRODUCE — `accountId` is the TENANT fairness key: it becomes the FIFO MessageGroupId, so a
    // flooding account occupies only its own group's in-flight slot. (Use priority: true for system work.)
    async onWebhook( accountId : string, payload : object ) : Promise<void> {
        const result : Type.Result<void> = await this.work.submit( payload, { fairnessKey: accountId } );
        if ( !result.ok ) this.log.error( "submit failed", result.error );
    }

    // CONSUME — receive priority-first (per fairWeight), process, then ack each item.
    protected override async start() : Promise<void> {
        for (;;) {
            const batch : Type.Result<Array<WorkQueue.Item>> = await this.work.receive( 10, 20 );
            if ( !batch.ok ) { this.log.error( "receive failed", batch.error ); continue; }
            for ( const item of batch.data ) {            // item : WorkQueue.Item
                await this.handle( item.message );        // item.source : "priority" | "fair"
                await this.work.ack( item );              // delete so it isn't redelivered
            }
        }
    }
}
```

> **What is `accountId`?** It's the **tenant fairness key** — whatever uniquely identifies the tenant
> (usually the account id). You pass it as `submit({ fairnessKey })`; SQS stores it as the FIFO
> **`MessageGroupId`**. On consume you recover it from `item.message.Attributes?.MessageGroupId` (ensure
> the fair-queue `receive` requests the `MessageGroupId` attribute) — or simply include `accountId` in the
> message body, since you control what you `submit`.

**Fairness is server-side + local, no shared state:** SQS FIFO holds one in-flight message per account
group (a flooding account occupies only its own slot), and `fairWeight` is a deterministic in-memory
weighted token deciding which queue a worker checks first each cycle. A fleet of workers needs **no
coordination** — each independently giving fair-first `w` of the time yields ~`w` in aggregate. For
queue **utilization/metrics**, read **CloudWatch** SQS metrics (depth, in-flight, oldest-age) — not a
datastore.

## Per-account rate limiting (Redis token bucket) — opt-in layer

The built-in model is **ordering fairness** (one in-flight per account). When you also need to cap an
account's *throughput* — e.g. "≤ N sends/sec per account" — add a **distributed token bucket** in Redis
(the [`Cache`](Cache.ts) facade). This is the one place WorkQueue needs shared state: the bucket counters
must be atomic **across the whole worker fleet**, which is exactly Redis's job.

**Key** (per the Redis convention above) — hash-tagged so the account's keys co-locate on one shard:
```
<service>:v1:rl:{acct:<accountId>}:tokens     # remaining tokens
<service>:v1:rl:{acct:<accountId>}:ts         # last refill time (ms)
```

**Algorithm** — token bucket, refilled lazily by elapsed time, decremented atomically in a single **Lua**
script (so the check-and-take can't race across workers):
```
take(accountId, rate, burst):
  now      = current time (ms, passed in)
  tokens   = min(burst, stored.tokens + (now - stored.ts) * rate/1000)   # refill
  if tokens >= 1:  tokens -= 1; persist(tokens, now);  return ALLOW
  else:            persist(tokens, now);                return DENY, retryAfterMs
```

**Where it gates — at the worker, post-receive, pre-process** (throttles *processing*, the scarce
resource — not enqueue):
```ts
import { ChangeMessageVisibilityCommand } from "@aws-sdk/client-sqs";
import type { Type } from "@repo/common";

// the token-bucket result (the opt-in `rate.take` helper would return this)
interface Gate { allowed : boolean; retryAfterMs : number; }

const batch : Type.Result<Array<WorkQueue.Item>> = await this.work.receive();
for ( const item of (batch.ok ? batch.data : []) ) {                 // item : WorkQueue.Item
    // accountId = the FIFO MessageGroupId we submitted under (the tenant fairness key)
    const accountId : string = item.message.Attributes?.MessageGroupId ?? "";
    const gate      : Gate   = await this.rate.take( accountId, /*perSecond*/ 50, /*burst*/ 100 );   // Lua via Cache.client
    if ( gate.allowed ) {
        await this.handle( item.message );
        await this.work.ack( item );
    } else {
        // No token: DEFER, don't drop. Re-hide the message for ~retryAfter so a hot account
        // backs off without spinning; other accounts keep flowing (FIFO group still fair).
        const retrySeconds : number = Math.ceil( gate.retryAfterMs / 1000 );
        await this.work.queue.client.send( new ChangeMessageVisibilityCommand( {
            QueueUrl          : this.work.queue.url( "ingest-fair" ),   // Sqs escape hatch via WorkQueue.queue
            ReceiptHandle     : item.message.ReceiptHandle,
            VisibilityTimeout : retrySeconds,
        } ) );
    }
}
```

**Why this composition works:**
* **Defer, never drop** — a rate-exceeded message is made invisible for a backoff, then redelivered;
  nothing is lost, and a hot account self-throttles instead of busy-looping.
* **Orthogonal to FIFO fairness** — ordering fairness (one in-flight/account) and rate fairness (tokens)
  stack: FIFO stops monopolizing the workers, the bucket caps sustained throughput.
* **Atomic + fleet-wide** — the Lua take is the only correctness-critical bit; one round trip per message.

> Status: **not implemented in `WorkQueue` yet** — this is the documented design for the opt-in
> `rate`/token-bucket layer. The header comment in [`WorkQueue.ts`](WorkQueue.ts) flags it as the
> rate-fairness alternative to FIFO grouping.
>
> **Factor this as a shared `rate.take(key, perSecond, burst)` helper** (over `Cache`), not a WorkQueue
> internal — the [realtime service](../../../../apps/core/realtime/SPECS.md) reuses the identical bucket for
> **per-connection / per-account egress fair-share** (byte-denominated tokens, shed-and-nudge overflow).
> Same primitive, both directions: SQS ingress (defer-and-redeliver) and socket egress (shed-and-resync).

---

# S3 / object storage layout

Two separate conventions: **bucket resource keys** (which bucket) and the **object key hierarchy**
(the path inside it). Multi-tenancy lives in the *object key*, not in per-tenant buckets.

## Buckets — few, by purpose, owned by a service (never per-tenant)

Don't make a bucket per tenant — partition tenants by **prefix** (below). Use a small set of buckets,
each named by **purpose**, because lifecycle / encryption key / access policy / storage class / versioning
all vary *per bucket*:

| Logical key | Owner | Traits |
|---|---|---|
| `uploads` | media (ingress) | raw **presigned-PUT** target, untrusted; **expire after processing**; versioning off |
| `media` | media | processed assets + variants; durable; **versioning on (backstop)**; CloudFront/OAC in front |
| `reports` | report | generated exports; **expire after 30–90d** (regenerable); versioning off |
| `documents` | account | account branding/docs; long-lived; versioned |

Keep all buckets **private** — reads go out via presigned GET or CloudFront+OAC, never public ACLs.
Logical keys are lowercase + purpose-named; cloud-manifest/CDK resolves the globally-unique physical name.

## Object keys — typed per-usage descriptors, built by the facade

Object keys are **not** free-form strings — that's how files get orphaned (a typo'd or reordered
segment). Instead [`S3.key`](S3.ts) takes a **typed, per-usage descriptor**: a discriminated union keyed
on the central **`S3.Domain`** enum. Each asset family has its **own fixed shape and path**; the scope
(`acct/` tenant · `user/` cross-account identity · platform-`global`), the path order, and the domain
token are baked into the builder — there are no segments to mis-name. Adding a family is a deliberate edit in **one place** (an enum member + a descriptor
+ a `case`); the `switch` is **exhaustive**, so omitting the case is a **compile error**, and two services
can't silently reuse a domain.

| `S3.Domain` | Scope | Path | Descriptor |
|---|---|---|---|
| `MEDIA` | account | `acct/<accountId>/media/<mediaId>/<variant>.<ext>` | `MediaKey` |
| `AVATAR` | **user** | `user/<userId>/avatar/<variant>.<ext>` | `AvatarKey` |
| `BRANDING` | account | `acct/<accountId>/branding/<variant>.<ext>` | `BrandingKey` |
| `REPORT` | account | `acct/<accountId>/reports/<reportId>/<submissionId>.<ext>` | `ReportKey` |
| `MARKETPLACE` | **global** | `global/marketplace/<integrationId>/<variant>.<ext>` | `MarketplaceKey` |

* **`variant`** is the filename stem — a **required string** (e.g. `"1080p"`, `"256"`, `"logo"`). An
  asset with a single form uses **`"default"`**, never an optional/omitted value. (Some descriptors name
  the stem for their domain — `REPORT` uses `submissionId`.)
* **`REPORT` groups submissions under the report definition** — `reportId` is the definition / initial
  request (stable across a schedule's runs); each execution is a `submissionId`. No date in the key — the
  **reports DB** is the index, and S3 lifecycle expiry works on object age.
* **`AVATAR` is user-scoped** because a profile image follows the **user identity** across accounts (a
  user can belong to many via `RoleGrant`), so it can't sit under one account's prefix. Account **branding/
  logo** is account-scoped — pick the scope by *what the asset belongs to*, not where it's shown.

`S3.key` returns a `Type.Result<string>`; `.data` holds the built key:

```ts
import { S3 } from "@repo/services";
import type { Type } from "@repo/common";

// tenant media rendition — .data === "acct/<accountId>/media/<mediaId>/1080p.mp4"
const mediaKey : Type.Result<string> =
    this.s3.key( { domain: S3.Domain.MEDIA, accountId, mediaId, variant: "1080p", ext: "mp4" } );

// USER profile image — user-scoped — .data === "user/<userId>/avatar/256.webp"
const avatarKey : Type.Result<string> =
    this.s3.key( { domain: S3.Domain.AVATAR, userId, variant: "256", ext: "webp" } );

// report submission, grouped under its definition — .data === "acct/<accountId>/reports/<reportId>/<submissionId>.csv"
const reportKey : Type.Result<string> =
    this.s3.key( { domain: S3.Domain.REPORT, accountId, reportId, submissionId, ext: "csv" } );

// most call sites skip key() and pass the descriptor straight to an I/O method, which propagates ok:false:
const put : Type.Result<void> = await this.s3.put( "media",
    { domain: S3.Domain.MEDIA, accountId, mediaId, variant: "1080p", ext: "mp4" }, bytes, "video/mp4" );
```

**Why scope-first:** scope IAM/policies + presigned URLs to `acct/<accountId>/*` or `user/<userId>/*`
(isolation), per-scope lifecycle + cost (Storage Lens by prefix), and even key distribution across S3
partitions. It also gives clean **GDPR-delete scopes**: forget a user → purge `user/<userId>/`; close an
account → purge `acct/<accountId>/` (a tenant purge never touches `global/`). An asset's renditions share
the same `<mediaId>/` folder (variant = the MediaConvert `nameModifier`) so you list/delete the family as a unit.

### Three roots — pick by *ownership*

A service often stores the same *kind* of asset at more than one ownership. Choose the root by **who owns
the bytes**, then add a typed Domain for it:

| Root | Owns | Examples |
|---|---|---|
| `acct/<accountId>/…` | a **tenant** | account media, reports, branding, **an account's own email templates** |
| `user/<userId>/…` | a **user identity** (across accounts) | profile avatar |
| `global/<area>/…` | the **platform / a service** (no tenant) | marketplace catalog icons, **a service's built-in email-template library**, default assets |

> **Worked example — email templates (two owners).** An account's *custom* templates are tenant data →
> `acct/<accountId>/email-templates/<templateId>.<ext>` (a new account-scoped Domain). A service's
> *built-in* template library is platform-owned → `global/email-templates/<templateId>.<ext>` (a global
> Domain). Same asset type, two Domains, two roots — chosen by ownership, never one free-form path. (These
> Domains are added when the owning service is built — central registry, exhaustive `switch`.)

A purge stays scoped: deleting `acct/<accountId>/` removes the account's custom templates but leaves the
shared `global/email-templates/` library intact.

`S3.key` **validates** the dynamic values (ids / `variant` / `ext` — `[A-Za-z0-9._-]`, non-empty; enum
tokens are safe by construction) and **rejects** a malformed one — a stray `/`, whitespace, or empty —
by returning **`ok: false`** with a descriptive error (no throw, per the platform convention). The I/O
methods resolve the key the same way and propagate that `ok: false`.

## Versioning — app-level immutability is the convention; S3 versioning is a backstop

* **App-level (the rule):** library assets are **immutable** — never overwrite. A new version = a **new
  key** (new `mediaId`, or content-hash), and the **media DB tracks the lineage / "current" pointer**.
  Stable per-version URLs let the CDN cache **forever**. Mutable single-slot assets (avatar) → write a
  new key + update the pointer, rather than overwriting (CDN-friendly).
* **S3 bucket versioning:** enable on `media`/`documents` purely as a **recovery backstop** (undo
  accidental overwrite/delete), with a lifecycle rule to expire **noncurrent** versions. Off for
  ephemeral `uploads`/`reports`. Don't rely on it for app-level versioning.

## Who has a DB

S3 isn't queryable by metadata, so any service that needs to *list/search* its objects keeps a DB in
front as the index. **Media and reports both do; profile/branding don't.**

* **Media** — the media DB (DynamoDB) is the **catalog/index + pipeline state**:
  `mediaId → { accountId, originalKey, variants[], contentType, dims/duration, status, version lineage,
  checksum }`. Flow: presigned PUT → `uploads` → process (transcode/resize) → write derivatives to
  `media` → record the row → serve via presigned GET / CDN.
* **Reports** — the reports DB holds **two entities**: the **definition** (`reportId → { accountId, type,
  schedule, params, requestedBy }` — the initial request, recurring or ad-hoc) and each **run**
  (`submissionId → { reportId, startedAt, recordCount, status, outputKeys, ext }`). The S3 key just groups submissions
  under `reports/<reportId>/`; the DB answers "who/when/how many/which schedule".
* **Profile/branding don't need a catalog** — store the key as a field on the user/account record.

See the [`S3`](S3.ts) facade (`S3.key`, `S3.ObjectKey`).

---

# WebSocket — live server→client push

[`WebSocketApi`](WebSocketApi.ts) pushes to **one connection** (`post` / `disconnect` by `connectionId`)
via the API Gateway Management API. It deliberately **doesn't know who is connected** — so the platform
conventions are about turning "a connection" into "this user / this account".

## Keep a connection registry (DynamoDB)

API Gateway hands you a `connectionId` on `$connect`; to push to a user/account *later* you must store the
mapping. Use a DynamoDB **connections** table with **TTL**, keyed so you can look up by tenant + identity:

```
PK = acct#<accountId>   SK = conn#<connectionId>   { userId, sessionId, connectedAt, ttl }
   (GSI or mirror item: PK = user#<userId> → conn ids, for per-user push)
```
* **`$connect`** — authorize (below), then write the row(s).
* **`$disconnect`** — delete them.
* **TTL** (e.g. `connectedAt + 2h`) is a backstop for a missed `$disconnect`.
* **Push** = query the registry for the target's `connectionId`s → `post()` to each.

## Address by identity, not connectionId

Wrap the registry in a small **live/notify** helper — `pushToUser(userId, msg)` /
`pushToAccount(accountId, msg)` — that looks up connections, `post()`s, and **prunes** dead ones. The raw
`connectionId` stays internal; callers think in users/accounts. **Tenant isolation:** a connection only
ever receives **its own account's** messages.

## `$connect` auth

Authorize the socket at connect time — JWT via a **query param** or a **Lambda authorizer** (browsers
can't set headers on a WS handshake). Capture `accountId` / `userId` / roles into the registry row so the
connection carries identity for its lifetime (re-auth on reconnect).

## Inbound (client→server)

WS is bidirectional; the facade is **push-only**. Inbound is the API Gateway **route** layer: `$connect`,
`$disconnect`, `$default`, plus custom routes via a route-selection expression on a message field (e.g.
`action`). Route handlers (Lambda) validate + hand off to **SQS/Kafka** for processing — don't do heavy
work in the socket handler.

## Event-driven push (the usual trigger)

Don't `post()` ad hoc from random services. The normal flow: a service **publishes a Kafka entity event**
(`message.received`, `report.completed`, …); a **live consumer** maps it to the relevant connections (by
account/user) and pushes. So WS push **composes with the entity-event convention** — one place fans out,
and a service that emits an event doesn't need to know who's watching.

## Prune stale connections (410)

`post()` to a vanished client → API GW `GoneException` (410) → the facade returns `ok:false`. On a gone
result, **delete the registry row**. Treat any post failure as "maybe gone" and reconcile.

## Scale & limits to design around

* **Stateless / regional** — any service instance can `post` via the management endpoint (no sticky
  sessions); the **registry is the source of truth**, never in-memory connection state.
* **Fan-out** — pushing to an account with many open tabs is N posts; parallelize, or hand large fan-outs
  to a worker.
* **API GW WebSocket limits** — ~10 min **idle** timeout, **2 h** max connection, **128 KB** frame.
  Clients reconnect (and re-auth + re-register); TTL cleans up. **Keep messages small** — for a big
  payload push a **pointer** (an `S3.presignGet` URL), not the bytes.

## Message envelope

Push the platform-wide **`Events.Envelope`** (`@repo/system`) — the **same universal body** Kafka and outbound
webhooks carry — so the client `switch`es on `verb` (or routes by `action`). `@repo/system` is pure types/enums
(no AWS), so nothing server-side leaks into the web bundle. The client re-publishes it **whole** on its pub/sub
bus. One envelope, all transports — see [root SPECS → Events & messaging](../../../../docs/SPECS.md).

## Key naming

Logical key **`"live"`** (the facade default). Usually one WebSocket API per environment; add another only
for a genuinely separate auth/scaling domain.

See the [`WebSocketApi`](WebSocketApi.ts) facade (`post`, `disconnect`, `.client`).
