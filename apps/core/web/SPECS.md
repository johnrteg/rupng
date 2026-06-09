#
# Web — app spec & discussion
#

The React/TypeScript SPA — stack/hosting below, then app-level design notes + TODOs; per-area detail
lives with the code.

# Stack & hosting

* **React + TypeScript + MUI**; consider **Vite** as the bundler (over webpack).
* **Static hosting on S3** (configured for website hosting), fronted by a CDN:
  * **CloudFront** — CDN in front of S3 for fast global delivery, **or**
  * **Amplify Hosting** — CI/CD, custom domains (needed for **whitelabel**), branch-per-environment
    (development / staging / production), password-protected staging previews, zero-downtime deploys +
    easy rollbacks, auto subdomains, managed SSL, build-and-deploy from git.
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

# Realtime — WebSocket client (`WebsocketService`)

The browser connects to the account WebSocket for **server → client push** (live inbox, updates,
notifications). [`WebsocketService`](src/model/service/WebsocketService.ts) wraps
`reconnecting-websocket` and routes inbound frames to the in-memory bus
([`PubSubService`](src/model/service/PubSubService.ts)) for components to subscribe to.

* **One shared envelope** — a frame is the platform-wide `Type.MessageEnvelope` (`@repo/common`), the
  **same body** Kafka publishes; `WebsocketService.Message` is a type-only alias of it. Consumers `switch`
  on `type`. Type-only import keeps server/AWS code out of the web bundle; see
  [root SPECS → Events & messaging](../../../SPECS.md).
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
* **Recommendation:** a **dedicated collaboration service** — **Hocuspocus** (tiptap's open-source Y.js
  backend) on **ECS Fargate** (stateful rooms, persist to S3/DB), on its **own WebSocket** with
  **per-document auth** — *or* a **managed** backend (Tiptap Cloud / Liveblocks). The browser uses the
  **Y.js provider** as a **separate client** from `WebsocketService`. **Build-vs-buy is open** (a future
  `collab` service).

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
