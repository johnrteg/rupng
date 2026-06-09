#
# Links service (tracked links · redirect · QR / PURL)
#

# Objective

The platform's **one tracked-link system**: mint a per-recipient short link / **QR** / **PURL**, resolve a
click/scan to a redirect, and emit the **engagement + conversion touch** for attribution. A short-link
(SMS/email), a print **QR**, and a **PURL** are the *same thing* with different rendering — one code→target
mapping, one scan pipeline. Every channel uses it; **analytics** does the attribution math on what it emits.

# Why a separate service (not part of campaign)

**Campaign *and* workflow are both first-class consumers** — links is **infrastructure** they each call, not
a module of either:

* **Many senders need it, not just campaign** — **[workflow](../../../packages/workflow/README.md) `send`
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
  **`targetType`** (`cta` · `registration` · `landing` · `content` · `unsubscribe` · `deep-link`). Minted
  **per recipient**, so a click/scan attributes **1:1**.
* **`channel`** — `sms | email | print | …`: which channel carried the link (so the same target across
  channels stays distinguishable). This is the "uniform per campaign / contact / channel" model.
* **`target` / `targetType`** — links is **target-agnostic**: it stores the destination + a tag for what the
  account is trying to make the user do; the destination is the account's (a CTA, a registration flow, a
  content page, an unsubscribe).
* **Engagement event** — a click/scan → emitted as a **Kafka domain event** (`link.clicked` /
  `link.scanned`) carrying the attribution tuple. **Two** subscribers, same event: **analytics** (a touch +
  conversion signal) **and** [workflow](../../../packages/workflow/README.md) (a **trigger** — see Use
  cases). Not kept here as durable channel state (mirrors print's tracking model).
* **Short domain** — branded, **whitelabel per account**; opaque code in the path (**no PII in the URL**).

# Mint → embed → resolve

1. **Mint** (call from campaign / workflow / channel at send/render): for each recipient, issue a `code` for
   `{ target, targetType, accountId, campaignId?, contactId, channel, messageId? }`. Returns the short URL.
2. **Embed** — SMS/email embed the **short URL**; **print renders the QR glyph from that URL** (links/QR are
   the same mint — print does *not* use the provider's built-in QR; see [print](../print/SPECS.md)); a PURL
   is the code as a path.
3. **Resolve** (public hot path) — `GET <short-domain>/<code>` → look up code → **record the engagement
   asynchronously** (enqueue to Kafka — never block the redirect) → **302 to `target`** (or render the PURL
   landing). Device via `UserAgent` (`@repo/common`), geo from edge.

# Use cases — engagement → automation

Engagement is **triggerable**: a click/scan is a first-class Kafka event, so [workflow](../../../packages/workflow/README.md)
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
* **GDPR forget** — purge the code→contact mapping (keep aggregate counts); the link can resolve anonymously
  or 410 after erasure.
* **Consent** — `unsubscribe` / STOP targets are first-class `targetType`s.

# Data model (sketch)

```
TrackedLink   pk=LINK#<code>
  { code, target, targetType, accountId, campaignId?, contactId?, channel, messageId?, createdAt, expiresAt? }
  // read-optimized for the redirect; opaque code; hot codes cached in Redis

// click/scan is NOT stored as link state — emitted to analytics as an engagement/conversion touch (Kafka)
```

# Scaling & availability

* **Redirect = read-hot, must be always-up** — cache hot codes (Redis), DynamoDB for the mapping;
  **record-then-redirect is async** (enqueue the touch, 302 immediately) so the user never waits on analytics.
* **Decoupled from campaign** — mint writes the mapping; resolve only reads it, so scans survive campaign
  downtime / post-campaign.
* **Hot, low-latency, high-availability tier** — deploy/scale independently of the control-plane services.

# Open items (backlog)

* **Short-domain strategy** — one shared branded domain vs per-account whitelabel domains (DNS/cert
  automation, like the web app's whitelabel).
* **Code scheme** — length / alphabet / collision strategy; signed vs random-opaque.
* **Link expiry / rotation** — TTL on transactional links; do campaign links expire?
* **Scan de-dup** — bot/preview scans (email link-prefetch, QR preview) vs real engagements (reuse the
  `UserAgent` bot detection).
* **Cross-channel cost-cap** — links is also where per-click cost (if any) would meter; coordinate with the
  [campaign](../campaign/SPECS.md) cost cap.
* **Payment ownership (from use case 2)** — collecting a payment **from a contact** (Stripe Checkout/Connect)
  vs *our* billing of the account: a **marketplace connector** or a dedicated **payments** service that
  ingests the Stripe webhook and emits `payment.succeeded`. Decide the owner; links only redirects to the
  checkout URL it mints.

# Dependencies

* `@repo/services` — `Dynamo` (mapping), `Cache` (hot-code cache), `Kafka` (emit engagement/conversion
  touches), `S3` (PURL landing assets if any).
* `@repo/common` — `UserAgent` (device parse on scan), `Type`, `Result`.
* Consumed by **campaign / workflow** (mint) and the channel services **email / texting / print** (embed);
  emits to **analytics** (attribution).

# eof
