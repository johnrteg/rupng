# `@repo/services`

The server-side runtime base for every node service: a small class hierarchy plus a thin
**AWS access layer** that lets a service consume cloud resources by their cloud-spec
**logical keys** — never raw physical names or hand-rolled SDK setup.

---

## Class hierarchy

```
Application                 # shared base: identity, logging (Trace), config/secrets,
  ├── Service               #   lifecycle (run/init/shutdown), AND the cloud access layer
  │     (Fastify HTTP server — ECS/Fargate; entry: src/index.ts)
  └── Job                   #   run-to-completion / Lambda handler (entry: src/lambda.ts)
```

`Application` owns the **cloud access layer**, so both long-running `Service`s and `Job`s
get the same `this.s3` / `this.kafka` / … with no extra wiring. A concrete service extends
`Service`/`Job` and adds whatever extra facades it needs (e.g. `dynamo`).

---

## The AWS access layer (`src/aws/`)

Services do **not** call the AWS SDK ad hoc. AWS (and Kafka) are wrapped in **thin facades**
that centralize the cross-cutting concerns and complete the cloud-spec contract.

### Why facades (not raw SDK everywhere)

- **cloud-spec logical keys in, physical names resolved inside.** A facade method takes a
  `ResourceKey` (`"uploads"`, `"events"`) and uses `CloudResolver` to turn it into the
  physical name the `/cloud` build injected. Services never touch `process.env.BUCKET_*`.
- **One client factory** (`ClientUtils.createClient`) applies `sdkConfig()` (LocalStack endpoint), region,
  and retries in a single place — and is the future hook for X-Ray tracing.
- **Uniformity** — AWS-SDK services (S3, KMS, AppConfig) and non-SDK ones (Kafka via
  `kafkajs`, later Redis) all present the same way: a lazy getter on the base class.
- **Testability** — facades stub cleanly.

### The rule: thin, with an escape hatch

Facades wrap the **common 80%**. Every facade exposes its raw underlying client as
**`.client`** for the exotic 20% — we don't reinvent the SDK.

Facade methods **don't throw** — they return a `Type.Result<T>` (`{ ok, data } | { ok, error }`),
so callers branch on `.ok` instead of wrapping every call in try/catch (the one try/catch lives
inside `ResultUtils.from`). On success, `data` is correctly typed:

```ts
import type { Type } from "@repo/common";

const put : Type.Result<void> = await this.s3.put("uploads", key, body);   // logical key "uploads" -> physical bucket
if ( !put.ok ) { this.log.error("upload failed", put.error); return; }

const link : Type.Result<string> = await this.s3.presignPut("uploads", key, 900);
if ( !link.ok ) { this.log.error("presign failed", link.error); return; }
use( link.data );                                        // link.data : string  (narrowed by the ok check)

const got : Type.Result<User | undefined> = await this.dynamo.get<User>("users", { id });
if ( got.ok && got.data ) render( got.data );            // got.data : User  (narrowed)

const sent : Type.Result<void> = await this.kafka.publishEvent("contact", { type: "contact.created", key: id, data: contact });
if ( !sent.ok ) this.log.error("publish failed", sent.error);

await this.s3.client.send(new SelectObjectContentCommand({ /* … */ }));   // escape hatch — raw SDK (may throw)
```

Every facade method returns `Promise<Type.Result<T>>`, so the result is **always** fully typed — the
`<T>` flows through (`get<User>` → `Type.Result<User | undefined>`), and after the `if (...ok)` guard
TypeScript narrows `data` to the success type. The annotations above are optional (inference already
gives the same types) but make the contract explicit.

### Lazy, by design

Facades are **lazy getters** — the client is created on first use and cached.

**On the base `Application`** — only what's common to *every* Service and Job (so a service
doesn't eagerly load SDK modules it never uses):

| Getter | Wraps | Resolves via CloudResolver |
|--------|-------|----------------------------|
| `this.cloud` | `CloudResolver` | — (the resolver itself) |
| `this.appConfig` | `@aws-sdk/client-appconfigdata` | `appConfigId(key)` |
| `this.kms` | `@aws-sdk/client-kms` | `kmsKeyArn(key)` |

**Everything else is wired by the concrete `Service`/`Job` that needs it** — import the facade
from `@repo/services` and add a lazy getter (`this.cloud` is available on the base):

```ts
import { Service, S3 } from "@repo/services";

class MediaService extends Service {
    private _s3? : S3;
    protected get s3() : S3 { return this._s3 ??= new S3( this.cloud ); }
}
```

Available facades (all constructed `new X( this.cloud )`):

| Facade | Wraps | Resolves via |
|--------|-------|--------------|
| `S3` | `@aws-sdk/client-s3` | `bucketName(key)` |
| `Dynamo` | `@aws-sdk/lib-dynamodb` (DocumentClient) | `tableName(key)` |
| `Sqs` | `@aws-sdk/client-sqs` | `queueUrl(key)` |
| `WorkQueue` | (composes `Sqs`) | multi-tenant **fair-share**: a system-priority queue + a per-account FIFO queue, so one account can't starve others |
| `Sns` | `@aws-sdk/client-sns` | `snsTopicArn(key)` |
| `EventBridge` | `@aws-sdk/client-eventbridge` | `eventBusName(key)` |
| `Secrets` | `@aws-sdk/client-secrets-manager` | `secretArn(key)` |
| `Lambda` | `@aws-sdk/client-lambda` | `functionArn(key)` |
| `Scheduler` | `@aws-sdk/client-scheduler` | `functionArn(key)` / `queueUrl(key)` (dynamic cron/rate schedules) |
| `Ses` | `@aws-sdk/client-sesv2` | — (sender is config, not a key) |
| `Cognito` | `@aws-sdk/client-cognito-identity-provider` | `userPoolId(key)` |
| `Kafka` | `kafkajs` (MSK) | `topicName(key)` — entity streams: one keyed topic + a typed `Kafka.Event` envelope (`publishEvent`/`subscribeEvents`), `switch` on `type` (not a topic-per-verb) |
| `Cache` | `ioredis` (ElastiCache/Redis) | `cacheEndpoint(key)` |
| `Search` | `@opensearch-project/opensearch` | `searchEndpoint(key)` |
| `MediaConvert` | `@aws-sdk/client-mediaconvert` | `mediaConvertQueue(key)` |
| `WebSocketApi` | `@aws-sdk/client-apigatewaymanagementapi` | `webSocketUrl(key)` |
| `Database` | `pg` (RDS/Aurora via RDS Proxy) | `databaseUrl(key)` (+ reader fallback) |

> **Choosing a datastore?** See **[DATABASE.md](DATABASE.md)** — DynamoDB vs RDS/Aurora vs Redis
> across schema, relationships, migrations, performance, cost, LocalStack, backups/DR, encryption,
> and a decision checklist. (Default: **DynamoDB**.)

> **Migrate up as commonality emerges.** Start with facades on the concrete service; if one
> proves common to most services, promote its getter to `Application` (or to `Service`/`Job`
> if it's specific to one kind). `appConfig` + `kms` earned their place on the base that way.

> **Cold-start note:** the base getters defer *client* construction, but a facade's module is
> imported eagerly when the service references it. Keeping the base minimal means a service
> only loads the SDK modules it actually wires — important for Lambda `Job` cold starts.

### How it ties back to cloud-spec

The same logical keys a service declares in its `ResourceManifest` (`src/infra.ts`) are the
keys it passes to these facades at runtime — declaration and use share one vocabulary:

```
infra.ts:   owns.buckets = [{ key: "uploads", … }]      # declared (CDK builds it, injects BUCKET_UPLOADS)
runtime :   this.s3.put("uploads", key, body)           # used (CloudResolver reads BUCKET_UPLOADS)
```

### Bundling

`@aws-sdk/*` and `kafkajs` are marked **external** by the shared bundler (`rup-bundle`) —
the Lambda runtime provides the AWS SDK v3 and the ECS image ships `node_modules`, so they
resolve at runtime rather than bloating the bundle.

---

## Local development

`sdkConfig()` redirects every client to **LocalStack** when `AWS_ENDPOINT_URL` is set (with
dummy creds), and to real AWS otherwise — the same service code runs in both. Kafka reads
`KAFKA_BROKERS` (the Redpanda side-container locally; the MSK broker list in the cloud).
See [`/cloud/local/README.md`](../../cloud/local/README.md).
