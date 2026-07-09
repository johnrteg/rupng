#
# Fake Email Service — spec
#
# STATUS: DRAFT for review + expansion. Not implemented. This is the canonical spec for the standalone fake
# email provider (a standalone service, one fake provider per channel).
#

# Objective

A **fake email provider that runs as its own service** — it exposes a representative ESP-style HTTP API, accepts
outbound email exactly like SendGrid / Postmark / Resend, and lets us **fully exercise the outbound email path
offline**: auth, send, rate-limits, outages, timeouts, delivery/bounce/complaint webhooks, and open/click
engagement — with **no real delivery** and a **built-in inbox** to inspect what was actually sent (merges,
formatting, links). Think "Mailtrap, but ours, and scriptable" — a controllable ESP simulator.

Using the fake provider is **no different from using any other provider**: the email service selects
`Email.Provider.FAKE`, resolves its key + base URL from config/Secrets like any ESP, and calls it over HTTP.
The only differences are (a) the base URL points at this service and (b) it's **gated to non-prod**.

# The fake-provider PATTERN (generalizes beyond email)

This is the **email instance** of a reusable pattern. The same design applies to **text (SMS/MMS), print,
social, voice, push**. Intended shape: a **shared fake-provider core** (auth, scenario engine, storage + TTL,
inbox UI shell, webhook dispatcher, console config) + a thin **per-channel module** that defines that channel's
**request payload**, **event types**, and **inbox renderer**. Deploy one fake service per channel
(`fake-email`, `fake-text`, …) so each mirrors its real counterpart and stays isolated. *(Open question:
one service per channel vs one multi-channel `fake-provider` with channel sub-APIs — leaning per-channel.)*

**Shared base class — `FakeService`.** The cross-channel concerns are common enough to warrant a **`FakeService`
base** (a sibling of the platform `Service` base, but deliberately *without* the Kafka / event / Authorizer
wiring — see "Architecture posture"). It owns the SaaS-simulator machinery every fake needs: **fake-key auth**,
the **scenario engine** (magic addresses + config + per-request overrides + seeded randomness), the **storage +
TTL** layer (S3 / in-memory), the **webhook dispatcher + timers** (delayed, signed, retried), the **inbox API**,
and the **console-config binding**. A channel's service — `FakeEmailService extends FakeService` — supplies only
the channel-specific payload shape, event types, and inbox renderer. This keeps each fake tiny and behaviorally
identical where it should be.

# Why a standalone service (not an in-process stub)

An in-process fake that returns success without I/O is fine for a smoke test, but it bypasses the parts most
likely to break: the real HTTP call, auth, non-2xx handling, retry/DLQ, idempotency, and the **async webhook
feedback loop** (a real ESP reports delivery/bounce/complaint *later*, out of band). A service also gives a
**shared inbox UI**, **deterministic scenarios**, and **multi-tenant isolation** a stub can't.

> **Status:** BUILT + WIRED. The service lives at `apps/core/fake-email` (on the shared `FakeService` base,
> port 9100); the email service's `FakeProvider` adapter is now a thin HTTP client that POSTs to it (auth via
> the per-account/default fake key) exactly like a real ESP adapter — no more in-process stub. The Console's
> **Fake → Email** tab reads its inbox + config. Still deferred (as designed): the async webhook/engagement
> dispatch and S3-backed storage.

# Architecture posture

- **Runs as a Service** (via the **`FakeService` base**, above) with its **own API registrations** (its own
  gateway routes) to accept incoming email requests — but is **NOT wired into the platform plumbing**: **no
  Kafka, no cross-service events, no Authorizer/JWT**. It is deliberately a leaf. It authenticates only via its
  own **fake API key** (below). `FakeService` exists precisely to carry these deviations from the normal
  `Service` base (no event bus, key-only auth, an inbox store + webhook timers instead of the usual facades) in
  one place, so `FakeEmailService` — and later `FakeTextService`, etc. — stay thin.
- **Non-prod only.** Never provisioned in prod; the email service refuses to resolve `Provider.FAKE` when
  `env === production` (fail-closed) — same guardrail as the Mailhog dev sink.
- **Its own Console config + inbox UI** (see below) — independent of the email service's config.

# Fake API keys (per-account) — test the key-present AND key-absent paths

- **A well-known default key** — `0000-00-0000` (a `FAKE_API_KEY` constant) — is always accepted, so the
  zero-config path works and the email service's credential matrix is testable out of the box:
  **key-not-configured** (adapter short-circuits, no call) vs **wrong key → `401`** vs **happy path**. This
  exercises the *whole* real credential path: register `email-fake` in the universal provider registry → set the
  Secrets value → the FAKE adapter resolves it via `Providers.byId("fake").secretKey` and sends it.
- **Per-account keys (yes).** Beyond the default, the fake **issues a distinct key per account instance**, so
  each account using the fake has its own credential (and its own isolated inbox — see storage). This mirrors a
  real ESP where every account has its own API key.
- **Marketplace install — a `0:1` item.** Surface the fake as a **marketplace item** a local/dev account
  **installs** (same flow as a real marketplace provider). Cardinality is **`0:1` per account** — an account has
  at most ONE fake-email instance (install/uninstall, not "add another"). On install the account **provisions
  its fake key from the API** — `POST /v1/_control/keys` (or the install hook) mints the key and returns it; the
  account stores it as its provider credential (Secrets / provider config) exactly like a real key. So "use the
  fake" is a normal marketplace-provider setup, not a special case.
  - *(Cardinality is the marketplace's existing **`multiInstance`** flag (default single = `0:1`) — see
    [marketplace SPECS](../../marketplace/SPECS.md). Fake-email (like every provider integration) is
    single-instance; no new attribute needed.)*
  - Within the single instance, the account may still hold **multiple named keys for rotation** (mint new,
    revoke old) — one instance, N credentials, one inbox.
- **Key registry storage (TBD → recommend JSON in S3).** The issued keys (key → account, created/expiry, label,
  active) are few and rarely written — a **single JSON document in S3** (`_keys/registry.json`), cached
  in-memory, is the simplest durable option and needs no DDB. (In-memory-only is fine for pure CI.) Validation on
  each request is an in-memory lookup; the default key is always implicitly valid.
- **Auth resolution:** a request's key → the owning account → that account's isolated inbox + scenarios + config
  overrides. The default key maps to a shared "default" tenant.

# Storage — DDB or in-memory? (recommendation)

**You do not need DynamoDB.** The fake handles low, throwaway volume in a single small instance, so:

- **Message bodies → S3**, as you described: durable, cheap, large-HTML-friendly, and **native TTL via a bucket
  lifecycle rule** (plus a per-object `expiresAt` the console TTL setting drives). **Partitioned by key →
  account** so each account's mail is separate: key by `acct/<accountId>/<messageId>.json` (the request's fake
  key resolves to the accountId; the default key → the shared `default` partition). The inbox, scenarios, and
  metrics are all scoped to that partition — one account never sees another's fake mail.
- **Key registry → `_keys/registry.json`** in the same bucket (issued key → account + label/expiry/active),
  cached in memory (see per-account keys above).
- **Index + mutable state (status, opens, clicks, scheduled-webhook timers) → in-memory** working set, rebuilt
  from S3 on boot (list-by-prefix). This is the simplest correct default: the inbox survives a restart (bodies
  are in S3), engagement/timer state is ephemeral (a fake owes no durability guarantee), and there's **no DDB to
  operate**.
- Pure **all-in-memory** (no S3) is also valid as a "fastest, fully ephemeral" mode for CI unit runs — a config
  toggle. **DDB is only worth adding IF** you later need: rich inbox queries/filtering at scale, **multiple
  service instances** sharing one inbox, or **durable scheduled webhooks** that must survive a restart. Start
  without it; add a thin DDB index only when one of those becomes real. **Recommendation: S3 bodies + in-memory
  index (default), all-in-memory (CI toggle), DDB deferred.**

# API surface (representative, ESP-shaped)

Versioned REST, keyed by the fake API key, JSON:

- `POST /v1/messages` — accept a send. Body = the `Email.Outbound` shape (`from, to[], cc?, bcc?, subject,
  html?, text?, headers?, attachments?`). Honors an **idempotency key** (repeat → same message id). Returns
  `202 { id, status: "accepted" }` — OR a scripted failure (below). **Per-recipient partial result** when a
  batch mixes good + bad recipients (`{ id, accepted:[…], rejected:[{ email, reason }] }`).
- `GET /v1/messages/:id` — the stored message + its current status + event timeline (for test assertions).
- `GET /v1/messages?tenant=…&status=…` — list the inbox (drives the UI).
- `GET /v1/messages/:id/links` — the extracted links/CTAs (so a test can "click" one).
- `POST /v1/_control/keys` — **issue a per-account fake key** (the marketplace-install / provisioning hook);
  returns the minted key. `GET`/`DELETE` list + revoke.
- `POST /v1/_control/scenario` — set behavior for a tenant/address (see scenario matrix).
- `POST /v1/_control/advance` — **time control**: fire due (or all pending) webhooks now, so tests don't wait.
- `POST /v1/_control/reset` — clear a tenant's inbox + scenarios (test setup/teardown).
- `GET /v1/_metrics` — counts by status (accepted/delivered/bounced/complained/…) for dashboards.

# Console home — a top-level "Fake" tab

Because the fake concept spans channels, the Console gets a **top-level `Fake` tab** (a peer of the real
service tabs, not nested under Email) that aggregates every fake provider: **Fake → Email**, **Fake → Text**,
… Each channel sub-section hosts that fake's **inbox** + **config** + **controls**. So the fake-email inbox and
config below live under **Console → Fake → Email**. The tab is only visible in non-prod (the fakes don't exist
in prod).

# Console config (its own interface — editable live)

A dedicated **fake-email config** (its own AppConfig-style profile + a Console screen under **Fake → Email**),
controlling the "personality" of the simulated ESP. The model is **independent on/off knobs, each with its own
parameter** — NOT a single "pick a scenario." Every knob is evaluated on each send, so you can, say, turn
`hardBounce` to 100% to make a small test send fully bounce.

**Seeded default = everything OFF** — a clean pass-through: **full delivery, no bounces/complaints, no
engagement events, no webhooks, no rate-limit/timeout/outage**. We tune the defaults once real testing starts;
until then the fake just accepts and "delivers" every message so it's a no-surprise sink.

**Storage**
- mode (`s3` | `memory`), **message TTL** (the configurable retention), max stored messages.

**Connection-level knobs** (gate the whole API call, before recipients are read):
- **Rate limit** — `on` + `perMinute` (e.g. `on → 10/min`) → over the limit returns **`429` with `Retry-After`**.
- **Timeout / slow** — `on` + `seconds` (e.g. `on → 10s`) → holds the response that long (exceeds the client
  timeout to exercise timeout handling).
- **Unavailability** — `on` + optional `window`/`probability` → returns `503`/`5xx` (failover + DLQ).
- **Auth** — the accepted fake key(s) (the default `0000-00-0000` + issued per-account keys).

**Delivery-level knobs** (per recipient, after the call is accepted — each an independent **percentage**):
- **`hardBounce`** `on → %` (e.g. `10%` = 1 in 10; `100%` = all) — permanent bounce → suppression.
- **`softBounce`** `on → %` — retryable bounce.
- **`complaint`** `on → %` → suppression.
- **`deferred`** `on → %` → delayed delivery.
- **`invalid`** `on → %` → per-recipient reject (`4xx`).
- Evaluated in a fixed priority order (hardBounce → complaint → softBounce → deferred → invalid); a recipient
  that matches none is **delivered**. (Percentages needn't sum to 100 — the remainder delivers.)

**Engagement knobs** (per delivered recipient — each `on` + `%` + a **delay window** `min–max`):
- **`open`** `on → % , delay min–max` — fires an `open` event in the window.
- **`click`** `on → % , delay min–max` — fires `open` + `click` (with a CTA URL).
- **`unsubscribe`** `on → % , delay min–max` — e.g. **5% between 1 and 15 minutes after send** → `unsubscribe`
  event (→ per-line-instance opt-out).

**Webhooks**
- callback URL (default `http://localhost:9000/webhook/email/fake`), signing secret, on/off per event type,
  delivery delay ranges, retry policy.

# Magic addresses (deterministic per-recipient overrides)

Independent of the probabilistic knobs, **magic recipient addresses force a specific outcome for that
recipient** (deterministic — bypasses the percentages), for pinpoint tests. Reserved domain `@fake.test`
(a `+tag` subaddress like `jane+bounce@acme.com` works too). Documented set:

| Outcome | Magic address | Effect |
|---|---|---|
| deliver | anything else | `202`, then async `delivered` |
| soft bounce | `soft-bounce@fake.test` | `202`, then **retryable** bounce |
| hard bounce | `bounce@fake.test` | `202`, then **permanent** bounce (→ suppression) |
| complaint | `complaint@fake.test` | `202`, then complaint (→ suppression) |
| deferred / greylist | `defer@fake.test` | delayed `delivered` |
| rate limited | `ratelimit@fake.test` | `429` + `Retry-After` |
| server error | `error@fake.test` | `5xx` (retry → DLQ) |
| timeout | `slow@fake.test` | delayed past the client timeout |
| invalid recipient | `invalid@fake.test` | `4xx` / per-recipient reject |
| opened | `opener@fake.test` | delivered, then `open` event |
| clicker | `clicker@fake.test` | delivered, then `open` + `click` events |
| unsubscriber | `unsub@fake.test` | delivered, then `unsubscribe` event |

# Webhooks (feedback loop — later, but designed now)

When webhooks land, the fake dispatches **asynchronous** callbacks that mirror a real ESP so the email service's
ingress + suppression + engagement paths are testable end-to-end:

- **Transport = a direct HTTP callback to a URL set in the provider config.** Default (local):
  `http://localhost:9000/webhook/email/fake`. The general ingress shape is
  **`POST /webhook/email/<provider>`** — the email service exposes one webhook route per provider (`.../fake`,
  `.../sendgrid`, `.../postmark`, …), each parsing that provider's payload and normalizing to the shared
  feedback model. (No SES→SNS mimicry — a plain signed HTTP POST is simpler and matches every non-SES ESP.)
- **Event types:** `delivered`, `deferred`, `bounced` (with **category**: mailbox-full / no-such-user / blocked
  / content, and soft-vs-hard), `complained`, `dropped`/`undelivered`, `open`, `click` (with the clicked URL),
  `unsubscribe`. Bounce/complaint → the email service's suppression + the **per-line-instance opt-out** path
  (contact svc). Open/click → analytics + CTA verification.
- **Realistic timing** (configurable delays), **HMAC-signed** with the signing secret (so the email service's
  signature verification is exercised), and **retried with backoff** if the callback fails.
- **Time control:** `_control/advance` fires due/all pending callbacks immediately for deterministic tests.

# Inbox UI (the "popup inbox")

A Console screen (Console → **Fake → Email → Inbox**) to explore sent messages and **verify field merges +
formatting**:

- List (tenant-scoped, filter by status/recipient/time), per-message detail rendering the **HTML preview**,
  **plain-text part**, **headers** (incl. `List-Unsubscribe`), **resolved merge output**, **attachments**, and
  the **raw MIME**.
- **Links/CTAs panel** — every link in the email, with a **"simulate click"** and **"simulate open/unsubscribe"**
  action that fires the corresponding webhook (so you can walk the engagement + opt-out loop by hand).
- Per-message **event timeline** (accepted → delivered → opened → clicked …) and the **scenario** applied.
- Controls: **reset inbox**, **advance timers**, set a scenario. Retention shows the configured **TTL**.

# Guardrails

- **Non-prod only**; never deployed to prod; email service fail-closes on `Provider.FAKE` in prod.
- **No real delivery, ever** — nothing leaves the environment.
- Fake key(s) clearly labeled; tenant isolation by key/account so parallel tests don't collide.

# "Anything missing to really test outbound email?" — coverage checklist

> **Implementation status.** The synchronous, config-driven items are BUILT: **#1 auth matrix, #2 idempotency,
> #3 per-recipient partial failure, #4 rate-limit (`429`; `Retry-After` reported in the body — a real header
> needs reply access, minor), #5 bounce taxonomy (soft/hard + categories via magic address or the
> `bounceCategory` default), #6 complaint + complaint-rate (in `_metrics`), #8 size/recipient validation limits
> (`413`/`400`), #9 message-id + status lookup, #12 multi-tenant isolation, #13 latency distribution.** Still
> DEFERRED because they need the async webhook/engagement dispatcher (a coherent next chunk): **#7 unsubscribe
> loop, #10 webhook signing/retry, #11 time-control (`_control/advance`) + seed, #14 delivered-then-bounced
> ordering, #15 DKIM/SPF/DMARC alignment.**

Beyond what you listed (rate limits, unavailability, slow/timeout, delivery/undelivered webhooks, open/click,
inbox), a *thorough* outbound simulator should also cover:

1. **Auth matrix** — key-missing (adapter short-circuits), key-wrong (`401`), key-ok — the full credential path.
2. **Idempotency** — a repeated idempotency key returns the same message id (no double send) — real ESPs dedupe.
3. **Per-recipient partial failure** — a batch where some recipients accept and some reject (real APIs return a
   mixed result), so fan-out + logging handle partial success.
4. **Rate-limit shape** — `429` **with `Retry-After`**, so backoff (not just "blocked") is tested.
5. **Bounce taxonomy** — soft (retryable) vs hard (permanent) **and** categories (mailbox-full / no-such-user /
   blocked / content) → drives suppression classification + the per-line-instance opt-out.
6. **Complaint / spam** + a **complaint-rate** signal (Gmail/Yahoo bulk-sender < 0.3%) for reputation tests.
7. **Unsubscribe loop** — `List-Unsubscribe` header present + a simulated one-click unsubscribe webhook feeding
   the consent opt-out (ties to the contact per-instance consent model).
8. **Message/attachment size + validation limits** → `4xx` rejects (missing subject, malformed recipient,
   oversize).
9. **Provider message id + status lookup** — an id on accept + a `GET /messages/:id` so send-log correlation
   and status polling are testable.
10. **Webhook signing + retry** — HMAC signature the service verifies; retries on callback failure.
11. **Time control / determinism** — trigger delayed webhooks on demand + a **seed** for reproducible random
    windows (so CI isn't flaky).
12. **Multi-tenant isolation** — inbox + scenarios partitioned by fake key/account for parallel test safety.
13. **Latency distribution** (not just a timeout flag) — p50/p95 delays for realistic performance tests.
14. **Delivered-then-bounced** async ordering — a message can be "delivered" then later hard-bounce, as happens
    in reality.
15. *(nice-to-have)* **DKIM/SPF/DMARC alignment** result reported in the delivered webhook, to exercise
    auth-result handling later.

# Decided (this round)

- **One fake provider per channel** (`fake-email`, `fake-text`, …), each on the shared `FakeService` base.
- **Behavior = independent on/off knobs, each with a parameter** (not a "pick a scenario"): connection-level
  (rate limit N/min, timeout N s, unavailability) gate the call; delivery-level (`hardBounce`/`softBounce`/
  `complaint`/`deferred`/`invalid` — each an independent `%`, e.g. 100% = force-all) run per recipient;
  engagement (`open`/`click`/`unsubscribe` — each `%` + a delay window) run per delivered recipient.
- **Magic addresses stay** as deterministic per-recipient overrides (documented set, `@fake.test` / `+tag`).
- **Per-account fake keys** (plus the always-valid `0000-00-0000` default), issued via the API on marketplace
  install; multiple named keys allowed within an account for rotation.
- **Marketplace cardinality:** fake-email is **single-instance (`0:1`)** via the marketplace's existing
  `multiInstance` flag (default single) — no new attribute. Marketplace build itself is deferred.
- **Seeded default = all knobs OFF** — full delivery, no bounces/complaints, no engagement, no webhooks. Tune
  after real testing begins.
- **Emails partitioned by account** (isolated inbox/scenarios/metrics; keys roll up to the account).
- **Storage:** S3 bodies + in-memory index (default); key registry as JSON in S3; DDB deferred.
- **Webhooks:** a direct **signed HTTP callback** to a URL set in the provider config (default
  `http://localhost:9000/webhook/email/fake`); email-service ingress is `POST /webhook/email/<provider>`.

# Open questions (for review)

- None outstanding — revisit the seeded knob values once testing is underway.

# eof
