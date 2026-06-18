#
# App service (the web BFF — client-shell concerns)
#

# Objective

The **backend-for-frontend (BFF)** for the web client — the thin server seam **between the SPA and the domain
services**, so the SPA makes **one call to start** and the domain services stay pure. It is the **one home for
the cross-cutting client-shell concerns** that aren't any single service's job:

* **Startup config + feature flags** — the public, per-subdomain **bootstrap blob** the SPA can't render without
  (branding · password policy · publishable keys · the platform ⊕ account flag set · version · login notices).
* **Web telemetry / error intake** — RUM + crash reports → [monitor](../monitor/SPECS.md), and **first-party**
  product-behavior events → [analytics](../analytics/SPECS.md) (**never** Google Analytics — compliance + ownership).
* **UI aggregation** — one authed call fans out to N services, shaped for a screen (kills client round-trips).
* **Application notices / version-gate** — scheduled, classed announcements incl. the login screen (its **one** datastore).
* **Customer-support glue** — Zendesk help-article proxy (token server-side) · page-sharing · ticketing.

Deliberately a **macro service**: these all share one shape — *stateless, client-facing, read-mostly,
aggregating from other services* — so they **cohere** as one BFF rather than a swarm of tiny micro-services.

**Boundaries:** the BFF **adds no authority** — aggregation runs under the **caller's JWT**, each underlying call
authorized by its owner; it **owns only the notices datastore** and reads everything else from AppConfig or the
owning service. It is the **client shell's backend — not a data plane.**

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
  passthrough that the **dev-only [webproxy](../webproxy/SPECS.md)** only emulates locally — see Customer
  support below for the endpoints.
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
| Password policy / login + SSO config | **[auth](../auth/specs/SPECS.md)** |
| Raw config values, upload limits, public keys, **platform feature flags** | **AppConfig** ([aws/SPECS.md](../../../packages/services/src/aws/SPECS.md)) — *change without redeploy* |
| Telemetry storage / dashboards | **[monitor](../monitor/SPECS.md)** |
| Attribution | **[analytics](../analytics/SPECS.md)** |

The BFF is a **read-model aggregator + intake** — with **one** exception it owns outright: **application
notifications** (below).

# Bootstrap config (the flagship)

The SPA can't render its login page without it, so it's **public, pre-auth, and served fresh (no stale TTL —
revalidated each load)**:

* **Per-subdomain** — resolve `Host` → whitelabel subdomain → **account**; different whitelabel domains get
  different branding/limits.
* **Assembled, not owned** — branding + plan-limits (**account**), password policy + login/SSO config
  (**auth**), upload limits + **publishable** keys (**AppConfig**).
* **Feature flags are part of this blob (not a separate service), resolved from two tiers:**
  **platform** flags (**AppConfig** — global rollout/kill-switch) **merged with** **account-level** flags
  (**account** service, toggled by **customer support** per account — see the support glue above). The BFF
  merges them (account override wins) and returns the effective set in `featureFlags`.
* **Always current — no stale TTL** — backed by **AppConfig**, **served fresh / revalidated each load**
  (`Cache-Control: no-cache` + an **ETag** → `304` when unchanged), so a flag toggle or a login-notice
  activation / expiry is correct **on the very next load** — no edge-staleness, no invalidation race.
* **Public-safe only** — **no secrets**, only *publishable* keys (Stripe publishable, reCAPTCHA site key,
  maps). Password **policy** is public-safe (the client enforces it; auth re-enforces server-side). **No
  PII** (it's pre-auth + cached).

```
GET /app/bootstrap            (public, served fresh / no stale TTL, keyed by Host)
  -> { branding, name, passwordPolicy, uploadLimits, publishableKeys, featureFlags, version,
       notices: [ … active login-screen notices … ] }
```

# Application notifications & announcements

**Account admins** (scoped to their own account / whitelabel) and **support / platform staff** (platform-wide)
can **author, schedule, and pause** time-windowed messages — including a **login-page message** (holiday
support hours, a maintenance window, a marketing offer, a webinar invite). The BFF **owns** these (its one
datastore) and serves only the **currently-active** set; the client renders by severity/placement.

A **Notice**:

| Field | Meaning |
|---|---|
| `class` | **system** (maintenance / issue / holiday hours) · **marketing** · **support** · **offer** · **webinar** |
| `severity` | **error** · **warning** · **info** — drives client styling/urgency |
| `title` + `body` | **vanilla, server-sanitized HTML** — a small **allowlist**: basic text styling (`b`/`i`/`em`/`strong`/`p`/`br`/`ul`/`ol`/`li`/`h*`), **one `img`**, and **`a` links**. **`script`, inline `style`/CSS, and `on*` event handlers are stripped.** **URLs are constrained:** `img src` = **`https:` from our own media/CDN only**; `a href` = **`https:`** and routed through the tracked [links](../links/SPECS.md) service (no `javascript:`/`data:`/`mailto:`-only tricks, no off-allowlist hosts). Sanitized on **store *and* render**. |
| `placement` | the **at-login vs in-app** selector — **`login`** (the pre-auth login screen) · **`banner`** (global in-app) · **`center`** (in-app notification list). `login` is the *at-login* surface; `banner`/`center` are *in-app*. |
| `window` | active range **`{ start, end }`** — **UTC instants + an IANA `timeZone`** for authoring/display, per the platform [time discipline](../../../docs/SPECS.md) ("holiday hours Dec 24–26 ET" stored UTC, shown in zone) |
| `audience` | **platform-wide** · per-**account** · per-**whitelabel subdomain** · per-**role** |
| `paused` | **pause without deleting** — a paused notice is excluded regardless of window (admin kill-switch) |
| `dismissible` | may the user dismiss it (and is the dismissal remembered)? |
| `cta?` | optional action — a **tracked [links](../links/SPECS.md)** URL (so offer/webinar clicks attribute) |

* **"Active now" = `paused == false` AND `now` ∈ `window` AND `audience` matches** the request
  (subdomain → account, + the caller's role when authed). The BFF resolves this; the client just renders.
* **Two delivery paths, matching the security tiers:**
  * **Login-screen (pre-auth)** notices ride the **public `bootstrap`** response (`notices[]`) — **public-safe
    only**, no PII, **served fresh with the bootstrap (no stale TTL)** — so a paused/expired notice clears on the
    next load. HTML is **sanitized**.
  * **In-app** (banner / center) notices come from an **authed** endpoint, filtered by account + role.
* **Version-gate / maintenance** is just a `system` notice (often `severity: warning` + `placement: banner`)
  — not a separate mechanism.
* **Who may author** *(decided)* — an **`account` admin** authors notices **for their own account**, with
  `audience` **auto-scoped** to that account / its whitelabel subdomain; a **login-placement** notice from an
  account therefore shows **only on that account's branded login page** (the `bootstrap` is keyed by `Host` →
  resolves to the account, so the scoping is automatic). **Platform-wide or cross-account** notices require
  **support / platform staff**. All authoring is **audited** (who scheduled/paused what); login HTML is
  **sanitized** server-side and authoring it is privileged. (Access: account-scoped = `ACCOUNT`; platform-wide
  = staff — see the endpoint table.)

```
GET /app/notices              (authed; filtered by account + role)   -> Notice[]   (active, in-app)
# login-screen notices are embedded in GET /app/bootstrap → notices[]  (public, cached)
```

# Customer support (Zendesk articles + page sharing)

The BFF is the **deployed home** for support glue — the dev-only [webproxy](../webproxy/SPECS.md) only
*emulates* the Zendesk passthrough locally, so production needs these endpoints here.

* **Zendesk help-article proxy** *(required)* — the web help drawer fetches articles from the **BFF, not
  Zendesk directly**. The **Zendesk API token stays server-side** (Secrets Manager — never in the browser),
  and the BFF **sanitizes** the returned HTML before sending it. Locale-aware (forward the user's locale to
  Zendesk). Cache responses (articles change rarely).
  ```
  GET /app/help/articles/:id        -> { id, title, body (sanitized HTML), htmlUrl, updatedAt }
  GET /app/help/articles?q=<query>  -> Article[]    (search / list; optional)
  ```
* **Page sharing** — `POST /app/support/share { route, state, ids }` → hands support the user's current page
  + context (see the support glue in *What it owns*).
* **Support ticket** — `POST /app/support/ticket` (authed, server-side).
* **Ticketing is provider-abstracted (factory)** — the BFF wraps the ticket provider behind a **factory** (the
  texting/email provider-factory pattern): a common `Ticket` interface, **Zendesk first** (token in Secrets
  Manager, AppConfig `provider-<id>`), Freshdesk / Intercom later. **The BFF is the one home for support
  ticketing** — no separate support service (kept here to avoid a too-small service).
* **Consumes the registration alert queue** — the BFF **drains an SQS queue** that [access-flows](../auth/specs/ACCESS-FLOWS.md)
  publishes `pending_review` flags to, and **opens a ticket** for customer support (retries + DLQ on the
  queue, so a provider outage never blocks signup). Account billing/dunning may enqueue the same way.

# Two security tiers

* **Public** — `bootstrap` (**served fresh, no stale TTL**), public feature flags, telemetry/error **intake**
  (unauthenticated but **rate-limited + validated**; intake only, never returns data).
* **Authenticated** — UI **aggregation/composition** endpoints (JWT); they just compose other services'
  authed calls and shape the result. No new authority — every underlying call is authorized by its owner.

# Routing

`/app/*` (the service-prefix convention) → this service, behind the edge (**API Gateway + CloudFront** in
cloud; the dev-only **webproxy** locally). `bootstrap` is the public, **served-fresh (no stale TTL)** path;
aggregation paths are authed.

# Relationship to other client-facing pieces

* **Edge** — cloud: **API Gateway + CloudFront** *routes* `/app/*` here + serves the SPA; local: the
  dev-only **[webproxy](../webproxy/SPECS.md)** emulates it. Pure transport, not the BFF.
* **[realtime](../realtime/SPECS.md)** — server→client push (notifications). The BFF is request/response.
* **[collab](../collab/SPECS.md)** — stateful live rooms. Unrelated to the BFF (kept separate by design).
* **[web](../web/SPECS.md)** — the consumer: calls `/app/bootstrap` at startup, POSTs crashes/RUM, uses
  aggregation endpoints.

# Stateless & scalable

Read-mostly, public-or-authed request/response → **stateless compute**, horizontally scalable. The public
**bootstrap is served fresh (no stale TTL)**; only **static assets / help articles** are edge-cached. Lambda or
small Fargate. Its **only** persistence is the
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

# Compliance & standards mapping

How **this BFF's** surfaces map to **OWASP Top 10 (2021)**, **ISO/IEC 27001:2022** (Annex A), **SOC 2 Type 2**
(TSC), **HIPAA** (Security Rule, if PHI), **GDPR**, and **CCPA/CPRA**. Clause refs are **indicative**; this is a
**design-intent** self-assessment (certification is operating-effectiveness over time + an ISMS — beyond a
spec). Auth/RBAC controls live in [auth](../auth/specs/SPECS.md); the BFF **adds no authority** of its own (see
below). Data-residency / no-cross-region is the platform [AWS topology](../../../packages/services/src/aws/SPECS.md).
**HIPAA applies only if the platform handles PHI** (needs a BAA) — the BFF holds no PHI by design (no-PII
bootstrap, scrubbed telemetry), so most HIPAA cells are ➖; the ones that map are where app-state/telemetry
*could* carry PHI for a healthcare customer.

**Legend:** ✅ meets/exceeds · ⚠️ partial — see Gaps · ➖ n/a

| BFF surface / control | OWASP T10 | ISO 27001:2022 | SOC 2 (TSC) | HIPAA (if PHI) | GDPR | CCPA | |
|---|---|---|---|---|---|---|---|
| **Adds no authority** — aggregation fans out under the caller's JWT; each call authorized by its owner | A01 | A.5.15 / A.8.3 | CC6.3 | §164.312(a)(1) | Art 32 | ➖ | ✅ |
| **Two tiers** — public-cacheable vs authed; intake-only paths never return data | A01 / A04 | A.8.20 | CC6.6 | §164.312(a)(1) | Art 32 | ➖ | ✅ |
| **Bootstrap public-safe** — no secrets, only *publishable* keys, **no PII**, **served fresh (no stale TTL)** | A05 / A02 | A.8.9 / A.8.11 | CC6.1 / CC6.6 | ➖ | Art 5(1)(c)/25 | §1798.100 | ✅ |
| **HTML in notices (incl. pre-auth login) + Zendesk articles** — sanitized | A03 (XSS/injection) | A.8.28 | CC7.1 / CC8.1 | ➖ | Art 32 | ➖ | ✅ server-side |
| **Zendesk token server-side** (Secrets Manager, never in browser) | A02 / A07 | A.8.24 / A.5.17 | CC6.1 | ➖ | Art 32 | ➖ | ✅ |
| **Zendesk proxy server-side fetch** (egress to external) | A10 (SSRF) | A.8.20 / A.8.23 | CC6.6 | ➖ | Art 32 | ➖ | ✅ id-only |
| **Feature flags via AppConfig** — versioned, no-redeploy, no secrets | A05 | A.8.9 / A.8.32 | CC8.1 | ➖ | ➖ | ➖ | ✅ |
| **Telemetry / RUM + error intake → monitor** (carries `transactionId`) | A09 (logging) | A.8.15 / A.8.16 | CC7.2 | §164.502(b) (min necessary) | Art 33 (support) | ➖ | ✅ PII-scrubbed |
| **Unauthenticated intake** — rate-limited + validated, intake-only | A04 | A.8.6 | CC6.6 / CC7.2 | ➖ | Art 32 | ➖ | ✅ |
| **First-party analytics, NOT Google Analytics** — no third-party transfer | A04 | A.5.34 / A.5.14 | CC6.x / Privacy | ➖ | Art 44–49 / 25 | §1798.140 | ✅ exceeds |
| **Behavioral analytics tied to real identity** — first-party only, never shared | ➖ | A.5.34 | (Privacy) | ➖ | Art 6 / 7 | §1798.120 | ✅ |
| **Page-sharing** — sends user's route + app-state + ids to support | A01 / A04 | A.5.34 / A.8.11 | CC6.7 | §164.502(b) (min necessary) | Art 5(1)(c)/32 | §1798.100 | ✅ explicit + stoppable |
| **Notices admin** — audited (who scheduled/paused what) | A09 | A.8.15 | CC7.2 | §164.312(b) | ➖ | ➖ | ✅ |
| **Per-subdomain resolution** (`Host` → account branding/flags) | A01 / A05 | A.8.9 | CC6.6 | §164.312(a)(1) | ➖ | ➖ | ✅ host guard |

# Gaps & decisions

*The one review list — open decisions and backlog are merged here.* ✅ = resolved/decided · ⚠️ = **open — needs
attention**.

1. ✅ **HTML sanitization** *(OWASP A03 · ISO A.8.28)* — **the server sanitizes**: Zendesk articles
   **sanitized server-side** (allowlist) before they ever reach the browser, and notices (incl. the pre-auth
   login HTML) sanitized on **store *and* render** via the shared `Application.sanitizeHtml` (`app-8.4`).
   Authoring of login HTML stays privileged + audited. *(Defense-in-depth: a **Content-Security-Policy** —
   additive, not blocking — `app-8.5`.)*
2. ✅ **Zendesk proxy — no SSRF surface** *(OWASP A10 · ISO A.8.23)* — the proxy accepts **only the article
   `id`**; the **server holds the Zendesk base URL + API token** and constructs the request, so there is **no
   user-supplied URL** to coerce. Validate the `id`; egress stays pinned to Zendesk (`app-8.6`).
3. ✅ **PII scrubbing in telemetry / RUM** *(GDPR Art 5(1)(c)/25)* — telemetry is **scrubbed of PII before
   storage**: the BFF intake **strips query params, masks PII, and drops auth headers/tokens** from URLs / error
   payloads / stacks **before** forwarding to monitor (`app-5.3`).
4. ✅ **Page-sharing privacy** *(GDPR Art 5(1)(c)/32 · CCPA §1798.100)* — sharing is **explicit and
   user-initiated** (never automatic), **stoppable at any point**, with an **unmistakable in-app active
   indicator**; the shared snapshot is audited (hashed `AuditEvent`) and short-retained / auto-expired (`app-4.2`).
5. ✅ **Behavioral analytics — first-party only, never shared** *(GDPR Art 6/7 · CCPA §1798.120)* — behavior
   data is **stored only within the app**, **never shared or sold** to any third party (consistent with
   [auth → no sale/sharing without opt-in](../auth/specs/SPECS.md)); usage stays in our own pipeline (`app-6.2`).
6. ✅ **`Host` / tenant spoofing guard** *(OWASP A01/A05)* — validate the `Host` against the known
   whitelabel-domain allowlist; an unknown/spoofed `Host` is **rejected** (no bootstrap served, no cache
   poisoning), so it can't be coerced into serving another tenant's branding/flags (`app-1.5`).
7. ✅ **Edge-cache strategy — DECIDED: no stale TTL (correctness-first).** The bootstrap blob carries **feature
   flags + login-screen notices that must be correct on every load**, so it is **not cached with a time-based
   TTL** — it is **served fresh / revalidated each request** (`Cache-Control: no-cache` + an **ETag** so an
   unchanged blob returns `304`, staying cheap without ever serving stale). A flag toggle, or a notice
   activating / expiring, is reflected **on the very next load** — no edge-staleness, no invalidation race. CDN
   caching still applies to **static assets + help articles** (not the dynamic bootstrap); `AppCacheInvalidationJob`
   (`app-11.6`) covers those. Trade-off **accepted**: the origin serves every bootstrap load (the blob is small +
   the BFF is stateless / horizontally scalable) (`app-9.x`).
8. ✅ **UI-aggregation scope — DECIDED: aggregate via the BFF for performance, guarded.** Use **BFF composition
   endpoints** (`/app/views/*`) to collapse multi-service round-trips where they hurt first paint — the classic
   BFF performance win. **Caveat (the guard):** scope them to screens that genuinely need it; **do not let the
   BFF become a god-gateway** that knows every domain and must change on every downstream contract change. The
   concrete screen list is product-driven and grows as expensive screens surface (`app-7.1` / `app-7.3`).
9. ✅ **Page-sharing depth — DECIDED: tiered, no browser plugin.** **Baseline (owned):** the lightweight
   **static page+context snapshot** (`POST /app/support/share` — route + app-state + ids), zero third-party
   dependency. **Live co-browse (optional, buy-not-build):** if support needs to *see / drive* the live app, use a
   **Zendesk-Marketplace co-browse JS-SDK** (Surfly / Upscope / Glance / Cobrowse.io) embedded in the SPA and
   surfaced in **Zendesk Agent Workspace** — **no browser plugin / extension** (obsolete since the WebRTC
   `getDisplayMedia()` Screen Capture API; modern co-browse SDKs are agentless JS). Full-screen share, if ever
   needed, is browser-native `getDisplayMedia()`. Any live option **must honor the page-sharing privacy controls**
   (#4): **explicit + user-initiated, stoppable anytime, active indicator, and PII field masking**. **Vendor
   selection deferred** (`app-4.5`) — the architecture (no plugin · Zendesk-integrated · masked) is set.
10. ✅ **Notices admin surface — DECIDED: in-app, role-gated tools section (no separate app).** Authoring /
    scheduling / pausing notices lives in a **role-gated "Tools" / admin section inside the main app**, surfaced
    by role — **staff (`SUPPORT` / `APPLICATION` / `ROOT`)** for platform-wide, **account admin** for their own
    account / whitelabel — **no separate admin app** (`app-3.6`). *(Residual: per-user **dismissal** persistence —
    client-local vs server-synced so it follows the user across devices — still to pin, `app-3.7`.)*
11. ✅ **i18n · A/B · CSRF — DECIDED.** (a) **i18n** — **labels are localized** (locale bundles); the BFF is
    **locale-aware** (cf. `app-4.4` article locale) and serves localized notice / label text (`app-3.9`).
    (b) **A/B assignment** — done via the **feature-flag** system: an A/B cohort is a **flag variant** (no
    separate experiment service), so assignment rides the existing platform⊕account flag merge (`app-2.4`).
    (c) **CSRF / session bootstrap** — handled **server-side + at the endpoint layer** (the `@repo/endpoint`
    framework), aligned with the [web](../web/SPECS.md) **two-token session** model (CSRF token on the
    state-changing / refresh path) (`app-8.7`).

# Service & Job topology

**Convention (platform-wide).** Each service layers **framework base → domain base → concrete role** on both the
HTTP and worker sides. A **domain Service base** (`AppService extends Service`) and a **domain Job base**
(`AppJob extends Job`) hold the **shared domain code** — the **aggregation / fan-out client**, `Host` → account
resolution + the **tenant-spoofing guard**, the two-tier **feature-flag merge**, `sanitizeHtml` usage, the
**notices** repository, the **ticket-provider factory**, and **telemetry PII-scrub** helpers — so **every concrete
role inherits it**. Concrete **roles extend the domain base, never the framework base directly.** Assume
specialized roles **will** appear (the BFF already has **two security tiers** — § *Two security tiers*), so the
base exists from day one.

```
Application
├── Service (Fastify; Lambda / small Fargate — edge-fronted, stateless)
│     └── AppService              (domain base — aggregation client · Host→account + tenant guard · flag merge · sanitizeHtml · notices repo · telemetry scrub; not deployed alone)
│           ├── AppMainService    (authed BFF: UI aggregation · full flag set · notices CRUD/admin · support glue · ops)
│           └── AppPublicService  (public, edge-fronted, high-volume: /app/bootstrap + login notices · public flags · unauthenticated rate-limited intake — scales independently)
└── Job (Lambda, event-driven)
      └── AppJob                  (domain base — ticket factory · monitor/analytics emit · idempotency · DLQ)
            ├── AppTicketJob            (SQS — registration pending_review + billing/dunning → open a support ticket; retries / DLQ)
            ├── AppTelemetryJob         (SQS/stream — enrich + PII-scrub intake → route errors→monitor, product events→analytics)
            └── AppCacheInvalidationJob (Kafka/EventBridge — change events → CloudFront invalidation of cached assets / help articles; bootstrap is no-TTL)
```

**Services (HTTP — Lambda / small Fargate, edge-fronted)**

| Class | Extends | Role |
|---|---|---|
| **`AppService`** | `Service` | **Domain base** — the **aggregation client**, `Host`→account resolution + **tenant-spoofing guard** (`app-1.5`), two-tier **flag merge** (`app-2.3`), `sanitizeHtml` (`app-8.4`), the **notices** repo, the **ticket factory**, telemetry **PII-scrub**; **not deployed alone** (health-only if instantiated). |
| **`AppMainService`** | `AppService` | The **authed** BFF — **UI aggregation** (`/app/views/*`, adds no authority), the full **flag** set, **notices** CRUD / admin, **support glue** (Zendesk proxy · page-share · ticket), and ops. |
| **`AppPublicService`** | `AppService` | The **public, edge-fronted, high-volume** role — **`/app/bootstrap`** (+ login `notices[]`), public flags, and the **unauthenticated, rate-limited, intake-only** endpoints (`/app/telemetry`, `/app/events`). **Adds no authority**; **scales independently** so a telemetry flood or a login-page bootstrap traffic spike (every load hits origin under no-TTL) **never starves the authed app** (realizes the *Two security tiers* split). |

**Jobs (Lambda, event-driven)** — each extends `AppJob`:

| Class | Trigger | Role | Req |
|---|---|---|---|
| **`AppTicketJob`** | SQS — registration `pending_review` (from [access-flows](../auth/specs/ACCESS-FLOWS.md)); billing / dunning | Drain the alert queue → **open a support ticket** via the ticket factory; **retries + DLQ** so a provider outage **never blocks signup** | app-4.3 |
| **`AppTelemetryJob`** | SQS / stream (from the intake endpoints) | **Enrich** (auth ctx, `transactionId`) + **PII-scrub**, then **route errors → [monitor](../monitor/SPECS.md)** and **product events → [analytics](../analytics/SPECS.md)** — absorbs bursts off the browser-facing intake path | app-5.2/5.3, app-6.1 |
| **`AppCacheInvalidationJob`** | Kafka / EventBridge — asset / help-article change | **CloudFront invalidation** of cached **static assets / help articles** (the **bootstrap is no-TTL / revalidated**, so it needs no busting) | app-9.2 |

> **Shared modules (not deployables).** The **`TicketProvider` factory** (Zendesk-first; Freshdesk / Intercom by
> AppConfig) is reused by `AppMainService` (interactive ticket) **and** `AppTicketJob` (queue-driven ticket) — one
> implementation, two callers. HTML safety uses the shared **`Application.sanitizeHtml`** base method (`app-8.4`),
> not an app-owned sanitizer. `AppTelemetryJob` is **optional for MVP** — the intake can scrub + forward inline
> until volume justifies decoupling it onto a queue.

# AWS Services and Other Dependencies

**AWS services**
* **AppConfig** — feature flags + runtime config (no redeploy).
* **CloudFront** — edge cache for the public bootstrap + notices; **API Gateway** — the edge transport.
* **DynamoDB** — the notices / announcements table.
* **Secrets Manager** — the Zendesk API token (server-side only).
* **Kafka / SQS** — forward telemetry + errors to monitor.

**Third-party libraries / services**
* **Zendesk** — help-article proxy + ticketing (factory-abstracted, Zendesk-first).
* **reCAPTCHA** — site (publishable) key surfaced in the bootstrap.

**Internal (`@repo/*`)**
* `@repo/services` (AppConfig, Dynamo, Cache, Kafka/Sqs), `@repo/endpoint` (the BFF's own endpoints), `@repo/common` (`Type` incl. `ZonedDateTime`, `Result`, `UserAgent` for RUM).
* Reads/calls **account · auth · monitor · analytics · [links](../links/SPECS.md)** (notice CTAs); behind the edge (API Gateway / CloudFront; webproxy locally); consumed by **web**.

# Requirements (traceable register)

The traceable requirement register for the **app BFF**. IDs are stable handles (**`app-N.M`**) — cite them in
code, tickets, and tests. **Priority:** **A** = MVP (ship first), **B** = core feature / hardening, **C** =
later. One level of sub-requirements only; a group's priority is its floor. **The BFF is a read-model
aggregator + intake** — it owns **only** the notices datastore; everything else is read from AppConfig or
called from the owning service ([account](../account/specs/SPECS.md) branding/flags, [auth](../auth/specs/SPECS.md)
login/SSO config, [monitor](../monitor/SPECS.md) telemetry, analytics).

## app-1.0 Bootstrap config — A
- **app-1.1** Per-subdomain resolve (`Host` → whitelabel → account) — A
- **app-1.2** Assembled public blob (branding, password policy, upload limits, publishable keys, version, notices) — A
- **app-1.3** Feature flags in the blob (platform AppConfig ⊕ account, account override wins) — A
- **app-1.4** Public-safe only — no secrets, no PII; **served fresh / revalidated each load (no stale TTL)** so flags + login notices are always correct *(gap #7)* — A
- **app-1.5** `Host`/tenant spoofing guard — reject any `Host` not in the whitelabel allowlist — A

## app-2.0 Feature flags — A
- **app-2.1** Platform flags from AppConfig (global rollout / kill-switch) — A
- **app-2.2** Per-account flags (support-toggled, from account) — B
- **app-2.3** Merge → effective set (account wins) — A
- **app-2.4** **A/B assignment via flag variants** — an experiment cohort is a **feature-flag variant** (no separate experiment service); rides the platform⊕account merge *(gap #11)* — B

## app-3.0 Application notices & announcements (owns the datastore) — B
- **app-3.1** `Notice` model (class / severity / title+body / placement / window / audience / paused / dismissible / cta) — B
- **app-3.2** "Active now" resolution (`paused==false` ∧ `now ∈ window` ∧ audience match) — B
- **app-3.3** Login-screen (pre-auth) notices via the public `bootstrap` blob — B
- **app-3.4** In-app (banner / center) notices via an authed endpoint (account + role filtered) — B
- **app-3.5** Version-gate / maintenance as a `system` notice — B
- **app-3.6** **In-app role-gated authoring surface** — a **"Tools" / admin section in the main app** (no separate app) to author / schedule / pause notices; surfaced by role — **staff (`SUPPORT`/`APPLICATION`/`ROOT`)** platform-wide, **account admin** own-account; audited *(gap #10)* — B
- **app-3.7** Per-user dismissal state (client-local vs server-synced) — C
- **app-3.8** Account-authored notices — account admin posts for **their own account/whitelabel** (incl. a `login`-placement login-page message, audience auto-scoped); platform-wide = staff — B
- **app-3.9** **Localized notice / label text** — notice `title`/`body` and BFF-served labels are **locale-aware** (localized bundles), consistent with `app-4.4` *(gap #11)* — B

## app-4.0 Customer-support glue — B
- **app-4.1** Zendesk article proxy — **id-only** input; server holds URL+token; **server-side sanitize**; cache — B
- **app-4.2** Page sharing — explicit + user-initiated, stoppable anytime, clear in-app indicator; audited; auto-expire — B
- **app-4.3** Support-ticket creation (authed, server-side) — B
- **app-4.4** Locale-aware article fetch — C
- **app-4.5** **Optional live co-browse** — if support needs to see / drive the live app, a **Zendesk-Marketplace co-browse JS-SDK** (Surfly / Upscope / Glance / Cobrowse.io) in Agent Workspace — **no browser plugin**; builds on the static snapshot; **honors the page-sharing privacy controls** (explicit · stoppable · active indicator · **PII field masking**); vendor selection deferred *(gap #9)* — C

## app-5.0 Web telemetry / RUM (engineering) — B
- **app-5.1** RUM — Core Web Vitals + JS errors + frontend API timing + route timing — B
- **app-5.2** Error/crash intake (`ErrorBoundary` / `onerror`) → enriched (auth ctx, `transactionId`) → monitor — B
- **app-5.3** **PII scrubbing before storage** — strip query params, mask PII, drop auth headers/tokens — A
- **app-5.4** Backend correlation via `transactionId` / X-Ray — B
- **app-5.5** Segmentation (device / browser / OS / geo via `UserAgent`) — C

## app-6.0 User-behavior analytics (product) — B
- **app-6.1** Domain events (`campaign.created`, `report.run`, …) → BFF intake → Kafka → analytics — B
- **app-6.2** **First-party only — stored in-app, never shared/sold** (not GA) — A
- **app-6.3** Identity-tied for funnels / retention / attribution — B

## app-7.0 UI aggregation / composition — B
- **app-7.1** Authed fan-out to N services, shaped for a screen — **collapse round-trips for performance** (first paint) *(gap #8)* — B
- **app-7.2** **Adds no authority** — every underlying call authorized by its owner — A
- **app-7.3** **Guard against god-gateway** — add composition **only where round-trips hurt**; the BFF must not become a layer that knows every domain (screen list is product-driven) *(gap #8)* — B

## app-8.0 Security tiers, routing & sanitization — A
- **app-8.1** `/app/*` edge routing (API GW + CloudFront; webproxy locally) — A
- **app-8.2** Two tiers — public-cacheable vs authed (JWT) — A
- **app-8.3** Intake endpoints — unauthenticated but rate-limited + validated, intake-only (never return data) — A
- **app-8.4** **HTML sanitization** — Zendesk + notices, server-side **allowlist** (vanilla: text styling + one image + links; strip script/style/`on*`; **`img`/`a` URLs = `https:`, own-CDN images, links via the tracked-links service**), on store *and* render. This allowlist is the **reference `"vanilla"` profile** of the shared **`Application.sanitizeHtml`** ([`@repo/services`](../../../packages/services/README.md)) — app uses the shared method, doesn't roll its own — A
- **app-8.5** Content-Security-Policy (defense-in-depth) — B
- **app-8.6** SSRF-safe egress — Zendesk id-only; URL/token server-side — A
- **app-8.7** **CSRF / session bootstrap** — handled **server-side + at the endpoint layer** (`@repo/endpoint`), aligned with the [web](../web/SPECS.md) **two-token session** model (CSRF token on the state-changing / refresh path) *(gap #11)* — A

## app-9.0 Edge caching — B
- **app-9.1** **Bootstrap = no stale TTL** — served fresh / revalidated each load (`no-cache` + **ETag** → `304` when unchanged); a flag toggle / login-notice change is correct on the next load *(gap #7)* — A
- **app-9.2** **CDN caching applies to static assets + help articles** (not the dynamic bootstrap); invalidate those via `AppCacheInvalidationJob` on change *(gap #7)* — B

## app-10.0 Stateless & infra footprint — A
- **app-10.1** Stateless compute (Lambda / small Fargate), horizontally scalable; **public bootstrap served fresh (no stale TTL)**, static assets / articles edge-cached — A
- **app-10.2** Only persistence — the notices/announcements table (DynamoDB) — A
- **app-10.3** Reads AppConfig; calls account / auth / monitor / analytics / links — A
- **app-10.4** Sits behind the edge (API GW / CloudFront; webproxy locally); consumed by web — A

## app-11.0 Service & Job topology — B
- **app-11.1** **Domain bases** — `AppService extends Service` + `AppJob extends Job` hold the shared domain code (aggregation client · `Host`/tenant guard · flag merge · `sanitizeHtml` · notices repo · ticket factory · telemetry scrub); **concrete roles extend the domain base, not the framework base** — B
- **app-11.2** **`AppMainService`** — authed BFF (UI aggregation, full flag set, notices CRUD/admin, support glue, ops) — A
- **app-11.3** **`AppPublicService`** — public, edge-fronted, high-volume role (`/app/bootstrap` + login notices, public flags, **unauthenticated intake**); **adds no authority**; **scales independently** (isolates the intake flood / login-page bootstrap traffic spike from the authed app) — B
- **app-11.4** **Jobs extend `AppJob`** — `AppTicketJob` / `AppTelemetryJob` / `AppCacheInvalidationJob`, each a Lambda on the shared base — B
- **app-11.5** **`AppTicketJob`** — drain the registration `pending_review` (+ billing / dunning) SQS queue → open a support ticket via the **factory**; **retries + DLQ** so a provider outage never blocks signup — A
- **app-11.6** **`AppCacheInvalidationJob`** — event-driven **CloudFront invalidation** of **cached static assets / help articles** on change; the **bootstrap is no-TTL / revalidated** so it needs no busting (`app-9.1`) — B
- **app-11.7** **`TicketProvider` factory** — shared module (Zendesk-first), reused by `AppMainService` + `AppTicketJob` (not a deployable) — B

# Endpoints (first cut)

A first pass at the BFF's endpoint surface, in [`@repo/endpoint`](../../../packages/endpoint/SPECS.md) style.
**Conventions:** every path is service-prefixed **`/app/*`**; `bootstrap` is the public, **served-fresh (no stale TTL)** path;
intake endpoints are **unauthenticated but rate-limited + validated, intake-only** (never return data); the
BFF **adds no authority** — aggregation runs under the caller's JWT, each underlying call authorized by its
owner.

**Access column:** the recommended **`minAccess`** role on the `Access` ladder — **`-`** = public (no auth) ·
account ladder **`SENDER` < `USER` < `BILLING` < `ACCOUNT`** · staff ladder **`SUPPORT` < `APPLICATION` <
`ROOT`** · **`Internal`** = VPC-only S2S. A senior role satisfies any junior minimum.

> Login-screen (pre-auth) notices are **embedded in `GET /app/bootstrap` → `notices[]`**, not a separate
> route. The **Zendesk proxy takes only the article `id`** — the server holds the URL + token and sanitizes.
> These are APP shapes; the published API is the `/v1/...` facade.

### Bootstrap & feature flags (app-1, app-2)
| Method | URI | Purpose | Access | Req |
|---|---|---|---|---|
| GET | `/app/bootstrap` | Public startup blob (branding, password policy, upload limits, publishable keys, flags, version, login `notices[]`) — keyed by **validated `Host`**, **served fresh (no stale TTL)** | - | app-1.2/1.5 |
| GET | `/app/flags` | Effective feature-flag set for the current account/user (full set; the public subset is in bootstrap) | USER | app-2.3 |

### Notices & announcements (app-3)
| Method | URI | Purpose | Access | Req |
|---|---|---|---|---|
| GET | `/app/notices` | Active in-app notices (banner/center), filtered by account + role | USER | app-3.4 |
| POST | `/app/notices` | Create a notice (account admin for own-account; staff for platform-wide; audited) | ACCOUNT | app-3.6 |
| GET | `/app/notices/{id}` | One notice (admin) | ACCOUNT | app-3.6 |
| PUT | `/app/notices/{id}` | Update a notice | ACCOUNT | app-3.6 |
| PATCH | `/app/notices/{id}/pause` | Pause / unpause (kill-switch) | ACCOUNT | app-3.6 |
| DELETE | `/app/notices/{id}` | Delete a notice | ACCOUNT | app-3.6 |
| POST | `/app/notices/{id}/dismiss` | Record a per-user dismissal | USER | app-3.7 |

### Customer-support glue (app-4)
| Method | URI | Purpose | Access | Req |
|---|---|---|---|---|
| GET | `/app/help/articles/{id}` | Zendesk article by **id** — server adds URL+token, **sanitizes HTML**, cached | USER | app-4.1 |
| GET | `/app/help/articles?q=` | Search / list help articles (locale-aware) | USER | app-4.1 |
| POST | `/app/support/share` | Start a page-share (explicit, user-initiated) → returns a share handle | USER | app-4.2 |
| DELETE | `/app/support/share/{id}` | Stop sharing (user can stop at any point) | USER | app-4.2 |
| POST | `/app/support/ticket` | Create a support ticket (server-side) | USER | app-4.3 |

### Telemetry & analytics intake (app-5, app-6)
| Method | URI | Purpose | Access | Req |
|---|---|---|---|---|
| POST | `/app/telemetry` | RUM / error-crash intake — **PII-scrubbed**, enriched (`transactionId`) → monitor; intake-only | - | app-5.2/5.3 |
| POST | `/app/events` | Product behavior events → Kafka → analytics (first-party, **never shared**) | USER | app-6.1 |

### UI aggregation (app-7)
| Method | URI | Purpose | Access | Req |
|---|---|---|---|---|
| GET | `/app/views/{view}` | Authed composition — fan-out to N services shaped for a screen (no new authority) | USER | app-7.1 |

### Ops (app-10)
| Method | URI | Purpose | Access | Req |
|---|---|---|---|---|
| GET | `/app/config` | Read the service's own runtime config (AppConfig-backed) | ROOT | app-10.3 |
| PUT | `/app/config` | Update service runtime config → reconfigure-without-restart; audited | ROOT ⬆ | app-10.3 |
| GET | `/app/health` | Liveness / readiness (read-only smoke) | Internal | app-10.1 |

# eof
