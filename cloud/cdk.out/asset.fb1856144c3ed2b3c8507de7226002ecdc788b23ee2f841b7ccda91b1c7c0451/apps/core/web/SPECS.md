#
# Web — app spec & discussion
#

The React/TypeScript SPA — stack/hosting below, then app-level design notes + TODOs; per-area detail
lives with the code.

# Role & boundaries

**Owns:** the **React/TypeScript SPA** — UI, client-side state (`AppModel` + model services), routing, the
in-browser **realtime client**, **localization**, **behavior-event capture**, and the static **build / hosting**.

**Delegates / does NOT do:**

| Concern | Owner |
|---|---|
| Business logic / persistence / the **write path** | the services, via **REST** through the **[app](../app/SPECS.md) BFF** |
| **Realtime push** (server → client) | **[realtime](../realtime/SPECS.md)** — web is a **receive-only** client |
| The behavior-**event catalog** + usage | **[analytics](../analytics/SPECS.md)** (web owns capture / batch / delivery) |
| **Collaborative editing** backend (Y.js rooms) | a future **[collab](../collab/SPECS.md)** service (separate socket) |
| **Identity / tokens** | **[auth](../auth/specs/SPECS.md)** (web holds the session, doesn't define it) |
| **Whitelabel domain / cert** | platform DNS + hosting ([account](../account/specs/SPECS.md) whitelabel) |

> **The socket is never a write path** — every durable mutation goes through the authorized, audited **REST**
> path; the WS is push-only (+ an optional thin signal route). See *Realtime* below.

# Stack & hosting

* **React + TypeScript + MUI**; consider **Vite** as the bundler (over webpack).
* **Static hosting on S3 via Amplify Hosting — DECIDED** (gap #2). **Amplify** over bare CloudFront for the
  managed CI/CD + ops it gives out of the box: **custom domains** (needed for **whitelabel**),
  **branch-per-environment** (development / staging / production), **password-protected staging previews**,
  **zero-downtime deploys + easy rollbacks**, auto subdomains, **managed SSL**, build-and-deploy from git.
  *(Amplify still uses **CloudFront** as the CDN under the hood — we get the edge delivery without managing the
  distribution + cert + CI ourselves.)*
* **WebSocket** — API Gateway WebSockets (see Realtime below).
* **Monitoring** — CloudWatch **RUM**; user-monitoring forwarded to the monitor service with a
  **transaction-id** for correlation.

# Source layout & path aliases

Imports use **path aliases, never relative cross-directory traversal** (`@model/AppModel`, not
`../model/AppModel`). Aliases keep imports readable and make files **move-safe** (move a file and its
`@…` imports don't change). Declared in [`tsconfig.json`](tsconfig.json) `paths` (with `baseUrl: "."`).

```
src/
  api/        # @api/*      — endpoint definitions / client calls
  model/      # @model/*    — AppModel + model services (PubSubService, WebsocketService, …)
  common/     # @common/*   — non-widget shared infra (data, network, localize)
  pages/      # @pages/*    — page-level components
  main/       # @main/*     — app entry, router, error boundary
  utils/      # @utils/*    — browser/app utilities (BrowserUtils, …)
  widgets/    # @widgets/*  — UI components, split by knowledge:
    core/     #   @widgets/core/*  — generic primitives, NO domain knowledge (Subscriber, TextInput,
              #                      CheckboxInput, TextLabel, ButtonIcon, Show, HtmlInput, …) — a reusable
              #                      UI kit; could graduate to a shared `@repo/ui` package later
    app/      #   @widgets/app/*   — domain widgets used across pages (import @model/@api, compose primitives)
```

* **Widget split test** — *"could it drop into a different app unchanged?"* → `core`. *"does it import
  `@model`/`@api`?"* → `app`.
* **Distinct from the platform packages** — `@common/*` here is the web app's `src/common`; the workspace
  packages are `@repo/common` / `@repo/endpoint` / … (re-listed in [`tsconfig.json`](tsconfig.json) `paths`,
  since `extends` doesn't merge them). Don't confuse `@common` (app) with `@repo/common` (package).
* Generic widgets currently imported from `@common/widgets/*` should land in **`@widgets/core/*`** when
  ported (leaving `@common` for `data`/`network` only).

# Build tooling (Vite)

The web app builds with **Vite** (dev server + production bundler; Vite 8 bundles via **Rolldown**, a Rust
port of Rollup). Config: [vite.config.ts](vite.config.ts).

## Two modes
* **`npm run dev`** → Vite dev server on **`localhost:5173`** (`server.port`). Serves source as **native ESM,
  unbundled**, with **HMR** (edit → hot-swap, state preserved). **Dev-only** — there is no port in production
  (it's static files). For single-origin dev, proxy API calls via Vite `server.proxy`, or serve the built
  `bin/` through the dev-only [webproxy](../webproxy/SPECS.md).
* **`npm run build`** → bundles to **`bin/`** (what the webproxy serves): minify, tree-shake, code-split,
  content-hash. `npm run preview` serves the built output. **`typecheck` = `tsc --noEmit`** is separate —
  Vite transpiles **without** type-checking (esbuild/Rolldown), so type errors don't block a build; run
  typecheck in CI.

## Entry & resolution
* **Entry = `index.html` (package root) → `<script src="/src/main/index.tsx">`** — the
  `createRoot(...).render(<App/>)` mount. `tsc` has **no** entry (it compiles all of `src/**/*`); the
  **bundler** is what starts at the entry and follows the import graph.
* **Aliases via `resolve.tsconfigPaths: true`** (Vite 8 native) — Vite honors the **same** `@`-aliases as
  `tsconfig.json` `paths` (one source of truth: `@widgets/core`, `@model`, `@utils`, `@repo/common`, …); no
  separate alias list to maintain.
* **Static assets** (`/assets/banner`, `/assets/language`, `/assets/themes`, favicon) live in **`public/`**
  — served at the web root, copied into `bin/` on build.
* `import.meta.env.*` is typed via [src/vite-env.d.ts](src/vite-env.d.ts)
  (`/// <reference types="vite/client" />`).

## Code splitting (don't ship one giant bundle)
Goal: **load on demand + cache the stable parts.** Two mechanisms:
* **Automatic, per route/feature** — any `React.lazy(() => import(...))` / dynamic `import()` becomes its own
  chunk, loaded on demand. **`AppRouter` already lazy-loads every page**, so each route is its own chunk —
  the highest-value split.
* **Vendor split** — `build.rollupOptions.output.manualChunks` groups `node_modules` into stable chunks
  (`react`, `mui`, `editor` = codemirror, `emoji`, `vendor`). Big libs change rarely; **content hashes**
  (`mui-a1b2c3.js`) mean a release only re-hashes the chunks that changed → the browser keeps the cached
  `react`/`mui`. One bundle would re-download everything every deploy.

**Strategy (priority order):** (1) **route-based lazy** — done (AppRouter); (2) **vendor-split** stable libs
for caching — done; (3) **isolate heavy, rarely-used libs** (codemirror, emoji, `@mui/x-date-pickers`) into
their own chunk **and** `React.lazy` the widgets that use them, so they're off the initial load; (4) **don't
over-split** (too many tiny chunks → HTTP overhead / request waterfalls — a few logical groups); (5) **read
the build size report** (Vite warns on chunks > 500 KB) and tune.

## Subresource Integrity (SRI) — build-time, environment-aware

SRI pins the **exact bytes** of each script the browser runs — a tampered chunk (compromised host / CDN) **fails
its hash and won't execute** (supply-chain integrity, OWASP A08). **Enabled** — but it's a **build-time**
concern, applied **per environment** (it must support local *and* production):

* **Production build (`npm run build` → `bin/`)** — a Vite **build plugin** computes a hash for **every emitted
  chunk** (entry + vendor + **lazy route chunks**) and injects `integrity` + `crossorigin` into `index.html`
  **and the `modulepreload` links** — so **dynamically-imported** chunks are covered, not just static
  `<script>`s. Hashes regenerate each build (content-addressed, like the chunk filenames).
* **`npm run dev` (Vite dev server) — SRI off.** Sources are served **unbundled** and **HMR mutates modules
  live**, so there are no stable bytes to hash and integrity would break hot-swap; localhost over the trusted
  dev server gains nothing. The plugin runs on **`build` only, not `serve`**.
* **Serving built `bin/` locally (via the dev-only [webproxy](../webproxy/SPECS.md)) — identical to prod.** The
  integrity attributes are baked into the built `index.html`, so the **same SRI** is enforced whether `bin/` is
  served by **Amplify** (prod) or the **webproxy** (local). The built artifact is **portable**.

So SRI is environment-aware **by construction**: off in HMR dev (where it can't apply), on in the **built
artifact** (same behavior local-serve + prod). Enforcement is the **`integrity` attribute itself** (the browser
blocks on mismatch) — so the guarantee is only as complete as the plugin's coverage; the requirement is that
**every** emitted chunk (incl. lazy / `modulepreload`) gets a hash. *(CSP `require-sri-for` has poor / removed
browser support — don't rely on it; rely on injecting `integrity` on every chunk at build.)*

# Localization (i18n)

UI strings are **per-locale JSON dictionaries** loaded at runtime by `LocaleService`; `label('some.key')`
looks the key up in the active locale (dates / numbers / currency go through `Intl`). Switching locale loads
the new file and publishes `PubSubService.Type.LANGUAGE` → the app re-renders. **Default locale: `en-US`**;
the choice persists in a cookie. A missing key renders as **`!some.key`** (gaps are visible) — which makes
**`en-US` the source of truth for keys**.

Files live in **`public/assets/language/`** — Vite serves `public/` at the web root, so they're reached at
**`/assets/language/`** (and copied verbatim into `bin/assets/language/` on build). All app assets
(`banner`, `themes`, `favicon`, `audio`, `icons`, `language`) live under **`public/assets/`** for the same
reason — source-controlled, auto-copied, no build step:
* **`index.json`** — the list of available locales, e.g. `["en-US","es-ES","fr-FR"]`. This populates the
  language picker (`appmodel.ui.locale.languages`).
* **`<locale>.json`** — one flat `key → string` dictionary per locale.

## Add a new language
1. **Register it** — add the BCP-47 code to **`public/assets/language/index.json`** (e.g. add `"de-DE"`).
   That's all the picker needs — the display name is derived automatically via `Intl.DisplayNames`.
2. **Create the file** — `public/assets/language/<locale>.json`. Copy **`en-US.json`** (the key reference), keep the
   **same keys**, translate the values. (Keys missing from a locale fall back to `!key`, so always start from
   en-US.)
3. **Translate** — edit the locale files with **BabelEdit** (use the **generic JSON** format); it keeps every
   locale's keys in sync and flags missing / extra keys. Download: **https://www.babeledit.com/**.

> Strings are simple `key → text` today. When you need **interpolation / pluralization** ("3 contacts
> selected", "Welcome, {name}"), keep `LocaleService` and add **ICU MessageFormat** (via `intl-messageformat`)
> inside `label()` — still authored in BabelEdit. Reach for full react-intl / react-i18next only if you need
> rich-text-in-sentences or namespace lazy-loading.

# Realtime — WebSocket client (`WebsocketService`)

The browser connects to the account WebSocket for **server → client push** (live inbox, updates,
notifications). [`WebsocketService`](src/model/service/WebsocketService.ts) wraps
`reconnecting-websocket` and routes inbound frames to the in-memory bus
([`PubSubService`](src/model/service/PubSubService.ts)) for components to subscribe to.

* **One shared envelope** — a frame is the platform-wide `Type.MessageEnvelope` (`@repo/common`), the
  **same body** Kafka publishes; `WebsocketService.Message` is a type-only alias of it. Consumers `switch`
  on `type`. Type-only import keeps server/AWS code out of the web bundle; see
  [root SPECS → Events & messaging](../../../docs/SPECS.md).
* **Safe parse** — frames go through `ObjectUtils.parseJSON` (returns `null`, never throws), so a
  keepalive/ping or malformed frame is dropped, not turned into an unhandled rejection.
* **Reconnect** — `reconnecting-websocket` with `maxRetries` capped on `localhost` (dev), `Infinity` in
  prod; the socket is torn down + rebuilt on account switch (`setAccountId`).

> **Connect auth is not yet implemented** — the socket currently connects with `?accountId=` and no token.
> Tracked in **[TODO.md → Connect auth](TODO.md)**.

## Outbound `send()` — receive-only for content; narrow exceptions

**`WebsocketService` stays receive-only** (server → client). Durable client *actions* go through the
**REST API**, not the socket — one auth path, one write path, realtime stays push-only. That holds even for
**internal user-to-user messaging**: the composer **`POST`s** the message (authorized once, **persisted** —
chat must be durable, not fire-and-forget), the server **fans it out via the push/outbox path**, and the
sender gets the same realtime echo as the recipient. **REST-send + WS-receive** — latency is a non-issue for
human messaging (tens of ms). So **messaging does *not* need client `send()`.**

> **Principle — `send()` never replaces REST.** If we ever add an inbound socket frame, it carries
> **signaling only** (ephemeral state, flow-control) — **never a durable action or mutation**. Every
> persisted write/command goes through the **authorized, audited REST path**, full stop. The socket is an
> optimization layer on top of REST, **not a second write path** — so there's no action-auth to duplicate
> and no way to mutate state by talking to the socket.

Three things *could* justify client→server frames — sorted by how they're handled:

1. **Ephemeral signals** (typing indicators, presence heartbeats, read receipts, the flow-control **ACK** —
   see realtime SPECS → Throughput & flow control). High-frequency, throwaway, not worth a persisted REST
   write each. These warrant a **narrow, constrained inbound route** on this socket (a thin AGW
   `$default`/`signal` route: validate participant → hand off) — **not** a general action channel.
2. **Durable content** (messages, edits-as-actions) → **REST**, as above. Never the socket.
3. **Collaborative document editing (tiptap / Y.js)** → a **different protocol on a different socket** — see
   below. The one truly full-duplex case, and it still doesn't extend *this* socket.

For reference, the API Gateway WebSocket model if/when we add the inbound signal route:

* **Bidirectional via route selection.** `RWS.send(data)` → API Gateway routes by a body field
  (`$request.body.action`); `{ "action": "signal", … }` hits the `signal` route's handler. Standard routes:
  `$connect` (auth), `$disconnect` (cleanup), `$default`. Inbound handlers **validate + hand off** — no heavy
  work in the socket handler.
* **Push is a separate API**, not a `send()`: the backend calls **`PostToConnection`**
  ([`WebSocketApi`](../../../packages/services/src/aws/WebSocketApi.ts)) against a stored `connectionId` —
  hence the **connection registry**; any instance can push.
* **Limits:** ~10 min idle, 2 h max connection, 128 KB frame; large payload → `S3.presignGet` pointer.

## Collaborative editing (tiptap / Y.js) — a dedicated socket, not this one

Joint document editing (tiptap WYSIWYG — e.g. shared templates, scripts, docs) is genuinely full-duplex,
keystroke-frequency sync — but it does **not** belong on the notification socket:

* **Different protocol** — tiptap collaboration rides **Y.js** (a **CRDT**): binary update + awareness
  messages, *merged* (not last-write-wins) — nothing like our `MessageEnvelope` JSON events.
* **Different durability** — the **merged CRDT doc is the source of truth** (persist snapshots + an update
  log), not per-keystroke events.
* **Different scaling** — **per-document rooms with affinity** (all editors share live doc state), not
  per-account fan-out. **AGW WebSocket + Lambda is a poor fit** (stateless, no room affinity, no in-memory
  `Y.Doc` — you'd reinvent a collab server on Lambda).
* **Decision — self-host, no external SaaS** (gap #3; aligns with the **data-in-our-infra** tenet — a collab
  SaaS would put customers' document content in a third party). The whole stack is self-hostable open source:
  **Y.js** (the CRDT — always ours, browser + server) + **tiptap** `Collaboration` extension client-side, and a
  **dedicated collaboration service** built *on* an open-source Y.js server — **Hocuspocus** (tiptap's, Node;
  auth + persistence + Redis-scaling hooks) **on ECS Fargate** (stateful per-doc rooms; **Redis** backplane for
  multi-node; **persist snapshots + update log to S3 / DynamoDB** — content stays in our infra), on its **own
  WebSocket** with **per-document auth**. *(Alternative: **y-redis** — the Y.js author's stateless Redis-backed
  backend — if we prioritize horizontal scale over batteries.)* **Lambda is a poor fit** (stateless, no room
  affinity). The browser uses the **Y.js provider** as a **separate client** from `WebsocketService`. The
  build-out lives in the **[collab](../collab/SPECS.md)** service.

Net: `WebsocketService` = receive-only notifications (+ an optional thin signal route); collaboration = its
own duplex client + backend. No general `send()` on the notification socket.

The collab backend, room model, and make-vs-buy live in the **[collab service spec](../collab/SPECS.md)** —
it also covers **intra-texting** (live in-app chat rooms) and future **whiteboarding** on the same substrate.

# Behavior instrumentation (product analytics)

First-party product analytics — **not Google Analytics** (see [app BFF → Telemetry & analytics](../app/SPECS.md)).
React components emit **named, domain-meaningful** behavior events; the web side owns **capture + batching +
delivery**, and **[analytics](../analytics/SPECS.md)** owns the canonical **event catalog + usage**.

## What to emit (intent + UX, not raw clicks)

Track what the **client uniquely knows** — navigation, dialog flows, intent, search, client-side friction.
**Don't re-track server outcomes** (`campaign.sent`, `payment.succeeded` already arrive as Kafka domain
events): the client fires the *intent* ("clicked send"), the server confirms the *result*. The full catalog +
categories live in [analytics → Product / behavior events](../analytics/SPECS.md). Rules: **named events**
(`object.action`, e.g. `report.create.clicked`, `dialog.abandoned`); **never PII in props** (opaque ids;
search → length + result count, not the raw query); **debounce chatty signals** (scroll/typing) before emit.

## One `track()` helper (auto-attaches the envelope)

Components call `track('report.create.clicked', { templateId })`; the helper stamps the common envelope so
every event is consistent: `event`, `occurredAt` (UTC), `accountId` + `userId`, `sessionId`, current `route`,
`transactionId` (correlates to RUM/backend), `appVersion`, device (`@repo/common` `UserAgent`), `locale`,
whitelabel `subdomain`, `props`.

## Where & when — buffer (cache) + periodic send

Events are **never sent one-per-call** (too chatty — wasteful on network/battery and rate limits). Instead:

* **Buffer in memory** — `track()` pushes onto an in-memory queue (the client-side cache).
* **Flush on a timer** — every **~10–30 s**, *or* when the buffer hits a **count/byte cap** (whichever first)
  → **batch POST** to the BFF intake (`POST /app/events`).
* **Flush on page-hide** — `visibilitychange→hidden` / `pagehide` → flush immediately via
  **`navigator.sendBeacon`** (fires reliably during unload; a normal `fetch` gets cancelled). This is what
  captures the "closed the tab" + final-action events.
* **Resilience** — on a failed flush keep the batch and retry next tick; **cap the buffer** (drop oldest
  low-value events) so a long offline stretch can't grow unbounded; optionally persist to `sessionStorage`
  so a reload doesn't lose the last batch.

Net: cheap (batched), reliable (beacon on exit), consistent (one envelope) → the BFF fans each batch to
Kafka → analytics.

# AWS Services and Other Dependencies

**AWS services**
* **Amplify Hosting** (over **S3** + **CloudFront** under the hood) — serves the built `bin/`; CI/CD,
  whitelabel custom domains, env-per-branch, managed SSL, rollbacks *(gap #2 — DECIDED)*.
* **API Gateway (WebSocket)** — the realtime push socket (server→client; `PostToConnection`).
* **CloudWatch RUM** — real-user monitoring → forwarded to **[monitor](../monitor/SPECS.md)** with a `transactionId`.
* **Route 53 / ACM** *(or the customer's registrar)* — **whitelabel** custom domains + managed certs.

**Third-party libraries / services**
* **React · TypeScript · MUI** · **Vite** (Vite 8 → **Rolldown**); **`reconnecting-websocket`**.
* Heavy/lazy libs — **CodeMirror** (editor), **emoji**, **`@mui/x-date-pickers`** (own chunks).
* *(later)* **`intl-messageformat`** (ICU); **tiptap / Y.js** + **Hocuspocus** *or* Tiptap Cloud / Liveblocks (collab — build-vs-buy, gap #3). **BabelEdit** = dev-only translation tool.

**Internal (`@repo/*`) + services**
* `@repo/common` (`Type.MessageEnvelope`, `UserAgent`, `Type`), `@repo/endpoint` (endpoint defs / client).
* Consumes the **[app](../app/SPECS.md) BFF** (REST + `POST /app/events`); **[realtime](../realtime/SPECS.md)** (WS push); **[analytics](../analytics/SPECS.md)** (event catalog); **[auth](../auth/specs/SPECS.md)** (session); a future **[collab](../collab/SPECS.md)** (Y.js). Dev: the **[webproxy](../webproxy/SPECS.md)** serves `bin/`.

# Compliance & standards mapping

How **this web client's** controls map to **OWASP Top 10 (2021)**, **ISO/IEC 27001:2022** (Annex A), **SOC 2
Type 2** (TSC), **PCI** (if payment UI), **GDPR**, and **CCPA/CPRA**. The web app is a **browser client**, so its
dominant controls are **XSS / injection defense (CSP + React escaping)**, **no secrets in the bundle**, **no PII
in behavior events**, and **safe session-token handling**. Payment card data **never touches our JS** (hosted
**Stripe Elements** → PCI **SAQ-A**). **HIPAA** is ➖ (no PHI by [AUP](../account/specs/SPECS.md)). There is **no
messaging-law** surface (web is UI). Accessibility (**WCAG / ADA**) is a real legal surface — gap #6.

**Legend:** ✅ meets/exceeds · ⚠️ partial / open — see Gaps · ➖ n/a

| Web control | OWASP T10 | ISO 27001:2022 | SOC 2 (TSC) | PCI | GDPR | CCPA | |
|---|---|---|---|---|---|---|---|
| **XSS / injection defense** — React auto-escapes; **all server HTML sanitized (allowlist, DOMPurify) before render** (`web-6.7`); **CSP + security headers** at the CDN | A03 | A.8.26 / A.8.28 | CC6.1 / CC7.1 | ➖ | Art 32 | ➖ | ✅ |
| **No secrets in the bundle** — no API keys / credentials shipped to the browser; the BFF holds server secrets | A05 / A02 | A.8.24 | CC6.1 | ➖ | Art 32 | ➖ | ✅ |
| **Session tokens — two-token** — access in memory (`Bearer`; API CSRF-immune) + refresh in httpOnly+SameSite cookie; WS via single-use ticket | A07 | A.5.17 / A.8.5 | CC6.1 | ➖ | Art 32 | ➖ | ✅ (gaps #1 / #8) |
| **No PII in behavior events** — opaque ids; search → length + count, not the query | A09 | A.5.34 / A.8.11 | (Privacy) | ➖ | Art 5(1)(c) / 25 | §1798.100 | ✅ by rule |
| **Tenant isolation (client)** — whitelabel subdomain scope; **account switch tears down the WS + clears state** | A01 | A.8.3 | CC6.1 | ➖ | Art 32 | §1798.100 | ✅ |
| **Payment data never in our JS** — hosted **Stripe Elements** → **PCI SAQ-A** | A04 | A.5.34 | CC6.1 | **SAQ-A** | ➖ | ➖ | ✅ |
| **Transport** — TLS (CDN) + **WSS** | A02 | A.8.24 | CC6.1 | ✅ | Art 32 | ➖ | ✅ |
| **Supply chain + SRI** — pinned lockfile; vetted deps; **SRI on all build chunks** (build-time; dev-server exempt; same artifact local + prod) | A06 / A08 | A.8.30 | CC7.1 / CC8.1 | ➖ | ➖ | ➖ | ✅ |
| **Accessibility — WCAG 2.1 AA** (ADA) — keyboard / focus / contrast / ARIA, in the core kit + CI | ➖ | A.5.34 | (Privacy) | ➖ | ➖ | ➖ | ✅ target set (gap #6) |

> **Design-intent mapping** — how the client is *intended* to satisfy each control, not an attestation. Server
> auth/RBAC is [auth](../auth/specs/SPECS.md); the durable write path + its audit is the services via REST.

# Gaps & decisions

*The one review list — the notes above are the rationale.* ✅ = resolved/decided · ⚠️ = **open — needs attention**.

1. ✅ **WS connect-auth — DECIDED: single-use ticket.** Browsers can't set an `Authorization` header on the WS
   handshake, so the Bearer token (gap #8) can't ride it. Instead: **mint a short-lived (~30–60 s), single-use
   "WS ticket"** via an authed REST call (Bearer header) → pass as `?ticket=` to AGW **`$connect`** → a
   **`$connect` Lambda authorizer validates + burns it** (one-time → query-string log exposure is negligible).
   Real tokens never hit the URL; the socket is authenticated **before** any data. *(Replaces today's
   `?accountId=`-with-no-token — TODO.md.)*
2. ✅ **Hosting — DECIDED: Amplify Hosting.** Over bare CloudFront for the managed CI/CD + whitelabel custom
   domains + env-per-branch + password-protected previews + zero-downtime deploy/rollback out of the box.
   Amplify uses **CloudFront** under the hood, so we keep edge delivery without managing the distribution,
   certs, or CI ourselves.
3. ✅ **Collab editing — DECIDED: self-host (no external SaaS).** **Y.js** (CRDT) + **tiptap** client + a
   **Hocuspocus**-on-**ECS Fargate** server (Redis backplane, **persist to S3 / DynamoDB** — content stays in
   our infra), own WebSocket + per-document auth. *(Alt: **y-redis** for stateless scale.)* Aligns with
   data-in-our-infra; build-out → the **[collab](../collab/SPECS.md)** service.
4. ✅ **Realtime = receive-only; REST is the only write path — DECIDED.** The socket never carries a durable
   mutation (signaling-only if ever inbound); every persisted action goes through authorized/audited REST.
5. ✅ **Behavior analytics — DECIDED: first-party, buffered + beacon, no PII.** `track()` → in-memory buffer →
   timer/cap flush → `sendBeacon` on page-hide → BFF `POST /app/events` → Kafka → analytics.
6. ✅ **Accessibility target — DECIDED: WCAG 2.1 AA.** Baked into the **`@widgets/core`** kit (keyboard, focus,
   contrast, ARIA) so every page inherits it, and **enforced in CI** (automated axe-core checks + a manual
   audit checklist). AA is the standard procurement / ADA baseline; AAA is not a blanket target.
7. ✅ **i18n — DECIDED.** Per-locale JSON + `LocaleService`; `en-US` is the key source of truth; **ICU
   MessageFormat** added inside `label()` when interpolation/pluralization is needed.
8. ✅ **Session-token storage — DECIDED: two-token (memory access + httpOnly refresh).**
   * **Access token** — short-lived (~5–15 min), **in memory only** (never `localStorage`); sent as
     **`Authorization: Bearer`** on REST calls (a header, **not** an ambient cookie → the API is **CSRF-immune**).
     Lost on reload → silently re-minted.
   * **Refresh token** — long-lived, **httpOnly + Secure + SameSite=Strict cookie**, path-scoped to
     `/auth/refresh`; **JS can't read it** → XSS can't exfiltrate the durable credential. **Silent refresh** on
     load / pre-expiry / 401.
   * **CSRF** — only the cookie-bearing **refresh endpoint** needs it: **SameSite=Strict + double-submit CSRF
     token (or strict Origin/Referer check)**. Token issuance / refresh is **[auth](../auth/specs/SPECS.md)**'s.
   * *Rationale:* the easy-to-steal token (access) is short-lived + in memory; the durable one (refresh) is
     unreadable by JS — XSS can ride a live session but can't walk off with a lasting token.

# Requirements (traceable register)

The traceable requirement register for the **web app** (the sections above are the rationale; this is the coded
list). IDs are stable handles (**`web-N.M`**). **Priority:** **A** = MVP, **B** = core / hardening, **C** = later.
**Boundaries:** web owns the **SPA + client state + capture + build/hosting**; the **write path is REST via the
[app](../app/SPECS.md) BFF**, push is **[realtime](../realtime/SPECS.md)**, the event catalog is
**[analytics](../analytics/SPECS.md)**, collab is a **separate** service.

## web-1.0 Stack & hosting — A
- **web-1.1** **React + TypeScript + MUI**, bundled by **Vite** (Rolldown) — A
- **web-1.2** **Amplify Hosting** (S3 + CloudFront under the hood); **env-per-branch** (dev / staging / prod), whitelabel custom domains, managed SSL, zero-downtime deploy + rollback, CI/CD from git *(gap #2 — DECIDED)* — A
- **web-1.3** **Whitelabel custom domains** (Route 53 / ACM or customer registrar) — B
- **web-1.4** **CloudWatch RUM** → forwarded to **[monitor](../monitor/SPECS.md)** with a `transactionId` for correlation — B

## web-2.0 Source layout & build — A
- **web-2.1** **Path aliases, never relative cross-dir** (`@model`, `@widgets/core`, …); one source of truth in `tsconfig.json` `paths`, honored by Vite — A
- **web-2.2** **Widget split** — `@widgets/core` (no domain knowledge, reusable kit) vs `@widgets/app` (imports `@model`/`@api`) — A
- **web-2.3** **Code splitting** — route-based `React.lazy` (every page its own chunk) + vendor split (stable libs, content-hashed) + isolate heavy libs (CodeMirror / emoji / date-pickers) — B
- **web-2.4** **Typecheck in CI** (`tsc --noEmit`) — Vite transpiles without type-checking, so type errors don't block a build — A

## web-3.0 Localization (i18n) — B
- **web-3.1** **Per-locale JSON** dictionaries loaded at runtime by `LocaleService`; `label('key')`; `Intl` for date/number/currency *(gap #7)* — B
- **web-3.2** **`en-US` is the key source of truth**; a missing key renders `!key` (gaps visible); switching locale republishes + re-renders — B
- **web-3.3** **ICU MessageFormat** (via `intl-messageformat`) inside `label()` when interpolation / pluralization is needed — C

## web-4.0 Realtime client — A
- **web-4.1** **`WebsocketService`** — receive-only; wraps `reconnecting-websocket`; routes frames to `PubSubService` — A
- **web-4.2** **One shared envelope** (`Type.MessageEnvelope`, type-only import — no server code in the bundle); **safe parse** (drop malformed/keepalive) — A
- **web-4.3** **Reconnect** (capped on localhost, ∞ in prod); **teardown + rebuild on account switch** — A
- **web-4.4** **No client write path** — durable actions via REST; an optional inbound frame is **signaling-only** *(gap #4)* — A
- **web-4.5** **WS connect-auth — single-use ticket** — mint a short-lived one-time ticket via authed REST → `?ticket=` to AGW `$connect` → authorizer validates + burns it (real tokens never in the URL); authenticated before any data *(gap #1)* — A

## web-5.0 Behavior instrumentation — B
- **web-5.1** **`track('object.action', props)`** — auto-attaches the common envelope (account/user/session/route/`transactionId`/appVersion/device/locale/subdomain) — B
- **web-5.2** **Capture intent + UX, not server outcomes**; **named events**; **never PII in props**; **debounce** chatty signals *(gap #5)* — B
- **web-5.3** **Buffer + flush** — in-memory queue → timer (~10–30 s) / count-or-byte cap → batch `POST /app/events`; **`sendBeacon` on page-hide**; retry on fail; cap the buffer — B

## web-6.0 Security & compliance — A
- **web-6.1** **No secrets in the bundle**; **CSP + security headers** at the CDN; React escaping + **server-HTML sanitization** (`web-6.7`) — A
- **web-6.2** **Session tokens — two-token** — **access token in memory** (`Authorization: Bearer`, API CSRF-immune) + **refresh token in httpOnly+Secure+SameSite=Strict cookie** (silent refresh); CSRF-protect only the refresh endpoint *(gap #8)* — A
- **web-6.3** **No PII in behavior events** — opaque ids; search → length + count *(gap #5)* — A
- **web-6.4** **Tenant isolation** — whitelabel subdomain scope; account switch clears state + WS — A
- **web-6.5** **Payment data never in our JS** — hosted **Stripe Elements** (PCI SAQ-A) — A
- **web-6.6** **Supply chain + SRI** — pinned lockfile; vetted deps; **SRI on all build chunks** (entry + vendor + **lazy / modulepreload**), injected at **build** into `index.html`; **dev server exempt** (HMR / unbundled), built `bin/` carries it identically under **Amplify** (prod) + **webproxy** (local) — B
- **web-6.7** **Sanitize ALL server HTML before render** — any server-supplied content rendered **as HTML** (rich-text / template / message bodies, previews, anything via `dangerouslySetInnerHTML`) is **sanitized client-side** with an **allowlist** sanitizer (DOMPurify): strip `<script>`, inline **`on*=` handlers**, **`javascript:` / `data:`** URLs, `<iframe>`/`<object>`/`<embed>` — render only safe tags + attrs. **Never** `dangerouslySetInnerHTML` with raw server content. React auto-escapes elsewhere; this covers the **only** XSS vector (rendering HTML as HTML). Defense-in-depth: **producing services sanitize on store/output** via the shared **`Application.sanitizeHtml`** ([`@repo/services`](../../../packages/services/README.md); email-2.5 / collab-9.4 / survey-7.2.1 / app-8.4) — never trust pre-sanitization — A

## web-7.0 Accessibility & UX — B
- **web-7.1** **Accessibility = WCAG 2.1 AA** — baked into the **`@widgets/core`** kit (keyboard / focus / contrast / ARIA) + **enforced in CI** (axe-core) + a manual audit checklist *(gap #6 — DECIDED)* — B
- **web-7.2** **Responsive / mobile-web**; keyboard + ARIA in `@widgets/core` — B

## web-8.0 Collaborative editing (deferred) — C
- **web-8.1** **Dedicated Y.js client + socket** (tiptap), **not** `WebsocketService`; backend = a **self-hosted** [collab](../collab/SPECS.md) service (**Hocuspocus** on ECS Fargate + Redis + S3/DDB persistence; **no external SaaS**) *(gap #3)* — C

# eof
