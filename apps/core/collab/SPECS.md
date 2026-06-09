#
# Collaboration service
#

# Objective

The home for **bidirectional, low-latency, presence-aware "live sessions" (rooms)** — where several users
interact on **shared state** in real time. Where the [realtime service](../realtime/SPECS.md) does one-way
server → client *push* of domain events on a **receive-only** socket, this service runs **full-duplex rooms**
backed by **stateful** servers. It is the one place a client genuinely *sends* over a socket.

First-class cases (v1):

* **Intra-texting** — live internal user-to-user / team conversations: presence, typing, instant delivery.
  *Distinct from the [`texting`](../texting/SPECS.md) service* (external **SMS / 10DLC to contacts**) —
  intra-texting is **in-app chat between platform users** (staff, agency, account teammates).
* **Collaborative document editing (tiptap / Y.js)** — multiple editors on one rich-text doc (email
  templates, scripts), **CRDT-merged**, with live cursors/selections.

Designed to extend to: **whiteboarding** (shared canvas), co-presence on dashboards, co-browsing — anything
that's a *shared room with live state*. New room types plug into the same session/presence/persistence
substrate.

# Why a separate service (not the notification socket)

| | **Realtime** (notification) | **Collab** (this service) |
|---|---|---|
| Direction | **Receive-only** push (server → client) | **Full-duplex** (client ↔ server) |
| Payload | `Type.MessageEnvelope` JSON events | **Y.js CRDT** binary updates + awareness; small JSON for chat/presence |
| Conflict model | n/a (last-write-wins snapshots) | **CRDT merge** (concurrent edits converge) |
| Topology | per-**account** fan-out | per-**room** (doc/conversation/board) with **affinity** |
| State | **stateless**, any instance can push | **stateful** — live room (`Y.Doc`/conversation) held in memory |
| Infra | AGW WebSocket + Lambda | **ECS Fargate** (stateful) behind a WS-capable LB |

Forcing rooms onto the stateless notification socket (AGW + Lambda) means no room affinity and no in-memory
doc — you'd reinvent a collab server on Lambda. Different protocol, different durability, different scaling →
different service. A user may hold **both** sockets at once (notification for app events, collab for an open
room).

# The boundary that keeps "`send()` never replaces REST"

The receive-only rule on the notification socket exists because **AGW is stateless fire-and-forget** — it
can't authorize/persist a write well. **This service is different: a stateful, room-aware backend that
authorizes per-room and persists.** So duplex writes here are legitimate — *because there's a real server
behind them*, not a dumb socket.

It still doesn't replace REST:

* **Canonical CRUD / history / initial load → REST.** Open a doc or conversation = REST loads the current
  state; the collab socket then carries the **live session** on top of it.
* **System of record.** The collab backend **persists** session artifacts (CRDT snapshots + update log; chat
  messages) and they remain retrievable via **REST** — the live stream is reconciled to durable storage, not
  a parallel truth.

So the live socket **augments** REST; durable state is always reachable (and auditable) through the REST path.

# Architecture (high level)

* **Stateful room servers on ECS Fargate** — hold live room state in memory (`Y.Doc` per document /
  conversation buffer per chat), behind a **WebSocket-capable ALB/NLB**. **Not** AGW + Lambda (no affinity,
  no in-memory doc).
* **Room affinity + routing** — a room is **pinned to a server** (or sharded by `roomId`); a **Redis room
  registry** maps `roomId → server`, with **Redis pub/sub** for cross-node fan-out / presence when a room's
  members land on different instances. Graceful room hand-off on scale-in.
* **Protocols** — **Y.js (CRDT)** binary updates + **awareness** (cursors/selection/typing) for docs &
  whiteboard; a thin **JSON message protocol** for chat + presence. Binary frames for CRDT to stay compact.
* **Presence / awareness — per room** (who's *in this doc/conversation*, cursors, typing). Distinct from
  **auth's *global* presence** (is the user online at all, from the connection registry — see
  [auth → Presence](../auth/SPECS.md)). Collab reports room-scoped awareness; auth owns account-wide online state.
* **Persistence** — CRDT **snapshots + update log** to **S3 / DB** (debounced snapshotting so a reconnecting
  client loads fast); chat to the messaging **system of record**. Survives server restart / room migration.
* **Auth — per room.** Connect/room-join authorizes via **Cognito JWT + room membership + `Access` role**
  ([`Access`](../../../packages/endpoint/src/Access.ts)); re-checked on join; rooms are **account-scoped**
  (never cross-account). A revoked grant evicts the connection.
* **Scaling** — shard rooms across the fleet, autoscale on room/connection count, Redis for registry +
  presence + pub/sub.

# Make vs buy

* **Buy / managed** — **Tiptap Cloud**, **Liveblocks**, **PartyKit**, **Ably/Pusher** (presence/pub-sub),
  **Convex**.
  * **Pros:** fastest to ship; scaling, presence, persistence, conflict-resolution handled for you.
  * **Cons (decisive for us):** **data leaves our infra** — a hard problem for **SOC 2 Type 2 / GDPR** (data
    residency, BYOK encryption, the platform's compliance-first tenet); plus per-seat/usage cost at scale and
    **vendor lock-in**.
* **Build / self-host** — **Hocuspocus** (tiptap's open-source **Y.js** backend) for CRDT, + a thin
  chat/presence layer on the same room infra, on **Fargate + Redis**, persisting to **our S3/DB**.
  * **Pros:** **data stays in our infra** (compliance), unified **Cognito/`Access`** auth, full control.
  * **Cons:** we own scaling, presence, persistence, ops.
* **Recommendation — self-host, lean on Hocuspocus.** Use **Hocuspocus** for CRDT (docs first, whiteboard
  later — Y.js handles both); run **intra-texting** on the **same room/presence substrate** with a light
  message protocol. Keep data in-infra for compliance; reuse platform auth. **Start with tiptap** (Hocuspocus
  is turnkey for Y.js), then add chat rooms. Revisit a managed backend only if ops cost dominates — and only
  one that can satisfy our data-residency/BYOK requirements.

# Relationship to other services

* **[realtime](../realtime/SPECS.md)** — one-way push of domain events; this is duplex live sessions. Separate
  sockets, often held simultaneously.
* **[auth](../auth/SPECS.md)** — owns identity, per-room authorization input, and **global** presence; collab
  owns **per-room** awareness.
* **[texting](../texting/SPECS.md)** — external SMS to contacts; **unrelated** to intra-texting (in-app user
  chat), despite the name.
* **[web](../web/SPECS.md)** — the browser uses the **Y.js provider** as a **separate client** from
  `WebsocketService`; tiptap binds to it.

# Security & compliance

* **Per-room authorization**, account isolation (no cross-account rooms), grant re-check on join + eviction
  on revoke.
* **Data in our infra** (the reason to self-host) — encryption at rest, BYOK where applicable, audit of
  room access. No PII leaves to a third party.
* **Abuse/rate limits per room** (message/edit floods) — reuse the shared `rate.take` token-bucket pattern.

# Open items (backlog)

* **Build-vs-buy final call** — confirmed *leaning self-host (Hocuspocus + Fargate)* for compliance; revisit
  if ops cost dominates.
* **Infra confirm** — **Fargate + ALB** (stateful), not AGW; pin-vs-shard room placement + migration strategy.
* **Chat transport** — live conversations over a collab room vs simple async chat over REST-send +
  notification-push (the [realtime](../realtime/SPECS.md) path). Likely **both**: async messaging = REST+push;
  *live, presence-rich* conversation = a collab room.
* **Presence scope split** with auth (global online vs per-room awareness) — finalize the ownership line.
* **Offline / reconnect** — CRDT reconciliation after a client edits offline; snapshot + update-log replay.
* **Whiteboard data model** (Y.js shared types for a canvas) — when that case lands.
* **Mobile / e2e encryption** — later.

# Dependencies

* `@repo/services` — `Cache` (Redis: room registry, presence, pub/sub, `rate.take`), `S3` + `Dynamo`
  (CRDT snapshots / update log / chat persistence), `Cognito` (connect auth).
* `@repo/endpoint` — `Access` (per-room role checks).
* `@repo/common` — `Type` (shared types), `Result`.
* **Y.js** + **Hocuspocus** (self-hosted CRDT backend); the browser **Y.js provider** on the web side.

# eof
