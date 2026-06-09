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

> **Install-time acceptance:** where present, the account accepts `license` + `termsUrl` + `privacyUrl`
> at install; the acceptance (which URLs, which versions, who, when) is **audited** on the Installation.

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
  instance id + label.
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

# Data model (sketch)

```
IntegrationDefinition   pk=DEF#<integrationId>            (catalog; platform-global)
  { name, provider, category, verticals[], description, icon, website, docsUrl,
    capabilities[], credentialType, configSchema, multiInstance?, metered?,
    license, termsUrl?, privacyUrl?, paywall?: { plan?, price?: { amount, currency, interval } }, visibility }

Installation            pk=ACCOUNT#<accountId>  sk=INTEG#<integrationId>[#<instanceId>]   (account-scoped; instanceId only when multiInstance)
  { status: active|paused|auto_paused|needs_auth|removed, label?, config, credentialRef, health,
    installedBy, installedAt, accepted?: { license?, termsUrl?, privacyUrl?, at }, disabledAt?, … }
  GSI: by status (sweep needs-auth / health checks)

UsageMeter              pk=ACCOUNT#<accountId>  sk=USAGE#<integrationId>#<instanceId>#<period>   (period = YYYY-MM)
  { calls, syncs, actions, records, lastUsedAt }
  // per-instance counters. Account roll-up = SUM the period's USAGE# items (one integration, or all) —
  // no separate aggregate table. Billing/quota roll up to the billing owner (an agency = the TOP account).

CredentialVault entry   Secrets Manager: marketplace/<accountId>/<integrationId>   (KMS CMK)
  { type: oauth|api_key|basic|webhook, accessToken?, refreshToken?, expiresAt?, apiKey?, … }
```

* Installations are **archived/auto-paused, never silently dropped**; credentials are **hard-purged** on
  remove + on account hard-close (consistent with the platform's archive-vs-GDPR rules).

# Open decisions

1. ~~Service boundary~~ — **DECIDED: standalone `marketplace` service** (depends on account).
2. ~~Connector runtime home~~ — **DECIDED: a connector is *both*.** The same connector contract is
   surfaced as a **workflow-node plugin** *and* can **run as a standalone service** already wired into the
   architecture (events/queues). **OAuth + dev-key access apply to both modes** — one credential/auth path
   whether the connector is invoked by a workflow node or runs on its own.
3. **OAuth broker** — build vs. a managed connectors product (a unified-API vendor) for the long tail of
   OAuth integrations. *(still open)*
4. ~~Multiple installs per integration~~ — **DECIDED: allow it, opt-in per definition (`multiInstance`),
   default single.** Most integrations are one-per-account, but real multi-instance cases exist — an
   **agency / multi-brand** account with several **Shopify stores**, **Meta / Google Ad accounts**,
   **Salesforce orgs**, **Stripe accounts**, or **Slack workspaces**, and **multiple delivery destinations**
   (several **SFTP / storage** endpoints). Each install carries an **instance id + label**.
5. ~~Paid add-on billing model~~ — **DECIDED: plan-integrated**, evaluated at the **billing account** and
   it **will evolve**. Support an **included quota** (e.g. *3 free, then $X/mo per additional*), a
   **per-add-on subscription**, and/or **usage-based** pricing — all billed through **account / Stripe**
   (see account/PRICING.md). Usage is **summed across instances and sub-accounts** up to the **billing
   owner** — for an agency, the **top account** (sub-accounts don't see platform pricing; reseller/markup
   + hierarchy in the account service). **Meter from day one** regardless of price.
6. ~~Default field mappings~~ — **DECIDED: build the data field-mapper** — needed for the **workflow
   engine** (`transform` / field mapping), shared with marketplace; per-connector **default mappings**
   seed it.
