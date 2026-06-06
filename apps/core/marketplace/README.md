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

* **Integration definition** — a catalog entry: id, name, **category**, **vertical tags**, the
  **capabilities** it offers, its **credential type** + config schema, docs, and entitlement/pricing.
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

* **Pause keeps everything** (config + creds) and just stops activity — reversible instantly.
* **Remove** purges the credential, revokes upstream, and tears down webhook subscriptions.
* Every transition is **audited** (who/when/what) per the platform `AuditEvent`.

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
  bill through account/Stripe.
* **Connection health monitoring** — periodic checks; `needs-reauth` prompts; failures surfaced to
  monitor + the account UI.
* **Audit + multi-tenancy** — all installs/config/credential changes audited; everything account-scoped.
* **Connector SDK** — a typed contract (`triggers` / `actions` / `sync` + credential + config schema)
  so new integrations are additive, not bespoke.

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
  { name, category, verticals[], capabilities[], credentialType, configSchema, entitlement, docsUrl }

Installation            pk=ACCOUNT#<accountId>  sk=INTEG#<integrationId>
  { status: active|paused|auto_paused|needs_auth|removed, config, credentialRef, health, installedAt, … }
  GSI: by status (sweep needs-auth / health checks)

CredentialVault entry   Secrets Manager: marketplace/<accountId>/<integrationId>   (KMS CMK)
  { type: oauth|api_key|basic|webhook, accessToken?, refreshToken?, expiresAt?, apiKey?, … }
```

* Installations are **archived/auto-paused, never silently dropped**; credentials are **hard-purged** on
  remove + on account hard-close (consistent with the platform's archive-vs-GDPR rules).

# Open decisions

1. ~~Service boundary~~ — **DECIDED: standalone `marketplace` service** (depends on account).
2. **Connector runtime home** — does the data-plane runtime live here, in **workflow**'s integration
   service (#9), or as its own service? (One connector contract either way.)
3. **OAuth broker** — build vs a managed connectors product (e.g. a unified-API vendor) for the long
   tail of OAuth integrations.
4. **Multiple installs per integration** — one HubSpot per account, or several (multi-org)?
5. **Paid add-on billing model** — flat per-integration fee, usage-based, or bundled into plans
   (ties to account/PRICING.md).
6. **Default field mappings** — per-connector defaults now; a visual mapper (shared with workflow
   `transform`) later.
