#
# Links service (tracked links · redirect · QR / PURL)
#

# Objective

The platform's **one tracked-link system**: mint a per-recipient short link / **QR** / **PURL**, resolve a
click/scan to a redirect, and emit the **engagement + conversion touch** for attribution. A short-link
(SMS/email), a print **QR**, and a **PURL** are the *same thing* with different rendering — one code→target
mapping, one scan pipeline. Every channel uses it; **analytics** does the attribution math on what it emits.

The load-bearing ideas:
* **one mapping, every rendering** — a single `code → target` is rendered as a **short URL** (SMS/email), a
  **QR glyph at print DPI** ([print](../print/SPECS.md)), or a **PURL** landing path; adding a surface is a new
  *rendering*, not a new pipeline;
* **the code is an opaque surrogate — no PII in the URL** — `campaignId × contactId × channel × messageId` lives
  **server-side**, behind a short base62 `code`; what travels on the wire (or a postcard) discloses nothing;
* **the redirect is a public hot edge** — `<short-domain>/<code>` does **lookup → record → 302 in <50 ms at high
  QPS, always up**, and the mapping is **availability-decoupled** from the campaign lifecycle (a QR scanned weeks
  later still resolves);
* **links emits the touch; analytics does the math** — links captures the scan/click (device `UserAgent` + geo)
  and emits the **engagement / conversion touch event**; **attribution credit is [analytics](../analytics/SPECS.md)'**,
  not links';
* **consumer → provider, whitelabel-ready** — campaign / workflow / channels **call** links to mint codes (it's
  part of none of them), over **branded short domain(s)** including **per-account whitelabel**.

# Why a separate service (not part of campaign)

**Campaign *and* workflow are both first-class consumers** — links is **infrastructure** they each call, not
a module of either:

* **Many senders need it, not just campaign** — **[workflow](../workflow/SPECS.md) `send`
  nodes** mint tracked links exactly like a campaign does (this alone rules out living inside campaign), plus
  transactional messages (verification / registration links), one-off sends, and marketplace. If links lived
  in campaign, every one of them would have to depend on campaign — wrong direction.
* **The redirect is a public, hot, latency-critical edge** — `<short-domain>/<code>` does lookup → record →
  **302** in **<50 ms at high QPS, always up**. That operational profile is nothing like campaign's
  authoring/orchestration control plane.
* **Availability decoupling (decisive)** — a postcard QR is scanned **weeks after** the campaign ends, or
  while campaign is mid-deploy. The redirect **must still resolve**, so the code→target mapping lives in a
  service independent of the campaign lifecycle.
* **One short domain + one scan pipeline**, and the mapping **outlives** any campaign.

**Relationship:** **consumer → provider.** Campaign / workflow / channels **call** links to mint codes;
**campaign or the workflow `send` node owns the target/CTA *definition*** (what we want the user to do);
**links owns the tracked code + redirect + scan capture**; **analytics owns attribution**. (Like a URL
shortener: used by campaigns *and* workflows, part of neither.)

# Role & boundaries

What it **owns**:

* **Mint** — issue a per-recipient opaque `code` → `target`, stamped with attribution context.
* **Resolve / redirect** — the public hot endpoint: code → record engagement → 302 (or render a PURL landing).
* **QR / PURL rendering** — turn a code's URL into a **QR glyph at print DPI** (for [print](../print/SPECS.md))
  or a PURL path; short URL for SMS/email.
* **Scan/click capture** — emit the engagement (and conversion) **touch event**, with device (`UserAgent`)
  and geo, to analytics.
* **The branded short domain(s)** — incl. **whitelabel** per account.

What it **delegates / does NOT do**:

| Concern | Owner |
|---|---|
| **Attribution math** (multi-touch credit) | **[analytics](../analytics/SPECS.md)** (links emits the touch) |
| The **target / CTA definition** (what the user should do) | **[campaign](../campaign/SPECS.md)** / workflow |
| Sending the piece that carries the link | the **channel** ([email](../email/SPECS.md) · [texting](../texting/SPECS.md) · print) |
| **Contact** identity + suppression | **contact / account** (links stores only an opaque contact id) |

# Core concepts

* **TrackedLink** — an opaque short **`code`** → a **`target`** (destination URL), stamped with the
  attribution tuple **`campaignId?` × `contactId?` × `channel` × `messageId/pieceId?`** and a
  **`targetType`** (`cta` · `registration` · `landing` · `content` · `unsubscribe` · `deep-link`). The `code` is
  an **opaque surrogate key** — a short base62 string that the server maps to the tuple; **the IDs are never in
  the URL**. **Tracked** links are minted **per recipient**, so a click/scan attributes **1:1**; **untracked**
  links skip the per-recipient mapping — a **shared code that just redirects to a CTA** (no attribution).
* **`channel`** — `sms | email | print | …`: which channel carried the link (so the same target across
  channels stays distinguishable). This is the "uniform per campaign / contact / channel" model.
* **`target` / `targetType`** — links is **target-agnostic**: it stores the destination + a tag for what the
  account is trying to make the user do; the destination is the account's (a CTA, a registration flow, a
  content page, an unsubscribe).
* **Engagement event** — a click/scan → emitted as a **Kafka domain event** (`link.clicked` /
  `link.scanned`) carrying the attribution tuple. **Two** subscribers, same event: **analytics** (a touch +
  conversion signal) **and** [workflow](../workflow/SPECS.md) (a **trigger** — see Use
  cases). Not kept here as durable channel state (mirrors print's tracking model).
* **Short domain** — the host in `<short-domain>/<code>`; **shared** (platform-branded, multi-account) or
  **whitelabel** (account-branded, single-account). Opaque code in the path (**no PII in the URL**). Managed in
  a **registry** and **assigned 0-N per account** (see *Short-domain management* below).
* **ShortDomain** — a registry entry: `{ domain, kind: shared | whitelabel, ownerAccountId?, status, dnsVerifiedAt?, certStatus, assignedAccountIds[], defaultForAccountIds[] }`.

# Short-domain management (registry + assignment)

links **owns the short domains used for shortening** — a **platform-managed registry** plus **per-account
assignment**. (Resolves the old "short-domain strategy" item: it's *both* a shared pool and per-account
whitelabel, governed here.)

* **Registry (platform pool).** Two kinds:
  * **Shared** — platform-branded domains (e.g. `rmbl.to`) usable by **many** accounts; codes stay
    **account-scoped** (opaque, no cross-account leakage).
  * **Whitelabel** — an **account-branded** domain (e.g. `go.acme.com`) that belongs to **one** account.

  Platform admins (`ROOT` / `APPLICATION`) **add / retire** domains in the registry.
* **Domain lifecycle.** `pending` → **DNS-verify** (account sets a CNAME/TXT proving control) → **TLS cert**
  provisioned (ACM / cert automation, **HTTPS-only**) → **`active`** → `disabled` / `expired`. **Minting is
  blocked on any domain that isn't `active`** (verified + valid cert). Certs **auto-renew**; expiry is
  **monitored + alerted** ([monitor](../monitor/SPECS.md)). Mirrors the web app's whitelabel DNS/cert automation.
* **Assignment — 0-N per account.** An account may have **zero** assigned (falls back to a **shared default**),
  **one**, or **many**. **Exactly one is the account default** (used when the caller doesn't name a domain).
  Platform admins control which domains an account may use; the **account admin** (`ACCOUNT`) **chooses among
  its assigned** domains, **sets its default**, and can **request a whitelabel** domain (self-serve onboarding =
  DNS + cert verification).
* **Selection at mint.** A mint uses an **explicitly-named assigned** domain **or** the **account default** —
  **never** a domain not assigned to that account.

# Mint → embed → resolve

1. **Mint** (call from campaign / workflow / channel at send/render): for each recipient, issue a `code` for
   `{ target, targetType, accountId, campaignId?, contactId, channel, messageId? }`. Returns the short URL.
2. **Embed** — SMS/email embed the **short URL**; **print renders the QR glyph from that URL** (links/QR are
   the same mint — print does *not* use the provider's built-in QR; see [print](../print/SPECS.md)); a PURL
   is the code as a path.
3. **Resolve** (public hot path) — `GET <short-domain>/<code>` → **validate the code** (well-formed + exists +
   status `active`; else 404 unknown / 410 expired / block if hibernated, honoring the post-archive policy) →
   **validate the UA** (parse `UserAgent` (`@repo/common`); classify **bot / preview / prefetch** — email
   link-scanners, QR previews, headless) → **record the engagement asynchronously**, **tagged `isBot`/`preview`
   so analytics excludes non-human hits (enqueue to Kafka — never block the redirect)** → **302 to `target`**
   (or render the PURL landing). Geo from edge. **UA validation tags, it never blocks the 302**; suspicious
   patterns feed the **abuse** signals.

# Use cases — engagement → automation

Engagement is **triggerable**: a click/scan is a first-class Kafka event, so [workflow](../workflow/SPECS.md)
can react to it. Two flows:

**1. Click → confirmation SMS**
```
user clicks <short>/<code>
 → links: record + emit `link.clicked` {campaign, contact, channel, target} → 302 to target
 → workflow trigger "on link click" (filtered by target/campaign) fires
 → workflow `send` node (channel = SMS → texting) → confirmation text   [consent + quiet-hours still apply]
```

**2. QR scan → Stripe payment → email receipt**
```
user scans QR  (= the same tracked link, rendered as a glyph)
 → links: record + emit `link.scanned` → 302 to target = a per-contact payment checkout
          (Stripe Checkout / Payment Link, stamped with contactId + campaignId metadata)
 → payment completes at Stripe → Stripe webhook ingested → emit `payment.succeeded` (carries that metadata)
 → workflow trigger "on payment succeeded" fires → `send` node (channel = email → email) → receipt
 → the conversion attributes back to the original scan touch (analytics)
```

**What these require (design implications):**

* **links publishes engagement as *triggerable* Kafka events** (`link.clicked` / `link.scanned`), carrying
  the attribution tuple — consumed by **both** analytics (touch) and workflow (trigger). Workflow needs
  matching **trigger nodes** ("on link click/scan", "on payment succeeded").
* **Attribution threads through external steps** — the Stripe session is created with contact/campaign
  **metadata**, so the webhook's `payment.succeeded` re-attaches identity and the receipt + conversion map
  back to the scan. (links itself stays out of the payment path — it just redirects to the checkout URL its
  owner minted.)
* **Payment ownership is open** — collecting a payment **from a contact** (distinct from *our* billing of the
  account) needs a Stripe integration: a **marketplace connector (Stripe Connect)** or a dedicated
  **payments** capability that ingests the webhook and emits `payment.succeeded`. Flagged below; not links's
  job.

# Privacy & compliance

* **Opaque codes — no PII in the URL** (per the no-PII-in-keys rule); the code→contact mapping is server-side.
* **GDPR forget** — `contact`'s central forget fan-out (contact-10.3: redact the contact to a tombstone, then
  call every content-holding service's S2S erase hook — see [contact](../contact/SPECS.md), already built and
  calling `print`/`voice`/`report`'s `/internal/erase`) calls **`POST /links/internal/erase`** (naming matches
  those three, not a links-specific "forget" verb) with `{ accountId, contactId }`. The handler **nulls
  `contactId` on every matching `TrackedLink`** (found via `gsi_contactId` — see *Data model* — the same
  "resolve a forgotten subject's rows via a GSI" shape as print's `gsi_mailid` / `findMailpieceByMailId`) while
  leaving `code`/`target`/`campaignId`/`channel` untouched — a scan **keeps resolving** (availability-decoupling
  still applies to a forgotten contact's QR), it just no longer attributes to a person. **Aggregate counts are
  unaffected** (they're not keyed by contact). Idempotent — re-erasing an already-erased/unknown contact matches
  zero rows, not an error (same contract as the other three erase hooks).
* **Consent** — `unsubscribe` / STOP targets are first-class `targetType`s.

# Data model (sketch)

```
TrackedLink   pk=LINK#<code>
  { code, target, targetType, accountId, campaignId?, contactId?, channel, messageId?,
    status, createdAt, expiresAt? }
  // status: active | flagged | hibernated | taken_down  (see Abuse handling)
  // read-optimized for the redirect; opaque code; hot codes cached in Redis
  // GSI gsi_contactId (accountId, contactId) — resolves a GDPR-forgotten contact's rows for
  //   POST /links/internal/erase to null out (mirrors print's gsi_mailid / findMailpieceByMailId)

// click/scan is NOT stored as link state — emitted to analytics as an engagement/conversion touch (Kafka)
```

# Scaling & availability

* **Redirect = read-hot, must be always-up** — cache hot codes (Redis), DynamoDB for the mapping;
  **record-then-redirect is async** (enqueue the touch, 302 immediately) so the user never waits on analytics.
* **Decoupled from campaign** — mint writes the mapping; resolve only reads it, so scans survive campaign
  downtime / post-campaign.
* **Hot, low-latency, high-availability tier** — deploy/scale independently of the control-plane services.

# Abuse handling (status · hibernate · reporting)

Short links are a **phishing / spam vector**, so every `TrackedLink` **and** `ShortDomain` carries an **abuse
status** and can be **hibernated** — a **reversible kill-switch** on resolution.

* **Status.** `active` → `flagged` (under review, still resolves) → **`hibernated`** (suspended — **resolve
  stops 302'ing**, returns a safe **block interstitial / 410 / 451**, never the target) → back to `active` on
  clear, or **`taken_down`** (permanent). A hibernated code **still records the attempt** (forensics); it just
  doesn't redirect.
* **Hibernate scope.** A single **code**, all codes for a **campaign** or **account**, or an entire **domain**
  (a shared/whitelabel domain implicated → hibernate the domain → **all its codes stop at once**).
* **Who can report / trigger.**
  * **Automated signals** — provider **spam-complaint / STOP** spikes (email/texting feedback loops),
    **carrier / 10DLC** abuse flags, **URL-reputation feeds** (Google Safe Browsing / Spamhaus / carrier
    blocklists) hitting the short domain, a **target-URL malware/phishing scan**, and **anomaly detection**
    (click/geo spikes).
  * **People** — **end users / recipients** (a "report this link" endpoint), **platform staff**
    (`SUPPORT` / `APPLICATION` / `ROOT`) via admin, the **account itself** (self-kill a compromised link), and
    **third parties** (registrar, carrier, anti-abuse orgs, law enforcement) via an **`abuse@` intake** /
    DMCA / legal channel.
* **When.** On a **complaint/STOP threshold**, a **reputation-feed hit**, a **target scan** flagging
  phishing/malware (**at mint + periodic re-scan**), or **immediately** on a manual/staff report — review →
  hibernate or clear within an SLA. High-confidence automated signals may **auto-hibernate**; lower-confidence
  ones **flag-first** for review.
* **Process + audit.** Every status change is an **`AuditEvent`** (who / when / why / source). The **account
  owner is notified** when their link/domain is hibernated, with an **appeal / restore** path.

# Compliance & standards mapping

How **this links service's** surfaces map to **OWASP Top 10 (2021)**, **ISO/IEC 27001:2022** (Annex A),
**SOC 2 Type 2** (TSC), **HIPAA** (Security Rule, if PHI), **GDPR**, **CCPA/CPRA**, and **messaging law**
(CAN-SPAM unsubscribe / TCPA STOP). Clause refs are **indicative**; this is a **design-intent** self-assessment
(certification is operating-effectiveness over time + an ISMS — beyond a spec). Links is a **public hot edge**,
so the dominant controls are **opaque codes (no PII in the URL)**, **open-redirect / abuse defense**, and
**short-domain TLS/DNS verification**. There is **no PCI** surface — links only **302-redirects to a checkout
URL its owner minted**; it **never touches card data** (payment ownership is flagged in Gaps). **HIPAA** is ➖
(opaque codes carry no PHI). Identity/RBAC live in [auth](../auth/specs/SPECS.md); the no-cross-region posture
is the platform [AWS topology](../../../packages/services/src/aws/SPECS.md).

**Legend:** ✅ meets/exceeds · ⚠️ partial / residual · ➖ n/a

| Links surface / control | OWASP T10 | ISO 27001:2022 | SOC 2 (TSC) | HIPAA (if PHI) | GDPR | CCPA | Messaging | |
|---|---|---|---|---|---|---|---|---|
| **Opaque codes — no PII in the URL**; code→contact mapping server-side | A01 / A04 | A.8.11 / A.5.34 | CC6.1 / Privacy | ➖ | Art 5(1)(c) / 25 | §1798.100 | ➖ | ✅ |
| **No open redirect** — 302 only to the **stored target** (no user-supplied destination param) | A01 (open redirect) | A.8.26 | CC6.6 | ➖ | ➖ | ➖ | ➖ | ✅ |
| **Short-domain TLS + DNS verification** — HTTPS-only; domain ownership proven before active | A02 / A05 | A.8.24 / A.5.23 | CC6.1 / CC6.6 | ➖ | Art 32 | ➖ | ➖ | ✅ |
| **Whitelabel domain isolation** — a whitelabel domain belongs to **one** account; shared codes account-scoped | A01 | A.8.3 | CC6.1 | ➖ | Art 32 | ➖ | ➖ | ✅ |
| **GDPR forget** — `/internal/erase` nulls `contactId` (keeps aggregate counts); the code **keeps resolving**, just unattributed | A04 | A.8.10 | (Privacy) | §164.310(d)(2) | Art 17 | §1798.105 | ➖ | ✅ |
| **No PII in engagement events / logs** — opaque `contactId` only | A09 | A.8.15 / A.8.16 | CC7.2 | ➖ | Art 5(1)(c) | §1798.100 | ➖ | ✅ |
| **Consent targets** — `unsubscribe` / STOP are first-class `targetType`s | A04 | A.5.34 | (Privacy) | ➖ | Art 21 | §1798.120 | CAN-SPAM / TCPA | ✅ |
| **Public-edge rate limiting / availability** — always-up redirect, abuse-throttled | A04 / A05 | A.8.6 / A.8.20 | CC6.6 / CC7.2 | ➖ | ➖ | ➖ | ➖ | ✅ |
| **Tenant isolation** — codes account-scoped; mapping per-account | A01 | A.8.3 | CC6.1 | ➖ | Art 32 | ➖ | ➖ | ✅ |
| **Domain admin actions audited** — add / assign / retire (who/when) | A09 | A.8.15 | CC7.2 | ➖ | ➖ | ➖ | ➖ | ✅ |
| **Phishing / link-abuse** — short links are an abuse vector; **abuse status + hibernate kill-switch + reporting** | A04 | A.5.7 / A.8.7 | CC7.2 | ➖ | ➖ | ➖ | CAN-SPAM | ✅ residual operational |

# Gaps & decisions

*The one review list — open items + decisions.* ✅ = resolved/decided · ⚠️ = **open — needs attention**.

1. ✅ **Short-domain strategy — DECIDED.** *Both* a **shared** platform pool **and** per-account **whitelabel**
   domains, governed by a **registry + 0-N per-account assignment** with DNS-verify + TLS automation (see
   *Short-domain management*; `links-5` / `links-6`).
2. ✅ **Code scheme — DECIDED (short opaque surrogate key).** The `code` is a **short random-opaque
   alphanumeric** (e.g. **base62, ~7–8 chars**) used as a **lookup key** into the server-side mapping — **not an
   encoding** of the IDs (two UUIDs, `contactId` + `campaignId`, would be far too long for a short URL / QR).
   Collision-checked on mint, sized for volume. **Tracked vs untracked:** with **tracking on**, each code is
   **per-recipient** and maps to the full attribution tuple (`contact × campaign × channel × message`) → **1:1**
   attribution; with **tracking off**, the code is a **shared, generic redirect to a CTA** — no per-recipient
   mapping, no attribution (`links-1.5` / `1.6`).
3. ✅ **Lifecycle after campaign archive — DECIDED (per-campaign policy).** Links are mostly meaningful while a
   campaign is **active**; once **archived**, a per-campaign **post-archive link policy** governs behavior —
   **`resolve_only`** (default: the redirect still works for late scans per the availability-decoupling rule,
   but **engagement tracking stops** since it's no longer meaningful), **`resolve_and_track`** (keep both), or
   **`disable`** (410 / hibernate); optional **`expire_after_days`** TTL. The **campaign** owns the setting;
   **links enforces it on resolve** (`links-9.4`). Transactional-link TTL + code rotation remain impl detail
   (`links-9.1` / `9.2`).
4. ✅ **Scan de-dup / UA validation — DECIDED.** On resolve, **validate the UA** (`@repo/common` `UserAgent`)
   and classify **bot / preview / prefetch** (email link-scanners, QR previews, headless) — **tag** the
   engagement (`isBot`/`preview`) so analytics excludes non-human hits, **without blocking the 302**
   (`links-2.8` / `links-10.1`). Threshold tuning per channel remains impl detail.
5. ✅ **Cross-channel cost-cap — DECIDED (campaign-owned).** The cap is **campaign config**; the cross-channel
   cost authority is **[campaign → Channel cost management](../campaign/SPECS.md)** (alert threshold + hard cap,
   reserve-before-dispatch → commit-on-actual). Links **meters per-click cost / usage** and **gates the follow-on
   at the hard cap** (`links-10.3`) — campaign owns the cap, links reports + enforces at the follow-on trigger.
6. ✅ **Phishing / link-abuse defense — DECIDED (status + hibernate + reporting).** Every `TrackedLink` /
   `ShortDomain` carries an **abuse status** and a **hibernate kill-switch** (per code / campaign / account /
   domain); abuse is surfaced by **automated signals + people** (recipients, staff, account self, third-party
   `abuse@`) and acted on within an SLA, all audited (see *Abuse handling*; `links-10.2` / `links-10.4`).
   *Residual: novel abuse always lags detection — bounded operationally.*
7. ✅ **Payment-from-contact — SCOPED OUT (not a planned capability).** Collecting a payment **from a contact**
   (distinct from *our* billing of the account) is **not something we expect to do**. Use case 2 stays only as
   an **illustration** of the triggerable-engagement + external-step **conversion-threading** pattern — links
   itself never touches the payment path. *If* it ever lands, it'd be a **marketplace connector (Stripe
   Connect)** or a dedicated **payments** service that ingests the webhook and emits `payment.succeeded` — **not
   links**. Until a real use case appears: **out of scope.**

# Service & Job topology

**Convention (platform-wide).** Each service layers **framework base → domain base → concrete role**. A **domain
Service base** (`LinksService extends Service`) and a **domain Job base** (`LinksJob extends Job`) hold the
**shared domain code** — the **`TrackedLink` / `ShortDomain`** model, the **Redis hot-cache + resolution**, **QR
render**, the **abuse-status gate**, the **scan-provider factory**, **Kafka emit**, and **audit** — so every
concrete role inherits it. Links' defining trait: the **redirect is the platform's hottest read path**, so it's
a **separate always-up tier** that scales independently and survives control-plane downtime.

```
Application
├── Service (Fastify, long-running — ECS)
│     └── LinksService            (domain base — TrackedLink/ShortDomain model · Redis hot-cache + resolution · QR render · abuse-status gate · scan-provider factory · Kafka emit · audit; not deployed alone)
│           ├── LinksMintService    (control plane: mint links · QR/PURL render · short-domain registry + assignment · lifecycle / abuse admin · config/health)
│           └── LinksResolveService (the HOT redirect tier — public, always-up, low-latency: cache-first → DDB → abuse-status check → RECORD-THEN-REDIRECT (302 NOW, enqueue the touch); scales independently)
└── Job (Lambda, event-driven)
      └── LinksJob                 (domain base — model · Kafka emit · idempotency)
            ├── LinksTouchJob       (SQS ← resolve's enqueued touch — record the click / scan → emit engagement / conversion → analytics + workflow)
            └── LinksScanJob        (EventBridge / SQS — target-URL malware/phishing scan at mint + periodic re-scan · reputation feeds · auto-hibernate / flag + audit)
```

**Services (HTTP, ECS Fargate)**

| Class | Extends | Role |
|---|---|---|
| **`LinksService`** | `Service` | **Domain base** — model · Redis hot-cache + resolution · QR render · abuse-status gate · scan-provider factory · Kafka emit · audit; **not deployed alone**. |
| **`LinksMintService`** | `LinksService` | The **control plane** — **mint** tracked links, **QR / PURL** render, the **short-domain registry + assignment**, **lifecycle / abuse** admin, config/health. (Authed; campaign / workflow / channels call mint.) |
| **`LinksResolveService`** | `LinksService` | The **hot redirect tier** — public `GET /{code}`: **cache-first** (Redis) → DDB mapping → **abuse-status** check (hibernated → safe interstitial / 410 / 451, never the target) → **record-then-redirect** (**302 immediately**, enqueue the touch). **Always-up, low-latency, scales independently** — a scan survives campaign / control-plane downtime. |

**Jobs (Lambda, event-driven)** — each extends `LinksJob`:

| Class | Trigger | Role | Req |
|---|---|---|---|
| **`LinksTouchJob`** | SQS ← resolve's enqueued touch | **Record the click / scan** (UA / geo / time, opaque ids) → emit **engagement / conversion** events → [analytics](../analytics/SPECS.md) + [workflow](../workflow/SPECS.md). The user never waits on this | links-4.0 |
| **`LinksScanJob`** | EventBridge / SQS | **Abuse / integrity** — target-URL malware/phishing **scan at mint + periodic re-scan**, reputation feeds (Safe Browsing / Spamhaus / carrier), **auto-hibernate** (high-confidence) / **flag** (low), audited | links-10.0 |

> **Why the redirect is its own `Service`** (the read-split): the resolve path is **read-hot + must be
> always-up** — so it's deployed / scaled **apart** from the control plane (`links-8.0`), and **mint writes,
> resolve only reads**, so scans keep working through campaign or control-plane downtime. **Record-then-redirect**
> = the 302 fires **immediately** and the touch is **async** (`LinksTouchJob`) — the recipient never waits on
> analytics. **CloudFront + WAF/Shield** front it for TLS / whitelabel-domain / DDoS — **not** response-caching
> (every hit must record a touch); the **mapping** is cached in Redis instead. **No PII in the code** — a link
> carries only **UUIDs** (resolve maps to the target); a `clicked` event stores the link UUID, never a
> PII-bearing URL (analytics #11). `LinksTouchJob` acts on **every** event → it's a `Job`, not a `Consumer`.

# AWS Services and Other Dependencies

**AWS services**
* **DynamoDB** — the `TrackedLink` mapping + the `ShortDomain` registry.
* **Redis (ElastiCache)** — hot-code cache for the redirect.
* **Kafka** — engagement / conversion events → analytics + workflow.
* **S3** — PURL landing assets.
* **CloudFront** (+ **Shield / WAF**) — the public redirect edge; **ACM** + DNS for whitelabel short-domain verification.

**Third-party libraries / services**
* **QR rendering** library — render a code's URL → QR glyph at print DPI.

**Internal (`@repo/*`)**
* `@repo/services` (Dynamo, Cache, Kafka, S3), `@repo/common` (`UserAgent`, `Type`, `Result`), `@repo/endpoint` (`Access`).
* Consumed by **campaign / workflow** (mint) and the channel services **email / texting / print** (embed); emits to **analytics** (attribution).

# Requirements (traceable register)

The traceable requirement register for the **links service** (the narrative sections above are the rationale;
this is the coded list). IDs are stable handles (**`links-N.M`**) — cite them in code, tickets, and tests.
**Priority:** **A** = MVP (ship first), **B** = core feature / hardening, **C** = later. One level of
sub-requirements only; a group's priority is its floor. **Boundaries:** links owns **mint + redirect + QR/PURL
+ scan capture + the short-domain registry**; **[analytics](../analytics/SPECS.md)** owns attribution math;
**[campaign](../campaign/SPECS.md)** / workflow own the **target/CTA definition**; the **channel** services
embed; **[contact](../contact/SPECS.md)/[account](../account/specs/SPECS.md)** own identity + suppression.

## links-1.0 Mint — A
- **links-1.1** Per-recipient **opaque `code` → `target`**, stamped with the attribution tuple (`campaignId?` × `contactId?` × `channel` × `messageId?`) — A
- **links-1.2** **`targetType`** (`cta` / `registration` / `landing` / `content` / `unsubscribe` / `deep-link`) — A
- **links-1.3** **Target-agnostic** — stores destination + tag; the destination is the account's — A
- **links-1.4** Returns the short URL; mint callable by **campaign / workflow / channel** — A
- **links-1.5** **Code scheme** — **short random-opaque base62 (~7–8 chars)** surrogate **lookup key** (**not** an encoding of the two UUIDs); collision-checked on mint, sized for volume *(gap #2)* — B
- **links-1.6** **Tracked vs untracked** — **tracked**: per-recipient code → attribution tuple (1:1); **untracked**: a **shared generic code → CTA redirect** (no per-recipient mapping / attribution). Tracking is a **mint-time choice** (campaign / caller) *(gap #2)* — A

## links-2.0 Resolve / redirect (public hot path) — A
- **links-2.1** `GET <short-domain>/<code>` → lookup → **302 to `target`** (or render PURL landing) — A
- **links-2.2** **Record-then-redirect is async** — enqueue the touch to Kafka, 302 immediately (never block); **<50 ms** — A
- **links-2.3** **Always-up, decoupled from campaign** — scans survive campaign downtime / post-campaign — A
- **links-2.4** **Hot-code cache** (Redis) over the DDB mapping — A
- **links-2.5** Device (`UserAgent`) + geo (edge) capture on resolve — A
- **links-2.6** **No open redirect** — 302 only to the **stored** target (no user-supplied destination) — A
- **links-2.7** **Validate code on resolve** — well-formed + exists + status `active`; else **404** (unknown) / **410** (expired) / **block** (hibernated); honor the post-archive policy (`links-9.4`) — A
- **links-2.8** **Validate UA / bot-filter** — parse `UserAgent`, classify **bot / preview / prefetch**; **tag** the engagement (`isBot`/`preview`) so analytics excludes non-human, **never block the 302**; feed anomaly signals to abuse status — A

## links-3.0 QR / PURL rendering — A
- **links-3.1** Render a code's URL → **QR glyph at print DPI** (for [print](../print/SPECS.md)) — A
- **links-3.2** **PURL** path / landing — B
- **links-3.3** Same mint across SMS short-URL / QR / PURL (one `code → target`) — A

## links-4.0 Engagement events (triggerable) — A
- **links-4.1** Emit **`link.clicked` / `link.scanned`** Kafka events carrying the attribution tuple — A
- **links-4.2** **Two subscribers** — [analytics](../analytics/SPECS.md) (touch + conversion) **and** workflow (trigger) — A
- **links-4.3** **Conversion threading** via external metadata (Stripe session metadata → `payment.succeeded` → back to the scan) — B
- **links-4.4** Click/scan **not** stored as durable link state (emitted, not persisted here) — A

## links-5.0 Short-domain registry — A
- **links-5.1** Platform-owned **registry** of short domains — **shared** + **whitelabel** kinds — A
- **links-5.2** Platform admins (`ROOT` / `APPLICATION`) **add / retire** registry domains — A
- **links-5.3** **Domain lifecycle** — `pending` → DNS-verify (CNAME/TXT) → TLS cert (HTTPS-only) → `active` → `disabled`/`expired` — A
- **links-5.4** **Minting blocked** unless the domain is `active` (verified + valid cert) — A
- **links-5.5** Cert **auto-renew** + expiry **monitoring/alerts** ([monitor](../monitor/SPECS.md)) — B
- **links-5.6** **Whitelabel onboarding** — customer keeps their registrar (e.g. GoDaddy); either **(a)** a **CNAME** (`go.acme.com → our CloudFront/ALB`) + **ACM DNS-validation** record, or **(b)** an **NS subdomain delegation** of `go.acme.com` to a **Route 53** hosted zone we create (full cert auto-validation/renewal). **No registrar transfer**; we automate ACM + CloudFront/ALB — B

## links-6.0 Domain assignment to accounts (0-N) — A
- **links-6.1** **0-N domains per account** — zero (→ shared default) / one / many — A
- **links-6.2** **Exactly one account default** (used when the caller doesn't name a domain) — A
- **links-6.3** Assignment controlled by **platform admins**; **account admin** (`ACCOUNT`) chooses among assigned + sets default — A
- **links-6.4** **Mint selects** an explicitly-named **assigned** domain or the account default — **never** an unassigned domain — A
- **links-6.5** **Whitelabel = single account** (isolation); shared domains are multi-account but codes stay account-scoped — A

## links-7.0 Privacy & compliance — A
- **links-7.1** **Opaque codes — no PII in the URL**; mapping server-side — A
- **links-7.2** **GDPR forget** — `POST /links/internal/erase` (called by [contact](../contact/SPECS.md)'s forget fan-out, matching print/voice/report's `/internal/erase` naming): null `contactId` on every `TrackedLink` for that `(accountId, contactId)` via `gsi_contactId`; code keeps resolving (aggregate counts unaffected), just unattributed — A
- **links-7.3** **Consent** — `unsubscribe` / STOP first-class `targetType`s — A
- **links-7.4** **No PII** in engagement events / logs — opaque `contactId` only — A
- **links-7.5** **Tenant isolation** — codes account-scoped — A

## links-8.0 Scaling & availability — A
- **links-8.1** Redirect **read-hot, always-up** — Redis hot-code cache + DDB mapping — A
- **links-8.2** **Decoupled from campaign** — mint writes, resolve only reads — A
- **links-8.3** Independent **hot / low-latency** tier (deploy/scale separately from control plane) — A
- **links-8.4** **Rate-limit / abuse protection** on the public redirect — B

## links-9.0 Link lifecycle — B
- **links-9.1** **Expiry / TTL** on transactional links *(gap #3)* — B
- **links-9.2** **Rotation** of codes — C
- **links-9.3** **Kill-switch** — disable a code (abuse / takedown) → the hibernate mechanism in `links-10.2` — B
- **links-9.4** **Post-archive link policy (per campaign)** — `resolve_and_track` / **`resolve_only`** (default) / `disable` / `expire_after_days`; the [campaign](../campaign/SPECS.md) owns the setting, **links enforces it on resolve** *(gap #3)* — B

## links-10.0 Abuse & integrity — B
- **links-10.1** **Scan/click de-dup** — filter bot/preview (email prefetch, QR preview) via `UserAgent` bot detection *(gap #4)* — B
- **links-10.2** **Abuse status + hibernate (kill-switch)** — per **code / campaign / account / domain**; `active`/`flagged`/`hibernated`/`taken_down`; hibernated resolve returns block/410/451 and **still records** the attempt *(gap #6)* — B
- **links-10.3** **Cost cap = campaign config (cross-channel, incl. follow-on engagement)** — the [campaign](../campaign/SPECS.md) config sets the **cross-channel cost cap**, which governs **follow-on engagement**: a click / scan that triggers a **follow-on action / send** counts toward the cap. Links **meters per-click cost / usage** and **gates the follow-on when the campaign cap is reached** — campaign **owns** the cap, links **reports + enforces at the follow-on trigger** *(gap #5)* — B
- **links-10.4** **Abuse reporting & triggers** — automated (complaint/STOP, reputation feeds, target scan, anomaly) + people (recipients, staff, account self, third-party `abuse@`); thresholds + SLA; **`AuditEvent`** + owner-notify + appeal *(gap #6)* — B
- **links-10.5** **Phishing/malware target scan** — at mint **and** periodic re-scan; feeds the abuse status — B

## links-11.0 Data model & dependencies — A
- **links-11.1** **`TrackedLink`** (DDB, read-optimized, opaque code; hot codes in Redis) — A
- **links-11.2** **`ShortDomain`** registry (DDB) — A
- **links-11.3** **Kafka** engagement/conversion emit; **S3** PURL assets — A
- **links-11.4** Consumed by campaign/workflow (mint) + email/texting/print (embed); emits to analytics — A

## links-12.0 Service & Job topology — B
- **links-12.1** **Domain bases** — `LinksService extends Service` + `LinksJob extends Job` hold the shared code (TrackedLink/ShortDomain model · Redis hot-cache + resolution · QR render · abuse-status gate · scan-provider factory · Kafka emit); **concrete roles extend the domain base** — B
- **links-12.2** **`LinksMintService`** — the control plane (mint · QR/PURL render · short-domain registry + assignment · lifecycle/abuse admin) — A
- **links-12.3** **`LinksResolveService`** — the **hot redirect tier**: cache-first → DDB → abuse-status check → **record-then-redirect** (302 now); **always-up, scales independently** of the control plane (`links-8.0`) — A
- **links-12.4** **Jobs extend `LinksJob`** — `LinksTouchJob` (record click/scan → emit engagement/conversion) + `LinksScanJob` (target scan + reputation → auto-hibernate/flag) — A
- **links-12.5** **Record-then-redirect** — the 302 fires immediately; the touch is async (`LinksTouchJob`), so the recipient never waits on analytics — A

# Endpoints (first cut)

A first pass at the endpoint surface, in [`@repo/endpoint`](../../../packages/endpoint/SPECS.md) style. Links
has **two planes**: the **public hot redirect edge** (no auth, latency-critical) and the control-prefixed
**`/links/*`** plane (mint, domain mgmt, abuse). Control reads return the `{ data, page }` envelope.

**Access column:** recommended **`minAccess`** on the `Access` ladder — **`-`** = public · account ladder
**`SENDER`<`USER`<`BILLING`<`ACCOUNT`** · staff ladder **`SUPPORT`<`APPLICATION`<`ROOT`** · **`⬆`** = also
step-up · **`Internal`** = VPC-only S2S. A senior role satisfies any junior minimum.

### Resolve — public hot edge (links-2)
| Method | URI | Purpose | Access | Req |
|---|---|---|---|---|
| GET | `<short-domain>/{code}` | **The redirect.** Validate code + UA → record async → **302** to target (or render PURL) — **on the branded short domain, not `/links`** | - | links-2.1/2.7/2.8 |

### Mint & render (S2S — campaign / workflow / channel call) (links-1, links-3)
| Method | URI | Purpose | Access | Req |
|---|---|---|---|---|
| POST | `/links/mint` | Mint a code — **tracked** (per-recipient → tuple) or **untracked** (shared CTA) — returns the short URL | Internal | links-1.1/1.6 |
| POST | `/links/mint/batch` | Bulk mint for a campaign send (per-recipient) | Internal | links-1.1 |
| GET | `/links/{code}/qr` | Render the code's URL as a **QR glyph** (PNG/SVG, print DPI) | Internal | links-3.1 |
| GET | `/links/{code}` | Code metadata (target, `targetType`, status, attribution tuple) | USER | links-1.1 |

### Short-domain registry & assignment (links-5, links-6)
| Method | URI | Purpose | Access | Req |
|---|---|---|---|---|
| GET | `/links/domains` | List registry domains (shared + whitelabel) + status | APPLICATION | links-5.1 |
| POST | `/links/domains` | Add a domain to the registry | APPLICATION ⬆ | links-5.2 |
| POST | `/links/domains/{id}/verify` | Trigger / poll **DNS verification + cert provisioning** | APPLICATION | links-5.3 |
| DELETE | `/links/domains/{id}` | Retire a registry domain | APPLICATION ⬆ | links-5.2 |
| GET | `/links/accounts/{accountId}/domains` | Domains assigned to an account | ACCOUNT | links-6.1 |
| POST | `/links/accounts/{accountId}/domains` | **Assign** a domain to an account (platform admin) | APPLICATION | links-6.3 |
| DELETE | `/links/accounts/{accountId}/domains/{domain}` | **Unassign** a domain | APPLICATION | links-6.3 |
| PUT | `/links/accounts/{accountId}/domains/default` | Set the account **default** domain | ACCOUNT | links-6.2 |
| POST | `/links/accounts/{accountId}/domains/whitelabel` | **Request a whitelabel** domain → returns the DNS records to set | ACCOUNT | links-5.6 |

### Abuse — status, hibernate, reporting (links-10)
| Method | URI | Purpose | Access | Req |
|---|---|---|---|---|
| POST | `/links/{code}/report` | **Report a link** as abusive (public "report this link" + authed) | - | links-10.4 |
| POST | `/links/{code}/hibernate` | **Hibernate** (kill-switch) a code | ACCOUNT · APPLICATION | links-10.2 |
| POST | `/links/{code}/restore` | Restore a hibernated code | APPLICATION | links-10.2 |
| POST | `/links/campaigns/{campaignId}/hibernate` | Hibernate **all codes** for a campaign | ACCOUNT · APPLICATION | links-10.2 |
| POST | `/links/domains/{id}/hibernate` | Hibernate an **entire domain** (all its codes) | APPLICATION ⬆ | links-10.2 |

### Internal / S2S & ops
| Method | URI | Purpose | Access | Req |
|---|---|---|---|---|
| PUT | `/links/internal/campaigns/{campaignId}/policy` | Set a campaign's **post-archive link policy** (campaign calls on archive) | Internal | links-9.4 |
| POST | `/links/internal/erase` | S2S forget hook — `{ accountId, contactId }`; nulls `contactId` on every matching `TrackedLink` (keeps aggregates). Called by contact's forget fan-out, same naming/shape as print/voice/report's `/internal/erase` | Internal | links-7.2 |
| GET, PUT | `/links/config` | Read / set the service's own runtime config (AppConfig-backed) | ROOT | links-11.1 |
| GET | `/links/health` | Liveness / readiness of the redirect fleet | - | links-8.1 |

# eof
