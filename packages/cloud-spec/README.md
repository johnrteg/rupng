# `@repo/cloud-spec`

**The dictionary your service uses to ask for cloud infrastructure — without knowing any AWS.**

---

## 1. What problem does this solve?

Every backend service needs "stuff in the cloud" to do its job: a place to store
files, a database, a queue to process work in the background, a secret to hold a
password, and so on. In AWS, each of those is a different product with its own
hundred knobs (S3, DynamoDB, SQS, Secrets Manager, …). Setting them up correctly —
encryption, permissions, networking, per-environment sizing — is a specialist job
that's easy to get wrong.

`@repo/cloud-spec` lets you **describe what your service needs in plain TypeScript
data**, and someone else (an automated build called the **CDK app**, living in the
[`/cloud`](../../cloud) folder) turns that description into real, correctly-configured
AWS resources.

You write a shopping list. The build does the shopping.

```
   YOU write this                         The /cloud build produces this
   ──────────────                         ──────────────────────────────
   "I need a file bucket,        ───►      A real, encrypted S3 bucket,
    a table, and a worker                  a DynamoDB table, a Lambda
    that reads them."                      function, and the exact IAM
                                           permissions tying them together.
```

This package contains **only the vocabulary** — the TypeScript types and a couple
of small helpers. It builds nothing on its own and has no AWS SDK dependency. It is
the shared contract between two sides:

- **Your service** declares what it wants (this package's types).
- **The `/cloud` CDK app** reads that declaration and builds it.

Because both sides import the *same* definitions, they can never drift out of sync.

---

## 2. The mental model (read this first)

Three ideas are all you really need:

### a) You declare *what*, never *how*

You say "I want a queue called `process`." You do **not** say which AWS region, what
encryption key, what IAM policy, or what the queue's real name is. Those are decided
for you, consistently, by the build.

### b) Everything is referred to by a **logical key**

A *logical key* is just a short, human name *you* choose, like `"files"`, `"widgets"`,
or `"process"`. You use that same name in two places:

1. When you **declare** the resource (your shopping list).
2. When you **use** the resource at runtime (your code).

You never type the resource's real ("physical") AWS name — e.g.
`prod-widget-bucket-files`. The system generates those names for you and hands them
back at runtime. (More in §6.)

### c) A service **owns** some resources and **uses** others

- **`owns`** — resources this service creates and is responsible for.
- **`uses`** — resources owned by a *different* service that this one needs to read
  or write. Declaring a `use` is what gets you permission to touch it — and *only*
  the permission you asked for (read-only stays read-only). This is "least privilege"
  and you get it for free just by being honest about what you need.

---

## 3. The vocabulary, piece by piece

Everything below is exported from `@repo/cloud-spec`.

### The manifest — your service's shopping list

A **manifest** is one object describing your whole service's cloud footprint. In a
real service it lives in `<service>/src/infra.ts` and is exported so the `/cloud`
build can find it. Its shape is [`ResourceManifest`](src/Manifest.ts):

```ts
interface ResourceManifest {
    service      : string;            // your service's name, e.g. "widget"
    description? : string;
    tracing?     : boolean;           // turn on AWS X-Ray request tracing
    owns         : OwnedResources;    // what you create  (see below)
    uses?        : ResourceRef[];     // what you borrow from other services
    publishes?   : KafkaBindingSpec[];  // Kafka topics you write to
    subscribes?  : KafkaBindingSpec[];  // Kafka topics you read from
    tags?        : Record<string,string>;
}
```

`OwnedResources` is just a bag of optional arrays — one per kind of thing you can
create (`queues`, `buckets`, `tables`, `databases`, `secrets`, `functions`, and so
on). You only fill in the ones you need.

### Resource kinds — the catalog of "things you can ask for"

[`ResourceKind`](src/Common.ts) is the full menu. You rarely type these directly
(you put a `QueueSpec` in `owns.queues`, etc.), but it's the canonical list of what's
available:

| Kind | AWS service | In plain English |
|------|-------------|------------------|
| `QUEUE` | SQS | A to-do list for background work |
| `BUCKET` | S3 | A folder for files |
| `TABLE` | DynamoDB | A fast key-value / NoSQL table |
| `DATABASE` | RDS / Aurora | A traditional SQL database (Postgres/MySQL) |
| `SECRET` | Secrets Manager | A safe for passwords & API keys |
| `FUNCTION` | Lambda | A small piece of code that runs on demand |
| `SERVICE` | ECS Fargate | A long-running server process |
| `BATCH_JOB` | AWS Batch | A heavy, run-to-completion job |
| `API` | API Gateway | The public HTTP front door |
| `WEBSOCKET` | API Gateway WS | A real-time, two-way connection |
| `EVENT_BUS` | EventBridge | An internal "something happened" notice board |
| `TOPIC` | Kafka / MSK | A high-throughput event stream |
| `SNS_TOPIC` | SNS | Fan-out notifications / alarms |
| `KMS_KEY` | KMS | An encryption key for the above |
| `CACHE` | ElastiCache | A fast in-memory cache (Redis/Valkey) |
| `SEARCH` | OpenSearch | Full-text search & log analytics |
| `CDN` | CloudFront | Fast global file delivery |
| `LOG_GROUP` | CloudWatch Logs | Where logs go |
| `APP_CONFIG` | AppConfig | Runtime config & feature flags |
| `SECRET`, `SES`, `USER_POOL`, `MEDIACONVERT`, `RUM`, `AMPLIFY` | … | Email, login, video transcoding, web monitoring, web hosting |

### Access intent — *how* you'll use something you borrow

When you `use` another service's resource, you say *why* with an
[`AccessIntent`](src/Common.ts): `READ`, `WRITE`, `READ_WRITE`, `SEND` (put on a
queue), `CONSUME` (take off a queue), `PUBLISH`, `SUBSCRIBE`, `INVOKE`, `ADMIN`.
That intent is what the build converts into a precise AWS permission.

### Environments — same code, different sizes

You ship to three [`Environment`](src/Environment.ts)s: `DEV`, `STAGING`, and
`PRODUCTION`. Almost any setting can vary per environment using
[`PerEnv<T>`](src/Environment.ts):

```ts
memoryMB: { default: 256, production: 512 }   // 256 MB everywhere, 512 in prod
```

`{ default: X }` is the value used when an environment isn't named explicitly.

### Sizing — pick a power level 1–10, not an instance type

You should never have to know that `db.r6g.2xlarge` is a database size. Instead you
give a [`Sizing`](src/Sizing.ts) on a **1 (smallest/cheapest) to 10 (largest)**
scale, and the build maps it to the right concrete AWS size for *that* resource:

```ts
sizing: { default: { size: 3 }, production: { size: 7 } }
// size  = applies to both cpu and memory
// cpu   = override compute only
// memory= override memory only
```

### Naming & the Resolver — how names are generated and read back

You'll rarely call these directly, but it helps to know they exist:

- [`Naming.ts`](src/Naming.ts) defines the *one* convention for turning
  `(environment, service, kind, key)` into a physical name, an SSM path, and an
  environment-variable name. Both the build and your runtime use it, so they agree.
- [`CloudResolver`](src/Resolver.ts) is the runtime helper your service uses to turn
  a logical key back into a real name. Covered in §6.

---

## 4. Quick start: a complete example

Two real files ship in [`src/sample/`](src/sample/) — read them alongside this. Here's
the gist.

### Step 1 — declare what you need (`infra.ts`)

This service owns an encryption key, an encrypted bucket, a table, a work queue, and
a Lambda worker that the queue triggers. It also borrows read access to another
service's bucket. (The full sample in [`src/sample/`](src/sample/) adds an AppConfig
application too.)

```ts
import {
    ResourceManifest, AccessIntent, ResourceKind,
    BucketAccess, BillingMode, AttrType, LambdaRuntime,
} from "@repo/cloud-spec";

export const widgetManifest : ResourceManifest = {
    service     : "widget",
    description : "Demo: S3, SQS, DynamoDB, KMS, AppConfig.",

    owns: {
        // An encryption key the bucket and table below both use.
        keys: [
            { key: "data", alias: "widget-data", enableRotation: true },
        ],

        // A private, versioned file bucket, encrypted with that key.
        buckets: [
            { key: "files", access: BucketAccess.PRIVATE, versioned: true,
              kmsKey: "data", lifecycle: [ { expireDays: 90 } ] },
        ],

        // A NoSQL table keyed by account + widget id.
        tables: [
            { key: "widgets",
              partitionKey: { name: "accountId", type: AttrType.STRING },
              sortKey:      { name: "widgetId",  type: AttrType.STRING },
              billingMode:  BillingMode.ON_DEMAND, kmsKey: "data" },
        ],

        // A work queue that auto-creates a dead-letter queue after 5 failures.
        queues: [
            { key: "process", maxReceiveCount: 5, dlq: true, visibilityTimeoutSec: 60 },
        ],

        // A Lambda worker, triggered by the queue. The build injects the bucket,
        // table, and key names into this function automatically.
        functions: [
            { key: "processor", handler: "processor.handler", runtime: LambdaRuntime.NODE_22,
              memoryMB: { default: 256, production: 512 }, timeoutSec: 30,
              triggers: [
                { source: "queue",
                  ref: { service: "widget", kind: ResourceKind.QUEUE, key: "process",
                         access: AccessIntent.CONSUME },
                  batchSize: 10 },
              ] },
        ],
    },

    // Borrow READ access to the media service's bucket. The build grants exactly
    // that — nothing more.
    uses: [
        { service: "media", kind: ResourceKind.BUCKET, key: "media", access: AccessIntent.READ },
    ],
};

export default widgetManifest;
```

### Step 2 — the build does its thing

You hand this manifest to the `/cloud` CDK app (see that folder's README). It:

1. Creates the KMS key, bucket, table, queue (+ its dead-letter queue), and Lambda.
2. Wires the queue to trigger the Lambda.
3. Grants the Lambda's role *least-privilege* permissions: encrypt/decrypt with the
   key, read/write the bucket and table it owns, consume its own queue, and **read**
   (only read) the media service's bucket.
4. Injects each resource's real name into the Lambda as an environment variable.

You write zero IAM policy and zero resource ARNs.

---

## 5. How this connects to the rest of the monorepo

```
   apps/<service>/src/infra.ts          <- your manifest (uses @repo/cloud-spec types)
            │
            ▼
   /cloud  (the CDK app)                <- imports the manifest, builds real AWS
            │   uses @repo/cloud-spec Naming to name things & publish identifiers
            ▼
   AWS                                  <- real resources + IAM + injected env vars
            │
            ▼
   apps/<service>/src/*.ts              <- your runtime code reads names back
                                           via CloudResolver (@repo/cloud-spec)
```

The same `@repo/cloud-spec` package is imported on all three rungs. That's the whole
point: one source of truth for what exists, what it's named, and who can touch it.

---

## 6. Reading your resources back at runtime

You declared a bucket with the logical key `"files"`. At runtime you need its *real*
name to actually call S3. You get it from [`CloudResolver`](src/Resolver.ts) — never
by hardcoding a name.

```ts
import { Environment, CloudResolver } from "@repo/cloud-spec";

// Which environment am I running in? (the build injects ENVIRONMENT)
const env = (process.env.ENVIRONMENT as Environment) ?? Environment.DEV;

// One resolver per service.
const cloud = new CloudResolver(env, "widget");

// Logical key -> the real, build-generated name (read from injected env vars):
const filesBucket = cloud.bucketName("files");    // e.g. "prod-widget-bucket-files"
const widgetTable = cloud.tableName("widgets");
const workQueue   = cloud.queueUrl("process");
const dataKey     = cloud.kmsKeyArn("data");
```

There's a typed accessor for each kind (`bucketName`, `tableName`, `queueUrl`,
`secretArn`, `databaseUrl`, `functionArn`, …). They all:

- **Fail fast**: if the resource wasn't wired up, you get a clear error at startup
  rather than a mysterious failure later.
- Have an optional sibling — `cloud.lookup(kind, key)` — that returns `undefined`
  instead of throwing, for genuinely optional resources.

How does the resolver find the value? The build named an environment variable using
the *same* `envVarName(kind, key)` convention from [`Naming.ts`](src/Naming.ts) — so
`("bucket", "files")` becomes `BUCKET_FILES`. The build sets it; the resolver reads
it. Neither side ever guesses.

---

## 7. Platform vs. service manifests

There are two manifest types:

- **`ResourceManifest`** (covered above) — one *per service*, for things that service
  owns.
- **[`PlatformManifest`](src/Manifest.ts)** — *one* for the whole platform, for shared
  foundations every service sits on top of: the network (`vpc`), the Kafka cluster,
  the search cluster, the shared event bus, audit logging (`cloudTrail`), and DNS
  zones. You'll usually only touch this if you're working on shared infrastructure.

---

## 8. FAQ

**Do I need to know AWS to use this?**
No. You need to know what your *service* needs ("a file store", "a queue"). The
mapping to AWS products and their safe defaults is what this package abstracts away.

**Where do real resource names come from? Can I set them?**
The build generates them from `(environment, service, kind, key)` so they're unique
and predictable. You don't set them — you refer to everything by your logical key and
let `CloudResolver` give you the real name at runtime.

**I added a resource to my manifest but my code can't find it.**
Two checks: (1) the logical `key` in your manifest must match the key you pass to the
resolver; (2) the `/cloud` build must have been re-run/deployed so the new resource —
and its injected env var — actually exist.

**How do I get permission to use another service's queue/bucket/table?**
Add it to your manifest's `uses[]` with the right `AccessIntent`. That declaration
*is* the permission request. Don't ask for more access than you'll actually use.

**Does this package create anything by itself?**
No. It's pure types and helpers — no AWS SDK, no side effects. All the building
happens in [`/cloud`](../../cloud).

---

## 9. File map

| File | What's in it |
|------|--------------|
| [`Common.ts`](src/Common.ts) | `ResourceKind`, `AccessIntent`, `ResourceRef`, logical-key type |
| [`Environment.ts`](src/Environment.ts) | `Environment` enum, `PerEnv<T>`, `forEnv()` |
| [`Sizing.ts`](src/Sizing.ts) | The 1–10 `Sizing` scale and `scales()` resolver |
| [`Resources.ts`](src/Resources.ts) | The spec (shape) for every resource you can own |
| [`Manifest.ts`](src/Manifest.ts) | `ResourceManifest` (per service) + `PlatformManifest` |
| [`Naming.ts`](src/Naming.ts) | The shared naming convention (names, SSM paths, env vars) |
| [`Resolver.ts`](src/Resolver.ts) | `CloudResolver` — logical key → real name at runtime |
| [`sample/`](src/sample/) | A complete, commented example manifest + runtime usage |
