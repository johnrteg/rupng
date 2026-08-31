#
# Collaboration service
#

> **STATUS (2026-08-30): chat v1 is BUILT** — `apps/core/collab` is a working service, not spec-only. Built:
> `CollabControlService` (stateless REST — room/DM CRUD, membership, message history, config) +
> `CollabRoomServer` (the stateful WebSocket room server — chat + presence, JSON-only frames), backed by
> DynamoDB (`collab_rooms`/`collab_members`/`collab_messages`, per-item message TTL) + Redis (room registry,
> presence, cross-node pub/sub), plus a real public/sticky-session ALB in CDK (`ServiceStack.makeEcsService`'s
> new `loadBalancer.public`/`stickySessions` branch — the platform's FIRST public-facing ALB). Web UI:
> `ChatPanel`/`ChatRoomList`/`ChatThread` + `useActivityStatus` (idle/active detection) +
> `CollabSocketService`.
> ✅ **JWT signature verification — CLOSED (2026-08-30).** The room server's WS-connect boundary now verifies
> Cognito JWTs for REAL via `aws-jwt-verify`'s `CognitoJwtVerifier` (signature against the pool's JWKS, cached
> after first fetch, plus issuer + expiry) — it no longer just decodes the payload. The pool id reaches this
> service as `USERPOOL_USERS`, via a NEW platform-wide CDK primitive: `cloud/src/lib/ServiceStack.ts`'s
> `UserPoolRegistry` (mirrors the existing `AlbRegistry`/`GatewayRegistry` cross-stack pattern) + a `uses:
> [{ kind: ResourceKind.USER_POOL }]` manifest reference — the first consumer of a mechanism any future
> directly-reached service can reuse. Fails CLOSED (refuses the connection, logs a warning/error) if the pool
> id is missing or verification fails for any reason — never falls back to trusting an unverified token.
> **Remaining, smaller gaps**: `tokenUse`/`clientId` claims are NOT asserted (passed `null` — the web app's
> session token's exact Cognito token type/client isn't threaded through yet; signature/issuer/expiry are
> still fully checked regardless); the raw JWT still travels as a WS query param, which ALB access logs
> capture in plaintext (a separate hardening item — short-lived single-use "connect tickets" minted via the
> already-Gateway-protected REST API would close this; not yet built).
> **NOT built** (see the Gaps list below for the authoritative, itemized version): Y.js/Hocuspocus CRDT
> document co-editing + whiteboard (collab-2.0, collab-1.5) — this is CHAT ONLY; per-room KMS envelope
> encryption (collab-8.7); the GDPR erasure job + `/collab/internal/erase` hook (collab-8.4/8.5/8.8); per-room
> rate-limiting (collab-8.1); hashed audit events (collab-8.3); ownership transfer endpoint (collab-7.6 —
> creator stays owner permanently in v1); graceful room hand-off / snapshot rehydrate (collab-5.4, moot
> without a CRDT doc to lose); a lower-privilege "list my account's teammates" read for the New-DM picker (it
> currently reuses `GetMembers`, which is ACCOUNT-admin-gated).

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
  **global presence** (is the user online at all, from the connection registry — see
  [realtime → Presence](../realtime/SPECS.md)). Collab reports room-scoped awareness; **realtime** owns
  account-wide online state.
* **Persistence — split by artifact.** **Documents** (CRDT) are the **durable system of record**: **snapshots +
  update log** to **S3 / DB** (debounced snapshotting so a reconnecting client loads fast), surviving restart /
  migration. **Chat rooms live in DynamoDB** — the **room record** (name, members, type, owning account) is
  **durable**, while **messages carry an account-configurable per-item TTL** (DynamoDB **auto-expires** them;
  durable retention = a longer / disabled TTL). **Redis is live coordination only** (room registry, presence,
  pub/sub, rate-limit), **not** message storage. Short chat TTL also **shrinks the GDPR erasure surface** (most
  free-text PII simply expires).
* **Auth — per room.** Connect/room-join authorizes via **Cognito JWT + room membership + `Access` role**
  ([`Access`](../../../packages/endpoint/src/Access.ts)); re-checked on join. Each room is **owned by exactly
  one account** (its isolation **and key** domain), but **membership is per-room** — the owning account's users
  **plus invited guests from outside the account** (e.g., **customer support**, an agency collaborator), each
  authorized per-room. A room never has **two *owning* accounts** (guest access doesn't change who owns/encrypts
  it). A revoked grant evicts the connection.
* **Room visibility + owner.** Each room is **`public`** (any user of the **owning account** may join, no
  invite — *account-scoped, not internet-public*) or **`private`** (**invite-only**; explicit membership, incl.
  outside guests). Each room also has a single **owner** (a *user*, the creator by default — distinct from the
  *owning account*) with **room-admin** rights: manage members/invites, set visibility, archive, and **transfer
  ownership**. The owner can **pass ownership** to another member **of the owning account** (never an outside
  guest; audited; exactly one owner at a time).
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

* **[realtime](../realtime/SPECS.md)** — one-way push of domain events (this is duplex live sessions —
  separate sockets, often held simultaneously); also owns **global** (account-wide) presence, while collab
  owns **per-room** awareness.
* **[auth](../auth/specs/SPECS.md)** — owns identity + per-room authorization input (the access gate).
* **[texting](../texting/SPECS.md)** — external SMS to contacts; **unrelated** to intra-texting (in-app user
  chat), despite the name.
* **[web](../web/SPECS.md)** — the browser uses the **Y.js provider** as a **separate client** from
  `WebsocketService`; tiptap binds to it.

# Security & compliance

* **Per-room authorization** + grant re-check on join + eviction on revoke. Each room is **owned by one
  account** (its isolation/key domain); **guests from outside the account can be invited** (e.g., customer
  support, an agency collaborator), authorized per-room — but a room never has two *owning* accounts.
* **Encryption — in transit (TLS/WSS) + at rest (SSE-KMS) under the per-environment platform CMK**
  (`cloud-5.4` — **per-env, not per-account**; see cloud gap #3). **Envelope encryption** — the CMK wraps a
  per-room **data key** (DEKs are byte-strings in our DB, **not** KMS keys, so **1000s of rooms ≠ 1000s of KMS
  keys**); the **server** unwraps for **any authorized member**, so an **invited guest from outside the account
  still reads** the room (the server decrypts on their behalf — there are **no per-user keys**). Data stays
  **in our infra** — nothing leaves to a third party; room access is **audited**. *(True per-account
  customer-held BYOK is **deferred** — revisit only if a contract requires a customer-revocable key, cloud
  gap #3.)*
* **Abuse/rate limits per room** (message/edit floods) — reuse the shared `rate.take` token-bucket pattern.

# Compliance & standards mapping

How **this collab service's** surfaces map to **OWASP Top 10 (2021)**, **ISO/IEC 27001:2022** (Annex A), **SOC 2
Type 2** (TSC), **HIPAA** (Security Rule, if PHI), **GDPR**, and **CCPA/CPRA**. Clause refs are **indicative**;
this is a **design-intent** self-assessment (certification is operating-effectiveness over time + an ISMS —
beyond a spec). Identity/RBAC live in [auth](../auth/specs/SPECS.md); the data-residency / no-cross-region
posture is the platform [AWS topology](../../../packages/services/src/aws/SPECS.md). There is **no PCI** surface
(collab touches no payment data) and **no messaging-law** surface (intra-texting is **in-app chat between
platform users**, not external SMS to contacts — that's [texting](../texting/SPECS.md)). **HIPAA applies only if
the platform handles PHI** (needs a BAA) — by [AUP no-PHI](../account/specs/SPECS.md) the platform prohibits
PHI, so HIPAA cells are ➖ except where room content *could* carry it for a healthcare customer.

**Legend:** ✅ meets/exceeds · ⚠️ partial — see Gaps · ➖ n/a

| Collab surface / control | OWASP T10 | ISO 27001:2022 | SOC 2 (TSC) | HIPAA (if PHI) | GDPR | CCPA | |
|---|---|---|---|---|---|---|---|
| **Per-room authorization** — Cognito JWT + room membership + `Access` role, re-checked on join | A01 | A.5.15 / A.8.3 | CC6.1 / CC6.3 | §164.312(a)(1) | Art 32 | ➖ | ✅ |
| **Room ownership & isolation** — each room owned by **one account** (key/isolation domain) + a per-room **owner** (user); **`public` is account-scoped, not internet-public**; guests invitable + authorized per-room; never two *owning* accounts | A01 | A.8.3 | CC6.1 | §164.312(a)(1) | Art 32 | ➖ | ✅ |
| **Grant revocation → connection eviction** — a revoked grant drops the live socket | A01 / A07 | A.5.18 / A.8.5 | CC6.2 / CC6.3 | §164.312(a)(2)(iii) | Art 32 | ➖ | ✅ |
| **Data stays in our infra** (the reason to self-host, not a managed backend) | A04 | A.5.34 / A.5.19 | CC6.x / Privacy | §164.308(b) (no BAA w/ 3p) | Art 44–49 / 28 | §1798.140 | ✅ exceeds |
| **Encryption — in transit (TLS/WSS) + at rest (SSE-KMS, per-env CMK)**; **envelope** (CMK wraps a per-room DEK; server unwraps for any authorized member — no per-room KMS keys) | A02 | A.8.24 / A.5.33 | CC6.1 | §164.312(a)(2)(iv) | Art 32 | ➖ | ✅ |
| **WS input validation** — binary CRDT frames + JSON chat/presence validated server-side | A03 | A.8.26 / A.8.28 | CC7.1 / CC8.1 | ➖ | Art 32 | ➖ | ✅ |
| **Durable system of record (documents)** — CRDT reconciled to S3/DB, retrievable + auditable via REST; **chat room in DynamoDB (record durable; messages on a per-item TTL, account-configurable)** | A08 | A.8.13 / A.8.15 | CC7.x | §164.312(c)(1) | Art 32 | ➖ | ✅ |
| **Audit of room access** — who joined / left which room, hashed `AuditEvent` | A09 | A.8.15 | CC7.2 | §164.312(b) | ➖ | ➖ | ✅ |
| **Per-room rate limits** — message/edit flood control via shared `rate.take` | A04 | A.8.6 / A.8.20 | CC6.6 / CC7.2 | ➖ | ➖ | ➖ | ✅ |
| **GDPR identity erasure** — anonymize a forgotten user's author/editor identity + presence everywhere | A01 | A.5.34 / A.8.10 | (Privacy) | §164.310(d)(2) | Art 17 | §1798.105 | ✅ shared auth/Application primitive |
| **GDPR content redaction** — structured `@`-refs purge deterministically; bare free-text PII obfuscated by the **forget job** (exact-match on the subject's known PII values; chat TTL self-heals chat) | A04 | A.5.34 / A.8.10 | (Privacy) | §164.310(d)(2) | Art 17 | §1798.105 | ✅ residual proportionality-bounded |
| **No PHI by design** — AUP prohibits PHI; room content holds none unless a customer misuses it | ➖ | A.5.34 | (Privacy) | §164.502 (AUP gate) | Art 9 | ➖ | ✅ AUP no-PHI |

# Gaps, issues & open decisions (the one review list)

*Open decisions are merged here — a single list to review.* ✅ = resolved/decided · ⚠️ = **open — needs attention**.

1. ✅ **Build-vs-buy — DECIDED: self-host** (**Hocuspocus + Fargate + Redis**). Data stays **in-infra** for
   **SOC 2 / GDPR** (residency, BYOK, the compliance-first tenet); reuse **Cognito/`Access`** auth. Revisit a
   managed backend (Tiptap Cloud / Liveblocks / PartyKit) **only if ops cost dominates** — and only one that can
   satisfy our data-residency / BYOK requirements.
2. ✅ **Infra placement & migration — DECIDED: pin each room to one server.** A stateful, in-memory `Y.Doc` /
   chat room has a **single authority**, so a room is **pinned to exactly one server** — *"shard by `roomId`"* is
   just the **assignment function** (consistent-hash via the **Redis `roomId → server` registry**), **not**
   splitting one room across nodes. **Graceful hand-off on scale-in = drain:** snapshot the room → deregister
   from the registry → clients **reconnect** and the room **re-pins** on a new node, **rehydrating** from
   snapshot + log (reuses `collab-6.5`). Cross-node **presence/awareness** still fans out via **Redis pub/sub**
   (`collab-4.3`). Remaining as **impl tuning** (not blocking): hash-ring vs registry-assigned placement, drain
   timeout.
3. ✅ **Chat transport — DECIDED: both.** **Async** messaging rides **REST-send + notification-push** (the
   [realtime](../realtime/SPECS.md) path); **live, presence-rich** conversation rides a **collab room**. The UX
   picks the transport; **chat persistence = DynamoDB** — durable room record + **messages on an
   account-configurable per-item TTL** (`collab-6.2`), durable retention opt-in.
4. ✅ **Presence scope split — RESOLVED.** **Account-wide** presence (is the user online at all) is owned by
   **[realtime](../realtime/SPECS.md)** (a read/aggregate over its connection registry); **collab owns
   room-scoped awareness** (who's *in this room*, cursors, typing); **[auth](../auth/specs/SPECS.md) is the
   access gate only** (whose presence you may see, by role). *(Recently moved off auth.)*
5. ✅ **Offline / reconnect reconciliation — DECIDED: server-authoritative rehydrate.** On reconnect the client
   **calls the server for state**, it doesn't trust its local copy. **Documents:** `GET /snapshot` for the
   current CRDT state, then replay the `GET /updates` log past that version (Y.js merges offline edits on
   rejoin). **Chat:** replayed from **DynamoDB within the TTL window** (items older than the TTL are auto-expired
   and simply gone unless retention is on). Remaining as **implementation tuning** (not blocking): snapshot **debounce** interval +
   update-log **compaction** cadence so the log doesn't grow unbounded.
6. ✅ **GDPR erasure in room artifacts — DECIDED (forget-triggered obfuscation job).** Two different "forget"
   triggers hit collab, and *"messages they sent"* is only one slice of either:
   * **A platform USER is forgotten** (a teammate leaves / exercises their rights) — they're the **author** in
     intra-texting and the **editor** of CRDT docs. This is collab's **native** case (the campaign/contact
     tombstone does **not** cover it).
   * **A CONTACT is forgotten** (recipient erasure) — contact PII can **leak into** collab content (a number
     pasted into chat, a contact embedded in a co-edited template).

   For either subject, three categories of data are in scope (not just authored messages): **(a) identity /
   presence metadata** (`authorId`, "edited by X", cursor labels, presence rows, room membership) — structured,
   **mandatory hard-delete / tombstone**; **(b) bodies authored by them** — **anonymize attribution → "Deleted
   user"** but **retain the text by default** (the room belongs to the remaining participants too), deleting the
   body only when it's the subject's own PII or on explicit request; **(c) a contact's PII *inside* content** —
   **split by how it got there:**
   * ✅ **Structured `@`-mention inserts** (`@contact` / `@user`) — stored as a **typed entity reference, not raw
     text**, so a forget can **map it back and deterministically purge/redact** every occurrence (rides the
     [campaign](../campaign/SPECS.md) *"Purged for GDPR forget-me request on DATE"* tombstone). **This is the
     supported, reliable path** — encourage/require `@`-inserts when referencing a contact.
   * ✅ **Bare email / phone typed as free text** — we **cannot stop** someone typing a raw number into a doc or
     chat, and it carries **no mapping** back to the contact. **Mechanism: a forget-triggered obfuscation job.**
     A **"forget" request lands on SQS** (typed `user` | `contact`); **[auth](../auth/specs/SPECS.md)** (users) /
     **[contact](../contact/SPECS.md)** (contacts) — which **own the subject's PII** — consume it, resolve the
     subject's **known PII values** (email, phone, name, …), and fan the obfuscation out to content-holding
     services. **collab** redacts via its `POST /collab/internal/erase` hook: it **scans doc snapshots + update
     log + retained chat for *exact matches* of those known values** and replaces them with a tombstone. Because
     it matches **known values, not blind patterns**, it's far more **precise/reliable** than regex/DLP. Two
     bounded residuals: **(i)** short **chat TTL** already expires most free-text PII in chat (so docs are the
     real durable surface), and **(ii)** *transformed* values (odd spacing, typos, encodings) an exact match
     misses are accepted as **proportionality-bounded** under **Art 17**. *(Optional later enhancement —
     `collab-8.8` — input-time detection that warns / auto-converts recognized PII to an `@`-mention, making
     even free-text deterministically purgeable.)*

   **Stance:** identity anonymization is **mandatory + cheap**; structured `@`-refs purge **deterministically**;
   bare free-text PII is obfuscated by the **SQS forget job** (exact-value match), residual **proportionality-
   bounded** (shrunk by chat TTL). Honor **Art 17(3)** (legal-hold / retention) exceptions as the rest of the
   platform does. **Cross-note:** the identity-anonymization half is the same "anonymize a user everywhere"
   primitive — it lives on the shared **[auth](../auth/specs/SPECS.md) / `Application`** erasure path; the
   **forget job is owned by auth (users) / contact (contacts)**, and **collab owns only the room-artifact scan +
   obfuscation** it performs when called.

# Out of scope (deferred — later considerations)

* **End-to-end encryption (zero-knowledge rooms)** — **out of scope by design, not merely deferred.** E2E means
  the *server* can't read room content, which is **incompatible** with collab's server-side **CRDT merge**, its
  **auditable, REST-retrievable** persistence (`collab-6.4`), and **GDPR content redaction** (gap #6 /
  `collab-8.5`) — and it reintroduces the **lost-key / key-escrow** problem. The platform's bar is **in-transit
  + at-rest (**per-env CMK + per-room DEK envelope**, cloud gap #3)** under a **trusted-processor** posture, not
  E2E. *(Per-account customer-held BYOK deferred.)* Revisit only if a
  genuine zero-knowledge requirement ever overrides those (the narrower fallback would be per-room *content-value*
  encryption with client-held keys — at the cost of server-side merge, search, and redaction).
* **Whiteboard / shared canvas** — a whiteboard room type (Y.js shared types for a canvas) is **out of scope
  for now**. The substrate already supports it (Y.js handles docs *and* canvas), so it plugs into the same
  session/presence/persistence later — design the data model **when that case lands**.
* **Mobile clients** — native / mobile collab (rooms, CRDT editing, intra-texting on a mobile app) is **beyond
  scope for now**. v1 targets the **web** client only ([web](../web/SPECS.md), browser Y.js provider). Revisit
  as a later consideration once the web substrate is proven.

# Service & Job topology

**Convention (platform-wide).** Each service layers **framework base → domain base → concrete role**. A **domain
base** (`CollabService`) holds the **shared domain code** — the **room model**, the **Redis room-registry +
pub/sub**, **auth** (Cognito JWT + room membership + `Access`), **persistence** (S3 CRDT snapshot/log + DynamoDB
chat + TTL), **per-room encryption** (per-env CMK + per-room DEK), and the **Hocuspocus / Y.js + chat protocol**.
**Collab is the platform's one STATEFUL, affinity-bound service** — everything else is stateless and scales out
trivially; collab's room server holds **in-memory CRDT state pinned per room**, so it needs **affinity + graceful
hand-off** and **cannot** be Lambda. That makes its room server a distinct long-running shape — neither a
stateless `Service` nor a consume-loop `Consumer`.

```
Application
├── Daemon (abstract — long-running: signals · graceful drain · run-forever)
│     ├── Service
│     │     └── CollabControlService  (STATELESS REST control plane: room CRUD · membership/invites · visibility · ownership transfer · archive · config/health — scales freely)
│     └── CollabRoomServer            (the STATEFUL WebSocket room server — long-running like a Service but stateful + room-affinity, so its own Daemon-based shape:
│                                       Hocuspocus/Y.js CRDT + chat/presence · in-memory Y.Doc per room · Redis room-registry (roomId→server) + pub/sub fan-out ·
│                                       graceful room HAND-OFF on scale-in · debounced snapshot → S3/DB; behind a WS ALB/NLB, NOT AGW+Lambda)
└── Job (Lambda, event-driven)
      └── CollabJob                   (domain base — room model · persistence · idempotency)
            ├── CollabErasureJob       (SQS ← contact-forget /internal/erase — obfuscate the known-PII match-set in CRDT docs + chat)
            └── CollabMaintenanceJob   (EventBridge — compact the CRDT update-log / consolidate snapshots · sweep archived / orphaned rooms)
```

**Long-running tier (ECS Fargate)**

| Class | Base | Role |
|---|---|---|
| **`CollabService`** | `Daemon` | **Domain base** — room model · Redis registry + pub/sub · auth · persistence · per-room encryption · Y.js/chat protocol; **not deployed alone**. |
| **`CollabControlService`** | `Service` | The **stateless REST control plane** — room **CRUD**, **membership / invites**, visibility, **ownership transfer**, archive, config/health. Stateless → **scales freely**, deploys apart from the room fleet. |
| **`CollabRoomServer`** | `Daemon` (stateful) | The **stateful WebSocket room server** — **Hocuspocus / Y.js CRDT** + chat/presence; holds the **in-memory `Y.Doc` per room**, **room-pinned** (Redis registry + pub/sub for cross-node fan-out), **graceful room hand-off** on scale-in, **debounced snapshot** → S3/DB. Behind a **WS ALB/NLB** (affinity), **not** AGW+Lambda. The platform's one stateful, affinity-bound role. |

**Jobs (Lambda, event-driven)** — each extends `CollabJob`:

| Class | Trigger | Role | Req |
|---|---|---|---|
| **`CollabErasureJob`** | SQS ← contact-forget (`/internal/erase`) | GDPR forget — **obfuscate the known-PII match-set** in CRDT **docs + chat** (the [contact](../contact/SPECS.md) `contact-10.4` fan-out target) | collab-8.x |
| **`CollabMaintenanceJob`** | EventBridge (scheduled) | **Compact** the CRDT update-log / consolidate snapshots; **sweep** archived / orphaned rooms | collab-6.0 |

> **Why a separate service from realtime** (the key distinction): **realtime is stateless fan-out** (Kafka →
> per-account outbox → drain to sockets — no per-connection state to lose); **collab is stateful CRDT rooms**
> (in-memory `Y.Doc`, room affinity, conflict-free merge). Different operational shape, kept separate by design.
> **Presence split:** collab reports **room-scoped awareness** (who's in *this* doc, cursors, typing);
> **[realtime](../realtime/SPECS.md)** owns **account-wide** online state. **Persistence is split by artifact:**
> CRDT **docs = durable** (snapshot+log → S3/DB); **chat = DynamoDB with per-item TTL** (short TTL shrinks the
> GDPR surface — most free-text PII just expires). **Compliance-first = self-host** (Hocuspocus on our infra),
> not a managed CRDT backend — data residency / BYOK / SOC 2.

# AWS Services and Other Dependencies

**AWS services**
* **ECS Fargate** (+ **WS-capable ALB/NLB**) — stateful room servers.
* **DynamoDB** — chat room record + messages (per-item TTL).
* **S3** — CRDT doc snapshots + update log (large snapshots).
* **Redis (ElastiCache)** — room registry, presence, pub/sub, `rate.take` (live coordination, **not** storage).
* **Cognito** — connect auth.

**Third-party libraries / services**
* **Y.js (CRDT)** + **Hocuspocus** (self-hosted backend) · **tiptap** (rich-text editor) · the browser **Y.js provider** (web client).

**Internal (`@repo/*`)**
* `@repo/services` (Cache, Dynamo, S3, Cognito), `@repo/endpoint` (`Access` — per-room role checks), `@repo/common` (`Type`, `Result`).

# Requirements (traceable register)

The traceable requirement register for the **collab service** (the narrative sections above are the rationale;
this is the coded list). IDs are stable handles (**`collab-N.M`**) — cite them in code, tickets, and tests.
**Priority:** **A** = MVP (ship first), **B** = core feature / hardening, **C** = later. One level of
sub-requirements only; a group's priority is its floor. **Boundaries:** collab owns **full-duplex rooms** (live
session, CRDT merge, room-scoped awareness, room persistence); **[realtime](../realtime/SPECS.md)** owns one-way
push + **account-wide presence**; **[auth](../auth/specs/SPECS.md)** owns identity + the per-room access gate;
**[texting](../texting/SPECS.md)** owns external SMS (unrelated to intra-texting).

## collab-1.0 Rooms & live sessions (full-duplex) — A
- **collab-1.1** Full-duplex room sessions over WS — the one place a client genuinely *sends* over a socket — A
- **collab-1.2** v1 room types: **intra-texting** (in-app chat) + **collaborative doc editing** (tiptap/Y.js) — A
- **collab-1.3** REST loads canonical state / history / initial load; the socket carries the **live session** on top — A
- **collab-1.4** Live socket **augments** REST, never replaces it (durable state always reachable via REST) — A
- **collab-1.5** Extensible substrate — new room types (whiteboard, dashboards, co-browse) plug into the same session/presence/persistence — C

## collab-2.0 CRDT document editing — A
- **collab-2.1** **Y.js (CRDT)** binary updates + awareness; concurrent edits converge (CRDT merge) — A
- **collab-2.2** **Hocuspocus** self-hosted Y.js backend (data in-infra) — A
- **collab-2.3** tiptap binds the browser **Y.js provider** as a **separate client** from `WebsocketService` — A
- **collab-2.4** Binary frames for CRDT (stay compact) vs thin JSON for chat/presence — A

## collab-3.0 Intra-texting (in-app chat) — A
- **collab-3.1** Live user-to-user / team chat — presence, typing, instant delivery — A
- **collab-3.2** Thin **JSON message protocol** on the same room/presence substrate — A
- **collab-3.3** **Distinct from external [texting](../texting/SPECS.md)** (SMS / 10DLC to contacts) — A
- **collab-3.4** Transport split — **async** = REST-send + notification-push; **live** = collab room *(gap #3)* — A
- **collab-3.5** **`@`-mention inserts** (`@contact` / `@user`) in chat **and** docs — stored as **typed entity refs**, not raw text, so they're **deterministically purgeable** on GDPR forget *(see `collab-8.5` / gap #6)* — B

## collab-4.0 Presence & awareness — A
- **collab-4.1** **Room-scoped awareness** — who's *in this room*, cursors, selection, typing — A
- **collab-4.2** Account-wide presence is **owned by [realtime](../realtime/SPECS.md)** (not here) — collab reports room awareness only — A
- **collab-4.3** Cross-node awareness fan-out via **Redis pub/sub** when members land on different instances — A

## collab-5.0 Room infra & routing — A
- **collab-5.1** Stateful room servers on **ECS Fargate** behind a **WS-capable ALB/NLB** (not AGW + Lambda) — A
- **collab-5.2** Room **affinity** — **pinned to one server** (single in-memory authority; assignment by `roomId` via the **Redis room registry** `roomId → server`) — A
- **collab-5.3** **Redis pub/sub** cross-node fan-out for presence + room events — A
- **collab-5.4** **Graceful room hand-off** on scale-in — **drain**: snapshot → deregister → reconnect → re-pin + rehydrate (`collab-6.5`) *(decided — gap #2)* — B
- **collab-5.5** Autoscale on room / connection count — B

## collab-6.0 Persistence — A
- **collab-6.1** **Documents** = durable **system of record** — CRDT **snapshots + update log** to **S3 / DB**, **debounced** for fast reconnect load — A
- **collab-6.2** **Chat room in DynamoDB** — room record (name, members, type, owning account) **durable**; **messages carry an account-configurable per-item TTL** (DDB auto-expire), separate from the CRDT doc store — A
- **collab-6.3** Doc state survives server restart / room migration — A
- **collab-6.4** Durable **doc** state retrievable + **auditable** via REST (live stream reconciled, not a parallel truth) — A
- **collab-6.5** **Offline / reconnect = server-authoritative rehydrate** — docs via `GET /snapshot` + `/updates` replay; chat replayed from **DynamoDB** within the TTL window *(gap #5; debounce/compaction = impl tuning)* — A
- **collab-6.6** **Chat retention** — message **TTL configurable per account** (DynamoDB per-item TTL); **durable long-term retention opt-in** (longer / disabled TTL) when a compliance hold / account requires it — B

## collab-7.0 Authorization & isolation — A
- **collab-7.1** Connect / room-join authorizes via **Cognito JWT + room membership + `Access` role** — A
- **collab-7.2** Grant **re-checked on join**; each room **owned by one account** (key/isolation domain), but **guests from outside the account are invitable** (e.g., customer support), authorized per-room — never two *owning* accounts — A
- **collab-7.3** Revoked grant **evicts** the live connection — A
- **collab-7.4** **Room visibility** — `public` (any user of the **owning account** may join, no invite) | `private` (**invite-only**; explicit membership incl. outside guests). "Public" is **account-scoped, not internet-public** — A
- **collab-7.5** **Room owner (user)** — a **single** owner (creator by default; distinct from the *owning account*) with room-admin rights: manage members/invites, set visibility, archive — A
- **collab-7.6** **Ownership transfer** — current owner (or account `ACCOUNT`/`ROOT`) **passes ownership** to **another member of the owning account** (never an outside guest); **audited** (`AuditEvent`); exactly one owner at a time — B

## collab-8.0 Security, abuse & compliance — A
- **collab-8.1** **Per-room rate limits** (message/edit floods) via shared `rate.take` token-bucket — A
- **collab-8.2** **Encryption** — in transit (TLS/WSS) + at rest (**SSE-KMS, one platform-managed key** by default); data in-infra, **no PII to third parties** — A
- **collab-8.3** **Audit of room access** (hashed `AuditEvent` — join/leave/grant changes) — A
- **collab-8.4** **GDPR identity erasure** — anonymize a forgotten **user's** author/editor identity + presence across all rooms (mandatory; the shared [auth](../auth/specs/SPECS.md) / `Application` "anonymize everywhere" primitive) — B
- **collab-8.5** **GDPR content redaction** — **structured `@`-refs** (`collab-3.5`) + linked `contactId` purge **deterministically** (campaign *"Purged…"* tombstone); **bare free-text PII** is obfuscated by the **forget job** (`collab-8.8`) via **exact-match on the subject's known PII values**; chat TTL self-heals chat; residual (transformed values) **proportionality-bounded** (Art 17); honor Art 17(3) — B
- **collab-8.6** **No PHI** by [AUP](../account/specs/SPECS.md). **E2E / zero-knowledge rooms** and **mobile** are **out of scope** (see deferred — E2E is incompatible by design) — C
- **collab-8.7** **Envelope encryption (per-env CMK)** — the **per-environment platform CMK** (`cloud-5.4`) wraps a per-room **DEK** (DEKs are in-DB byte-strings, **not** KMS keys → no per-room KMS-key sprawl); the **server** unwraps for **any authorized member**, so **invited outside guests still read** (no per-user keys). **Per-account customer-held BYOK deferred** (cloud gap #3) — B
- **collab-8.8** **Forget-job erasure hook** — `POST /collab/internal/erase` accepts a subject's **known-PII match-set** from the **[auth](../auth/specs/SPECS.md) / [contact](../contact/SPECS.md) SQS forget job**; collab **scans doc snapshots + update log + retained chat for exact matches** and obfuscates with a tombstone. *(Optional later: input-time PII detection → suggest/auto-convert to an `@`-mention.)* — B

## collab-9.0 Infra footprint & dependencies — A
- **collab-9.1** **Fargate + ALB/NLB** (stateful) + **Redis** (registry / presence / pub/sub / `rate.take`) — A
- **collab-9.2** **DynamoDB** (chat room record + messages w/ per-item TTL; CRDT **doc** snapshots / update log) + **S3** (large snapshots); **Redis** = live registry / presence / pub-sub / rate — A
- **collab-9.3** **Cognito** (connect auth); **Y.js + Hocuspocus**; browser Y.js provider on [web](../web/SPECS.md) — A
- **collab-9.4** **Sanitize rich-text HTML (XSS/JS)** — when a CRDT doc is rendered / exported to HTML (or reused as email/template content), run it through the **shared `Application.sanitizeHtml(html, "richtext")`** (allowlist; strip `script`/`style`/`on*`; constrain URLs) on **output** — a multi-author shared doc is untrusted content *(see [`@repo/services` → Shared HTML sanitizer](../../../packages/services/README.md); web-6.7 = client backstop)* — A

## collab-10.0 Service & Job topology — B
- **collab-10.1** **Domain base** — `CollabService` (on `Daemon`) holds the shared code (room model · Redis registry + pub/sub · auth · persistence · per-room encryption · Y.js/chat protocol); concrete roles extend it — B
- **collab-10.2** **`CollabControlService`** (`Service`) — the **stateless REST control plane** (room CRUD · membership/invites · visibility · ownership transfer · archive); scales freely, deploys apart from the room fleet — A
- **collab-10.3** **`CollabRoomServer`** — the **stateful WebSocket room server** (Hocuspocus/Y.js + chat/presence): in-memory `Y.Doc` per room · **room affinity** (Redis registry + pub/sub) · **graceful room hand-off** on scale-in · debounced snapshot → S3/DB; behind a **WS ALB/NLB**, not AGW+Lambda. The platform's **one stateful, affinity-bound** role — A
- **collab-10.4** **Jobs extend `CollabJob`** — `CollabErasureJob` (contact-forget `/internal/erase` → obfuscate docs + chat) + `CollabMaintenanceJob` (compact update-log / consolidate snapshots · sweep archived rooms) — A
- **collab-10.5** **Separate from realtime** — collab = **stateful CRDT rooms** (in-memory, affinity); realtime = **stateless fan-out**. Collab reports **room-scoped awareness**; realtime owns **account-wide** presence — A

# Endpoints (first cut)

A first pass at the endpoint surface, in [`@repo/endpoint`](../../../packages/endpoint/SPECS.md) style — all
service-prefixed **`/collab/*`**. Collab is **WebSocket-first**: **REST** handles **canonical CRUD, initial
load, history, and membership** (the *"`send()` never replaces REST"* rule); the **live session** rides a
**per-room WebSocket** behind the **WS-capable ALB/NLB** (**not** API Gateway). Reads return the
`{ data, page }` envelope.

**Access column:** recommended **`minAccess`** on the `Access` ladder — **`-`** = public · account ladder
**`SENDER`<`USER`<`BILLING`<`ACCOUNT`** · staff ladder **`SUPPORT`<`APPLICATION`<`ROOT`** · **`⬆`** = also
step-up · **`Internal`** = VPC-only S2S. A senior role satisfies any junior minimum. Beyond the ladder, some
actions are gated by a **per-room `owner`** role (set visibility, transfer ownership, archive), and **invited
outside guests** (e.g., customer support) are authorized **per-room** by membership, independent of their home
account (`collab-7.2`).

### Rooms — lifecycle & metadata (collab-1, collab-7)
| Method | URI | Purpose | Access | Req |
|---|---|---|---|---|
| POST | `/collab/rooms` | Create a room (`type`: doc / chat; `visibility`: public / private); owning account = caller's; **creator = owner** | USER | collab-1.2/7.2/7.4/7.5 |
| GET | `/collab/rooms` | List rooms the caller can access (own + invited **private** + the account's **public** rooms) | USER | collab-7.1/7.4 |
| GET | `/collab/rooms/{id}` | Room metadata (type, **visibility, owner**, owning account, members, version) | USER | collab-7.1/7.5 |
| PATCH | `/collab/rooms/{id}` | Rename / settings, incl. **`visibility`** *(owner; or ACCOUNT/ROOT)* | USER | collab-1.2/7.4 |
| POST | `/collab/rooms/{id}/owner` | **Transfer ownership** to another **owning-account** member (not a guest) *(current owner; or ACCOUNT/ROOT)* — audited | USER | collab-7.6 |
| DELETE | `/collab/rooms/{id}` | Archive / delete a room *(owner; or ACCOUNT/ROOT)* | USER | collab-6.4/7.5 |

### Initial load, snapshots & history (collab-1.3, collab-6)
| Method | URI | Purpose | Access | Req |
|---|---|---|---|---|
| GET | `/collab/rooms/{id}/snapshot` | Current CRDT snapshot — the **initial load** before the socket opens | USER | collab-1.3/6.1 |
| GET | `/collab/rooms/{id}/updates` | Y.js update log since a `version` (reconnect / offline replay) | USER | collab-6.5 |
| GET | `/collab/rooms/{id}/versions` | Snapshot / version history (auditable durable state) | USER | collab-6.4 |
| GET | `/collab/rooms/{id}/messages` | Chat history (paged, ordered by `occurredAt`) — **within the account's chat TTL** unless retention is on | USER | collab-3.1/6.2 |

### Membership & invites — incl. outside guests (collab-7)
| Method | URI | Purpose | Access | Req |
|---|---|---|---|---|
| GET | `/collab/rooms/{id}/members` | List members + per-room roles | USER | collab-7.1 |
| POST | `/collab/rooms/{id}/members` | Invite a member (**required** for **private** rooms + for **any outside-account guest**; public rooms admit owning-account users without invite). Outside guest needs ACCOUNT | USER · ACCOUNT for external | collab-7.2/7.4 |
| DELETE | `/collab/rooms/{id}/members/{userId}` | Remove a member; **evicts** the live connection | USER | collab-7.3 |

### WebSocket — the live session (one socket per room) (collab-1.1, collab-2, collab-3, collab-4)
| Protocol | URI | Purpose | Access | Req |
|---|---|---|---|---|
| WSS · Upgrade | `wss://…/collab/rooms/{id}/ws` | Open the live session — **Y.js sync** (docs) + **JSON** (chat/presence). JWT verified on connect; room grant **re-checked on join** | USER | collab-1.1/7.1 |

> **JWT on connect, not in the path.** The socket authenticates with the **Cognito JWT** at the upgrade (header
> / WS subprotocol) and authorizes **by visibility** — **public:** any user of the **owning account**;
> **private:** explicit **membership** (incl. invited guests) — **re-checked on join**; a revoked grant
> **evicts** mid-session. **One WSS per room** (room affinity / pinning); **account-wide presence is
> [realtime](../realtime/SPECS.md)'s separate socket**, not this one.

#### WS frames ("the lines" over the room socket)
`C→S` = client→server · `S→C` = server→client · **bin** = binary Y.js frame · **json** = JSON message.

| Dir | Frame / op | Payload | Purpose | Req |
|---|---|---|---|---|
| C→S · S→C | `sync` | bin | Y.js sync step 1/2 — reconcile CRDT state on (re)join | collab-2.1 |
| C→S · S→C | `update` | bin | Incremental Y.js CRDT update (doc edit) — merged + fanned out | collab-2.1 |
| C→S · S→C | `awareness` | bin/json | Cursors / selection / typing — **room-scoped awareness** | collab-4.1 |
| C→S | `chat.send` | json | Post a chat message to the room | collab-3.1/3.2 |
| S→C | `chat.message` | json | Broadcast a chat message (persisted to system of record) | collab-3.1/6.2 |
| S→C | `presence.join` / `presence.leave` | json | A member entered / left the room | collab-4.1 |
| S→C | `evict` | json | Grant revoked / removed — server closes the connection | collab-7.3 |
| C→S · S→C | `ping` / `pong` | — | Heartbeat / keepalive | collab-5.5 |
| S→C | `error` | json | Protocol / authz / rate-limit error (then close if fatal) | collab-8.1 |

### Internal / S2S & ops (collab-7, collab-8, collab-9)
| Method | URI | Purpose | Access | Req |
|---|---|---|---|---|
| POST | `/collab/internal/evict` | S2S: force-evict a user from **all** rooms (grant revoked / account disabled) | Internal | collab-7.3 |
| POST | `/collab/internal/erase` | S2S hook for the **auth/contact SQS forget job** — anonymize identity + **scan & obfuscate** room artifacts matching the subject's **known PII values** | Internal | collab-8.4/8.5/8.8 |
| GET, PUT | `/collab/config` | Read / set the service's own runtime config (AppConfig-backed) | ROOT | collab-9.1 |
| GET | `/collab/health` | Liveness / readiness of the room-server fleet | - | collab-9.1 |

# eof
