#
# `@repo/endpoint`
#

The **single source of truth for an API endpoint**. A `RestfulEndpoint` subclass declares — *once* —
the method, URI, field mappings, query/body/response **schemas** (ajv = JSON Schema), **access** (RBAC
min-role), and **audience**. Three consumers read that one definition, so they can't drift:

* **Client** — `marshalClient()` builds the request (used by the web app).
* **Server** — `unmarshalServer()` hydrates + validates the incoming request (used by the `Service` base).
* **Build** — `toRoutes()` → API Gateway routes; `toOpenApi()` → the API docs.

See `RestfulEndpoint.ts` for the model. Key concepts:

* **Audience** (`INTERNAL ⊂ APP ⊂ PUBLIC`) — who an endpoint is for + whether it's published. An
  ascending **ladder** (not a union): `APP` = first-party app, **JWT only**; `PUBLIC` = published dev
  API, **JWT *or* dev-key**, and the only audience emitted to the docs. Network `exposure` derives from it.
* **`toOpenApi()`** — generates **OpenAPI 3.1** from the definitions (JSON Schema embeds directly, no
  translation), filtered to `PUBLIC`. Because it's generated from the same code the client/server use,
  the docs **cannot drift** — run it in the build, diff in CI.

---

# URI convention — service-prefixed paths

Every endpoint URI **leads with its owning service**: `/contact/list` → the **contact** service, `/media/…`
→ **media**, `/auth/…` → **auth**. The **first path segment is the service name**, 1:1 with
`apps/core/<service>`.

* **Trivial edge routing** — **API Gateway** (+ CloudFront) routes by **prefix** to the service's target
  (ECS/Lambda); no per-endpoint routing table. Locally, the dev-only
  [webproxy](../../apps/core/webproxy/SPECS.md) emulates the same prefix routing.
* **Self-attributing** — logs, traces, metrics, and the **topic-7 test scope** key off the prefix
  ("test `/contact/*`" = test the contact service).
* **Maps to the codebase** — `/contact` ↔ `apps/core/contact`; first segment → OpenAPI **tag**.
* **CRUD chains** (topic 7) — resource = the service-prefixed path, op = the HTTP **method**; action-style
  sub-segments (`/contact/list`) are fine, the method still decides the op.

**Enforce it:** a build/lint check that every `RestfulEndpoint` URI's first segment ∈ the known service set
**and** matches the package that defines it.

> **Caveat — don't leak it into the `PUBLIC` contract.** Service-prefix paths describe **internal / APP**
> decomposition; a **published** (`PUBLIC`) API must be **resource-named + versioned** (`/v1/contacts`) and
> **decoupled** from internal service names, so we can split/merge services without breaking external
> integrators. The public surface is a **facade** mapping `/v1/contacts` → internal `/contact/*`. Settle:
> version placement (`/v1/{resource}`, version-first) and a **reserved** service-name segment set (no
> resource/version collisions). See audience (topic 1) + versioning (topic 2).

# Discussion topics

Open design questions for this package — captured here so they're not re-litigated in scattered places.

## 1. Publishing the API docs + a "try it" console (lead topic)

We can already **generate** an accurate OpenAPI 3.1 spec (`toOpenApi`). The open question is **how to
surface it** to developers — ideally a docs page where they can read the endpoints **and enter their
dev-key to test-run** the PUBLIC APIs live. Three paths:

### A) Buy a hosted dev portal (ReadMe.io, Stoplight, Mintlify, Bump.sh)
Feed it our generated OpenAPI; it renders reference docs + a try-it console + guides + changelog +
versioning + search + SEO.
* **Pros** — polished out of the box; least build; guides/changelog/quality-of-life for a real developer
  program; hosted.
* **Cons** — recurring **cost**; **off-brand / their domain** (unless paid tier); the **try-it console
  proxies through their infra**, so our **dev-key auth + CORS + gateway** need to play nicely with it;
  another vendor + data path. Best **when we run a serious external developer program** and want the
  guides/changelog/support tooling, not just reference docs.

### B) Build our own page
A page in **`apps/core/web`** that renders the generated OpenAPI, with a **dev-key field** and a
**try-it** that calls **our** gateway directly (inject `x-devkey`, hit the real PUBLIC endpoint).
* **Pros** — fully **on-brand**, **our domain**, **our auth model** (dev-key → `x-devkey`, JWT for
  logged-in staff), no per-seat cost, total control, try-it hits the **real edge** (no third-party proxy).
* **Cons** — we build + maintain the renderer (schema rendering, try-it, auth, examples, search,
  versioning). Reinventing polished tooling.

### C) Embed an open-source renderer in our own page  ← recommended middle path
Don't hand-roll the renderer **and** don't pay for a portal: drop a mature **OpenAPI React component**
into **our** page, fed by our generated spec, and add the dev-key field + try-it ourselves.
* Candidates: **Scalar** (`@scalar/api-reference` — modern, MIT, excellent built-in try-it),
  **Redoc / Redocly**, **Stoplight Elements**, **Swagger UI**, **RapiDoc**.
* **Pros** — on-brand + our domain + **our auth** (we own the try-it → inject `x-devkey`, call our
  gateway), **low build** (the renderer is the library's job), no portal cost. The user's instinct is
  right: with a renderer library doing the heavy lifting, the wrapper is small.
* **Cons** — themed within the library's limits; we still own auth wiring + versioning UX.

**Recommendation:** **(C) embed a renderer in our own page** for the first dev-API surface — it gets
on-brand + our-auth + low-effort without a vendor. Keep **(A) ReadMe/Stoplight** on the table for *later*
if we launch a full external developer program that wants guides/changelog/support, not just reference.
**(B) from scratch** only if a library can't meet a hard requirement.

> **The try-it must respect the audience model:** only **PUBLIC** endpoints appear (the spec is already
> filtered); the dev-key field sends `x-devkey` and the console calls the **real PUBLIC edge route**, so
> a dev exercises exactly what they'll integrate against. (APP/INTERNAL never appear — they're not in
> the spec.)

## 2. Public-API versioning

`PUBLIC` audience implies a **stable, versioned** contract; `APP` can change freely. Open: version in
the **URL** (`/v1/…`) vs a **header**; how a breaking change is rolled (new version + deprecation
window); whether `toOpenApi` emits one doc per version.

## 3. SDK generation

The same OpenAPI can generate **typed client SDKs** for developers (openapi-generator / Speakeasy /
Fern) — and `operationId` (defaults to the class name) is the stable handle. Worth it once the public
API stabilizes; decide build-step vs on-demand.

## 4. Docs-drift guard in CI

Since `toOpenApi` is generated from code, wire a CI step that **regenerates and diffs** the committed
`openapi.json` (fail on mismatch) — or don't commit it and always generate. Either way the published
docs track the code; pick which.

## 5. Standard error + response model in the docs

Endpoints share `RestfulEndpoint.Response` / `ErrorResponse`. Adopt **`getResponseSchema()`** broadly so
the docs show real response shapes (today many are `any`), and document the **standard error envelope +
status codes** once, referenced by every operation.

## 6. Per-field descriptions + examples

OpenAPI quality comes from the **JSON Schema** itself — encourage `description`/`examples` keywords on
schema fields, plus the endpoint-level `docs` (summary/tags/examples). The richer the schemas, the
better the generated docs, for free.

## 7. Endpoint testing — conformance, CRUD, load & ecosystem trace

**The leverage:** an endpoint is *one typed definition* (method/URI/schemas/`minAccess`/audience), so
tests are **generated from the same source** that drives client/server/docs — they can't drift, and adding
an endpoint adds its tests for free. The harness drives the **real** `marshalClient()` /
`unmarshalServer()` / `getResponseSchema()`, exercising production marshalling, not a mock. Five tiers,
each opt-in by the scope plan (§ d):

### a) Contract conformance (auto, per endpoint)
From each endpoint's schemas, synthesize **valid** + **invalid** fixtures (ajv schema → faker / property-
based) and assert: valid request → **2xx** whose body validates against `getResponseSchema()` (topic 5);
malformed request (missing / wrong-typed / extra fields) → **4xx + the standard error envelope**. The
cheapest, broadest net — every endpoint checked against its own contract with ~zero hand-written tests.

### b) Access & audience matrix (auto)
Assert the **RBAC ladder** per endpoint: a caller **below `minAccess`** → **403**, at/above → allowed
(`Access.isAllowed`). And the **audience** rule: a dev-key against an `APP`/`INTERNAL` endpoint → rejected;
`PUBLIC` reachable by dev-key *and* JWT. Security validated **as data**, straight from the definitions.

### c) CRUD lifecycle scenarios
Chain endpoints for a resource — **create → read (verify) → update → read (verify delta) → delete → read
(404)** — capturing the created id to feed later calls. The **crud op is inferred from the HTTP method** —
**POST = create, GET = read, PUT / PATCH = update, DELETE = delete** — and endpoints are grouped into a
**resource by their URI/entity**, so the runner assembles the chain with no extra per-endpoint declaration.
Runs in an **isolated test account** with **seed + teardown** — writes are real, so **never against
production data**.

### d) Configurable scope (the test plan)
A plan selects **which services**, **which endpoints** (by `operationId` / tag), **which audience**, and
**which tiers** — smoke one service or full-suite the platform. The same plan drives local (**LocalStack**),
CI (test account), and pre-prod.

### e) Load / stress
Generate **k6 / Artillery** scripts from the same defs (or the generated OpenAPI), parameterized by the
scope plan: concurrency, ramp, duration, target subset. Assert **SLOs** (p95 latency, error rate).
Non-prod environments only.

### f) Ecosystem trace (the integration truth — the unique-to-us tier)
Fire an endpoint with a known **`transactionId`** and assert the **whole causal chain**, not just the HTTP
response: the DB write, the **Kafka event** published (envelope `transactionId` matches — see
[aws/SPECS.md → Entity state-change events](../services/src/aws/SPECS.md)), downstream consumers reacting
(search index, read models), and the **[realtime](../../apps/core/realtime/SPECS.md)** push. Assembled from
the **[monitor](../../apps/core/monitor/SPECS.md)** service's spans (X-Ray / OTel) keyed by `transactionId`.
This validates the **event-driven ecosystem**, where most real bugs hide — *"POST /contact ⇒ `contact.created`
⇒ indexed ⇒ pushed."*

**Where it lives / runs:** a definition-driven runner in **`@repo/endpoint`** consuming `RestfulEndpoint`,
reused by each service's suite + a top-level conformance run. Tiers **a/b** run **in-process or on
LocalStack** (fast, every PR); **c–f** against a **deployed test account** (never prod writes); a
**read-only** subset (health / GETs) can smoke **prod** post-deploy. Shares the try-it marshalling (topic 1)
and the standard error envelope (topic 5).

**Recommendation:** build **(a) + (b) first** — nearly free (generated) and the highest regression-catch per
line; add **(c)** with the `resource`/`op` tags as services mature; then **(f)** once monitor +
`transactionId` propagation land; **(e)** last, reusing the same plan.

**Open questions:** fixture source (faker vs the topic-6 `examples` doubling as fixtures vs property-based);
how a **resource** is grouped for the CRUD chain (by URI base path vs entity tag — *the op itself is settled:
by HTTP method*); test-account isolation + teardown (ephemeral per-run account vs namespaced data); load
tool choice; ecosystem-trace assertion mechanism (poll monitor/X-Ray vs the test subscribing to Kafka directly).

### Tooling — generate ours, buy the engines
**Principle:** keep the *generation from our definitions* in-house (our `toOpenApi()` + `Access`/`resource`
metadata are the leverage); feed standard **execution engines** the generated artifacts — don't rebuild
fuzzers, load tools, or trace frameworks.

| Tier | Off-the-shelf (feed it our OpenAPI) | Ours (thin) |
|---|---|---|
| a) conformance/fuzz | **Schemathesis** (property-based, OpenAPI, GH Action) · Prism (validating proxy) · Dredd · Microcks | the generated spec |
| b) access/audience | **Vitest + Fastify `inject()`** as the substrate (Schemathesis auth hooks optional) | the role/audience matrix from `Access` + `minAccess` |
| c) CRUD flows | **Hurl** · **Bruno** · Step CI · Newman/Postman · Playwright request | a Vitest chainer — op from **HTTP method** (POST/GET/PUT/DELETE), resource from URI |
| d) scope plan | (runner-agnostic tag/file selection) | the plan format |
| e) load/stress | **k6** (`grafana/k6-action`, thresholds = SLOs) · **Artillery** (distributed on **Fargate**) · Gatling · AWS DLT | scope→script generator |
| f) ecosystem trace | **Tracetest** (trace-based testing) + **OpenTelemetry / X-Ray (ADOT)** · Microcks/Specmatic (AsyncAPI/Kafka) · kafkajs consume-and-assert | `transactionId` propagation + monitor spans |
| prod smoke (read-only) | **Checkly** / Datadog Synthetics (monitoring-as-code) | the GET-only subset of the plan |

**CI:** `schemathesis/action` (a/b) · `grafana/k6-action` (e) · Hurl-binary / `postman/newman` (c) ·
Tracetest CLI vs a deployed env (f) · **LocalStack as a service container** so a–c run hermetically per PR.
**Recommendation:** Schemathesis + Vitest/`inject()` (a/b) → k6 *or* Artillery-on-Fargate (e) → Tracetest +
OTel/X-Ray (f) once monitor lands. Consumer-driven **Pact/PactFlow** only if we publish an external SDK.
