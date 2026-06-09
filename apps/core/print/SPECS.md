#
# Print Service (direct mail — the physical `send` channel)
#

# Objective

The **physical `send` channel** — render and mail **postcards / letters / self-mailers / checks** to a
postal address via a print partner (**PostGrid / Lob**), verify + standardize addresses, track delivery,
and turn **scans (QR / PURL)** back into digital events. It's a `send(recipient, message)` channel like
SMS/email — but **async, slow, and physical**: delivery is measured in **days**, every piece **costs
money**, and "inbound" is indirect.

See `apps/CHANNELS.md` for where print sits among the channels.

# Role & boundaries (read this first)

A **channel service** owning the mail mechanics + provider format; orchestration/pacing/creds live
elsewhere.

What it **owns**:
* **Artifact rendering** — merge data into a template → a print-ready **PDF** (postcard/letter/…), with
  the address block, dimensions, bleed/safe zones, and USPS marks (IMb).
* **Address verification** — **CASS** standardization, **NCOA** move-update, deliverability scoring,
  deceased/vacant flags — *before* mailing.
* **Provider adaptation** — PostGrid / Lob submit + template + tracking, behind the channel interface.
* **Tracking ingestion** — USPS scan events (in-transit / delivered / returned) via the provider.
* **Proof / preview** + **cost preview** before a run.

What it **delegates / does NOT do**:

| Concern | Owner |
|---|---|
| **Batch pacing / retry** | **dispatch** (print is batch + lead-time, not TPS) |
| Provider **credentials** | **marketplace** (or platform key) |
| **Orchestration** (multi-step, cross-channel) | **workflow / campaign** (`send` node, channel=print) |
| **Delivery/scan engagement history + conversion** | **analytics** |
| **Suppression / consent** (do-not-mail, deceased) + the contact's postal **address** | **contact / account** |
| Tracked **short links / QR / PURL** generation | **links/tracking** (print embeds them) |
| Template **media / images** | **media** |

# Out of scope (deferred)

* **In-house print/mail** — we **partner** (PostGrid/Lob); no presses, postage, or USPS contracts.
* **Rich response handling beyond scan** — inbound is QR/PURL + returns; full BRM/IRC reply-mail later.
* **The template designer UI** — this service owns the template *schema* + render; the editor is **web**.

# Core concepts

* **Mailpiece** — what to mail: `type` (postcard / letter / self-mailer / check), a **template** +
  merge data, the **recipient** postal address, and the **sender/return** address.
* **AddressVerification** — the result of CASS+NCOA: standardized address, deliverability, move-applied,
  deceased/vacant flags. Runs **before** a piece is mailed.
* **Proof** — the rendered PDF preview for approval (and what the partner prints).
* **TrackingEvent** — a USPS scan relayed by the provider: `in_production → mailed → in_transit →
  delivered` (or `returned` / `undeliverable`).
* **Response** — a **QR / PURL** scan that turns a physical piece into a tracked **digital event**
  (and a conversion signal).

# Providers (PostGrid / Lob)

Both render + mail + verify addresses + relay tracking — wrapped as a **provider adapter** behind the
channel interface (so the account/campaign picks neither directly; the service routes). They differ in
template model, pricing, and webhook shape — the adapter normalizes.

# Content & format

* **Physical dimensions per type** — postcard (4×6 / 6×9 / 6×11), letter (#10 + insert), self-mailer;
  each with **address-block placement, bleed, safe zones**, and the **IMb** (Intelligent Mail barcode).
* **Variable data / merge** — name, custom fields, and a **per-recipient QR/PURL** (from links/tracking)
  for response attribution.
* **Front/back** (postcards), enclosure pages (letters); rendered to a print-ready **PDF**.

# Addressing — the part that's unique to print

* **CASS** — standardize/validate to a deliverable USPS address (reject/flag bad ones pre-send).
* **NCOA** — apply **move updates** (people relocate; required for bulk postal discounts).
* **Suppression** — **do-not-mail** (DMA Mail Preference), **deceased**, prison, vacant — checked with
  the account block list + contact suppression (consent for mail is lighter than SMS, but suppression
  still applies).
* **Undeliverable / returns** — handled as a (negative) tracking event; feeds list hygiene.

# Scheduling, lead time & cost

* **Lead time is days, not seconds** — print production + postal class (**First-Class** vs **Marketing
  Mail/Standard**). Campaign scheduling must account for the production+transit window (a "arrive by
  date" works backward from it).
* **Batch economics** — pieces are batched; **per-piece cost** is real. A **cost preview** (recipients ×
  per-piece) runs before a run and **gates on the campaign budget cap** (the campaign spec's budget cap).
* **Proof approval** — large runs require an approved proof before submission.

# Inbound (effectively one-way)

Direct mail is one-way; "response" is captured digitally:

* **QR / PURL** — a per-recipient code/URL on the piece; a scan → a tracked landing → a **digital
  engagement event** (and a **conversion** signal, attributed back to the mail touch in analytics).
* **Returns / undeliverable** — a tracking event that also drives **address hygiene**.

# Events to analytics

Normalized lifecycle events stream to analytics: `sent`(submitted) → `delivered`(USPS) → `returned`, plus
**scan/PURL** as the engagement+conversion signal — `occurredAt` is the **USPS scan time**, channel-
specific attrs carry tracking detail. Because mail is **addressed**, these attribute **1:1 to the
contact** (unlike social).

# Data model (sketch)

```
Mailpiece          pk=ACCOUNT#<id>  sk=MAIL#<mailId>
  { type, templateId, mergeData, recipient(address), sender(address), provider, mailClass, status, costEstimate, purl?, createdAt }
  // mailClass defaults from account config (First-Class | Marketing Mail), overridable per campaign

AddressVerification (on the mailpiece or contact)
  { standardized, deliverability, ncoaApplied, deceased, vacant, verifiedAt }

TrackingEvent      pk=ACCOUNT#<id>  sk=MAIL#<mailId>#<at>
  { status: in_production|mailed|in_transit|delivered|returned|undeliverable, at, providerEventId }
  // scan/PURL responses flow to analytics as engagement/conversion, not stored as channel state
```

* Mailpieces are **archived, never silently dropped** (audit + USPS proof of mailing where retained).

# Decided

* **Provider abstraction — factory/adapter from day one** *(was open #1).* Both **PostGrid + Lob** sit
  behind a **provider factory/adapter** (same pattern as marketplace/oauth + the `provider-<id>` AppConfig
  convention); the service routes, the account/campaign picks neither directly. No rewrite to add the second
  provider, and a fallback if one degrades.
* **Cost cap — cross-channel, set at segmentation** *(was open #4).* The cap is a **campaign-level** control
  spanning channels (SMS / email / print), defined when the audience is segmented, in three modes:
  * **All-in** — one total budget the channels draw from until exhausted.
  * **Percent allocation** — split the budget by **% per channel** (e.g. 50/30/20).
  * **Fixed price per channel** — a hard cap per channel.

  At **design time** the campaign shows **estimated cost + timeline**; each channel contributes a per-unit
  estimate. **Print's role:** supply a **per-piece estimate + production/transit lead time**, and **enforce**
  its allocation at **submit** (refuse to exceed). → The cross-channel cap itself belongs in the **campaign
  spec**; print is a contributor + pre-submit gate.
* **Mail class — account default, per-campaign override** *(was open #5).* The account configures a
  **default mail class** (First-Class vs Marketing Mail); any **campaign may override** it. Drives the
  lead-time + cost estimates above. (`mailClass` on the mailpiece, defaulted from account config.)

# Leaning (discussion retained — not yet locked)

1. **Rendering ownership — make vs buy. → Start by BUYING (provider templates); keep "own the PDF" in the
   back pocket.**
   * **Buy (provider templates)** *(chosen for v1)* — author in Lob/PostGrid, send merge data. Fastest to
     ship; the **provider owns print-spec compliance** (bleed / 300dpi / CMYK). **Cost:** templates live in
     the provider, so a later switch / load-balance means re-authoring — partially **defeats the factory**.
     *Mitigate:* keep our own **template schema + designer** ([web](../web/SPECS.md)) as the source of truth
     and **compile** it down to the provider's template, so the canonical creative stays ours and a switch is
     a re-compile, not a re-author.
   * **Make (own the PDF)** *(back pocket — uncertain ROI)* — render template → print-ready PDF → submit to
     any provider (adapter becomes a thin "mail this PDF"; the provider still overlays IMb/postage from its
     permit). Full portability + control; **cost:** a print-grade render pipeline. Revisit when volume /
     provider-portability / per-piece cost justifies the build.
   * **Self-hosted tech for the back-pocket** (if/when we build): HTML/CSS → PDF via **Gotenberg** (self-host
     Chromium API), **WeasyPrint**, or headless **Chromium/Playwright**; then **Ghostscript** for **CMYK /
     PDF/X-1a / bleed** compliance (most HTML→PDF output is RGB). Buy-but-print-grade-color option:
     **DocRaptor / PrinceXML**. Programmatic (non-HTML): **pdf-lib / PDFKit / @react-pdf**.
   * **Decision:** provider templates for v1; own-render stays a documented future option.

2. **NCOA cadence — per-send vs periodic vs hybrid. → Hybrid, optimized for lowest cost.**
   *(all options retained — most accounts are budget-sensitive, so the driving goal is the **cheapest
   compliant** path, not the freshest.)*
   * **CASS** (standardization) is cheap + deterministic → always **per-send**. **NCOA** (move-update) is the
     **costed + regulated** one (USPS move-update **within 95 days** of mail date for presort discounts).
   * **Per-send NCOA** — freshest, simplest; pays per record every send (priciest at volume).
   * **Periodic refresh** — cheapest at a frequent cadence (verify once per window, reuse); addresses drift
     between runs.
   * **Hybrid (chosen)** — cache the standardized/move-applied address on the **contact** with `verifiedAt`;
     **reuse within a ≤95-day window**, re-verify on send only when **stale or changed**.
   * **Cost-first tuning:** reuse the **longest compliant window (≤95d)** to minimize NCOA hits; for a
     **one-off / tiny** send where presort discounts don't apply, **CASS-only is acceptable** (skip NCOA —
     forgo the bulk discount rather than pay for NCOA). Net rule: **pay for NCOA only when the discount it
     unlocks exceeds its cost.**

3. **PURL/QR ownership — who mints the code + holds the contact mapping? → WE do (links/tracking); the
   provider only renders our URL.** The choice is purely about **data ownership**:
   * **Provider-owned (reject)** — the provider generates the unique QR per contact and **keeps the
     code→contact mapping**. We'd have to **call their API** for scan analytics, **lose history on a provider
     switch**, and a **third party holds PII-linked mapping**. Lock-in + compliance cost.
   * **Us-owned (choose)** — **links/tracking mints a per-recipient tracked URL** on **our short domain** and
     **holds the code→contact mapping**; the piece's QR just **encodes our URL**. A scan — anywhere, anytime
     — hits **our** endpoint → resolve code→contact → emit **our** analytics event (1:1 to the contact).
     First-party data, provider-portable, PII stays in our infra.
   * **Reconciles with decision 1 (provider templates):** pass our tracked URL as a **per-recipient merge
     variable**; the provider template renders the QR **from our URL**. **Do not** enable the provider's
     **built-in** QR/tracking feature — that is the variant that hands them the mapping. They render the
     glyph; identity + mapping + scan pipeline stay ours.
