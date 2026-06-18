# The Manifest — structure reference

A **manifest** is the typed, declarative description of a service's cloud footprint. A service exports one
from `<service>/src/CloudManifest.ts`; the `/cloud` CDK app reads it and synthesizes the AWS resources,
derives least-privilege IAM, and injects the resulting identifiers back to the service as env vars.

This is the **field-by-field reference**. For the *how-to* (declare → expose → register → deploy) see
[`/cloud/README.md`](../../../cloud/README.md); for the *design rationale* see [`/cloud/SPECS.md`](../../../cloud/SPECS.md).
The types documented here live in [`src/`](../src) — [`Manifest.ts`](../src/Manifest.ts),
[`Resources.ts`](../src/Resources.ts), [`Common.ts`](../src/Common.ts). A runnable sample is
[`src/sample/widgetManifest.ts`](../src/sample/widgetManifest.ts).

---

## Mental model

```
            ┌──────────────────────────── synth time ────────────────────────────┐
service/src/CloudManifest.ts  ──import──▶  cloud/src/app.ts  ──▶  ServiceStack  ──▶  AWS resources
   (pure data: imports ONLY                                          │                + IAM (from `uses`)
    @repo/cloud-manifest)                                            │                + env injection
            └──────────────────────────── runtime ───────────────────┼───────────────────────────────┘
                                                                      ▼
                            service boots  ──▶  CloudResolver.tableName("notices")  ──▶  "prod-app-table-notices"
```

Three rules make the whole thing work:

1. **The manifest is pure data.** `CloudManifest.ts` imports *only* `@repo/cloud-manifest` — no CDK, no runtime
   code, no SDK. That's what lets `/cloud` import it at synth without dragging in the service's app code.
2. **You declare *what*, never *how*.** You say "I own a table keyed by `accountId`" or "I read media's bucket";
   `/cloud` decides the construct, the instance class, and the exact IAM policy.
3. **Everything is addressed by a logical `key`.** The manifest never contains a physical ARN/URL/name. The
   service resolves a logical key (`"notices"`) → physical id at runtime via `CloudResolver` — so the same code
   runs locally, in LocalStack, and in real AWS.

---

## Top level — `ResourceManifest`

```ts
export interface ResourceManifest {
  service      : string;                    // unique service name — prefixes every resource + the stack name
  description? : string;
  tracing?     : boolean;                   // AWS X-Ray active tracing across this service's compute

  owns         : OwnedResources;            // resources THIS service creates (see below)
  uses?        : Array<ResourceRef>;        // resources owned by OTHER services + the access intent

  publishes?   : Array<KafkaBindingSpec>;   // Kafka topics this service produces to
  subscribes?  : Array<KafkaBindingSpec>;   // Kafka topics this service consumes from

  tags?        : Tags;                      // Record<string,string> applied to the stack's resources
}
```

`service` is the identity: it prefixes physical names (`<env>-<service>-<kind>-<key>`) and names the stack
(`<service>-<env>`). `owns` is the only required member of the body.

---

## Cross-cutting conventions

These four primitives appear throughout every spec.

### `ResourceKey` — the logical handle

```ts
export type ResourceKey = string;   // unique within a (service, kind), e.g. "notices", "tickets"
```

Every owned resource has a `key`. It's how other parts of the manifest reference it (`kmsKey: "data"`,
`ref: { …, key: "tickets" }`) and how the service resolves it at runtime (`resolver.queueUrl("tickets")`).
Keep keys stable — renaming one re-points every reference and changes the injected env var name.

### `PerEnv<T>` — values that vary by environment

```ts
export type PerEnv<T> = Partial<Record<Environment, T>> & { default?: T };
// Environment = "local" | "dev" | "staging" | "production"
```

Anywhere you see `PerEnv<…>`, you can pass either a plain value or a per-env map. `forEnv()` resolves it,
falling back to `default`:

```ts
natGateways : { default: 1, production: 2 }     // 2 NATs in prod, 1 everywhere else
desiredCount: { default: 1, production: 3 }
memoryMB    : 256                               // plain value — same in all envs
```

> **`local`/`dev`/`staging`/`production` are the *account/deploy* boundary** (one account per market ×
> environment). They are **not** AppConfig deployment rings — see `AppConfigSpec.environments`.

### `Sizing` — the 1..10 power scale

```ts
export interface Sizing { cpu?: Scale; memory?: Scale; size?: Scale; }   // Scale = 1..10
```

No instance types anywhere. Pick a power level; `/cloud` ([`lib/sizing.ts`](../../../cloud/src/lib/sizing.ts))
maps `(cpu, memory)` → the concrete Fargate task size / RDS instance class / cache capacity. `size` is
shorthand applied to both when `cpu`/`memory` aren't set. Almost always `PerEnv<Sizing>`:

```ts
sizing: { default: { cpu: 2, memory: 3 }, production: { cpu: 5, memory: 6 } }
sizing: { default: { size: 2 }, production: { size: 6 } }
```

### `Tags`

```ts
export type Tags = Record<string, string>;   // e.g. { domain: "core", tier: "bff" }
```

---

## `owns` — resources the service creates

One service owns each resource. Below is every kind in `OwnedResources`, with its array/object shape and the
fields you'll reach for most. Full field lists are in [`Resources.ts`](../src/Resources.ts).

| Field | Type | Resource | Key fields |
|---|---|---|---|
| `queues` | `QueueSpec[]` | SQS | `key`, `fifo?`, `dlq?` (`true` auto-creates), `maxReceiveCount?`, `visibilityTimeoutSec?`, `kmsKey?` |
| `buckets` | `BucketSpec[]` | S3 | `key`, `access?` (`PRIVATE`\|`PUBLIC_CDN`), `versioned?`, `kmsKey?`, `lifecycle?`, `cdn?`, `presignedUpload?`, `eventNotifications?` |
| `tables` | `TableSpec[]` | DynamoDB | `key`, `partitionKey`, `sortKey?`, `billingMode?`, `ttlAttribute?`, `stream?`, `globalSecondaryIndexes?`, `kmsKey?` — how the entity interface maps to this + the typed `keyOf`/`ttlOf` binding: [**DYNAMODB.md**](./DYNAMODB.md) |
| `databases` | `DatabaseSpec[]` | RDS/Aurora | `key`, `engine`, `serverless?`, `sizing?`, `databaseName?`, `multiAz?`, `backupRetentionDays?` |
| `secrets` | `SecretSpec[]` | Secrets Manager / SSM | `key`, `store?`, `generate?`, `rotationDays?` |
| `keys` | `KmsKeySpec[]` | KMS CMK | `key`, `alias?`, `enableRotation?` — referenced by `kmsKey:` on other specs |
| `caches` | `CacheSpec[]` | ElastiCache Serverless | `key`, `engine?` (`REDIS`\|`VALKEY`), `sizing?` |
| `eventBuses` | `EventBusSpec[]` | EventBridge | `key`, `archive?`, `rules?` (static deploy-time rules → targets) |
| `scheduler` | `SchedulerSpec` | EventBridge Scheduler | `group?` — for **dynamic** runtime cron/rate/one-time schedules |
| `jobs` | `JobSpec[]` | Lambda workers | `key`, `handler`, `runtime?`, `memoryMB?`, `timeoutSec?`, `triggers?`, `environment?` |
| `services` | `ServiceSpec[]` | ECS (long-running) | `key`, `containerPort?`, `healthCheckPath?`, `sizing?`, `autoscaling?` (`{min,max,start?}`, synth-validated), `desiredCount?` (fixed, non-autoscaling only), `loadBalancer?`, `environment?` |
| `batchJobs` | `BatchJobSpec[]` | AWS Batch | `key`, `image`, `sizing?`, `retryAttempts?`, `timeoutSec?` |
| `topics` | `KafkaTopicSpec[]` | Kafka topic (owned) | `key`, `topic`, `partitions?`, `retentionMs?` |
| `snsTopics` | `SnsTopicSpec[]` | SNS | `key`, `fifo?` — alarm/notification fan-out |
| `api` | `ApiSpec` | API Gateway (≤1) | `key`, `authorizer?`, `cognito?`, `cors?`, `throttle?`, `endpoints?` |
| `webSocketApi` | `WebSocketApiSpec` | API GW WebSocket (≤1) | `key`, `routes` (`routeKey` → owned Lambda `function`) |
| `userPools` | `UserPoolSpec[]` | Cognito | `key`, `selfSignUp?`, `mfa?`, `signInAliases?`, `clients?`, `triggers?` |
| `appConfig` | `AppConfigSpec[]` | AWS AppConfig | `key`, `application?`, `profiles` (`freeform`\|`feature_flags`), `environments?` |
| `ses` | `SesSpec[]` | SES identity | `key`, `domain`, `dkim?`, `configurationSet?` |
| `mediaConvert` | `MediaConvertSpec[]` | Elemental MediaConvert | `key`, `reserved?` |
| `rum` | `RumSpec[]` | CloudWatch RUM | `key`, `domain`, `sessionSampleRate?` |
| `amplify` | `AmplifySpec[]` | Amplify Hosting | `key`, `repository?`, `branches?`, `domain?` |
| `alarms` | `AlarmSpec[]` | CloudWatch alarm | `key`, `metric`, `threshold`, `comparison`, `alarmActions?` |
| `logGroups` | `LogGroupSpec[]` | CloudWatch Logs | `key`, `retentionDays?` |
| `dnsRecords` | `DnsRecordSpec[]` | Route 53 | `key`, `hostedZone`, `recordName`, `type`, `aliasTo?` |

### Worked examples

**A queue with an auto dead-letter queue** — after 5 failed receives a message moves to the DLQ:

```ts
queues: [ { key: "tickets", maxReceiveCount: 5, dlq: true, visibilityTimeoutSec: 60 } ]
```

**A KMS key + an encrypted table that references it** — `kmsKey` points at a `keys[].key` in the same manifest:

```ts
keys:   [ { key: "data", alias: "app-data", enableRotation: true } ],
tables: [ {
  key          : "notices",
  partitionKey : { name: "accountId", type: AttrType.STRING },
  sortKey      : { name: "noticeId",  type: AttrType.STRING },
  billingMode  : BillingMode.ON_DEMAND,
  kmsKey       : "data",                 // ← encrypts at rest with the CMK above
  ttlAttribute : "expiresAt",
} ],
```

**A Lambda worker (`jobs`) triggered by a queue** — `handler` is `"file.export"` relative to the bundle; the
trigger's `ref` is a `ResourceRef` (here to the service's own queue) and drives both the event-source mapping
and the IAM grant:

```ts
jobs: [ {
  key        : "ticket",
  handler    : "jobs/AppTicketJob.handler",
  runtime    : JobRuntime.NODE_22,
  timeoutSec : 30,
  triggers   : [ {
    source    : "queue",
    ref       : { service: "app", kind: ResourceKind.QUEUE, key: "tickets", access: AccessIntent.CONSUME },
    batchSize : 10,                       // SQS→Lambda: 1..10 (synth rejects larger without a window)
  } ],
} ],
```

> **`jobs` vs `services`.** `jobs` are Lambda workers (the platform `Job` base — queue/event/schedule driven);
> `services` are long-running ECS/Fastify (the platform `Service` base). Don't put a worker under `services`.

**An ECS service** — one role of a service; `containerPort` is the role's named absolute port from
`Ports`, the *same constant* the `Service` base uses, so the manifest and the running service can't drift:

```ts
services: [ {
  key             : "main",
  launchType      : LaunchType.FARGATE,
  containerPort   : Ports.APP.MAIN,              // from @repo/cloud-manifest Ports — a named absolute port, not a literal
  healthCheckPath : "/health",
  environment     : { SERVICE_ROLE: "main" },
  sizing          : { default: { cpu: 2, memory: 3 }, production: { cpu: 4, memory: 5 } },
  autoscaling     : { default:    { min: 1, max: 2, start: 1, targetCpuPercent: 60 },
                      production: { min: 2, max: 8, start: 2, targetCpuPercent: 60 } },
  loadBalancer    : { public: false },
} ],
```

**Task count: `autoscaling` vs `desiredCount`.** With `autoscaling`, the count lives in `{ min, max, start }`
— `start` is the initial desired count at deploy (defaults to `min`), and the autoscaler then keeps it in
`[min, max]` on the target metric. Synth enforces `min ≤ start ≤ max`. Use the standalone `desiredCount` **only
for a fixed, non-autoscaling service** (it's ignored when `autoscaling` is set).

---

## `uses` — resources owned by other services (least-privilege IAM)

`uses` is how a service declares it touches a resource **another** service owns. Each entry is a `ResourceRef`
plus an **access intent**; `/cloud` derives the exact IAM policy from the intent — **you never hand-write a
policy**, and a service can touch only what it declares.

```ts
export interface ResourceRef {
  service : string;          // the OWNING service
  kind    : ResourceKind;    // queue | bucket | table | secret | topic | function | …
  key     : ResourceKey;     // the owned resource's logical key
  access  : AccessIntent;    // read | write | readwrite | send | consume | publish | subscribe | invoke | admin
}

uses: [
  { service: "media", kind: ResourceKind.BUCKET, key: "media", access: AccessIntent.READ },
]
```

`AccessIntent` → IAM mapping (intent, not raw actions):

| Intent | Means | Typical kind |
|---|---|---|
| `READ` / `WRITE` / `READ_WRITE` | object/item access | bucket, table, secret |
| `SEND` / `CONSUME` | queue producer / consumer | queue |
| `PUBLISH` / `SUBSCRIBE` | topic / bus producer / consumer | topic, eventbus |
| `INVOKE` | call a function | function |
| `ADMIN` | full control | any |

The same `ResourceRef` shape is reused inside the manifest wherever something points at a resource — a Lambda
`trigger.ref`, an `EventRuleSpec.targets[]`, an `AlarmSpec.alarmActions[]`, a `BucketEventNotification.target`,
a `DnsRecordSpec.aliasTo`. **Owner vs reference:** a resource is `owns`'d by exactly one service; everyone else
`uses` it.

---

## `publishes` / `subscribes` — Kafka bindings

Bind the service to a Kafka topic on the shared cluster. **Direction is implied by which array the binding sits
in** — there is no `mode` field. The `topic` **is** the event identity from [`@repo/events`](../../events/README.md):

```ts
export interface KafkaBindingSpec {
  topic          : Events.Object | Events.Stream | { external: string };
  consumerGroup? : string;                                // subscribe-only
}

publishes:  [ { topic: Events.Stream.BEHAVIOR } ],                                              // analytics stream
subscribes: [ { topic: Events.Object.MEDIA_ASSET, consumerGroup: "app-cache-invalidation" } ],  // per-entity topic
```

The topic is one of three, **never a literal**:

* **`Events.Object`** (`<service>.<noun>`, e.g. `media.asset`) — a **per-entity state-change topic** (the usual
  case). It's owned by the publishing service and keyed by entity id; a subscriber takes only the objects it
  needs and switches on the **verb** within.
* **`Events.Stream`** (`BEHAVIOR` / `ENGAGEMENT`) — a broad **analytics ingestion** stream (sole consumer:
  analytics).
* **`{ external }`** — an escape hatch for a topic outside the vocabulary.

Because the topic *is* the `Events.Object` enum value (not a hand-maintained `Topics` list), it can't drift from
the action vocabulary. What flows is an **`Events.Envelope`** whose `object` matches the topic, with a `verb`
and the object's typed `data`.

See [`@repo/events`](../../events/README.md) and [`/cloud/SPECS.md` → *Publishers & subscribers*](../../../cloud/SPECS.md).

---

## The runtime handoff — from synth to a running service

You declare resources by logical key; at synth `/cloud` names them and injects their physical ids; at runtime
the service resolves the logical key back. The naming helpers in [`Naming.ts`](../src/Naming.ts) are used by
**both** sides so they can't drift:

```ts
physicalName(env, service, kind, key)  // "prod-app-table-notices"   — the resource's physical name
ssmPath(env, service, kind, key)       // "/prod/app/table/notices"  — SSM registry path
envVarName(kind, key)                  // "TABLE_NOTICES"            — the injected env var
```

The service reads them back through `CloudResolver` ([`Resolver.ts`](../src/Resolver.ts)) — never hardcoding a
physical name:

```ts
const resolver = new CloudResolver( env, "app" );      // reads process.env by default
const table    = resolver.tableName( "notices" );      // → "prod-app-table-notices"
const queueUrl = resolver.queueUrl( "tickets" );
const ttl      = resolver.require( ResourceKind.TABLE, "notices" );   // generic; throws if missing (fail-fast at boot)
```

There's a typed accessor per kind (`queueUrl`, `bucketName`, `tableName`, `secretArn`, `topicName`,
`functionArn`, `cacheEndpoint`, `userPoolId`, …) plus generic `lookup()` (returns `undefined`) / `require()`
(throws). See [`src/sample/widgetRuntime.ts`](../src/sample/widgetRuntime.ts).

---

## `PlatformManifest` — shared, foundational infra

Defined **once** (in [`cloud/src/app.ts`](../../../cloud/src/app.ts)), not per service — the VPC, the Kafka/MSK
cluster, OpenSearch, the shared event bus, CloudTrail. Service stacks reference it (e.g. they run in its VPC).

```ts
const platformManifest: PlatformManifest = {
  vpc           : { maxAzs: 2, natGateways: { default: 1, production: 2 } },
  kafkaCluster  : { brokers: { default: 2 }, sizing: { default: { size: 3 }, production: { size: 6 } }, version: "3.6.0" },
  searchCluster : { serverless: true, sizing: { default: { size: 2 }, production: { size: 6 } } },
  cloudTrail    : { enabled: true, multiRegion: true, managementEvents: true },
};
```

---

## A complete annotated manifest

```ts
import {
  ResourceManifest,
  AccessIntent, ResourceKind,
  BucketAccess, BillingMode, AttrType, JobRuntime,
} from "@repo/cloud-manifest";

export const manifest: ResourceManifest = {
  service     : "widget",
  description : "Sample service demonstrating S3, SQS, DynamoDB, KMS and AppConfig.",

  owns: {
    keys:    [ { key: "data", alias: "widget-data", enableRotation: true } ],     // CMK ↓ referenced below

    buckets: [ { key: "files", access: BucketAccess.PRIVATE, versioned: true,
                 kmsKey: "data", lifecycle: [ { expireDays: 90 } ] } ],

    tables:  [ { key: "widgets",
                 partitionKey: { name: "accountId", type: AttrType.STRING },
                 sortKey:      { name: "widgetId",  type: AttrType.STRING },
                 billingMode: BillingMode.ON_DEMAND, kmsKey: "data", ttlAttribute: "expiresAt" } ],

    queues:  [ { key: "process", maxReceiveCount: 5, dlq: true, visibilityTimeoutSec: 60 } ],

    appConfig: [ { key: "config", application: "widget",
                   profiles: [ { key: "settings", type: "freeform" }, { key: "flags", type: "feature_flags" } ] } ],

    jobs:    [ { key: "processor", handler: "processor.handler", runtime: JobRuntime.NODE_22,
                 memoryMB: { default: 256, production: 512 }, timeoutSec: 30,
                 triggers: [ { source: "queue",
                   ref: { service: "widget", kind: ResourceKind.QUEUE, key: "process", access: AccessIntent.CONSUME },
                   batchSize: 10 } ] } ],
  },

  uses: [ { service: "media", kind: ResourceKind.BUCKET, key: "media", access: AccessIntent.READ } ],
};

export default manifest;
```

This declares a KMS key, an encrypted bucket + table, a queue with a DLQ, AppConfig, and a Lambda worker the
queue triggers — and grants the worker read on **media's** bucket. From it `/cloud` creates the resources,
writes the IAM, and injects `BUCKET_FILES`, `TABLE_WIDGETS`, `KMS_DATA`, `APPCONFIG_CONFIG`, `QUEUE_PROCESS`,
and media's `BUCKET_MEDIA` onto the worker — which reads them via `CloudResolver`.

---

## Rules & gotchas

* **Pure data only.** `CloudManifest.ts` imports `@repo/cloud-manifest` and nothing else — no CDK, no SDK, no
  service runtime. That's the synth-purity contract.
* **No literals where a registry exists.** Ports come from `Ports`, topic names from `Topics` — never hand-typed.
* **`key`s are an API.** Renaming a key re-points every reference *and* changes the injected env var
  (`envVarName`), so it's a breaking change for the running service. Treat it as one.
* **One `api` and one `webSocketApi` per service** (objects, not arrays).
* **SQS→Lambda `batchSize` is 1..10** without a batching window; synth rejects larger.
* **`uses` is the only way to cross a service boundary.** No ad-hoc ARNs — declare the ref + intent and let
  `/cloud` derive the grant.
* **Escape hatch.** For the exotic ~10% the manifest doesn't model, a service may also export raw CDK from
  `src/CloudManifest.cdk.ts` that `/cloud` composes alongside (see `/cloud/SPECS.md`).
