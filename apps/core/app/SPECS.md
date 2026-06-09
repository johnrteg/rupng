#
# App service (the web BFF — client-shell concerns)
#

# Objective

The **backend-for-frontend (BFF)** for the web client: the one service for the **cross-cutting client-shell
concerns** that aren't any single domain service's job — **startup config**, **feature flags**, **web
telemetry / error intake**, **UI aggregation**, **version/maintenance state**. Deliberately a **macro
service**: these all share one shape — *stateless, client-facing, read-mostly, aggregating from other
services* — so they **cohere** as one BFF rather than a swarm of tiny services.

# Why a service — and why not the edge / collab / a config-only micro-service

* **Not `collab`** — collab is **stateful, full-duplex, room-affinity** (CRDT/chat). The BFF is **stateless
  request/response**. Operational opposites; merging them is incoherent.
* **Not the edge** — the edge (cloud: **API Gateway + CloudFront**; local: the dev-only
  [webproxy](../webproxy/SPECS.md)) is pure **transport** — serve the SPA, route `/app/*` by prefix. The BFF
  is a deployed **backend** the edge routes *to*. Layered, not overlapping.
* **Not a config-only service** — serving one JSON blob doesn't justify a service. But **bundled** with
  flags / RUM / aggregation / version-gate (same shape), a single BFF is the right macro seam — micro per
  concern would be sprawl.

# What it owns / delegates

**Owns** (the client-shell surface, all under `/app/*`):

* **Bootstrap config** — the per-subdomain public blob the SPA reads at startup, **including feature flags**
  (not a separate concern — just part of bootstrap; see below). The flagship.
* **Web telemetry / error intake** — RUM / web-vitals / `ErrorBoundary` crash reports → forwarded to
  **[monitor](../monitor/SPECS.md)** (with `transactionId`). *(RUM for perf/errors; product analytics is
  first-party via [analytics](../analytics/SPECS.md), **not** Google Analytics — see Telemetry & analytics.)*
* **Customer support glue** — **Zendesk help-article proxy** (token held **server-side**, never in the
  browser), support-ticket creation, and **page sharing** (a user hands support their current page + context
  — URL, app state, ids — so support sees exactly where they are). The deployed home for the Zendesk
  passthrough that the **dev-only [webproxy](../webproxy/SPECS.md)** only emulates locally.
* **UI aggregation / composition** — one authed call fans out to N services, shaped for a screen (kills
  client round-trips — the classic BFF win).
* **Application notifications & announcements** — scheduled, windowed, classed messages (holiday support
  hours, a system issue, a marketing offer, a webinar) with **error/warning/info** severity, plus
  **login-screen HTML** (pre-auth). Version-gate / maintenance ("new version, please refresh") is one class
  of these. **The BFF *owns* these** (its one system-of-record) — see Application notifications below.

**Delegates (aggregates, never owns the source of truth):**

| Data | Source of truth |
|---|---|
| Branding / whitelabel / **plan-derived limits** + **account-level feature flags** | **[account](../account/SPECS.md)** (plan + per-account flags, toggled by **customer support**) |
| Password policy / login + SSO config | **[auth](../auth/SPECS.md)** |
| Raw config values, upload limits, public keys, **platform feature flags** | **AppConfig** ([aws/SPECS.md](../../../packages/services/src/aws/SPECS.md)) — *change without redeploy* |
| Telemetry storage / dashboards | **[monitor](../monitor/SPECS.md)** |
| Attribution | **[analytics](../analytics/SPECS.md)** |

The BFF is a **read-model aggregator + intake** — with **one** exception it owns outright: **application
notifications** (below).

# Bootstrap config (the flagship)

The SPA can't render its login page without it, so it's **public, pre-auth, edge-cached**:

* **Per-subdomain** — resolve `Host` → whitelabel subdomain → **account**; different whitelabel domains get
  different branding/limits.
* **Assembled, not owned** — branding + plan-limits (**account**), password policy + login/SSO config
  (**auth**), upload limits + **publishable** keys (**AppConfig**).
* **Feature flags are part of this blob (not a separate service), resolved from two tiers:**
  **platform** flags (**AppConfig** — global rollout/kill-switch) **merged with** **account-level** flags
  (**account** service, toggled by **customer support** per account — see the support glue above). The BFF
  merges them (account override wins) and returns the effective set in `featureFlags`.
* **Changes without redeploy** — backed by **AppConfig**; served behind **CloudFront**, **cache-busted on
  change** (AppConfig deploy → invalidate). 
* **Public-safe only** — **no secrets**, only *publishable* keys (Stripe publishable, reCAPTCHA site key,
  maps). Password **policy** is public-safe (the client enforces it; auth re-enforces server-side). **No
  PII** (it's pre-auth + cached).

```
GET /app/bootstrap            (public, cached, keyed by Host)
  -> { branding, name, passwordPolicy, uploadLimits, publishableKeys, featureFlags, version,
       notices: [ … active login-screen notices … ] }
```

# Application notifications & announcements

Admin/support can **author, schedule, and pause** app-wide messages (holiday support hours, a system issue,
a marketing offer, a webinar invite). The BFF **owns** these (its one datastore) and serves only the
**currently-active** set; the client renders by severity/placement.

A **Notice**:

| Field | Meaning |
|---|---|
| `class` | **system** (maintenance / issue / holiday hours) · **marketing** · **support** · **offer** · **webinar** |
| `severity` | **error** · **warning** · **info** — drives client styling/urgency |
| `title` + `body` | text; **HTML allowed** (esp. login-screen messages) — sanitized on render |
| `placement` | **login** (pre-auth screen) · **banner** (global in-app) · **center** (notification list) |
| `window` | active range **`{ start, end }`** — **UTC instants + an IANA `timeZone`** for authoring/display, per the platform [time discipline](../../../SPECS.md) ("holiday hours Dec 24–26 ET" stored UTC, shown in zone) |
| `audience` | **platform-wide** · per-**account** · per-**whitelabel subdomain** · per-**role** |
| `paused` | **pause without deleting** — a paused notice is excluded regardless of window (admin kill-switch) |
| `dismissible` | may the user dismiss it (and is the dismissal remembered)? |
| `cta?` | optional action — a **tracked [links](../links/SPECS.md)** URL (so offer/webinar clicks attribute) |

* **"Active now" = `paused == false` AND `now` ∈ `window` AND `audience` matches** the request
  (subdomain → account, + the caller's role when authed). The BFF resolves this; the client just renders.
* **Two delivery paths, matching the security tiers:**
  * **Login-screen (pre-auth)** notices ride the **public `bootstrap`** response (`notices[]`) — **public-safe
    only**, no PII, edge-cached (so a paused/expired notice clears on cache-bust). HTML is **sanitized**.
  * **In-app** (banner / center) notices come from an **authed** endpoint, filtered by account + role.
* **Version-gate / maintenance** is just a `system` notice (often `severity: warning` + `placement: banner`)
  — not a separate mechanism.
* **Managed by customer support / platform admin** (same crowd that toggles account feature flags) via an
  admin surface; **audited** (who scheduled/paused what).

```
GET /app/notices              (authed; filtered by account + role)   -> Notice[]   (active, in-app)
# login-screen notices are embedded in GET /app/bootstrap → notices[]  (public, cached)
```

# Two security tiers

* **Public, cacheable** — `bootstrap`, public feature flags, telemetry/error **intake** (unauthenticated but
  **rate-limited + validated**; intake only, never returns data).
* **Authenticated** — UI **aggregation/composition** endpoints (JWT); they just compose other services'
  authed calls and shape the result. No new authority — every underlying call is authorized by its owner.

# Routing

`/app/*` (the service-prefix convention) → this service, behind the edge (**API Gateway + CloudFront** in
cloud; the dev-only **webproxy** locally). `bootstrap` is the public, edge-cached path; aggregation paths
are authed.

# Relationship to other client-facing pieces

* **Edge** — cloud: **API Gateway + CloudFront** *routes* `/app/*` here + serves the SPA; local: the
  dev-only **[webproxy](../webproxy/SPECS.md)** emulates it. Pure transport, not the BFF.
* **[realtime](../realtime/SPECS.md)** — server→client push (notifications). The BFF is request/response.
* **[collab](../collab/SPECS.md)** — stateful live rooms. Unrelated to the BFF (kept separate by design).
* **[web](../web/SPECS.md)** — the consumer: calls `/app/bootstrap` at startup, POSTs crashes/RUM, uses
  aggregation endpoints.

# Stateless & scalable

Read-mostly, public-or-authed request/response → **stateless compute**, horizontally scalable,
**edge-cached** on the public paths. Lambda or small Fargate. Its **only** persistence is the
**notices/announcements table** (DynamoDB — see Application notifications); everything else it reads from
AppConfig or calls from other services.

# Telemetry & analytics (decided)

Two distinct streams to two sinks — kept separate because they answer different questions.

## RUM — engineering telemetry (CloudWatch RUM)

*"Is the app fast and reliable for real users?"* — technical health, **not** feature usage. What it captures:

* **Core Web Vitals** — **LCP** (load), **INP** (interactivity), **CLS** (layout stability), plus **FCP** /
  **TTFB** — the *real* distribution across users, not a lab score.
* **JS errors + unhandled rejections** — the `window.onerror` / `onunhandledrejection` handlers already in
  `App.tsx`, plus `ErrorBoundary` crashes **with the stack**, so production breakage actually surfaces.
* **Frontend API timing + error rates** — how slow each `/<service>/*` call is **from the user's browser**
  (real latency incl. their network), and which 4xx/5xx they hit.
* **Page / SPA route-change timing** and **session journeys** (the route sequence within a session).
* **Segmentation** — by **device / browser / OS / geo** (parsed with `@repo/common`'s `UserAgent`).
* **Backend correlation** — events carry the **`transactionId`**, so a slow page links to its **X-Ray /
  [monitor](../monitor/SPECS.md)** span — you see the exact server work behind a slow render.

*Path:* the RUM agent ships vitals/perf to **CloudWatch RUM**; errors + custom events route **through the BFF
intake** so they're enriched (auth context, `transactionId`) before → **monitor**.

## User-behavior metrics — first-party, NOT Google Analytics

*"What do users do — which features, which funnels, do they convert?"* — captured in **our own pipeline**,
never GA:

* **Domain-meaningful events, not generic pageviews** — `campaign.created`, `report.run`,
  `contact.imported`, `onboarding.step.completed`, CTA clicks — emitted from the web app **through the BFF
  intake → Kafka → [analytics](../analytics/SPECS.md)** (the same event backbone as everything else).
* **Tied to real identity** — events carry the authenticated **account / user**, so funnels, retention, and
  **conversions attribute 1:1**, joined with **`links`** click/scan touches + **workflow** events for
  end-to-end attribution. (GA's anonymized, sampled, cookie-based model can't do this.)
* **Why not GA:**
  * **Compliance** — GA ships user data to a **third party** → a **GDPR / SOC 2** liability (consent
    banners, DPAs, data residency). First-party keeps it **in our infra**; GDPR-forget purges it.
  * **Redundant** — we *are* an analytics platform; funnels/attribution are a pipeline **we already own**.
  * **Richer** — first-party events are identity-joined and un-sampled, vs GA's anonymized aggregates.

**RUM and behavior analytics are complementary, not substitutes** — perf/reliability (RUM → monitor) vs
product/behavior (events → analytics). The BFF is the shared **client-telemetry intake** that splits the two
to their sinks.

# Open items (backlog)

* **Edge-cache strategy per subdomain** — TTL + invalidation on AppConfig/account/branding change (flags +
  branding must propagate promptly when support toggles them).
* **UI-aggregation scope** — which screens get composition endpoints (only where round-trips hurt; don't
  turn the BFF into a god-gateway).
* **Page-sharing depth** — static page+context capture (a link/ticket attachment) vs live co-browse (which
  would lean on [collab](../collab/SPECS.md), not the BFF).
* **Notices: admin surface + dismissal state** — where support/admin author/schedule/pause notices (an
  admin app vs an `/app` admin route), and where per-user **dismissals** persist (client-local vs server so
  it follows the user across devices).
* **i18n / locale bundles, A/B assignment, CSRF/session bootstrap** — fold in here as they arise (same shape).

# Dependencies

* `@repo/services` — **AppConfig** (config/flags), **`Dynamo`** (the notices/announcements table), `Cache`
  (edge/secondary cache), `Kafka`/`Sqs` (forward telemetry/errors to monitor).
* `@repo/endpoint` (the BFF's own endpoints), `@repo/common` (`Type` incl. `ZonedDateTime` for notice
  windows, `Result`, `UserAgent` for RUM).
* Reads/calls **account**, **auth**, **monitor**, **analytics**, **[links](../links/SPECS.md)** (notice CTAs);
  sits behind the edge (API Gateway / CloudFront; webproxy locally); consumed by **web**.

# eof
