#
# Realtime service
#

# Objective

The **one bridge from Kafka to the browser**. It consumes a curated **subset** of platform events, decides
which connected web clients should see each, and pushes the event over **API Gateway WebSocket** to the
sockets a client opened for a given **`accountId`**. Domain services stay transport-ignorant — they publish
to Kafka and never touch a socket; this service owns the egress.

It is **push-only**. The client WebSocket is receive-only by design (client *actions* go through the REST
API — see [web SPECS](../web/SPECS.md)); this service never processes inbound *action* frames. (A tiny
client→server **`{ ack: seq }`** flow-control frame is an *optional* future upgrade for RTT-paced delivery —
signaling only, not actions — see Throughput & flow control.)

# Why a dedicated service (not push-from-each-service)

Pushing to clients from every domain service would copy the same machinery into all of them and couple
each to the WebSocket transport. Centralizing it here gives **one** owner of:

* the **connection registry** lookup + API Gateway Management API posting (the `WebSocketApi` facade),
* the **push set** — which object-change events are even eligible to reach a browser (and, TBD, which a
  given client has *registered* interest in),
* **authorization** — does *this* connection's **access role** permit *this* event's account + object?,
* **fan-out** — one event → N connections, with per-connection send/prune handled in one place.

Domain services scale on their own concerns; this one scales on connection count + event volume.

# Role & boundaries

* **In:** a subset of Kafka entity / state-change events (`Kafka.subscribeEvents`), each a
  `Type.MessageEnvelope` (see [root SPECS → Events & messaging](../../../docs/SPECS.md)).
* **Out:** the **same envelope** posted to 0..N open WebSocket connections via API Gateway
  (`WebSocketApi.post`). The client re-publishes it whole on its pub/sub bus.
* **Owns:** the read path of the connection registry, the push set, **account-wide presence** (who's online —
  derived from the registry), the **per-account outbox log** + the **per-connection drainers/cursors** that
  pace delivery, per-entry **access-role authorization**, egress fair-share, and stale-connection pruning.
  (No field-level redaction — see below.)
* **Does not own:** the `$connect` / `$disconnect` handlers and registry *writes* — those live with the
  WebSocket API stack ([`@repo/services` aws/SPECS.md → WebSocket](../../../packages/services/src/aws/SPECS.md)).
  This service is a **reader** of that registry. It also does **not** do mobile push (APNS/FCM) — a separate
  notification concern — nor **collaborative document editing** (tiptap / Y.js CRDT sync), which is a
  dedicated full-duplex service on its own socket (see [web SPECS](../web/SPECS.md)). Durable client writes
  always go through **REST**, never any socket.

# The pipeline (two phases)

Ingest and delivery are **decoupled by the per-account outbox log** (see Throughput & flow control): the
Kafka consumer appends fast; per-connection drainers deliver at each socket's pace. Authorization happens
at **drain**, per connection — so the cheap append never needs the connection list.

**Phase A — Ingest (per consumed Kafka event):**

1. **Filter — push set.** Only **object-change** event `type`s in the eligible push set proceed; everything
   else is dropped immediately. Browsers see a deliberately small slice of the firehose — never "every
   Kafka event". The eligible set is **AppConfig-driven** (activate a `type` by adding it — a redeploy is fine);
   it is **server-decided, not client-registered**. *(Client-side narrowing to an open view's objects is a
   far-future perf optimization, not planned — see Gaps.)*
2. **Resolve account.** Every pushable event must carry an **`accountId`** (in the envelope payload /
   headers) and **`minAccess`**. Missing either ⇒ drop + log (it shouldn't have been in the push set).
3. **Append to the account outbox** — `XADD rt:{acct:<id>}:out` — **iff the account has ≥1 live connection**
   (registry lookup by `accountId`; zero ⇒ skip, no reader). One append per event, regardless of connection
   count; the entry carries `minAccess` for per-connection authz at drain.

**Phase B — Drain (per connection, paced):**

4. **Read from the cursor.** The connection's drainer reads its account log from the connection's stored
   offset, in order.
5. **Authorize — by access role.** Deliver an entry iff `Access.isAllowed(connectionRole, entry.minAccess)`
   **and** the role's grant covers `accountId` (agency / sub-account included). `minAccess` was stamped by
   the publisher, so the check is generic — no per-object rules here. **Never trust the socket's `accountId`
   alone** — re-evaluated on **every** entry (grants/roles can change mid-connection). Not allowed ⇒ skip
   this entry for this connection, advance cursor.
6. **Pace + shape.** Spend the connection/account **token bucket** (bytes + msgs/sec) before posting; if the
   frame would exceed **128 KB**, send an `S3.presignGet` **pointer**, not the bytes. No field redaction —
   the role already gated the whole entry.
7. **Post + advance.** `WebSocketApi.post(connectionId, entry)`; on success advance the cursor. `410 Gone`
   ⇒ connection vanished without `$disconnect`: drop its cursor + registry entry (TTL is the backstop). AGW
   `429`/buffer-full ⇒ back off this connection (it's not keeping up); falling off the capped log ⇒ `resync`
   nudge (see Throughput & flow control).

# Push set (the contract for what may reach a browser)

Not all events belong in a browser. The push set is the **contract** for which **object changes** the UI
may react to — client-relevant, account-scoped, low-to-moderate volume. Examples (illustrative, not final):

| Event `type` | Why a client cares |
|---|---|
| `contact.updated` | live-refresh an open contact view |
| `message.received` / `message.status` | inbox / conversation live updates |
| `report.completed` / `report.failed` | toast + unlock the download |
| `campaign.status` | progress on a running send |

**Excluded by default:** internal/audit/billing-internal events, **service-config change events** (those go
to Kafka for services to hot-reconfigure without restart — machine-to-machine, never a browser), and
high-frequency machine-to-machine chatter. Adding a `type` to the push set is a reviewed **AppConfig** change,
**paired with a web-app consumer** for it (typically the same deploy).

**Server-decided, config-driven (not client-registered).** Services emit the events meaningful to the web app;
**activation = a push-set config entry + a web-app handler** that consumes the envelope (the
[`WebsocketService`](../web/src/model/service/WebsocketService.ts) → `PubSubService` re-publishes it; a view
subscribes to the `type`). Because the web app needs a code change to consume a new type anyway, the two **ship
together** — so a **re-deploy is fine**. A client narrowing the set to its open views is a far-future perf
optimization, **not planned** (see Gaps).

# Authorization (access-role based, non-negotiable)

* **The server decides — the browser cannot circumvent it.** Delivery is gated **server-side**, here, on
  every push. The `?accountId=<accountId>` the client connected with is a *request*, not a permission;
  nothing the client sends (subscriptions, hints, the `accountId`) widens what it receives. A client only
  ever gets object changes its **access role** can already see via REST — the socket grants no extra
  visibility, so there is no client-side path around access control.
* **The publisher stamps `minAccess` on the event; this service enforces it — generically.** Each
  state-change/pushable event carries `minAccess` (an [`Access.Role`](../../../packages/endpoint/src/Access.ts)
  value) = the minimum role required to see that object. The realtime service stays **object-agnostic**: it
  delivers to a connection iff `Access.isAllowed(connectionRole, event.minAccess)` **and** the role's grant
  covers the event's `accountId` (agency / sub-account access included). No per-object-type rules live here —
  the owning service, which knows the object, declares the bar; we just compare ranks. Missing `minAccess`
  on a pushable event ⇒ **fail closed** (drop + log).
* **Re-checked per push.** Roles/grants can change mid-connection, so authorization is evaluated on **every**
  event, not cached at `$connect`.
* **Role gates the whole event — no field redaction.** Permitted ⇒ the client gets the **full payload**;
  not permitted ⇒ **nothing** for that event. Visibility is decided at the event/object level by role, not
  by masking fields.
* **Account isolation.** An event for account A is never delivered to a connection whose role authorizes
  only account B, even if B's user requested `accountId=A`.

# Delivery semantics

* **Lossless under bursts; at-most-once only at the edges.** Each connection has a **durable, ordered
  outbox** (Redis Stream — see Throughput & flow control), so a noisy-but-keeps-up account loses **nothing**;
  a burst is buffered and drained in order. Loss is confined to two edges: (a) the client is offline /
  reconnecting (it **re-syncs via REST** — the socket is a liveness optimization, not the source of truth),
  and (b) a connection **falls off the capped log** under genuine sustained over-capacity (→ `resync` nudge).
* **Ordering** is per entity (preserved by the Kafka partition key, carried through the outbox append order);
  `seq` lets a client drop a stale frame.
* **Idempotency / dedup** via envelope `id` (a client may briefly hold two connections during reconnect).
* **No per-object debounce.** Same-UUID rapid re-updates are rare and we do **not** hold in-process
  per-`(connection, entity)` state to collapse them. Aggregate egress (a flood of *distinct* small events) is
  handled by the buffered, paced drain below — and a chatty event *type* (send-progress counters) is
  additionally throttled at its **publisher** (emit "every Ns / every N%"), which cuts Kafka volume for *every*
  consumer, not just browsers.

# Throughput & flow control (egress fair-share)

The push set excludes machine chatter, but an account can still emit a flood of *distinct* events — inbound
texts, dispatch results, stat ticks — that saturates a socket in **bytes/sec & msgs/sec** (a volume problem,
not a per-message-size one). We do **not** want to drop a client's traffic just because it's noisy. So the
model is **buffer-first, drain-paced, shed-only-at-the-cap** — a tiny Kafka-per-account in Redis.

## Per-connection outbox — a durable, ordered log (Redis Streams)

* **One ordered log per account** — `XADD rt:{acct:<id>}:out` (hash-tagged so the account co-locates). The
  enqueue path stays **stateless / any-instance**: a consumer instance appends; nothing is held in process.
  Append order preserves per-entity Kafka order (same partition → ordered consumption → ordered append).
* **Per-connection cursors** — each socket tracks its own last-delivered stream id (its *offset*). One copy
  of the data, **N independent readers** — like Kafka consumer offsets. A connection applies **its own role
  filter** (`minAccess`) as it drains, so authorization stays per-connection even though storage is shared.
* **Bounded** — the log is capped (`MAXLEN` ≈ N entries / max bytes / idle **TTL**). The cap *is* the
  burst-tolerance knob; TTL reaps a disconnected socket's cursor + idle logs.

## Paced drain — absorb the burst, deliver steadily, in order

* A per-connection **drainer** reads the log from the cursor and `PostToConnection`s **paced by the
  bytes/sec + msgs/sec token bucket** (the **same `rate.take` primitive** as the WorkQueue fair-share —
  [aws/SPECS.md → Per-account rate limiting](../../../packages/services/src/aws/SPECS.md)). A burst lands in
  the log instantly and drains out **steadily and in order** — **lossless** for any account whose *average*
  rate is within the client's capacity, even if it never goes quiet.
* **Two buckets, stacked:** **per-connection** (the individual pipe) and **per-account** (fairness across an
  account's sockets + protects the **API Gateway account-level** `PostToConnection` throttle). Tokens are
  **bytes** (consume `frame.length`); a parallel **msgs/sec** bucket bounds tiny-frame floods.
* **What sets the pace** (the client's "acceptable rate"):
  * **Default — AGW backpressure, no client ACKs (keeps receive-only):** drain at a configured per-connection
    budget; when `PostToConnection` returns **429 / buffer-full**, the client isn't keeping up, so slow that
    connection's drain. Coarse but ACK-free.
  * **Optional upgrade — timestamped client ACK (one frame, two signals):** a tiny client→server
    `{ ack: <seq>, t: <serverTimeEcho> }` frame, sent periodically. The **ack'd seq** gives **backlog +
    goodput** — the real pacing input (drain rate = the rate the client is actually clearing, slow when the
    un-acked backlog grows). The **echoed timestamp** gives an **RTT sample** — used as a *trend* signal
    (RTT climbing while we push = a buffer filling → **back off early**, before AGW 429s). *Flow-control
    signaling only* (not actions), but it does relax strict receive-only — adopt only if AGW backpressure
    proves too coarse.
    > Why ACK-with-timestamp over a bare **latency ping**: latency ≠ capacity (a far-but-fat client has high
    > RTT and high bandwidth; congested wifi has low RTT until it collapses), so RTT *level* is a poor drain
    > rate. The ACK already carries goodput/backlog (what we want) *and* an RTT sample — one frame, both
    > signals — measured over the **actual socket round trip**, not a side HTTP endpoint that probes the
    > wrong path.

## Overflow — shed only when it's physically impossible to keep up

A buffer absorbs **bursts**; it cannot fix a **sustained average** rate above the client's capacity (lag → ∞).
So loss is confined to that genuine-overload case: when the cap is hit, the slowest connection's cursor falls
behind the trim horizon — it **"fell off the log"**. *Only then* do we degrade, per connection:

1. **Normal / bursty** — log absorbs it, drainer paces it out in order → **nothing lost**.
2. **Cursor lagging toward the cap** — **shed low-value first** (a direct inbound message outranks a
   background stat tick; priority from the event type / push-set entry); coalesce a chatty *category*.
3. **Fell off the capped log** — send **one** `{ type: "resync", scope: "<category>" }` control frame (REST
   re-sync is the recovery path), debounced by a short-TTL Redis flag, and **emit a saturation metric** — the
   signal to throttle that account's *publisher* (the real fix), not to grow the cap forever.

## Costs this takes on (be explicit)

* **Drainer ownership** — AGW connections aren't "held" by any instance, so an ordered per-connection drainer
  needs a **Redis lease** (one drainer per connection) or a **connectionId-hash-partitioned** drain fleet —
  else two drainers race and reorder. This is the main new complexity vs. fire-and-forget push.
* **Memory** — per-account logs cost Redis RAM; the `MAXLEN`/byte/TTL cap bounds it (the price of lossless
  burst handling).

> **Redis Streams, not SQS.** SQS can't do thousands of per-connection ordered streams drained at *variable*
> rates: no per-socket queues, FIFO-group throughput caps + visibility-timeout mechanics fight client pacing,
> and the receive/delete churn adds latency. Streams give an ordered, ranged-readable, trimmable log with
> independent cursors — exactly this shape. SQS stays the **ingress** work buffer.

> Reuse note: factor the WorkQueue Lua token-bucket into a shared **`rate.take(key, perSecond, burst)`** helper
> (`@repo/services`, over `Cache`). One primitive, both directions — SQS ingress (defer-and-redeliver) and
> socket egress (buffer-and-pace, shed-and-resync only at the cap).

# Scaling & ops

* **Kafka consumer group**, scaled on lag; partition count bounds parallelism. Per-entity ordering holds
  because routing is keyed by entity id upstream.
* **Connection-registry reads** are hot — query by `accountId` (the registry's access pattern); see the
  WebSocket section of [aws/SPECS.md](../../../packages/services/src/aws/SPECS.md) for the table design.
* **API Gateway limits to design around:** ~10 min idle / 2 h max connection / 128 KB frame. Keep frames
  small (pointer-not-payload), expect reconnects, prune aggressively on 410.
* **Failure isolation:** a bad single connection (410 / throttle) must not stall the batch — push per
  connection, prune/skip on error, continue.

# Service & Job topology

**Convention (platform-wide).** The platform has three execution shapes under `Application` (see
[`@repo/services` → Class hierarchy](../../../packages/services/README.md)): **`Daemon`** (the long-running base —
signals + graceful drain) → **`Service`** (request-driven, HTTP) + **`Consumer`** (self-driven, consumes the
backbone in a run-loop); and **`Job`** (one-shot). **Realtime is the *motivating case* for `Consumer`:** its core
is **two `Consumer`s** (a continuous *consume → outbox → drain* loop), fronted by a **thin `Service`**. The
connection lifecycle is a **paired WebSocket API stack** realtime only **reads** from. Realtime-specific shared
code — **push-set filter** (AppConfig), **outbox** model (Redis Streams), **registry read**, **`Access` authz**,
**token-bucket pacing**, **presence** — lives in shared modules + a `RealtimeConsumer` domain base.

```
Application
├── Daemon (abstract — long-running: signals · graceful drain · run-forever)
│     ├── Service
│     │     └── RealtimeApiService      (thin /realtime/* REST: presence reads · internal connection lookup · config (push set) · health)
│     └── Consumer
│           └── RealtimeConsumer        (domain base — outbox (Redis Streams) · registry read · Access authz · token-bucket pacing; not deployed alone)
│                 ├── RealtimeIngestConsumer  (Phase A — Kafka consumer group, scaled on lag: filter push-set · resolve account · append outbox IFF ≥1 live connection)
│                 └── RealtimeDrainer          (Phase B — leased per-connection: read outbox @ cursor · authorize PER ENTRY (Access.isAllowed, re-checked) · pace + shape (>128 KB → S3 pointer) · WebSocketApi.post · prune on 410)
└── (no Job — realtime has no one-shot work)
   shared modules: push-set filter (AppConfig) · presence  ·  paired infra: WebSocket API stack (below)
```

**Service (HTTP, ECS Fargate)**

| Class | Extends | Role |
|---|---|---|
| **`RealtimeApiService`** | `Service` | The **thin `/realtime/*` REST** — **presence** reads, internal connection lookup (S2S), **config** (the push-set AppConfig profile), health. (Push is the socket, not REST; the socket is **receive-only**.) |

**Consumers (`Consumer` — long-running, self-driven; ECS/Fargate)** — the pipeline's two phases, scaled independently:

| Class | Extends | Shape | Role | Req |
|---|---|---|---|---|
| **`RealtimeConsumer`** | `Consumer` | domain base | outbox · registry read · `Access` authz · token-bucket pacing; **not deployed alone** | — |
| **`RealtimeIngestConsumer`** | `RealtimeConsumer` | **Kafka consumer group** (scaled on lag) | **Phase A** — filter to the **push set**, resolve `accountId` + `minAccess`, **append to the per-account outbox** (`XADD`) **iff ≥1 live connection** (one append regardless of connection count) | realtime-1.0 |
| **`RealtimeDrainer`** | `RealtimeConsumer` | **leased per-connection fleet** | **Phase B** — read each connection's outbox at its cursor, **authorize per entry** (`Access.isAllowed`, re-checked — grants change mid-connection), **pace** (token bucket) + **shape** (>128 KB → S3 pointer), `WebSocketApi.post`, advance cursor; **prune on `410`** | realtime-2.0 / 6.0 |

> **Why `Consumer`s, not `Job`s.** Both phases run **continuously**. **Phase A** reads the *whole* Kafka firehose
> to forward a *small filtered subset* — paying a Lambda invocation per event to **drop ~95%** is the wrong cost
> shape, and a **consumer group** gives offset control + **self-paced backpressure** (pause/resume partitions on
> outbox pressure) + hot Redis/registry connections. **Phase B** drains a **live socket at its own pace** over
> minutes (leases · token bucket · idle/410 management) — there is **no Lambda model** for a paced, long-lived
> per-connection drain. **Rule:** *`Job` when work is discrete/spiky and you act on most events; **`Consumer`**
> when you consume a high-volume firehose to forward a subset, or hold a live connection.*

> **Paired WebSocket API stack (not a realtime role).** `$connect` (single-use **ticket auth**), `$disconnect`,
> and the **connection-registry writes** + **presence on/off** live in the **WebSocket API stack**; realtime
> **reads** the registry (ingest checks "≥1 connection", the drainer leases connections). **`$disconnect` is
> what drives presence-off** — and is the signal [texting](../texting/SPECS.md)'s P2P **contact-lock
> auto-release** keys off (`texting-21.2.2`). Realtime is **push-only** — no HTTP push-intake, the socket is
> **receive-only**; durable writes always go through each owning service's REST.

# AWS Services and Other Dependencies

**AWS services**
* **API Gateway (WebSocket)** — the egress transport (`WebSocketApi.post` via the Management API); the `$connect`/`$disconnect` + registry **writes** live with this stack (we **read**).
* **Kafka (MSK)** — consume the curated push-set subset (`subscribeEvents`).
* **DynamoDB** — the connection registry (read path, by `accountId`).
* **Redis (ElastiCache)** — the per-account **outbox (Redis Streams)** + per-connection cursors + the shared **`rate.take`** token bucket + drainer **leases**.
* **S3** — `presignGet` pointers for frames over the **128 KB** AGW limit.

**Third-party libraries / services** — none.

**Internal (`@repo/*`)**
* `@repo/services` (`Kafka`, `WebSocketApi`, `Dynamo`, `S3.presignGet`, `Cache` / `rate.take`), `@repo/common` (`Type.MessageEnvelope` incl. **`minAccess`**, `Result`), `@repo/endpoint` (`Access` — `isAllowed` / role ladder).
* Pairs with the **WebSocket API stack** (`$connect` auth + registry writes) and the browser [`WebsocketService`](../web/src/model/service/WebsocketService.ts) → `PubSubService`. Presence is access-gated by [auth](../auth/specs/SPECS.md); **does not** do mobile push (APNS/FCM) or collab CRDT.

# Compliance & standards mapping

How **this realtime service's** controls map to **OWASP Top 10 (2021)**, **ISO/IEC 27001:2022** (Annex A),
**SOC 2 Type 2** (TSC), **HIPAA** (if PHI), **GDPR**, and **CCPA/CPRA**. Realtime is **push-only egress**
(Kafka → browser); its dominant control is **server-side, per-push authorization** — the socket grants **no**
visibility REST wouldn't, and nothing the client sends widens what it receives. There is **no PCI** and **no
messaging-law** surface. **HIPAA** is ➖ (envelopes carry no PHI by [AUP](../account/specs/SPECS.md); a >128 KB
payload becomes an access-controlled S3 pointer). Identity/RBAC live in [auth](../auth/specs/SPECS.md);
residency is the platform [AWS topology](../../../packages/services/src/aws/SPECS.md) (single-region first).

**Legend:** ✅ meets/exceeds · ⚠️ partial / open — see Gaps · ➖ n/a

| Realtime control | OWASP T10 | ISO 27001:2022 | SOC 2 (TSC) | HIPAA (if PHI) | GDPR | CCPA | |
|---|---|---|---|---|---|---|---|
| **Server-side authorization on every push** — role + account grant; client cannot widen visibility | A01 | A.5.15 / A.8.3 | CC6.1 / CC6.3 | §164.312(a)(1) | Art 32 | ➖ | ✅ |
| **Account isolation** — A's event never reaches B's connection (a requested `accountId` is not permission) | A01 | A.8.3 | CC6.1 | §164.312(a)(1) | Art 32 | §1798.100 | ✅ |
| **`minAccess` fail-closed** — a pushable event missing `minAccess` is dropped + logged | A04 | A.8.27 / A.8.28 | CC6.1 | ➖ | Art 32 | ➖ | ✅ |
| **Re-checked per push** — roles/grants re-evaluated each event (mid-connection revocation) | A01 / A07 | A.5.18 | CC6.2 / CC6.3 | §164.312(a)(2)(iii) | Art 32 | ➖ | ✅ |
| **Data minimization** — client gets only what its role sees via REST; role gates the **whole** event (no extra fields) | A01 | A.5.34 / A.8.3 | (Privacy) | §164.502(b) | Art 5(1)(c) / 25 | §1798.100 | ✅ |
| **Oversized frames → S3 pointer** — >128 KB sends a **time-limited presigned** pointer, not the bytes | A01 / A02 | A.8.20 | CC6.6 | ➖ | Art 32 | ➖ | ✅ |
| **Egress fair-share / rate limiting** — per-connection + per-account token buckets; shed-only-at-cap | A04 | A.8.6 | CC6.6 / A1.2 | ➖ | ➖ | ➖ | ✅ |
| **Encryption** — in transit (WSS / TLS) + at rest (Redis / DDB / S3 SSE-KMS) | A02 | A.8.24 | CC6.1 | §164.312(e) | Art 32 | ➖ | ✅ |
| **Presence access-gated** — account-scoped + role-gated (auth); never cross-account | A01 | A.8.3 | CC6.1 | ➖ | Art 32 | ➖ | ✅ |
| **No PHI** by AUP — envelopes are minimal, no PHI | ➖ | A.5.34 | (Privacy) | §164.502 (AUP) | Art 9 | ➖ | ✅ |

# Gaps & open decisions

*The one review list.* ✅ = resolved/decided · ⚠️ = **open — needs attention**.

1. ✅ **Activation — DECIDED: server-decided (NOT client-registered).** Services emit the events meaningful to
   the web app; **activating one** = adding its `type` to the **push-set config** **and** the **web app shipping
   a handler** to consume it (the [`WebsocketService`](../web/src/model/service/WebsocketService.ts) →
   `PubSubService` re-publishes the envelope; a view subscribes to the `type`). The event just needs `accountId`
   + `minAccess`. Because the web app needs a code change to consume a new type **anyway**, the two ship
   **together** — so a **re-deploy is fine**; hot-config-without-deploy is a nicety, not a requirement. A client
   narrowing the set to its open views is a **far-future perf optimization**, **not planned** (`realtime-3.4`).
2. ✅ **Cross-region — NOT A CONCERN (single-region, multi-AZ per market).** Each environment/market is **one
   AWS account in one region, multi-AZ** — HA is automatic (API Gateway is regional/AZ-spanning; DynamoDB, MSK,
   ElastiCache are multi-AZ with failover). Connections, registry, outbox + presence all live in that one
   region, so the WebSocket regional-ownership issue (you can only `PostToConnection` from the owning region)
   **never arises** — it would only bite with *two regions in one market*, which we don't run. Residency is
   handled by the **separate per-market accounts** (no cross-region flow). The only residual is **full-region
   DR**, a **platform-topology** decision (not realtime's) — and realtime recovers trivially (**reconnect +
   REST resync**; the socket isn't the source of truth). See the [AWS topology](../../../packages/services/src/aws/SPECS.md).
3. ✅ **Push-set source — DECIDED: AppConfig** (like every other service's config). Hot-change without a deploy
   is supported but **not required** — since activating a new event is paired with a **web-app deploy** to
   consume it (gap #1), a **re-deploy of the push-set is perfectly fine** (`realtime-3.3`).
4. ✅ **`minAccess` on events — DECIDED.** The publishing service stamps the object's required `Access.Role` on
   each pushable event; this service enforces it **generically** (object-agnostic). Adds a `minAccess?` field to
   the shared envelope ([`@repo/common`](../../../packages/common/src/SPECS.md)).
5. ✅ **Presence ("who's online") — DECIDED: owned here.** The connection registry this service reads **is** the
   source of truth, so **account-wide presence is a read/aggregate over it** (≥1 live connection = online),
   surfaced as a presence read + presence-change events. **Access-gated by [auth](../auth/specs/SPECS.md)**
   (account-scoped + role-gated; never cross-account — auth provides the *gate*, not the data). Unlocks
   **internal user-to-user messaging** (later). *(Room-scoped awareness — who's in a specific doc — is
   [collab](../collab/SPECS.md).)*

# Requirements (traceable register)

The traceable requirement register for the **realtime service** (the narrative sections above are the
rationale; this is the coded list). IDs are stable handles (**`realtime-N.M`**) — cite them in code, tickets,
and tests. **Priority:** **A** = MVP, **B** = core / hardening, **C** = later. One level of sub-requirements; a
group's priority is its floor. **Boundaries:** realtime owns **Kafka→browser push egress** — the registry
**read** path, the push set, the per-account outbox + paced drain, per-push authorization, presence; the
**WebSocket API stack** owns `$connect`/`$disconnect` + registry **writes**; **mobile push** + **collab CRDT**
are separate; durable client writes go through **REST**.

## realtime-1.0 Ingest (Phase A) — A
- **realtime-1.1** Consume the **push-set subset** of Kafka events (`subscribeEvents`) — A
- **realtime-1.2** **Filter** to push-set object-change `type`s; drop everything else immediately — A
- **realtime-1.3** **Resolve `accountId` + `minAccess`**; missing either ⇒ **drop + log** — A
- **realtime-1.4** **Append to the per-account outbox** (`XADD rt:{acct:<id>}:out`) **iff ≥1 live connection** (one append per event) — A

## realtime-2.0 Drain & delivery (Phase B) — A
- **realtime-2.1** Per-connection **cursor** reads the account log **in order** from its offset — A
- **realtime-2.2** **Authorize per entry** — `Access.isAllowed(role, minAccess)` **and** the grant covers `accountId`; **re-checked every entry** — A
- **realtime-2.3** **Pace** via the bytes + msgs/sec **token bucket** before posting — A
- **realtime-2.4** Frames **>128 KB** → an `S3.presignGet` **pointer**, not the bytes — A
- **realtime-2.5** `WebSocketApi.post` → advance cursor; **410** prune, **429** back off, fell-off-log → `resync` — A

## realtime-3.0 Push set (contract) — A
- **realtime-3.1** Eligible **object-change** types only; adding a `type` is a **reviewed** change — A
- **realtime-3.2** **Exclude** internal / audit / billing / **service-config** / high-frequency M2M chatter — A
- **realtime-3.3** **Push set is AppConfig-driven** — activate by adding the `type` to the AppConfig profile (a redeploy is fine); event carries `accountId` + `minAccess`; **the web app must ship a handler to consume it** *(gaps #1 / #3)* — A
- **realtime-3.4** **Not client-registered** — the server (config + publishers) decides what's meaningful; client-side narrowing is a far-future perf optimization, not planned *(gap #1)* — C

## realtime-4.0 Authorization — A
- **realtime-4.1** **Server-side, every push** — the client cannot widen what it receives (requested `accountId` is a request, not a grant) — A
- **realtime-4.2** Publisher stamps **`minAccess`**; this service enforces **generically** (no per-object rules here) *(gap #4)* — A
- **realtime-4.3** **Fail-closed** on missing `minAccess`; **role gates the whole event** (no field redaction) — A
- **realtime-4.4** **Account isolation** — never deliver A's event to a B-only connection — A

## realtime-5.0 Delivery semantics — A
- **realtime-5.1** **Lossless under bursts** (durable ordered outbox); **at-most-once only at the edges** (offline → REST resync; fell-off-cap → resync) — A
- **realtime-5.2** **Per-entity ordering** (Kafka partition key → append order); `seq` lets a client drop a stale frame — A
- **realtime-5.3** **Idempotency / dedup** via envelope `id` (brief dual connections on reconnect) — A
- **realtime-5.4** **No per-object debounce**; chatty event *types* throttle at the **publisher** (emit every Ns / N%) — B

## realtime-6.0 Throughput & flow control — A
- **realtime-6.1** Per-account **outbox** (Redis Streams) + per-connection cursors; **bounded** (`MAXLEN` / bytes / TTL) — A
- **realtime-6.2** **Paced drain** (`rate.take`) — **two stacked buckets** (per-connection + per-account; protects the AGW account throttle) — A
- **realtime-6.3** Pace by **AGW backpressure** (no client ACK — keeps receive-only); **optional** ACK+timestamp upgrade (backlog/goodput + RTT trend) — B
- **realtime-6.4** **Overflow** — absorb → **shed low-value first** → fell-off → one `resync` frame + **saturation metric** (throttle the publisher) — A
- **realtime-6.5** **Drainer ownership** — a **Redis lease** (one drainer / connection) or connectionId-hash partition (no reorder) — A

## realtime-7.0 Presence — A
- **realtime-7.1** **Account-wide presence** = read/aggregate over the connection registry (≥1 live = online) *(gap #5)* — A
- **realtime-7.2** Presence **read** + **presence-change** events — A
- **realtime-7.3** **Access-gated by [auth](../auth/specs/SPECS.md)** — account-scoped + role-gated; never cross-account — A
- **realtime-7.4** Unlocks **internal user-to-user messaging** (route a DM to a live socket) — C

## realtime-8.0 Scaling & ops — A
- **realtime-8.1** **Kafka consumer group** scaled on lag; partition count bounds parallelism (per-entity order holds) — A
- **realtime-8.2** **Connection-registry reads** by `accountId` (hot path) — A
- **realtime-8.3** Design around **AGW limits** — ~10 min idle / 2 h max / 128 KB frame; small frames, expect reconnects, prune on 410 — A
- **realtime-8.4** **Failure isolation** — push per connection; a bad connection (410 / throttle) never stalls the batch — A

## realtime-9.0 Boundaries & infra — A
- **realtime-9.1** **Reader** of the registry; `$connect`/`$disconnect` + registry **writes** owned by the WebSocket API stack — A
- **realtime-9.2** **Not** mobile push (APNS/FCM); **not** collab CRDT; durable client writes via **REST**, never a socket — A
- **realtime-9.3** Infra — **API GW WebSocket** · **Kafka** · **DynamoDB** (registry) · **Redis** (outbox / cursors / `rate.take` / leases) · **S3** (pointers) — A

## realtime-10.0 Service & Consumer topology — B
- **realtime-10.1** **Bases** — `RealtimeApiService extends Service`; the consumers extend a `RealtimeConsumer extends Consumer` domain base (outbox · registry read · `Access` authz · token-bucket pacing); push-set filter + presence are shared modules — B
- **realtime-10.2** **`RealtimeApiService`** — the thin `/realtime/*` REST (presence reads · internal connection lookup · config · health) — A
- **realtime-10.3** **Core = two `Consumer`s (long-running, self-driven), not `Job`s** — **`RealtimeIngestConsumer`** (Phase A, Kafka consumer group, scaled on lag) + **`RealtimeDrainer`** (Phase B, leased per-connection, paced). Realtime is the **motivating case** for the platform `Consumer` base — A
- **realtime-10.4** **Connection lifecycle is the paired WebSocket API stack** — `$connect` (ticket auth) / `$disconnect` / registry writes + presence on/off; realtime **reads** the registry, doesn't own the writes (`realtime-9.1`) — A
- **realtime-10.5** **`$disconnect` drives presence-off** — the signal [texting](../texting/SPECS.md)'s P2P contact-lock **auto-release** keys off (`texting-21.2.2`) — A

# Endpoints (first cut)

Realtime is **push-only**, so its surface is thin: the **WebSocket** (egress) + a small **presence** read API.
Service-prefixed **`/realtime/*`** for REST.

> **Ingestion is not HTTP, and the socket is receive-only.** Events arrive on **Kafka** (`subscribeEvents`) —
> there is **no HTTP push-intake** route. The client WebSocket is **receive-only** (client *actions* go through
> the REST API of the owning service); realtime never processes inbound action frames. Durable writes always go
> through **REST**, never a socket.

**Access column:** **`minAccess`** on the `Access` ladder — **`-`** = public · account ladder
**`SENDER`<`USER`<`BILLING`<`ACCOUNT`** · staff ladder **`SUPPORT`<`APPLICATION`<`ROOT`** · **`Internal`** =
VPC-only S2S.

### WebSocket — the egress socket (realtime-2)
| Protocol | URI | Purpose | Access | Req |
|---|---|---|---|---|
| WSS · Upgrade | `wss://…/realtime?accountId={accountId}` | Open the receive-only push socket. **`$connect` auth + registry writes are owned by the WebSocket API stack**; realtime is the **reader / pusher** | USER | realtime-9.1 |

#### WS frames ("the lines" over the socket)
`S→C` = server→client · `C→S` = client→server.

| Dir | Frame | Payload | Purpose | Req |
|---|---|---|---|---|
| S→C | `event` | `Type.MessageEnvelope` (role-gated) | A pushed object-change / presence-change event (full payload, or an S3 pointer if >128 KB) | realtime-2.5 |
| S→C | `resync` | `{ type:"resync", scope }` | Recovery nudge — fell off the capped log / reconnect → re-sync via **REST** | realtime-6.4 |
| C→S | `ack` *(optional)* | `{ ack: seq, t }` | **Flow-control signaling only** (backlog/goodput + RTT trend) — not an action; opt-in upgrade | realtime-6.3 |

### Presence (REST reads — push-change over the socket) (realtime-7)
| Method | URI | Purpose | Access | Req |
|---|---|---|---|---|
| GET | `/realtime/presence` | Who's online in the account (role-gated; account-scoped, never cross-account) | USER | realtime-7.1/7.3 |
| GET | `/realtime/presence/{userId}` | Whether a specific user is online (≥1 live connection) | USER | realtime-7.1 |

### Internal / S2S & ops
| Method | URI | Purpose | Access | Req |
|---|---|---|---|---|
| GET | `/realtime/internal/connections` | S2S — live connection / presence lookup by `accountId` | Internal | realtime-8.2 |
| GET, PUT | `/realtime/config` | Read / set runtime config (the **push set** is an AppConfig profile) | ROOT | realtime-3.3 |
| GET | `/realtime/health` | Liveness / readiness (consumer lag + drainer fleet) | - | realtime-8.1 |

# eof
