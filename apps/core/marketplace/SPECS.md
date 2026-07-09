#
# Marketplace Service
#

# Objective

The **integration catalog + control plane**: where an account browses available add-ons, **enables**
the ones it wants, **connects** them with its own credentials (BYOK), and manages their lifecycle
(configure / pause / resume / remove). Most add-ons are integrations to 3rd-party systems — a HubSpot
install, for example, captures the account's HubSpot OAuth grant (or API key) so the platform can
call HubSpot's APIs and receive its webhooks on the account's behalf.

This is the keystone for the platform's expansion **beyond the political vertical** into a **universal
messaging platform** (text, email, and other channels) serving **political, nonprofit, e-commerce, and
marketing** — the catalog is how each vertical brings its own tools (donation platforms, storefronts,
CRMs, ad networks) into one messaging hub.

The load-bearing ideas:
* **control plane, not connector runtime** — marketplace owns *what's available, what's enabled, the
  credentials, and the lifecycle*; the **actual talking-to-3rd-parties** (call HubSpot, parse a Shopify
  webhook, normalize events) lives in the **connector runtime**, so integration logic isn't reimplemented
  per add-on inside this service;
* **BYOK credential vault as the security keystone** — per-account OAuth grants / API keys, **KMS-encrypted
  (CMK per account)** over Secrets Manager, with token **refresh + revocation** — jobs hold a **reference**,
  never the secret;
* **a uniform lifecycle state machine** — `enable → connect → active → pause → resume → remove`, with
  **auto-pause** when the account goes inactive (entitlements / billing), so connection health is one
  consistent model across every integration;
* **a code-defined catalog, entitlement-gated** — integration definitions (capabilities · required creds ·
  vertical tags · pricing) are declared centrally; *which* an account may enable comes from
  [account](../account/specs/SPECS.md) `ResolvedEntitlements`, billing from account / Stripe;
* **growth is additive** — a **connector SDK** means a new integration is a new connector + a catalog entry
  (exposed to **workflow** as trigger / action nodes), **not** changes to this service.

# Role & boundaries (read this first)

Marketplace is a **control plane**, not a connector runtime. It owns *what's available*, *what an
account has enabled*, *the credentials/config*, and *the lifecycle* — and it **delegates the actual
talking-to-3rd-parties** to connectors. If a HubSpot sync or a Shopify webhook parse lives in this
service, it'll be reimplemented per integration; Marketplace owns the catalog and the vault, the
**connector runtime** owns the data plane.

What Marketplace **owns**:
* The **catalog** — integration definitions, categories, vertical tags, capabilities, required
  credentials/config, entitlement/pricing.
* Per-account **installations** — enabled integrations, their config, and connection health/state.
* The **credential vault** — per-account secrets (OAuth tokens / API keys), **KMS-encrypted**, with
  token **refresh** and **revocation**.
* The **lifecycle**: enable → connect → active → pause → resume → remove (and **auto-pause** when the
  account goes inactive).

What Marketplace **delegates / does not do**:

| Concern | Owner |
|---|---|
| Running a connector (call HubSpot, parse a Shopify webhook, normalize events) | **integration/connector runtime** (workflow spec, open decision #9) |
| Receiving inbound 3rd-party webhooks (validate at edge → SQS) | the platform **incoming-webhook intake** |
| Exposing an integration's **triggers (input nodes)** + **actions** as workflow nodes | **workflow** |
| Plan limits + which integrations an account may enable | **account** (`ResolvedEntitlements`) |
| Paid add-on billing (per-integration fees) | **account / billing** (Stripe — see account/PRICING.md) |
| Sending the actual messages | **texting / email / dispatch** |
| Secret storage primitive | **Secrets Manager** (vault wraps it; KMS CMK per account) |

> **Service boundary — DECIDED: standalone.** Marketplace is its **own service**, account-scoped and
> tied to account lifecycle (entitlements, active/inactive, billing) but not living inside account —
> the catalog, OAuth broker, and credential vault are substantial enough to stand alone.

# Out of scope (deferred)

* **Building every connector up front** — ship the catalog + lifecycle + vault + a few high-value
  connectors; the rest land incrementally (a connector SDK makes them additive).
* **A public 3rd-party developer marketplace** (partners publishing their own integrations) — internal
  catalog first; an open submission program is a later, much larger surface.
* **Per-field data-mapping UI** between a 3rd party and our model — start with sensible default
  mappings per connector; a visual field-mapper is a follow-on (and overlaps the workflow `transform`).

# Core concepts

* **Integration definition** — a catalog entry: id, name, **provider**, **category**, **vertical tags**,
  **description**, **icon**, **website**/docs, the **capabilities** it offers, its **credential type** +
  config schema, **license** + **terms/privacy links**, and an optional **paywall** (plan/price). See
  *Catalog entry — definition fields* below.
* **Capability** — what an integration provides:
  * **triggers** — events in (`invoice.created`), via **webhook** or, for webhook-less APIs, **polling**
    (the connector polls on a cadence + **dedupes** seen ids);
  * **actions** — calls out (*create QuickBooks invoice*);
  * **search / find** — look up a record (and optional *find-or-create*), feeding workflow's
    `find-or-create` node;
  * **sync / transfer** — ongoing mirroring, plus an optional **bulk backfill** of *existing* records
    on connect (seed contacts/segments, not just new events).

  An enabled integration's triggers/actions/searches become available to **workflow** as **input
  (trigger) and action nodes** — e.g. *invoice created → send to accounting software X* — scoped to
  what the account has connected and authorized via the vault.
* **Installation** — an account's enabled instance of a definition: config, credential reference,
  status, and connection health. One account may have one (or, later, several) per definition.
* **Credential** — how we authenticate as the account to the 3rd party: **OAuth2** (most modern SaaS),
  **API key**, basic auth, or a **webhook signing secret**. Stored only as a reference to a vault entry.
* **Vault** — the per-account, **KMS-encrypted** secret store (built on Secrets Manager) holding tokens
  and keys; supports rotation/refresh and hard purge on removal.
* **Connection health** — validated on connect and checked periodically; surfaces `connected` /
  `needs-reauth` / `error` so a broken integration is visible, not silent.

# Catalog entry — definition fields

Every catalog entry (`IntegrationDefinition`, **platform-global**) carries presentation, commerce, and
technical metadata. Installations of it are always **account-scoped**.

**Presentation** (the catalog tile + detail page)

| Field | Purpose |
|---|---|
| `name` | display name (e.g. "HubSpot") |
| `provider` | the vendor/company behind it (e.g. "HubSpot, Inc.") |
| `category` | **enum** — `CRM` · `EMAIL` (ESP) · `ECOMMERCE` · `PAYMENTS` · `MESSAGING` · `CHAT` · `ADS_SOCIAL` · `ANALYTICS` · `ACCOUNTING` · `SUPPORT` · `STORAGE` · `FORMS` · `CALENDAR` · `AI` · `IPAAS` (the catalog groups + filters by this) |
| `verticals[]` | political / nonprofit / e-commerce / marketing tags |
| `description` | short explainer shown on the tile + detail |
| `icon` | logo asset — an `S3` key (account-agnostic `branding`-style prefix) or URL |
| `website` | the provider's marketing / home URL |
| `docsUrl` | setup / how-to docs |

**Commerce & access**

| Field | Purpose |
|---|---|
| `paywall?` | **optional** gate — `{ plan?, price? }`. **Absent ⇒ free / included.** `plan` requires a tier to enable; `price` (`{ amount, currency, interval }`) bills the add-on via **account / Stripe** (see account/PRICING.md). |
| `license` | the integration's license — an **SPDX id** (`"MIT"`), `"Proprietary"`, or a **license URL**. |
| `termsUrl?` | the provider's **Terms & Conditions** URL — shown on the detail page and presented for **acceptance on install**. |
| `privacyUrl?` | the provider's **Privacy Policy** URL — shown on the detail page and surfaced for the account's own compliance/disclosure (where the data goes). |
| `visibility` | `available` · `beta` · `deprecated` — controls listing without deleting the definition. |
| `multiInstance?` | allow **several installs per account** (agency / multi-brand: many stores, ad accounts, SFTP destinations). Default **single**; when true, each install has an instance id + label. |
| `metered?` | the **usage signals** this integration reports (calls / syncs / actions / records) for billing + pricing analytics. |
| `dataJurisdiction` | **where this integration processes account data — `US` · `EU` · `All`.** Drives the **cross-border gate**: an **EU account** enabling a service **not** covering EU (i.e. `US`) triggers an **escalated GDPR data-transfer acceptance** (below). `All` = the provider offers EU-resident processing. |

> **Install-time acceptance:** where present, the account accepts `license` + `termsUrl` + `privacyUrl`
> at install; the acceptance (which URLs, which versions, who, when) is **audited** on the Installation.
>
> **Cross-border (EU → US) escalation.** When an **EU account** enables an integration whose `dataJurisdiction`
> is **`US`** (data leaves the EEA → GDPR **Chapter V**, Art 44–49), the generic sub-processor acknowledgment is
> **escalated**: the account must **explicitly accept a cross-border data-transfer notice** (the data is
> processed in the US; **Standard Contractual Clauses (SCCs)** apply; the sub-processor + destination are
> disclosed). **No enable without that specific acceptance** — and it's audited distinctly from the ordinary
> terms acceptance. *(A US account enabling a US/`All` service, or any account enabling an `All` service, takes
> the ordinary accept-to-enable path.)*

**Technical** (detailed under Core concepts)

| Field | Purpose |
|---|---|
| `capabilities[]` | triggers / actions / search / sync (→ workflow nodes) |
| `credentialType` | `oauth` · `api_key` · `basic` · `webhook` |
| `configSchema` | per-install config the connect UI collects |

# Credentials & security

Credentials are the crux — get this right and the rest is plumbing.

* **OAuth broker** — for OAuth integrations (Shopify, Google, HubSpot, Salesforce, QuickBooks, Meta,
  …): run the authorize → callback → token-exchange flow, store the **access + refresh tokens** in the
  vault, and **auto-refresh** before expiry. The account never handles raw tokens.
* **API-key integrations** (Mailgun, SendGrid, L2, …) — the account pastes its key; we **validate** it
  immediately and store it encrypted. Never logged, never returned to the client after save.
* **At rest** — every secret is **KMS-encrypted** under a per-account CMK (same posture as the `@repo/ai`
  BYOK keys); the app holds only a vault **reference**, decrypting on use.
* **Webhook verification** — inbound 3rd-party webhooks carry a signing secret/HMAC; the intake layer
  verifies it (the marketplace registers the subscription + stores the secret).
* **Least privilege + revocation** — request the **minimum scopes** per integration; **removal purges**
  the credential and, where supported, **revokes** the token at the provider.
* **Account-inactive auto-pause** — if the account is suspended/closed, **all integrations pause**
  automatically (no syncs, no outbound calls, webhooks ignored) — config + creds retained for a grace
  window, then purged on hard close (GDPR-consistent).

# Lifecycle

```
 browse ──enable──► configured ──connect(creds ok)──► ACTIVE ⇄ pause/resume ──► PAUSED
   ▲                    │                                │                          │
   │                    └── connect fails ──► NEEDS_AUTH │ account inactive ──► AUTO-PAUSED
   │                                                     │
   └──────────────── remove (purge creds, revoke) ───────┴──► REMOVED
```

**User-facing terms map to these states:**
* **Install** = enable + connect (creds validated) → **ACTIVE**.
* **Disable** = **pause**: turn it off but **keep config + credentials** — reversible instantly. (Also
  happens automatically as **auto-pause** when the account goes inactive.)
* **Uninstall** = **remove**: purge the credential, **revoke** upstream, tear down webhook subscriptions.

* **Pause/disable keeps everything** (config + creds) and just stops activity — reversible instantly.
* **Remove/uninstall** purges the credential, revokes upstream, and tears down webhook subscriptions.
* Each install is **account-scoped** (`Installation pk=ACCOUNT#<accountId>`); a paid `paywall` add-on
  also checks the account's entitlement/billing on install.
* Every transition is **audited** (who/when/what) per the platform `AuditEvent` — including
  **license / terms / privacy acceptance** at install time.

# Architecture

```
  account ──browse/enable/configure──► MARKETPLACE (control plane)
                                          │  catalog + installations (DynamoDB)
                                          │  credential vault (Secrets Manager + KMS CMK)
                                          │  OAuth broker (authorize/callback/refresh)
                                          ▼
  3rd-party webhook ─► incoming-webhook intake ─► SQS ─► CONNECTOR RUNTIME ──► normalized events
                                                          (per-integration logic)        │
  workflow / contact / analytics  ◄── normalized events ──┘     outbound actions ◄───────┘
                                                                (sync contact, push order, …)
  account (entitlements, active/inactive)  ·  billing/Stripe (paid add-ons)  ·  monitor (health/trace)
```

* Marketplace stores **what/whom/creds**; the **connector runtime** uses a vault reference to do the
  work; inbound events arrive via the **shared webhook intake**; normalized events feed **workflow**
  (as triggers) and **contact/analytics**; outbound **actions** are driven by workflow or sync jobs.

# Requirements

* **Categorized catalog** — browsable by **category** and **vertical** (political / nonprofit /
  e-commerce / marketing), searchable, with per-integration docs + required-credential disclosure.
* **One-click enable + guided connect** — OAuth in a redirect, or a validated key entry; show
  connection health immediately.
* **Pause without losing config** — reversible; **remove** fully purges creds + webhooks + revokes.
* **Auto-pause on account inactivity** — driven by the account service's status.
* **Entitlement + billing gating** — plan determines which integrations are available; paid add-ons
  bill through account/Stripe (included quota / subscription / usage — see Open decisions #5).
* **Usage metering (every integration)** — meter usage **per instance** (calls, syncs, actions, records,
  last-used) **regardless of current price**, and **roll it up per account** (per-integration total +
  account total — a simple sum, not a pipeline). Two reasons: (1) feeds **usage-based billing**, and
  (2) gives **the business the data to set + evolve pricing**. **Billing + quotas roll up to the billing
  owner** — for an agency, the **top account**, summing across its **sub-accounts** (the agency resells /
  marks up; sub-accounts don't see platform pricing — see account service). Metering stays simple
  (per-instance counters → summed). Surfaced to **analytics / admin** + the account UI.
* **Connection health monitoring** — periodic checks; `needs-reauth` prompts; failures surfaced to
  monitor + the account UI.
* **Multiple instances (opt-in)** — a definition may allow several installs per account (`multiInstance`)
  for agency / multi-brand cases (multiple stores, ad accounts, SFTP destinations); each has an
  instance id + label. This is the per-account **cardinality** knob: default **single-instance (`0:1`)** vs
  **multi-instance (`0:N`)**. **Provider/channel integrations are single-instance** (`0:1`) — an account runs
  at most one instance of a given email/SMS/print/social provider (incl. the dev **"fake" providers**), which
  may still hold **multiple named credentials for rotation** within that one instance; only agency/multi-brand
  connectors opt into `multiInstance`.
* **Audit + multi-tenancy** — all installs/config/credential changes audited; everything account-scoped.
* **Connector SDK — one contract, two run modes** — a typed `triggers` / `actions` / `sync` + credential
  + config schema, surfaced **both** as **workflow nodes** and as a **standalone service** plugged into
  the bus; OAuth + dev-key auth apply to both. New integrations are additive, not bespoke.

# Integration catalog — current + recommended

Existing picks are kept; **bold** = recommended high-value additions to reach the new verticals.
Vertical key: **P**olitical · **N**onprofit · **E**-commerce · **M**arketing.

| Category | Integrations | Verticals |
|---|---|---|
| **CRM** | HubSpot, Salesforce, NationBuilder, Bloomerang, Blackbaud Raiser's Edge, Neon CRM, GiveButter, **Zoho CRM, Google Contacts, Pipedrive, MS Dynamics, Keap, ActiveCampaign, DonorPerfect, Virtuous, Bonterra/EveryAction-NGP VAN, Klaviyo** | all |
| **Fundraising / Payments** *(new)* | **ActBlue, WinRed** (P), **Donorbox, Classy, Fundraise Up, GiveButter** (N), **Stripe, PayPal, Square** (E/M) | P N E M |
| **E-commerce** | Shopify, Squarespace, **WooCommerce, BigCommerce, Wix, Magento/Adobe Commerce, Recharge** | E M |
| **Messaging channels** *(new — "universal message")* | **WhatsApp Business, Facebook Messenger, Instagram DM, RCS, Apple Messages for Business, Telegram, mobile push (FCM/APNs)** | all |
| **Team chat / Collaboration** *(new)* | **Slack, Microsoft Teams, Google Chat** — internal alerts/notifications (the `notify-internal` node), not contact-facing | all |
| **Email (ESP)** | Mailgun, MailerSend, Postmark, Mailtrap, SendGrid, **Amazon SES, Brevo, SparkPost, Resend, Mailchimp, Constant Contact** | all |
| **Marketing / Ads & Social** *(new)* | **Meta Ads + Lead Ads, Google Ads, TikTok Ads, LinkedIn, X/Twitter** | M E P |
| **CDP / Analytics / Data** | L2, TargetSmart, **Segment (CDP), Google Analytics 4, Snowflake, BigQuery, Mixpanel, Amplitude, Catalist, PDI** | all |
| **Workflow / iPaaS** | Zapier, Workato, **Make, Tray.io, n8n, Pipedream** | all |
| **Forms / Surveys / Events** *(new)* | **Typeform, Jotform, SurveyMonkey, Google Forms, Eventbrite, Mobilize, Action Network, Luma** | P N M |
| **Canvassing / Phone / Advocacy** | MiniVAN, OpenVPB/CallHub, **ThruText, Scale to Win, Hustle, Phone2Action/Quorum, New/Mode, Resistbot** | P N |
| **Accounting** | IsPolitical, Aristotle, Aplos, MonkeyPod, QuickBooks, **Xero, Sage Intacct, Bill.com** | all |
| **Support / Helpdesk** *(new)* | **Zendesk, Intercom, Freshdesk** | E M |
| **Storage** | Google Drive, **Dropbox, Box, OneDrive/SharePoint, Amazon S3, SFTP** | all |
| **Calendar / Scheduling** *(new)* | **Calendly, Google Calendar, Microsoft 365** | all |
| **AI providers** *(new)* | **AWS Bedrock, Anthropic, OpenAI** (account BYOK keys → `@repo/ai`) | all |

# Strategic recommendations

1. **Lead with a CDP — Segment.** It normalizes events/identity from dozens of sources behind one
   integration, so a single Segment connector unlocks data from tools we haven't built connectors for
   yet. High leverage for marketing + e-commerce.
2. **Klaviyo for e-commerce.** It's the dominant email/SMS+data platform for Shopify-class stores —
   table stakes to win that vertical.
3. **Fundraising/payments is its own category, not a CRM footnote.** ActBlue/WinRed (political),
   Donorbox/Classy/Fundraise Up (nonprofit), Stripe/PayPal/Square (commerce) are how each vertical
   moves money — and donation/purchase events are the **best workflow triggers** (thank-you flows,
   receipts, lapsed-donor win-backs).
4. **Deliver on "universal message" with real channels.** WhatsApp, Messenger/Instagram, RCS, Apple
   Messages, push — this is the "(text, email, other)" promise; each is a delivery channel for
   dispatch, surfaced as a marketplace add-on.
5. **Treat native AWS as first-party "integrations."** SES (email), S3 (storage), Bedrock (AI) appear
   in the catalog but need **no account credentials** (platform IAM) — the easy, zero-config defaults.
6. **Make AI BYOK a marketplace category.** Account-supplied Bedrock/Anthropic/OpenAI keys flow through
   the same vault and feed `@repo/ai`'s `forAccount()` resolution — one credential model for everything.
7. **Pair vertical catalogs with workflow template packs.** Each vertical's integrations ship alongside
   ready-made **workflow templates** (e.g. enable Shopify → offer the *abandoned-cart → SMS* template;
   enable ActBlue → *new-donation → thank-you* template). Enabling an integration suggests the journeys
   that use it — the marketplace and workflow's template gallery reinforce each other for onboarding.

# Data model

The typed model lives in **[`src/MarketplaceModel.ts`](src/MarketplaceModel.ts)** (`Marketplace.*`) — the source
of truth for the relationships: **`IntegrationDefinition`** (global catalog, `pk=DEF#<integrationId>`) └─<
**`Installation`** (account-scoped, `pk=ACCOUNT#<accountId> sk=INTEG#<integrationId>[#<instanceId>]`, GSI by
status) ├── `credentialRef` ──► **`Credential`** (Secrets Manager + KMS CMK) └─< **`UsageMeter`**
(`sk=USAGE#<integrationId>#<instanceId>#<period>`; account roll-up = **SUM** the period's `USAGE#` items, no
aggregate table; rolls up to the **billing owner** — an agency = the TOP account).

* Installations are **archived / auto-paused, never silently dropped**; credentials are **hard-purged** on
  remove + on account hard-close (consistent with the platform's archive-vs-GDPR rules).

# Service & Job topology

**Convention (platform-wide).** Each service layers **framework base → domain base → concrete role**. A **domain
Service base** (`MarketplaceService extends Service`) and a **domain Job base** (`MarketplaceJob extends Job`)
hold the **shared domain code** — the **catalog / installation** model, the **OAuth broker** (authorize /
callback / refresh), the **credential vault** (Secrets Manager + KMS), the **connector SDK / registry**, the
**entitlement + cross-border gate**, **usage metering**, the **`WorkQueue`** egress pacing, and **audit** — so
every concrete role inherits it. Marketplace is a **control plane + connector runtime**: a control-plane API, a
provider-facing webhook ingress, and event-driven workers for the per-integration logic.

```
Application
├── Service (Fastify, long-running — ECS)
│     └── MarketplaceService      (domain base — catalog/installation · OAuth broker · credential vault (Secrets Manager + KMS) · connector SDK/registry · entitlement + cross-border gate · metering · WorkQueue · audit; not deployed alone)
│           ├── MarketplaceMainService    (the /marketplace/* API: catalog browse · enable/configure/disconnect (accept-to-enable + cross-border gate) · OAuth authorize/callback · connection-health reads · config/health)
│           └── MarketplaceWebhookService (3rd-party INBOUND webhook intake — per-connector signature-verify, ACK-fast → enqueue; provider-facing, scales apart)
└── Job (Lambda, event-driven)
      └── MarketplaceJob          (domain base — connector SDK/registry · vault · idempotency · retry/DLQ)
            ├── MarketplaceConnectorJob (SQS ← webhook intake — INBOUND: connector.normalize a 3rd-party event → emit normalized → workflow / contact / analytics)
            ├── MarketplaceActionJob    (SQS ← workflow / sync — OUTBOUND: connector.execute an action (sync contact, push order); egress-gated + rate-paced via WorkQueue)
            ├── MarketplaceTokenJob     (EventBridge — refresh OAuth tokens before expiry → vault)
            └── MarketplaceHealthJob    (EventBridge — probe active connections → mark degraded/broken → alert)
```

**Services (HTTP, ECS Fargate)**

| Class | Extends | Role |
|---|---|---|
| **`MarketplaceService`** | `Service` | **Domain base** — catalog/installation · OAuth broker · credential vault · connector SDK/registry · entitlement + cross-border gate · metering · `WorkQueue` · audit; **not deployed alone**. |
| **`MarketplaceMainService`** | `MarketplaceService` | The **control-plane `/marketplace/*` API** — catalog browse, **enable / configure / disconnect** (**accept-to-enable** + **cross-border gate**, `marketplace-2.7`), **OAuth authorize / callback**, connection-health reads, config/health. |
| **`MarketplaceWebhookService`** | `MarketplaceService` | **3rd-party inbound webhook intake** — per-connector **signature-verify, ACK-fast → enqueue**; provider-facing (multi-integration, burst-prone) so it **scales apart** from the control-plane API. |

**Jobs (Lambda, event-driven)** — each extends `MarketplaceJob`:

| Class | Trigger | Role | Req |
|---|---|---|---|
| **`MarketplaceConnectorJob`** | SQS ← webhook intake | **Inbound** — `connector.normalize` a 3rd-party event → emit **normalized events** to [workflow](../workflow/SPECS.md) (triggers) / [contact](../contact/SPECS.md) / [analytics](../analytics/SPECS.md) | marketplace-5.0 / 10.0 |
| **`MarketplaceActionJob`** | SQS ← workflow / sync | **Outbound** — `connector.execute` an action (sync contact, push order, …); **egress-gated** (feature-flag × connecting-user permission) + **rate-paced** via `WorkQueue` (throttle like SMS providers) | marketplace-4.0 |
| **`MarketplaceTokenJob`** | EventBridge (scheduled) | **Refresh OAuth tokens** before expiry → update the vault; mark a connection broken if refresh fails | marketplace-3.0 |
| **`MarketplaceHealthJob`** | EventBridge (scheduled) | **Probe active connections** → mark degraded / broken → alert ([monitor](../monitor/SPECS.md)) + notify the account | marketplace-9.0 |

> **Shared modules (not deployables).** The **connector SDK** is the **single dialect boundary** per integration
> (Stripe / Shopify / Zapier / external-HubSpot / …) — `verifySignature` · `normalize` (inbound) · `execute`
> (outbound action) · `healthCheck` — self-registering into a typed registry, the same pattern as texting's
> `SmsAdapter`. The **OAuth broker** (grant / arctic + vault), the **credential vault** (Secrets Manager + KMS —
> tokens **never** leave it; jobs hold a vault *reference*), the **cross-border gate** (EU→US SCC acceptance,
> `marketplace-2.7`), **egress gating**, and **`WorkQueue`** pacing live on the bases. **Erasure boundary:** once
> data egresses to a 3rd party the account chose, erasure = **stop-sending + disclose**, not reach-in-delete
> (the account is controller downstream).

# AWS Services and Other Dependencies

**AWS services**
* **DynamoDB** — the catalog (`IntegrationDefinition`), per-account `Installation`s, `UsageMeter`.
* **Secrets Manager** (+ **KMS** per-account CMK) — the credential vault.
* **SQS** — inbound webhook intake → connector runtime.
* **S3** — catalog icon / asset storage.
* **EventBridge** — account-status (active/inactive) → auto-pause; periodic health-check scheduling.
* **API Gateway / CloudFront** — the OAuth authorize / callback redirect endpoints.

**Third-party libraries / services**
* **The integrations themselves** — OAuth / API to HubSpot · Salesforce · Shopify · Stripe · Meta/Google Ads · Mailgun/SendGrid · Slack/Teams · QuickBooks · Segment · … (the catalog). **Each is a sub-processor of account data.**
* **OAuth broker built in-infra** — `grant` / `arctic` (OAuth2 dance) + a refresh worker. *(For the connector long tail: a **self-hostable OSS** library, e.g. **Nango**, run in-infra — **not** a managed unified-API vendor, per the data-in-infra tenet; gap #3.)*

**Internal (`@repo/*`)**
* `@repo/services` (Dynamo, Secrets, Kms, Sqs, S3), `@repo/endpoint` (`Access`), `@repo/common` (`Type`). Account-supplied AI keys feed **`@repo/ai`** BYOK (`forAccount()`).
* Composes **[account](../account/specs/SPECS.md)** (entitlements, billing, active/inactive), **[workflow](../workflow/SPECS.md)** (connectors as trigger/action nodes), the **connector runtime** (data plane), and **dispatch / contact / analytics / monitor** (events, health).

# Compliance & standards mapping

How **this marketplace service's** controls map to **OWASP Top 10 (2021)**, **ISO/IEC 27001:2022** (Annex A),
**SOC 2 Type 2** (TSC), **HIPAA** (if PHI), **GDPR**, and **CCPA/CPRA**. Marketplace is the **integration
control plane + per-account credential vault** — its dominant controls are **secret security (KMS BYOK vault)**,
**OAuth least-privilege**, and **3rd-party sub-processor / data-egress governance** (each enabled integration is
a new data flow to a 3rd party — the account **accepts** its terms/privacy and is the **controller**;
marketplace **discloses + audits**). There is **no PCI** surface here (paid add-ons bill via **account /
Stripe** — that service owns the payment surface); **HIPAA** is ➖ (no PHI by [AUP](../account/specs/SPECS.md);
3rd-party data *could* carry it → account-responsible). The connector **data plane / SSRF** lives in the
**connector runtime**, not here. Identity/RBAC live in [auth](../auth/specs/SPECS.md); residency is the platform
[AWS topology](../../../packages/services/src/aws/SPECS.md).

**Legend:** ✅ meets/exceeds · ⚠️ partial / shared-responsibility — see Gaps · ➖ n/a

| Marketplace control | OWASP T10 | ISO 27001:2022 | SOC 2 (TSC) | HIPAA (if PHI) | GDPR | CCPA | |
|---|---|---|---|---|---|---|---|
| **Per-account credential vault** — KMS CMK; never logged / returned after save; refresh + revoke | A02 | A.8.24 / A.5.17 | CC6.1 | §164.312(a)(2)(iv) | Art 32 | ➖ | ✅ |
| **OAuth least-privilege** — request the minimum scopes per integration | A01 / A05 | A.8.2 / A.5.15 | CC6.1 / CC6.3 | ➖ | Art 25 / 32 | ➖ | ✅ |
| **Tenant isolation** — account-scoped installs + per-account CMK; never cross-account | A01 | A.8.3 | CC6.1 | ➖ | Art 32 | §1798.100 | ✅ |
| **Webhook verification** — inbound 3rd-party HMAC / signing verified at the edge | A08 | A.8.24 / A.8.26 | CC7.1 | ➖ | Art 32 | ➖ | ✅ |
| **3rd-party sub-processor governance** — **accept-to-enable**: terms / privacy + data-sharing acknowledgment **required + audited**; account is the controller | A08 | A.5.19–.23 | CC9.2 | §164.308(b) | Art 28 / 44–49 | §1798.140 | ✅ accept-to-enable |
| **Cross-border transfer (EU → US)** — integration `dataJurisdiction` (US/EU/All); an **EU account** enabling a **US** service must accept an **escalated transfer notice** (SCCs; US processing disclosed) | A08 | A.5.14 / A.5.34 | CC9.2 | ➖ | **Art 44–49** | §1798.140 | ✅ cross-border gate |
| **GDPR purge + egress boundary** — removal purges **our** creds + revokes the token + tears down webhooks; **data already sent to the integration is NOT recallable** — account is controller downstream (root *Egress erasure boundary*) | A04 | A.8.10 | (Privacy) | §164.310(d)(2) | Art 17 | §1798.105 | ✅ |
| **Auto-pause on account inactive** — no syncs / calls / webhooks when suspended | A01 | A.5.18 | CC6.x | ➖ | Art 32 | ➖ | ✅ |
| **Install / config / credential changes audited** (incl. acceptance) | A09 | A.8.15 | CC7.2 | §164.312(b) | Art 30 | ➖ | ✅ |
| **Encryption** — in transit (TLS to providers) + at rest (KMS) | A02 | A.8.24 | CC6.1 | §164.312(e) | Art 32 | ➖ | ✅ |
| **No card data** — paid add-ons bill via account / Stripe (PCI owned there) | ➖ | A.5.19 | CC9.2 | ➖ | ➖ | ➖ | ✅ no PCI here |
| **Connector egress / SSRF** — outbound calls run in the **connector runtime** (validated egress), not marketplace | A10 | A.8.23 | CC6.6 | ➖ | ➖ | ➖ | ➖ connector runtime |
| **Entitlement gating** — plan controls which integrations may enable | A01 | A.8.2 | CC6.3 | ➖ | ➖ | ➖ | ✅ |

# Gaps & open decisions

*The one review list.* ✅ = resolved/decided · ⚠️ = **open — needs attention**.

1. ✅ **Service boundary — DECIDED: standalone `marketplace` service** (account-scoped; depends on account).
2. ✅ **Connector runtime — DECIDED: a connector is *both*.** The same contract is a **workflow-node plugin**
   *and* can **run as a standalone service** on the bus; **OAuth + dev-key auth apply to both** — one
   credential/auth path either way.
3. ✅ **OAuth broker & connector long tail — DECIDED (make the broker; self-hosted for the long tail).** Two
   parts: **(a) the OAuth broker (auth) → MAKE it in-infra** — `grant` / `arctic` + our Secrets Manager / KMS
   **vault** + a refresh worker; the dance is commoditized and tokens **stay in our infra**. **(b) the connector
   data-plane long tail** (normalization + ongoing maintenance) → **build-vs-buy**, and **if buy, prefer a
   self-hostable OSS** connector library (e.g. **Nango** — ~250+ providers, run in our infra) over a **managed**
   unified-API vendor (Merge / Paragon / Apideck), because managed routes account **data + tokens through a 3rd
   party** — at odds with the **data-in-our-infra** tenet (and would itself need accept-to-enable disclosure).
   **Make the broker now; evaluate self-hosted Nango when the connector long tail becomes the bottleneck.**
4. ✅ **Multiple installs — DECIDED: opt-in `multiInstance`, default single.** Real multi-instance cases
   (agency / multi-brand: several Shopify stores, Meta/Google ad accounts, Salesforce orgs, Stripe accounts,
   Slack workspaces, SFTP destinations); each install carries an **instance id + label**.
5. ✅ **Paid add-on billing — DECIDED: plan-integrated (will evolve).** Included quota / per-add-on subscription
   / usage-based, all billed via **account / Stripe**; usage **summed across instances + sub-accounts** to the
   **billing owner** (agency = top account; sub-accounts don't see platform pricing). **Meter from day one**
   regardless of price.
6. ✅ **Default field mappings — DECIDED: build the data field-mapper.** Needed by the **workflow** engine
   (`transform` / field mapping), shared with marketplace; per-connector **default mappings** seed it.
7. ✅ **3rd-party sub-processor / data-egress governance — DECIDED: accept-to-enable.** Enabling an integration
   **requires the account to accept** the provider's **terms + privacy** *and* a **sub-processor / data-sharing
   acknowledgment** (data will flow to this 3rd party — possible international transfer) — **no enable without
   acceptance**. The acceptance (which URLs, which versions, who, when) is **audited** on the Installation
   (`marketplace-2.5` / `11.2`). Marketplace **discloses** where the data goes; the **account is the controller /
   responsible party**. **Cross-border escalation (DECIDED):** each integration carries a **`dataJurisdiction`
   (US / EU / All)**; an **EU account** enabling a **US** service (data leaves the EEA, Art 44–49) must accept an
   **escalated cross-border transfer notice** (SCCs; US processing disclosed) — `marketplace-2.7`.

# Requirements (traceable register)

The traceable requirement register for the **marketplace service** (the narrative sections above are the
rationale; this is the coded list). IDs are stable handles (**`marketplace-N.M`**) — cite them in code, tickets,
and tests. **Priority:** **A** = MVP, **B** = core / hardening, **C** = later. One level of sub-requirements; a
group's priority is its floor. **Boundaries:** marketplace is the **control plane** — catalog, installations,
the **credential vault**, lifecycle; the **connector runtime** owns the data plane; **[workflow](../workflow/SPECS.md)**
surfaces connectors as nodes; **[account](../account/specs/SPECS.md)** owns entitlements + billing; the shared
**webhook intake** receives inbound events.

## marketplace-1.0 Catalog — A
- **marketplace-1.1** **Categorized, searchable** catalog — by `category` + `vertical` (political / nonprofit / e-commerce / marketing) — A
- **marketplace-1.2** `IntegrationDefinition` fields — presentation · commerce (paywall / license / terms / privacy / visibility / multiInstance / metered) · **governance (`dataJurisdiction`: US / EU / All)** · technical (capabilities / credentialType / configSchema) — A
- **marketplace-1.3** `visibility` — `available` / `beta` / `deprecated` (list without deleting) — B
- **marketplace-1.4** Required-credential + docs **disclosure** per integration — A

## marketplace-2.0 Installation & lifecycle — A
- **marketplace-2.1** Lifecycle — enable → connect → **ACTIVE** ⇄ pause/resume → remove; **NEEDS_AUTH** on connect-fail — A
- **marketplace-2.2** Install = enable + connect (creds validated); **Disable = pause** (keep config + creds); **Uninstall = remove** (purge + revoke + tear down webhooks) — A
- **marketplace-2.3** **Auto-pause on account inactive** (driven by account status) — A
- **marketplace-2.4** Account-scoped (`Installation pk=ACCOUNT#`); paid add-on checks entitlement / billing on install — A
- **marketplace-2.5** **Accept-to-enable** — install **requires** the account to accept `license` / `terms` / `privacy` **and a sub-processor / data-sharing acknowledgment** (no install without it); **audited** (which URLs / versions / who / when) — A
- **marketplace-2.6** Every transition **audited** (`AuditEvent`) — A
- **marketplace-2.7** **Cross-border (EU → US) data-transfer gate** — an **EU account** enabling an integration with `dataJurisdiction` = **`US`** (data leaves the EEA, GDPR Ch. V / Art 44–49) must **explicitly accept a cross-border transfer notice** (US processing; **SCCs** apply; sub-processor + destination disclosed) — **escalated** from `marketplace-2.5`, **no enable without it**, **audited distinctly**. US→US / `All` take the ordinary path *(gap #7)* — A

## marketplace-3.0 Credentials & vault — A
- **marketplace-3.1** **OAuth broker — MAKE in-infra** (`grant` / `arctic` + our vault + a refresh worker): authorize → callback → token-exchange; store access + refresh; **auto-refresh** before expiry; account never handles raw tokens *(gap #3)* — A
- **marketplace-3.2** **API-key** integrations — validate immediately, store encrypted; never logged / returned after save — A
- **marketplace-3.3** **Vault** — per-account **KMS CMK** (Secrets Manager); app holds only a **reference**, decrypt on use — A
- **marketplace-3.4** **Least-privilege** scopes per integration — A
- **marketplace-3.5** **Removal purges** the credential + **revokes** upstream where supported — A
- **marketplace-3.6** Webhook **signing secret** stored; the intake verifies — A

## marketplace-4.0 Capabilities → workflow — A
- **marketplace-4.1** **Triggers** (events in) — webhook, or **polling + dedupe** for webhook-less APIs — A
- **marketplace-4.2** **Actions** (calls out) — A
- **marketplace-4.3** **Search / find** (+ find-or-create) → workflow's `find-or-create` node — B
- **marketplace-4.4** **Sync / transfer** — ongoing mirror + optional **bulk backfill** on connect — B
- **marketplace-4.5** Enabled caps surface as **workflow trigger / action nodes** (scoped to what's connected + authorized) — A

## marketplace-5.0 Connector SDK & runtime — A
- **marketplace-5.1** **One connector contract** — typed triggers / actions / sync + credential + config schema — A
- **marketplace-5.2** **Two run modes** — workflow-node plugin *and* standalone service; OAuth + dev-key apply to both *(gap #2)* — A
- **marketplace-5.3** New integrations are **additive** (SDK), not bespoke — B
- **marketplace-5.4** **Connector runtime owns the data plane** — marketplace passes a vault reference; no connector logic here — A
- **marketplace-5.5** **Connector long tail — build-vs-buy**; if buy, a **self-hostable OSS** connector library (e.g. **Nango**) run **in-infra**, **not** a managed unified-API vendor (data-in-infra tenet) *(gap #3)* — C

## marketplace-6.0 Multi-instance — B
- **marketplace-6.1** **Opt-in `multiInstance`** per definition (default single); each install has an **instance id + label** (agency / multi-brand) *(gap #4)* — B

## marketplace-7.0 Entitlement & billing — B
- **marketplace-7.1** **Plan gating** — entitlement (`ResolvedEntitlements`) controls which integrations may enable — A
- **marketplace-7.2** **Paid add-ons** bill via **account / Stripe** — included quota / subscription / usage *(gap #5)* — B
- **marketplace-7.3** Billing / quota **roll up to the billing owner** (agency = top account, summed across sub-accounts) — B

## marketplace-8.0 Usage metering — B
- **marketplace-8.1** **Per-instance counters** (calls / syncs / actions / records / last-used); **metered from day one** regardless of price — B
- **marketplace-8.2** **Roll up per account / billing owner** — a simple SUM of `USAGE#` items, no pipeline — B
- **marketplace-8.3** Surfaced to **analytics / admin** + the account UI (feeds usage billing + pricing evolution) — B

## marketplace-9.0 Connection health — A
- **marketplace-9.1** Validate on connect + **periodic checks** — A
- **marketplace-9.2** Surface `connected` / `needs-reauth` / `error`; `needs-reauth` prompts; failures → **monitor** + account UI — A

## marketplace-10.0 Webhooks & events — A
- **marketplace-10.1** Inbound 3rd-party webhooks via the **shared intake** (verify at edge → SQS) — A
- **marketplace-10.2** **Connector runtime normalizes**; normalized events → **workflow** (triggers) + **contact / analytics** — A
- **marketplace-10.3** **Outbound actions** driven by workflow / sync jobs — A
- **marketplace-10.4** Marketplace **registers / tears down** webhook subscriptions on connect / remove — A

## marketplace-11.0 Privacy, security & compliance — A
- **marketplace-11.1** **Per-account credential vault** (KMS CMK); never logged / returned — A
- **marketplace-11.2** **3rd-party sub-processor governance** — enabling **requires acceptance** of the provider's terms / privacy **+ a data-sharing / sub-processor acknowledgment** (audited); marketplace discloses where data goes; the account is the controller *(gap #7)* — A
- **marketplace-11.3** **GDPR purge + egress boundary** — removal + account hard-close **hard-purge** creds (grace window) + revoke token + tear down webhooks; **PII already sent to the integration is NOT recallable** — account is **controller downstream** (root *Egress erasure boundary*); we **stop future flow + disclose**, never claim to erase the third party's copy — A
- **marketplace-11.4** **No PHI** by [AUP](../account/specs/SPECS.md); **no card data** (billing via account / Stripe) — A

## marketplace-12.0 Multi-tenancy & audit — A
- **marketplace-12.1** Everything **account-scoped**; per-account CMK; never cross-account — A
- **marketplace-12.2** All install / config / credential changes **audited** — A

## marketplace-13.0 Data model & infra — A
- **marketplace-13.1** **DynamoDB** — `IntegrationDefinition` (global) · `Installation` (account-scoped, GSI by status) · `UsageMeter` — A
- **marketplace-13.2** **Secrets Manager + KMS CMK** (vault) · **SQS** (webhook intake) · **S3** (icons) · **EventBridge** (auto-pause / health) — A
- **marketplace-13.3** Composes **account** (entitlements / billing / status) · **workflow** (nodes) · **connector runtime** (data plane) · **dispatch / contact / analytics / monitor** — A

## marketplace-14.0 Service & Job topology — B
- **marketplace-14.1** **Domain bases** — `MarketplaceService extends Service` + `MarketplaceJob extends Job` hold the shared code (catalog/installation · OAuth broker · credential vault · connector SDK/registry · cross-border gate · metering · `WorkQueue`); **concrete roles extend the domain base** — B
- **marketplace-14.2** **`MarketplaceMainService`** — the control-plane `/marketplace/*` API (browse · enable/configure/disconnect · OAuth authorize/callback · health reads) — A
- **marketplace-14.3** **`MarketplaceWebhookService`** — 3rd-party inbound webhook intake (per-connector signature-verify, ACK-fast → enqueue); **scales apart** from the control plane — A
- **marketplace-14.4** **Jobs extend `MarketplaceJob`** — `MarketplaceConnectorJob` (inbound normalize) / `MarketplaceActionJob` (outbound action, egress-gated + WorkQueue-paced) / `MarketplaceTokenJob` (OAuth refresh) / `MarketplaceHealthJob` (connection probes) — A
- **marketplace-14.5** **Connector SDK = single dialect boundary** per integration: `verifySignature` · `normalize` · `execute` · `healthCheck`, self-registered in a typed registry (the texting `SmsAdapter` pattern) — A
- **marketplace-14.6** **Tokens stay in the vault** — jobs hold a vault *reference*, never the secret; egress to a 3rd party = **stop-sending + disclose** on erasure (account is controller downstream) — A

# Endpoints (first cut)

A first pass at the endpoint surface, in [`@repo/endpoint`](../../../packages/endpoint/SPECS.md) style — all
service-prefixed **`/marketplace/*`**. Reads return the `{ data, page }` envelope.

**Access column:** **`minAccess`** on the `Access` ladder — **`-`** = public · account ladder
**`SENDER`<`USER`<`BILLING`<`ACCOUNT`** · staff ladder **`SUPPORT`<`APPLICATION`<`ROOT`** · **`⬆`** = step-up ·
**`Internal`** = VPC-only S2S · **`Provider-sig`** = signature-verified 3rd-party webhook · **`State`** =
OAuth `state`-validated callback. Browsing is `USER`; **enable / connect / lifecycle** require `ACCOUNT`
(accept-to-enable + billing); catalog definitions are platform-global (`APPLICATION`+).

### Catalog (marketplace-1)
| Method | URI | Purpose | Access | Req |
|---|---|---|---|---|
| GET | `/marketplace/catalog` | Browse / search the catalog (filter by `category` / `vertical`) | USER | marketplace-1.1 |
| GET | `/marketplace/catalog/{integrationId}` | Integration detail (definition fields, license / terms / privacy, paywall) | USER | marketplace-1.2 |
| POST | `/marketplace/catalog` | Create a definition (platform-global) | APPLICATION ⬆ | marketplace-1.2 |
| PATCH | `/marketplace/catalog/{integrationId}` | Edit a definition (visibility, paywall, capabilities) | APPLICATION ⬆ | marketplace-1.2/1.3 |

### Installations & lifecycle (marketplace-2)
| Method | URI | Purpose | Access | Req |
|---|---|---|---|---|
| GET | `/marketplace/installations` | List the account's installs + status + health | USER | marketplace-2.1/9.2 |
| POST | `/marketplace/installations` | **Enable** — create an install with config **+ acceptance** (license/terms/privacy + sub-processor ack — *accept-to-enable*) | ACCOUNT | marketplace-2.1/2.5 |
| GET | `/marketplace/installations/{id}` | Install detail (config, status, health, acceptance) | USER | marketplace-2.1 |
| PATCH | `/marketplace/installations/{id}` | Update config / label | ACCOUNT | marketplace-2.1 |
| POST | `/marketplace/installations/{id}/pause` | **Disable** (pause) — keep config + creds | ACCOUNT | marketplace-2.2 |
| POST | `/marketplace/installations/{id}/resume` | Resume a paused install | ACCOUNT | marketplace-2.2 |
| DELETE | `/marketplace/installations/{id}` | **Uninstall** — purge creds, **revoke upstream**, tear down webhooks | ACCOUNT ⬆ | marketplace-2.2/3.5 |

### Connect & OAuth (marketplace-3)
| Method | URI | Purpose | Access | Req |
|---|---|---|---|---|
| POST | `/marketplace/installations/{id}/connect` | Start connection — OAuth → returns the **authorize redirect URL**; API-key → **validate** + store | ACCOUNT | marketplace-3.1/3.2 |
| GET | `/marketplace/oauth/callback` | OAuth provider **callback** → token-exchange → vault (state-validated) | State | marketplace-3.1 |
| POST | `/marketplace/installations/{id}/reauth` | Re-trigger OAuth when `needs-reauth` | ACCOUNT | marketplace-9.2 |

### Health & usage (marketplace-8, marketplace-9)
| Method | URI | Purpose | Access | Req |
|---|---|---|---|---|
| GET | `/marketplace/installations/{id}/health` | Current health (`connected` / `needs-reauth` / `error`) | USER | marketplace-9.2 |
| POST | `/marketplace/installations/{id}/health/check` | Trigger a health check now | ACCOUNT · APPLICATION | marketplace-9.1 |
| GET | `/marketplace/usage` | Account usage roll-up (per-integration + total, by period) | USER | marketplace-8.2/8.3 |
| GET | `/marketplace/installations/{id}/usage` | Per-instance usage counters | USER | marketplace-8.1 |
| GET | `/marketplace/installations/{id}/capabilities` | Triggers / actions / search / sync available (workflow node binding) | USER | marketplace-4.5 |

### Webhooks, internal / S2S & ops
| Method | URI | Purpose | Access | Req |
|---|---|---|---|---|
| POST | `/marketplace/webhooks/{provider}` | Inbound 3rd-party webhook — verified at edge → SQS → connector runtime | Provider-sig | marketplace-10.1 |
| GET | `/marketplace/internal/installations/{id}/token` | S2S: connector runtime resolves a **fresh token** (marketplace owns refresh; never raw storage) | Internal | marketplace-3.1/3.3 |
| POST | `/marketplace/internal/usage` | S2S: connector runtime **reports usage** signals (calls / syncs / actions / records) | Internal | marketplace-8.1 |
| GET, PUT | `/marketplace/config` | Read / set the service's own runtime config (AppConfig-backed) | ROOT | marketplace-13.2 |
| GET | `/marketplace/health` | Liveness / readiness | - | marketplace-13.2 |

> **Event-driven, not HTTP:** **auto-pause** on account active/inactive is driven by an **EventBridge** account-status event → a worker, not a public route.

# eof
