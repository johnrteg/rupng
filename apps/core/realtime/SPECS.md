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
  `Type.MessageEnvelope` (see [root SPECS → Events & messaging](../../../SPECS.md)).
* **Out:** the **same envelope** posted to 0..N open WebSocket connections via API Gateway
  (`WebSocketApi.post`). The client re-publishes it whole on its pub/sub bus.
* **Owns:** the read path of the connection registry, the push set, the **per-account outbox log** + the
  **per-connection drainers/cursors** that pace delivery, per-entry **access-role authorization**, egress
  fair-share, and stale-connection pruning. (No field-level redaction — see below.)
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
   Kafka event". *(TBD: the client may further narrow this by **registering** the object types/ids it
   cares about, so we only push what an open view actually needs.)*
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
high-frequency machine-to-machine chatter. Adding a `type` to the push set is a reviewed change.

**Client-registered interest (TBD).** Beyond this server-side eligibility set, a client may *register*
the object types (and possibly specific ids) its open views need, so we push only what's actually on
screen. Shape of that registration (over the socket vs REST, granularity) is undecided — see Open items.

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

# Open items (backlog)

* **Client-registered interest** — whether/how a client narrows the push set to the objects its open views
  need (register over the socket vs REST; type-level vs id-level granularity; how it's revoked on view close).
* **Cross-region** *(open)* — single-region first; multi-region connection affinity is a later concern.
* **Push-set source** — static config vs AppConfig profile (so the eligible set can change without a deploy).

**Decided (no longer open):**

* **`minAccess` on events** — the publishing service stamps the object's required `Access.Role` on each
  pushable event; this service enforces it generically (see Authorization). Adds a `minAccess?` field to the
  shared envelope ([`@repo/common`](../../../packages/common/src/SPECS.md)).
* **Presence ("who's online") — yes, owned by [auth](../auth/SPECS.md).** The connection registry already
  knows who's connected; auth surfaces that as presence. Presence in turn unlocks **internal user-to-user
  messaging** (a later capability) — once we know a user is online we can route a direct message to their
  socket. This service is the push path; auth owns presence state + the messaging policy.

# Dependencies

* `@repo/services` — `Kafka` (`subscribeEvents`), `WebSocketApi` (`post` / `disconnect`), the connection
  registry table (`Dynamo`), `S3.presignGet` (large-payload pointers), `Cache` for the **per-account outbox
  (Redis Streams)** + per-connection cursors + the shared **`rate.take`** token-bucket (egress fair-share).
* `@repo/common` — `Type.MessageEnvelope` (the body, incl. `minAccess`), `Result`.
* `@repo/endpoint` — `Access` (`isAllowed` / role ladder) for the per-event role gate.
* Pairs with the **WebSocket API stack** ($connect auth + registry writes) and the client
  [`WebsocketService`](../web/src/model/service/WebsocketService.ts) → `PubSubService` on the browser end.

# eof
