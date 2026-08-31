# `@repo/services`

The server-side runtime base for every node service: a small class hierarchy plus a thin
**AWS access layer** that lets a service consume cloud resources by their cloud-manifest
**logical keys** — never raw physical names or hand-rolled SDK setup.

---

## Class hierarchy

Three execution shapes, named by **role** — *serves* · *consumes* · *runs-once* — split on **how a process
gets its work**:

```
Application                 # shared base: identity · logging (Trace) · config/secrets · cloud access layer
  ├── Daemon (abstract)     # LONG-RUNNING resident process — owns signals + graceful drain + the run-forever
  │     │                   #   lifecycle (the classic "…d", e.g. httpd/sshd). NOT instantiated directly.
  │     ├── Service         #   request-driven — a Fastify HTTP listener (ECS/Fargate; entry: src/index.ts)
  │     └── Consumer        #   self-driven — consumes the Kafka / SQS / stream backbone in a run-loop
  │                         #     (consumer groups, queue workers, the realtime outbox drainer — ECS/Fargate)
  └── Job                   # ONE-SHOT — run-to-completion / Lambda handler (entry: src/lambda.ts)
```

* **`Service`** *serves* — blocks on an HTTP listener, reacts to inbound requests (request-driven).
* **`Consumer`** *consumes* — blocks on a consume/drain loop, pulls its own work off the event/queue backbone
  (self-driven). The right shape for a **high-volume firehose filtered to a subset** or a **live-connection
  drain** — where paying a Lambda invocation per event (to drop most) is the wrong cost shape and you want
  consumer-group offset control + self-paced backpressure. See [realtime](../../apps/core/realtime/SPECS.md).
* **`Job`** *runs once* — invoke → work → exit; no long-running loop (Lambda, or a run-to-completion batch on
  Fargate).

`Application` owns the **cloud access layer**, so every shape gets the same `this.s3` / `this.kafka` / … with no
extra wiring. **`Daemon`** owns the **long-running lifecycle** — signal handling + graceful drain — which
`Application` deliberately omits so that `Job`/Lambda contexts never install process-level handlers; `Service`
and `Consumer` are the two long-running kinds (they differ only in *what they block on*). A concrete app extends
`Service` / `Consumer` / `Job` and adds whatever extra facades it needs (e.g. `dynamo`).

---

## Shared send-compliance gate — `canSend()`  *(planned; mechanism TBD)*

Sending is **regulated** (TCPA / CAN-SPAM / quiet-hours / fatigue), and **every** send path — campaign →
dispatch, transactional sends, workflow jobs — must run the **same** pre-send checks. Rather than each caller
re-implementing them (and risking a missed check), expose **one gate on the `Application` base** so every
**Service *and* Job** gets it for free — exactly like the platform's other shared checks (the RBAC `Access`
check and the `ResolvedEntitlements` feature gate).

```ts
// shape (illustrative — NOT yet implemented)
const verdict = await this.canSend({ accountId, contactId, channel, content, at });
//  -> { allowed: boolean; reasons: string[] }   // e.g. ["suppressed","frequency_cap","quiet_hours","shaft"]
```

**Invoked by the channel** (its send worker) — [dispatch](DISPATCH.md) governs only
fairness/rate; the **channel owns send eligibility** and calls this gate.

**What it composes** (it *aggregates* the authoritative sources — it does **not** duplicate them):
- **per-contact, per-channel consent / suppression** — from the **contact** service
  ([Consent & suppression](../../apps/core/contact/SPECS.md), `contact-5`): opt-in / opt-out (with `source` + `proof`), STOP / bounce / complaint;
- **account block list** — value-keyed do-not-contact, covers non-contacts — from **account**;
- **global frequency cap / fatigue** — max messages per contact per period, **across all campaigns**;
- **quiet hours** — recipient TZ + federal/state + holiday windows;
- **content screening** — SHAFT / prohibited.

**Per-channel consent precedence** (mirror of `contact-5.3` / `5.7`): the effective state for a channel is the
consent record with the **latest `at`** — so an **opt-in dated after an opt-out re-enables sending** (a
re-subscribe). **Hard-block exception:** a **complaint / hard-bounce** suppression is *not* cleared by a later
opt-in timestamp. So `allowed` requires: opted-in by latest `at` **and** no hard-block suppression **and** not
on the account block-list **and** within quiet-hours **and** under the frequency cap.

**Mechanism — TBD** *(captured so the **interface** is settled even though the implementation isn't)*:
- where the **frequency counters** live — likely a **Redis** token/counter store (atomic, fleet-wide,
  hot-path), the same primitive as the `WorkQueue` rate-limiter;
- how **quiet-hours / holiday** rules are sourced;
- whether the gate is a **base method backed by a shared library** vs a thin call to a dedicated
  **compliance** service (start as a library; promote to a service if the rule set grows).

See [contact → Consent & suppression](../../apps/core/contact/SPECS.md) (the SoT for per-channel consent +
precedence), [campaign → Compliance & consent](../../apps/core/campaign/SPECS.md), the
[account block-list](../../apps/core/account/specs/SPECS.md), and
[dispatch](DISPATCH.md) gap #12 (the channel — not dispatch — runs this gate). This
is the home for campaign open-decision *"suppression / consent home"*.

---

## Shared reputation / geo lookup — `reputation(ip)`  *(planned)*

IP **reputation + geo** signals (country, ASN, VPN/Tor/hosting, abuse score) are needed by **auth's risk
engine**, **registration anti-abuse**, and **data-residency** — so expose **one method on the `Application`
base** rather than wiring a provider into each service.

```ts
const rep = await this.reputation(ip);
//  -> { country, asn, isTor, isVpn, isHosting, score }
```

**Auth owns the data + storage; this base method is a thin client.** The base method calls auth's
**generalized internal API** (`GET /auth/internal/reputation`) — **[auth](../../apps/core/auth/specs/SPECS.md)**
maintains the **provider factory**, the per-user **login-context baseline**, and the **IP allow/deny rules**,
and uses the same signals in its own authorizer (locally, no hop). Other services just call `reputation(ip)`.

- **Provider factory** (same pattern as the texting/email providers): a `ReputationProvider` interface +
  AppConfig `provider-<id>` — `provider-geolite`, `provider-maxmind`, `provider-ipqs`, `provider-cloudflare`,
  a `null` stub. Swap/add by config, no call-site change.
- **Cheapest start ($0/call):** **MaxMind GeoLite2** (free geo + ASN, local `.mmdb`) + the **Tor exit-node
  list** + an **ASN-based datacenter heuristic** — covers new-country / new-ASN / Tor / rough VPN. Add a paid
  VPN/fraud feed (MaxMind Anonymous-IP / IPQS / Spur) later **by config**. If behind **Cloudflare**, prefer its
  edge country + threat score (no DB to host).
- **Keep the local DB fresh with MaxMind [`geoipupdate`](https://github.com/maxmind/geoipupdate)** — the `.mmdb`
  drifts, so a scheduled `geoipupdate` (~weekly) pulls the current DB into **S3**; the GeoLite2/MaxMind provider
  loads + **hot-reloads** it ($0/call). License key in **Secrets Manager**. Never hand-bundle a stale DB.
- **auth owns the `RiskPolicy`** (what to *do* with the signals); callers only *read* them.

---

## Shared HTML sanitizer — `sanitizeHtml()`  *(planned)*

**Any** service that emits or stores HTML — **email** bodies/templates, **collab** rich-text docs, **app**
notices + Zendesk articles, **survey** forms — must strip XSS/JS. Expose **one method on the `Application`
base** so no caller rolls its own allowlist and nothing slips through.

```ts
const safe = this.sanitizeHtml(dirtyHtml, "email");   // profiles: "vanilla" (default) | "email" | "richtext"
```

- **Always strips:** `<script>`, inline `<style>`/CSS, `<iframe>`/`<object>`/`<embed>`, and **all `on*` event
  handlers**. **Constrains URLs:** `a[href]` / `img[src]` = **`https:` only** (no `javascript:`/`data:`/`vbscript:`),
  images from **our media/CDN**, links via the tracked-**[links](../../apps/core/links/SPECS.md)** service.
- **Profiles widen the TAG allowlist** (`email` > `richtext` > `vanilla`) but **never** re-enable
  script/style/`on*`/bad URLs. The reference allowlist is **[app](../../apps/core/app/SPECS.md) `app-8.4`**.
- **Sanitize on STORE *and* OUTPUT** — never trust upstream pre-sanitization. Backed by a **vetted library**
  (DOMPurify / sanitize-html), not hand-rolled.
- **Defense-in-depth, not the only line** — the **[web](../../apps/core/web/SPECS.md)** client sanitizes
  **again at render** (`web-6.7`), so a non-web consumer (an email recipient's inbox) is protected server-side
  *and* the browser is protected even if a producer forgets.

---

## Shared audit emitter — `audit()`  *(planned)*

**Nearly every service claims "audited"** (SOC 2 CC7.2, ISO A.8.15, GDPR Art 30) — logins, access grants, role
changes, exports, config changes, consent changes, integration connects, money movement. Rather than each
service inventing its own log, expose **one emitter on the `Application` base** so every **Service *and* Job**
records the same shape — and **emit, don't store**: this method only *enqueues* (**SQS**); the
**[audit](../../apps/core/audit/SPECS.md)** service is the **sole writer** of the immutable trail.

```ts
this.audit({ actor, action: "contact.export", target: { type: "segment", id }, outcome: "success" });
//  -> void   (enqueues to the audit SQS queue; the audit service sinks it to a WORM store)
```

- **PII-light by contract** — `target` is an **id, not a value**; `context` is ids + enums, **never** field
  values or message content. This is *why* the trail can be retained for years and **survive a GDPR forget
  untouched** (nothing personal to erase).
- **Not change-history** — `audit()` records **that** something happened (provenance); the field-level
  `{before, after}` **diff** lives **co-located** with the owning service (see below). Audit = central +
  immutable + PII-light; change-history = local + PII-dense + purges on forget.
- **One writer** — no service writes the audit store directly, and there is **no update/delete path** (even for
  root). See [audit](../../apps/core/audit/SPECS.md).

---

## Shared change-history — `changeHistory`  *(planned)*

Every **primary object** (contact, account, campaign, …) should get a **versioned, revertable field-level**
history — who/when/source + per-field `{before, after}` — without each service reinventing it. Expose the
**mechanism** on the base; keep the **data co-located** with each owning service.

```ts
const diff = this.changeHistory.record({ entity: { type: "contact", id }, version, actor, source, before, after });
//  -> [{ field, before, after }, …]   (append-only; supports compare(v1,v2) + revert(field[]))
```

- **Computed off the write path** — typically called from each service's **DynamoDB-Streams CDC Job** (it sees
  the OldImage/NewImage on every committed write), so the diff is reliable and the API path stays clean. See
  [contact](../../apps/core/contact/SPECS.md) `contact-13` (the reference) + `contact-14.5` (the Stream job).
- **Co-located, not centralized** — one **`change_history`** table **per service** (`PK accountId#entityId`,
  `SK version`). It is **PII-dense** (holds prior values) and bound to that service's tenancy + **GDPR forget**
  (purge values on forget, retain `{who, when, field, version}`). Centralizing it would build a PII honeypot.
- **Revert** — `revert(field[])` applies a prior value as a **new, audited** change (history is append-only),
  **optimistic-concurrency guarded** (`version`/etag) so it can't clobber a concurrent edit.
- **Contrast `audit()`** — change-history holds PII + purges on forget + lives per-service; `audit()` is
  PII-light + immutable + central. The two are complementary layers, not alternatives.

---

## Shared dispatch governor — `WorkQueue`

Getting work onto SQS **fairly** (no account starves others) and **without oversending** to a provider /
outside service is something the platform does **everywhere** — email, SMS, webhooks, social, report. So the
mechanism is **one class, composed as a member** (not a base class), configured per channel:

```ts
this.workQueue = new WorkQueue(this.cloud, "email", { limits: { perMinute: 100 }, batchSize: 250 });
const verdict  = await this.workQueue.admit(accountId, n);   // token-bucket rate gate
const batch    = await this.workQueue.dispatch({ max: 250 }); // WFQ/DRR fair pick → leased + pushed to SQS
```

- **Two jobs, one mechanism:** **fair-share IN** (Weighted Fair Queuing / DRR by account weight — `dispatch()`)
  + **rate-limit OUT** (token bucket per account/queue — `admit()`). Same Redis counters drive both.
- **Composed, not inherited.** `WorkQueue` is a **capability**, orthogonal to the execution-shape axis
  (`Daemon → {Service, Consumer}` / `Job`). A send-worker *has* a `WorkQueue`; it isn't *a kind of* one — exactly
  like `canSend()` / `audit()` / the AWS facades. The long-running **coordinator** that drives a `WorkQueue`
  (event- + timer-woken, self-scheduled) is a **`Consumer`**.
- **Configure rules, it self-governs.** Each channel passes its own `Rules` (rate caps, account weights, batch
  size, low-water-mark); the governor owns its **own Redis metrics** (per-minute bins, summed-on-read windows)
  and makes the decision. **Opt-in per channel** — bulk channels adopt it; transactional/one-off sends bypass.
- **No PII in the queue** — a job carries a **`payloadRef` pointer** (DB id / S3 key), not the payload; the
  durable job store (DynamoDB) is system-of-record. **Compliance is the channel's** (`canSend()`), never the
  governor's — it governs only fairness / rate / priority / order.
- This **subsumes the standalone dispatch design** — see [dispatch](DISPATCH.md): the
  *mechanism* lives here; a thin dispatch **service** remains only for genuinely **cross-account / cross-channel**
  scheduling (global account priority, the send-window reservation + CS "tetris" operator view).

---

## Inbound provider webhooks — `Webhook`

Every provider-facing service needs an inbound webhook endpoint (Twilio call-status, Meta Graph API, a future
CSP/TCR callback, …). Rather than each service hand-rolling "verify → enqueue → ack" from scratch, `Webhook`
(`src/Webhook.ts`) is a small composed helper — same pattern as `WorkQueue`/the AWS facades, not a base class:

```ts
private readonly webhook = new Webhook( this.cloud, { auth: Webhook.hmacSha256RawBody( secret ), log: this.log } );
```

- **Two modes, because both are real.** Most webhooks are pure notifications: `webhook.handle(request,
  queueKey)` verifies the signature, enqueues to SQS, and returns a generic ack — real processing happens
  downstream, off the queue, by whatever consumer the service already runs (a `Job` Lambda in production,
  optionally also drained locally by MAIN for dev — the same `Service`/`Job` split every other queue uses;
  `Webhook` stops at "verified + durably queued"). Some provider protocols are a **blocking request/response**
  instead (Twilio's call-control webhook must return TwiML synchronously) — for those, call `webhook.verify()`
  ALONE and process inline; there's no enqueue step to force.
- **A real bug this fixed**: HMAC-over-raw-body schemes (Meta/Stripe/GitHub-style) need the TRUE request
  bytes, not a re-serialized `JSON.stringify(body)` (key order/whitespace can differ from what was actually
  signed — social's original Meta verification had exactly this bug). `Service.enableRawBodyCapture()` (opt-in
  — call it from your own `addServerRegister()` override, replacing the base's `formbody`-only registration)
  captures the raw bytes as `RestfulEndpoint.rawBody`, which `Webhook.hmacSha256RawBody` verifies against.
- **Pluggable auth.** `Webhook.Auth` is a one-method interface (`verify(request): boolean | Promise<boolean>`)
  — a provider whose scheme doesn't fit a built-in (Twilio's HMAC-SHA1-over-URL+params, wrapped from the
  existing, already-correct `twilio` package) implements its own strategy object instead of the helper trying
  to special-case every vendor.
- **No payload validation built in, on purpose.** `@repo/api`'s `Validation.compile` lives a layer above
  `@repo/services`; pulling it in here would invert that dependency for a "nice to have" cheap gate. Real
  payload-shape validation belongs in the queue consumer, not inline before the ack.

---

## The AWS access layer (`src/aws/`)

Services do **not** call the AWS SDK ad hoc. AWS (and Kafka) are wrapped in **thin facades**
that centralize the cross-cutting concerns and complete the cloud-manifest contract.

### Why facades (not raw SDK everywhere)

- **cloud-manifest logical keys in, physical names resolved inside.** A facade method takes a
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

const sent : Type.Result<void> = await this.kafka.publishEvent(envelope);   // Events.Envelope → topic = envelope.object
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
| `Kafka` | `kafkajs` (MSK) | entity streams: one topic per `Events.Object` carrying an `Events.Envelope` (`publishEvent`/`subscribeEvents`), keyed by entity id, `switch` on `verb` (not a topic-per-verb); `publishStream`/`subscribeStream` for analytics |
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

### How it ties back to cloud-manifest

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
