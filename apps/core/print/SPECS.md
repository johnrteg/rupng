#
# Print Service (direct mail — the physical `send` channel)
#

# Objective

The **physical `send` channel** — render and mail **postcards / letters / self-mailers / checks** to a
postal address via a print partner (**PostGrid / Lob**), verify + standardize addresses, track delivery,
and turn **scans (QR / PURL)** back into digital events. It's a `send(recipient, message)` channel like
SMS/email — but **async, slow, and physical**: delivery is measured in **days**, every piece **costs
money**, and "inbound" is indirect.

Print's job is to make direct mail feel like **just another channel** to the rest of the platform — the same
`send` primitive a campaign or workflow targets — while **absorbing the three things that make physical mail
unlike a digital send**: it's **irreversible and billable per piece** (so a bad address or a duplicate is wasted
money, not a retry), it's **deliverable-quality-gated** (USPS won't carry mail it can't parse, so addresses must
be **verified before** they're committed), and its **feedback loop is days-long and indirect** (scan events and
returns, not opens and clicks). Everything else — pacing, credentials, orchestration, consent, attribution —
**delegates to the service that already owns it**, exactly like the digital channels; print only owns the
**physical mechanics + the provider's print format**.

The load-bearing ideas:
* **render → verify → submit → track** as the spine — merge data into a **print-ready PDF** (address block,
  bleed / safe zones, USPS **IMb**), then **CASS-standardize + NCOA move-update + deceased / vacant flag** the
  address *before* a single piece is committed;
* **cost is first-class** — a **proof / preview + cost preview** before any run, and per-piece accounting that
  composes with the campaign's **cross-channel cost cap** and the account's prepaid balance (a print run can be
  the most expensive thing a campaign does);
* a **provider factory** (PostGrid / Lob behind one channel interface — submit · template · tracking · returns)
  so **adding a partner = a new adapter, not a new pipeline**, with per-account failover living in dispatch;
* **inbound is indirect, by design** — **QR / PURL scans** (from [links/tracking](../links/SPECS.md)) and USPS
  **return / undeliverable** events are normalized into the same engagement stream digital sends emit, so
  [analytics](../analytics/SPECS.md) sees one cross-channel history;
* **partner, don't operate** — no presses, postage, or USPS contracts; print owns the **template schema + render
  + the carrier-facing format**, not a mailroom.

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
* **AddressVerification** — the verification result. Two layers by **what it's about**:
  **address-intrinsic** (CASS standardized form · DPV deliverability · vacant) vs **person-specific**
  (NCOA move-update · deceased). The address-intrinsic layer is the **`VerifiedAddress`** global cache; the
  person-specific layer stays **contact-scoped** (NCOA cached on the contact, ≤95 d — gap #5). Both carry the
  **`verifier`** (which source produced it) and **`verifiedAt`**.
* **VerifiedAddress** — the **verified-address database** (gap #8), one partition per address
  (`pk=ADDR#<hash(normalized address)>`). The **verification record** (`sk=META`) holds the standardized form +
  deliverability + vacant, plus **only verification metadata**: **`verifiedAt`** (when), **`verifier`** (which
  provider), and **`externalRefId`** (the provider's reference). It carries **NO contact and NO name** — it is
  **not tied to a person**; a contact that looks up an address gets its **own copy** of the result (stored in
  [contact](../contact/SPECS.md)), and the database holds **no back-reference** to a contact. Person-decoupled →
  shared across accounts and **not personal data** (the *who-lives-there* linkage lives in contact,
  GDPR-forgettable there). A cache hit skips the 3rd-party call entirely.
* **AddressUsage** — co-located in the **same address partition** (`sk=ACCT#<accountId>`): the address database
  **tracks which accounts have accessed/paid** for the lookup, so an account is **never double-charged**. This is
  **commercial** data (an `accountId`, not a contact/person) — the address tracks its accounts, never a contact.
  Drives charge-once-per-account idempotency + the cost-share margin model.
* **AddressVerifier** — a verification **provider adapter** (USPS Web Tools / PostGrid / Lob / Melissa /
  SmartyStreets) behind a typed factory, **capability-declared** (`cass` / `ncoa`), **decoupled** from the
  mail-fulfillment provider; the service routes per operation (NCOA → licensed NCOALink verifiers only).
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

Verification runs through a dedicated **`AddressVerifier` factory** (USPS Web Tools · PostGrid · Lob · Melissa ·
SmartyStreets), **independent of the mail-fulfillment provider** and **capability-aware** (a source declares
`cass` and/or `ncoa`; NCOA routes only to licensed NCOALink verifiers — USPS Web Tools is CASS-only). Results are
**cached** so an unchanged address never re-hits a vendor (gap #5 / #7).

* **CASS** — standardize/validate to a deliverable USPS address (reject/flag bad ones pre-send); **result-cached**
  on the normalized address (deterministic), invalidated on change.
* **NCOA** — apply **move updates** (people relocate; required for bulk postal discounts); **cached on the
  contact** (`verifiedAt`, ≤95 d).
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

AddressVerification (the per-use result stamped on a mailpiece/contact; composed from the two caches below)
  { standardized, deliverability, ncoaApplied, deceased, vacant, verifier, verifiedAt }
  // verifier = which AddressVerifier source produced it (usps | postgrid | lob | melissa | smartystreets)
  // address-intrinsic (standardized/deliverability/vacant) ← VerifiedAddress; person-specific (ncoaApplied/deceased) ← contact ≤95 d

// ONE address database, partitioned per address (pk=ADDR#<addrHash>). NO contact anywhere; tracks accountIds.
VerifiedAddress    pk=ADDR#<addrHash>  sk=META         // the verification record — GLOBAL, cross-account, person-free
  { standardized, deliverability, vacant, verifier, externalRefId?, verifiedAt, freshUntil? }
  // addrHash = hash(normalized input address). Just the result + when + which provider + vendor ref. NO contact, NO name.
  // A contact that looks up an address gets its OWN COPY (in contact); this database holds NO back-reference to a contact.

AddressUsage       pk=ADDR#<addrHash>  sk=ACCT#<accountId>   // the address tracks WHICH ACCOUNTS accessed/paid (accountId, NOT contact)
  { chargedAt, amountCharged, wasVendorCost, ourCost? }      // wasVendorCost=true + ourCost ONLY on the first requester overall
  // existence = "this account already paid for this address" → charge-once-per-account (no double charge)

TrackingEvent      pk=ACCOUNT#<id>  sk=MAIL#<mailId>#<at>
  { status: in_production|mailed|in_transit|delivered|returned|undeliverable, at, providerEventId }
  // scan/PURL responses flow to analytics as engagement/conversion, not stored as channel state
```

* Mailpieces are **archived, never silently dropped** (audit + USPS proof of mailing where retained).

# Service & Job topology

**Convention (platform-wide).** Each service layers **framework base → domain base → concrete role**. A **domain
Service base** (`PrintService extends Service`) and a **domain Job base** (`PrintJob extends Job`) hold the
**shared domain code** — the **provider adapter factory** (PostGrid / Lob), the **Mailpiece / TrackingEvent**
model, **render / proof**, **address verification** (CASS / NCOA), the **`canSend()`** client, the
**[`WorkQueue`](../../../packages/services/DISPATCH.md)** pacing governor, and the **S3 artifact** store — so every
concrete role inherits it. Print is a physical `send` channel: **provider-fulfilled**, **batched**, **long
lead-time** (days), with **sparse** tracking — so unlike texting it needs no separate high-volume webhook tier.

```
Application
├── Service (Fastify, long-running — ECS)
│     └── PrintService            (domain base — mail-fulfillment adapter factory (PostGrid/Lob) + AddressVerifier factory (USPS/Melissa/…) · Mailpiece/TrackingEvent model · render/proof · CASS/NCOA caches · canSend · WorkQueue · S3 store · audit; not deployed alone)
│           └── PrintMainService   (the /print/* API: submit mailpiece/batch · templates/proofs · address verify · status reads · config/health; provider tracking-webhook ingress = ACK-fast → enqueue)
└── Job (Lambda, event-driven)
      └── PrintJob                 (domain base — mail-fulfillment + AddressVerifier factories · render · canSend · retry/DLQ · idempotency)
            ├── PrintRenderJob      (SQS — merge fields + QR/PURL + verified address → print-ready PDF + proof → S3; mark ready)
            ├── PrintSubmitJob      (SQS — canSend + provider.submit via the adapter; rate-paced (WorkQueue/dispatch); retry → DLQ)
            ├── PrintTrackingJob    (SQS from provider webhook — normalize tracking (printed/mailed/in-transit/delivered/returned) → TrackingEvent → analytics)
            └── PrintScheduleJob    (EventBridge — "arrive-by" submission windows: release scheduled batches at the right lead-time)
```

**Services (HTTP, ECS Fargate)**

| Class | Extends | Role |
|---|---|---|
| **`PrintService`** | `Service` | **Domain base** — mail-fulfillment adapter factory + **`AddressVerifier` factory** · Mailpiece/TrackingEvent model · render/proof · CASS/NCOA caches · `canSend` · `WorkQueue` · S3 store · audit; **not deployed alone**. |
| **`PrintMainService`** | `PrintService` | The **`/print/*` API** — submit **mailpiece / batch**, templates / **proofs**, **address verify**, status reads, config/health; the **provider tracking-webhook** ingress (ACK-fast → enqueue — low volume, so no separate webhook service). |

**Jobs (Lambda, event-driven)** — each extends `PrintJob`:

| Class | Trigger | Role | Req |
|---|---|---|---|
| **`PrintRenderJob`** | SQS | Prepare the artifact — merge fields + **QR/PURL** ([links](../links/SPECS.md)) + **verified address** → print-ready **PDF + proof** → S3; mark ready | print-1.0 / 2.0 |
| **`PrintSubmitJob`** | SQS | **`canSend`** gate → **`provider.submit`** via the adapter (provider-agnostic), **rate-paced** via `WorkQueue` / [dispatch](../../../packages/services/DISPATCH.md); retry → DLQ | print-3.0 / 6.0 |
| **`PrintTrackingJob`** | SQS (from provider webhook) | Normalize provider **tracking** (printed / mailed / in-transit / delivered / returned) → `TrackingEvent` → emit to [analytics](../analytics/SPECS.md) | print-4.0 |
| **`PrintScheduleJob`** | EventBridge | **"Arrive-by" submission windows** — release scheduled batches at the right **lead-time** (campaign-driven) | print-6.0 |

> **Shared modules (not deployables).** **Two independent typed factories**, both the `SmsAdapter` pattern
> (one self-registering adapter per provider, resolved by a typed registry): **(1) the mail-fulfillment adapter**
> — the single dialect boundary per mail provider (PostGrid / Lob) — `submit` · tracking-**normalize** ·
> `verifySignature`; and **(2) the `AddressVerifier` factory** — one adapter per verification source (USPS Web
> Tools · PostGrid · Lob · Melissa · SmartyStreets), **capability-declared** (`cass` / `ncoa`), routed per
> operation (NCOA → licensed NCOALink only). They're **decoupled** (verify with one, mail with another). The
> **CASS/NCOA caches**, **`canSend()`**, **`WorkQueue`** pacing, and **S3 artifact** store live on the bases and
> are reused across the API + workers. **QR/PURL** come from [links](../links/SPECS.md); **provider creds** from
> [marketplace](../marketplace/SPECS.md). Addresses are **PII** — encrypted (KMS), every provider (mail or
> verifier) is a **sub-processor**.

# AWS Services and Other Dependencies

**AWS services**
* **S3** — rendered print-ready **PDFs** + proofs (+ lifecycle).
* **DynamoDB** — `Mailpiece` + `TrackingEvent` records.
* **SQS** — submit batches + provider tracking-webhook ingestion (fair-shared by dispatch).
* **KMS** — encryption at rest (addresses, check data).
* **EventBridge** — scheduled "arrive-by" submission windows (campaign-driven).

**Third-party libraries / services**
* **PostGrid / Lob** — print + mail + USPS tracking, behind the **mail-fulfillment factory/adapter**; each is a **sub-processor** of address PII. (They can *also* be `AddressVerifier` sources.)
* **Address verification (the `AddressVerifier` factory)** — **USPS Web Tools** (CASS/DPV, no NCOA) · **PostGrid / Lob** · **Melissa / SmartyStreets** (CASS + NCOALink); capability-routed, decoupled from mail fulfillment; every verifier is a **sub-processor** of address PII.
* **[links](../links/SPECS.md)** — per-recipient QR/PURL (our short domain), rendered by the provider template.
* *(back-pocket own-render — future)* **Gotenberg / WeasyPrint / headless Chromium** → **Ghostscript** (CMYK / PDF/X-1a / bleed), or **DocRaptor / PrinceXML**; `pdf-lib` / `PDFKit` / `@react-pdf`.

**Internal (`@repo/*`)**
* `@repo/services` (S3, Dynamo, Sqs, Kms), `@repo/endpoint` (`Access`), `@repo/common` (`Type`, `UserAgent` for scans).
* Composes **[dispatch](../../../packages/services/DISPATCH.md)** (pacing), **[marketplace](../marketplace/SPECS.md)** (provider creds), **[workflow](../workflow/SPECS.md) / [campaign](../campaign/SPECS.md)** (orchestration + cost cap), **[analytics](../analytics/SPECS.md)** (events), **[contact](../contact/SPECS.md) / [account](../account/specs/SPECS.md)** (suppression + address), **links** (QR/PURL), **[media](../media/SPECS.md)** (template images).

# Compliance & standards mapping

How **this print service's** controls map to **OWASP Top 10 (2021)**, **ISO/IEC 27001:2022** (Annex A),
**SOC 2 Type 2** (TSC), **HIPAA** (if PHI), **GDPR**, **CCPA/CPRA**, and **mail law** (USPS move-update / **DMA**
do-not-mail). Clause refs are **indicative**; this is a **design-intent** self-assessment. Print is the
**physical send channel** — it handles **postal-address PII** and partners with **PostGrid / Lob**
(sub-processors). There is **no PCI** surface (no card data); **checks**, if mailed, carry financial data
handled **provider-side** + encrypted, minimal retained. **HIPAA** is ➖ (no PHI by [AUP](../account/specs/SPECS.md)).
Suppression/consent + the address are owned by [contact](../contact/SPECS.md) / [account](../account/specs/SPECS.md);
tracked QR/PURL by [links](../links/SPECS.md). Identity/RBAC live in [auth](../auth/specs/SPECS.md); residency is
the platform [AWS topology](../../../packages/services/src/aws/SPECS.md).

**Legend:** ✅ meets/exceeds · ⚠️ partial / open — see Gaps · ➖ n/a

| Print control | OWASP T10 | ISO 27001:2022 | SOC 2 (TSC) | HIPAA (if PHI) | GDPR | CCPA | Mail (DMA/USPS) | |
|---|---|---|---|---|---|---|---|---|
| **Postal-address PII** — CASS/NCOA processing; per-account tenant isolation | A01 | A.8.3 / A.5.34 | CC6.1 | ➖ | Art 32 | §1798.100 | ➖ | ✅ |
| **Suppression pre-send** — do-not-mail (DMA) / deceased / prison / vacant + account block-list + contact suppression | A04 | A.5.34 | (Privacy) | ➖ | Art 21 | §1798.120 | DMA do-not-mail | ✅ |
| **NCOA move-update** — USPS-regulated (≤95 d for presort); hybrid cache | ➖ | A.5.31 | CC6.x | ➖ | Art 5(1)(d) | ➖ | USPS move-update | ✅ |
| **Address verification before mail** — reject/flag undeliverable / deceased pre-send | A04 | A.8.26 | CC7.1 | ➖ | Art 5(1)(d) | ➖ | ➖ | ✅ |
| **No PII in tracking URLs** — opaque codes via links (we hold the mapping) | A01 / A04 | A.8.11 | CC6.1 | ➖ | Art 5(1)(c) / 25 | §1798.100 | ➖ | ✅ |
| **GDPR forget** — purge address + mergeData in mailpieces (contact-forget fan-out); the **global `VerifiedAddress` cache is untouched** (no contact/name → not personal data) | A04 | A.8.10 | (Privacy) | §164.310(d)(2) | Art 17 | §1798.105 | ➖ | ✅ |
| **`VerifiedAddress` database** — cross-account, **contact-free** ("just a verified address"); a **controlled exception** to per-account isolation, sound because it carries **no person linkage**; the address tracks **which accounts accessed/paid** (`accountId`, commercial) — **never a contact** | A01 | A.8.3 | CC6.1 | ➖ | Art 4 (not personal data) | §1798.140 | ➖ | ✅ |
| **Provider sub-processor** — address PII to PostGrid / Lob (DPA); provider-portable | A08 | A.5.19–.23 | CC9.2 | §164.308(b) | Art 28 | §1798.140 | ➖ | ✅ |
| **Check data** *(if mailing checks)* — financial PII handled provider-side, encrypted, minimal retained | A02 | A.8.24 | CC6.1 | ➖ | Art 32 | §1798.81.5 | ➖ | ✅ |
| **Encryption** — PDFs / addresses at rest (S3 / DDB SSE-KMS) + in transit | A02 | A.8.24 | CC6.1 | §164.312(e) | Art 32 | ➖ | ➖ | ✅ |
| **Proof-of-mailing + archive** — mailpieces archived, never dropped; transitions audited | A09 | A.8.15 | CC7.x | §164.312(b) | Art 30 | ➖ | USPS proof | ✅ |

# Gaps & open decisions

*The one review list — formerly "Decided" + "Leaning".* ✅ = resolved/decided · ⚠️ = **open — needs attention**.

1. ✅ **Provider abstraction — DECIDED: factory/adapter from day one.** Both **PostGrid + Lob** behind a
   **provider factory/adapter** (`provider-<id>` AppConfig); the service routes, account/campaign picks
   neither; no rewrite to add the second + fallback if one degrades.
2. ✅ **Cost cap — DECIDED: cross-channel, set at segmentation.** A **campaign-level** cap across SMS / email /
   print — **all-in**, **percent allocation**, or **fixed-per-channel**. Print contributes a **per-piece
   estimate + lead time** at design time and **enforces its allocation at submit** (refuse to exceed). The cap
   itself lives in the [campaign](../campaign/SPECS.md) spec.
3. ✅ **Mail class — DECIDED: account default, per-campaign override.** First-Class vs Marketing Mail; default
   from account config, overridable per campaign; drives the lead-time + cost estimates (`mailClass` on the
   mailpiece).

4. ✅ **Rendering — DECIDED: BUY provider templates for v1** (own-render = back-pocket). Author in Lob/PostGrid,
   send merge data; the **provider owns print-spec compliance** (bleed / 300 dpi / CMYK). Keep our own
   **template schema + designer ([web](../web/SPECS.md)) as the source of truth** and **compile down** to the
   provider template, so a switch is a **re-compile, not a re-author**. **Own-the-PDF** (Gotenberg / WeasyPrint /
   Chromium + **Ghostscript** for CMYK / PDF-X; or DocRaptor / PrinceXML) is a **documented future option** —
   revisit when volume / portability / per-piece cost justify (`print-3.5`).
5. ✅ **NCOA cadence + verification caching — DECIDED: hybrid, cost-first, cache everything 3rd-party.**
   **NCOA** (regulated — USPS move-update **≤95 d** for presort discounts) is **cached on the contact** with
   `verifiedAt` and **reused within ≤95 d**, re-verified only when **stale / changed** (NCOA is person-specific →
   it stays contact-scoped). **CASS** is **also cached, but globally** in the contact-free **`VerifiedAddress`**
   store (gap #8) — keyed by the **normalized address** (deterministic; a different address is just a different
   key), so a cache hit skips the 3rd-party call entirely (each lookup still costs money + latency even though
   it's "cheap"). So: **no 3rd-party verification call repeats for an address we've already verified.** Reuse the
   **longest compliant window**; **CASS-only acceptable** for tiny / no-presort sends. **Net rule: pay a
   verification vendor only on a true cache miss where the discount/quality it unlocks exceeds its cost.**
6. ✅ **PURL/QR ownership — DECIDED: WE own it (links/tracking).** [links](../links/SPECS.md) mints a
   per-recipient tracked URL on **our short domain** + holds the **code→contact mapping**; the provider
   template renders the QR **from our URL** (a merge variable). **Never** enable the provider's **built-in**
   QR/tracking (that hands them the mapping). First-party, provider-portable, PII stays in our infra.
7. ✅ **Address verification is its OWN provider factory — DECIDED: decoupled, capability-aware.** Verification is
   a **separate `AddressVerifier` factory** (one self-registering adapter per source into a typed registry — the
   same pattern as the `SmsAdapter` / mail-provider factory), **independent of the mail-fulfillment provider**:
   you can verify with **USPS Web Tools** or a dedicated vendor and **mail with Lob**, in any combination.
   Sources: **USPS Web Tools · PostGrid · Lob · Melissa · SmartyStreets**. Each verifier **declares its
   capabilities** — `cass` (standardize / DPV-deliverability / deceased-vacant flags) and/or `ncoa` — and the
   service **routes per operation**: **NCOA only goes to a licensed NCOALink verifier** (USPS Web Tools is
   **CASS-only**, so it can't satisfy NCOA). The CASS/NCOA caches (gap #5) sit **in front of** the factory, so
   the cache is **verifier-agnostic**. (The mail-fulfillment adapter no longer owns `address-verify`.)
8. ✅ **Verified-address cache is a GLOBAL, contact-free, billable shared resource — DECIDED.** The CASS layer is
   stored once in the **`VerifiedAddress`** database, one partition per address (`pk=ADDR#<hash(normalized
   address)>`). The **verification record** (`sk=META`) is the standardized result + **when** (`verifiedAt`),
   **which provider** (`verifier`), and the **provider's external ref** (`externalRefId`) — and **no contact and
   no name**: it is **not tied to a person**. A contact that looks up an address gets its **own copy** of the
   result (in [contact](../contact/SPECS.md)); the database holds **no back-reference** to a contact. The address
   database **does** track **which accounts accessed/paid** for the lookup (`sk=ACCT#<accountId>` rows — see
   billing) so they aren't double-charged — that's **commercial** data (an accountId, never a contact). This makes
   it a **deliberate, controlled exception to per-account tenant isolation**, sound precisely because a
   person-decoupled address **is not personal data** (the *who-lives-there* linkage lives in contact and is
   GDPR-forgettable there; a contact-forget **does not touch** `VerifiedAddress`). NCOA / deceased are
   person-specific → **never** here; they stay contact-scoped (gap #5).
   * **Billing — charge-once-per-account, cost-shared (the markup model).** Verification is a **paid service**
     (markup over the vendor rate). An **`AddressUsage`** ledger row per **(account, address)** records that an
     account has paid. On a verify request for address *A* by account *X*:
     - **Cold (A not cached):** call the vendor (**we incur cost `C`**) → store the pure `VerifiedAddress[A]` →
       charge *X* the price `P` (margin `P−C`); record `AddressUsage[X][A] {wasVendorCost:true, ourCost:C}` (the
       cost fact lives on the **ledger**, not the cache).
     - **Warm (A cached) + X never paid:** **no vendor cost** → charge *X* `P` (**pure margin** `P`, our cost 0)
       → write `AddressUsage[X][A]`.
     - **Warm + X already paid (`AddressUsage[X][A]` exists):** **no charge** (idempotent — same account, same
       address, free thereafter).
   * **Net:** the **first account overall** to need an address subsidizes our vendor cost; **every later account**
     that needs the same address is **pure margin** at no cost to us; **no account is ever charged twice** for the
     same address. Charges compose with the account prepaid balance / entitlements via
     [account](../account/specs/SPECS.md) (same path as the EVT surcharge / per-piece cost).
   * **Freshness:** `VerifiedAddress` is effectively immutable per address; an optional **`freshUntil` TTL**
     (config) can force a refresh (vacancy/DPV drift) — a refresh is a new cold lookup (cost event) at that point.

# Requirements (traceable register)

The traceable requirement register for the **print service** (the narrative sections above are the rationale;
this is the coded list). IDs are stable handles (**`print-N.M`**) — cite them in code, tickets, and tests.
**Priority:** **A** = MVP, **B** = core / hardening, **C** = later. One level of sub-requirements; a group's
priority is its floor. **Boundaries:** print owns **mail mechanics + provider format + address verification +
the send-log**; **[dispatch](../../../packages/services/DISPATCH.md)** paces, **[marketplace](../marketplace/SPECS.md)**
holds creds, **[workflow](../workflow/SPECS.md) / [campaign](../campaign/SPECS.md)**
orchestrate + own the cost cap, **[analytics](../analytics/SPECS.md)** owns engagement/conversion,
**[contact](../contact/SPECS.md) / [account](../account/specs/SPECS.md)** own suppression + address,
**[links](../links/SPECS.md)** owns QR/PURL, **[media](../media/SPECS.md)** owns template images.

## print-1.0 Artifact rendering — A
- **print-1.1** Merge data + template → print-ready **PDF** (`postcard` / `letter` / `self-mailer` / `check`); address block, dimensions, **bleed / safe zones**, **IMb** — A
- **print-1.2** **Variable data / merge** — name, custom fields, per-recipient **QR/PURL** (from [links](../links/SPECS.md)) — A
- **print-1.3** Front/back (postcards) + enclosure pages (letters) — B
- **print-1.4** **Proof / preview** before a run; large runs require an **approved proof** — A

## print-2.0 Address verification — A
- **print-2.1** **CASS** standardization (reject/flag bad pre-send) — served from the **global `VerifiedAddress` cache** (print-2.7); a true miss calls a verifier once *(gap #5)* — A
- **print-2.2** **NCOA** move-update — **hybrid cache** on the contact (`verifiedAt`, ≤95 d reuse), re-verify when stale/changed *(gap #5)* — A
- **print-2.3** **Cost-first** — CASS-only acceptable for tiny / no-presort sends; pay a vendor only on a cache miss where the discount/quality unlocked exceeds its cost *(gap #5)* — B
- **print-2.4** **Suppression** — do-not-mail (DMA) / deceased / prison / vacant + account block-list + contact suppression — A
- **print-2.5** **Undeliverable / returns** → list hygiene (a negative tracking event) — B
- **print-2.6** **`AddressVerifier` provider factory** — one self-registering adapter per source (**USPS Web Tools · PostGrid · Lob · Melissa · SmartyStreets**) into a typed registry, **independent of the mail-fulfillment provider** (verify with one, mail with another); each verifier **declares capabilities** (`cass` / `ncoa`), service **routes per operation** — **NCOA only to a licensed NCOALink verifier** (USPS Web Tools = CASS-only); caches sit in front (verifier-agnostic) *(gap #7)* — A
- **print-2.7** **`VerifiedAddress` database** — one partition per address (`pk=ADDR#<hash(normalized address)>`); the verification record (`sk=META`) = standardized result + **`verifiedAt` · `verifier` · `externalRefId`**, with **NO contact and NO name** (not tied to a person); a contact lookup gets its **own copy** (in [contact](../contact/SPECS.md)) — the database holds **no back-reference** to a contact. Cross-account "just an address" → not personal data (a **controlled exception** to tenant isolation); **contact-forget does NOT touch it**; optional `freshUntil` TTL *(gap #8)* — A
- **print-2.8** **The address tracks its accountIds — charge-once-per-account + cost-share (markup)** — `sk=ACCT#<accountId>` rows in the **same address partition** record which accounts accessed/paid (commercial, **never a contact**); **cold** lookup = we pay the vendor (`ourCost`) + charge the account (margin); **warm + new account** = no vendor cost + charge (pure margin); **warm + same account** = **no charge** (idempotent — no double charge). Charges compose with [account](../account/specs/SPECS.md) balance/entitlements *(gap #8)* — A

## print-3.0 Provider adaptation (factory) — A
- **print-3.1** **PostGrid / Lob** behind a **provider factory/adapter** (`provider-<id>` AppConfig); service routes; fallback if one degrades *(gap #1)* — A
- **print-3.2** Normalize provider **template / pricing / webhook** shapes — A
- **print-3.3** **Rendering = buy provider templates (v1)**; **own template schema (web) as SoT**, compile down *(gap #4)* — A
- **print-3.4** **Do NOT** use the provider's built-in QR/tracking — render our URL only *(gap #6)* — A
- **print-3.5** **Own-render PDF** (Gotenberg/WeasyPrint/Chromium + Ghostscript; or DocRaptor/PrinceXML) — documented **future option** *(gap #4)* — C

## print-4.0 Tracking & events — A
- **print-4.1** Ingest **USPS scan events** (`in_production → mailed → in_transit → delivered` / `returned` / `undeliverable`) via the provider — A
- **print-4.2** Normalize lifecycle → **[analytics](../analytics/SPECS.md)** (`sent` → `delivered` → `returned`); `occurredAt` = **USPS scan time**; **1:1 to the contact** (addressed) — A

## print-5.0 Response (QR / PURL) — A
- **print-5.1** Per-recipient tracked URL via **[links](../links/SPECS.md)** (our short domain + mapping); provider renders the **QR from our URL** *(gap #6)* — A
- **print-5.2** Scan → digital **engagement + conversion** signal (analytics), attributed to the mail touch — A

## print-6.0 Scheduling, lead time & cost — A
- **print-6.1** **Lead time = production + postal class**; "arrive-by" works backward from the production+transit window — A
- **print-6.2** **Per-piece cost preview** before a run — A
- **print-6.3** **Cross-channel cost cap** (all-in / %-alloc / fixed-per-channel) — print contributes a per-piece estimate + lead time, **enforces its allocation at submit** *(gap #2)* — A
- **print-6.4** **Mail class** — account default + per-campaign override (`mailClass`), drives lead-time + cost *(gap #3)* — A

## print-7.0 Privacy & compliance — A
- **print-7.1** **Address PII** + tenant isolation; **GDPR forget** purges address + mergeData in mailpieces — A
- **print-7.2** **Provider sub-processor** — address PII to PostGrid / Lob (DPA); provider-portable — A
- **print-7.3** **Check data** *(if checks)* handled provider-side, encrypted, minimal retained — B
- **print-7.4** **Encryption** at rest (S3 / DDB SSE-KMS) + in transit; **No PHI** by [AUP](../account/specs/SPECS.md) — A

## print-8.0 Data model, lifecycle & infra — A
- **print-8.1** `Mailpiece` (`pk=ACCOUNT# sk=MAIL#`) · `AddressVerification` · `TrackingEvent` (`sk=MAIL#<at>`) · the **address database** (`pk=ADDR#<hash>`: `sk=META` = **`VerifiedAddress`** record, contact-free · `sk=ACCT#<accountId>` = **`AddressUsage`** access/billing) — A
- **print-8.2** Mailpieces **archived, never silently dropped** (audit + USPS proof of mailing) — A
- **print-8.3** **S3** (PDFs/proofs) · **DynamoDB** (mailpieces/tracking) · **SQS** (submit + tracking ingest) · **KMS** — A

## print-9.0 Service & Job topology — B
- **print-9.1** **Domain bases** — `PrintService extends Service` + `PrintJob extends Job` hold the shared code (**mail-fulfillment adapter factory** + **`AddressVerifier` factory** · Mailpiece/TrackingEvent model · render/proof · CASS/NCOA caches · `canSend` · `WorkQueue` · S3 store); **concrete roles extend the domain base** — B
- **print-9.2** **`PrintMainService`** — the `/print/*` API (submit · proofs · address verify · status) + the provider tracking-webhook ingress (ACK-fast → enqueue; low volume → no separate webhook service) — A
- **print-9.3** **Jobs extend `PrintJob`** — `PrintRenderJob` / `PrintSubmitJob` / `PrintTrackingJob` / `PrintScheduleJob` — A
- **print-9.4** **`PrintSubmitJob`** — `canSend` + provider-agnostic `provider.submit`; **rate-paced** via `WorkQueue` / [dispatch](../../../packages/services/DISPATCH.md); retry → DLQ — A
- **print-9.5** **Mail-fulfillment adapter = single dialect boundary** per mail provider (PostGrid/Lob): `submit` · tracking-normalize · `verifySignature`, resolved by a typed registry (the texting `SmsAdapter` pattern) — A
- **print-9.6** **`AddressVerifier` factory** — separate typed registry of verification sources (USPS/PostGrid/Lob/Melissa/SmartyStreets), capability-declared (`cass`/`ncoa`), **decoupled** from the mail adapter; CASS/NCOA caches sit in front *(gap #7)* — A

# Endpoints (first cut)

A first pass at the endpoint surface, in [`@repo/endpoint`](../../../packages/endpoint/SPECS.md) style — all
service-prefixed **`/print/*`**. **Submission is S2S** — [campaign](../campaign/SPECS.md) / workflow's
`send` node (channel = print) enqueues; the authoring surfaces (proof, cost-preview, templates, address-verify)
are user-facing. Reads return the `{ data, page }` envelope.

**Access column:** **`minAccess`** on the `Access` ladder — **`-`** = public · account ladder
**`SENDER`<`USER`<`BILLING`<`ACCOUNT`** · staff ladder **`SUPPORT`<`APPLICATION`<`ROOT`** · **`⬆`** = step-up ·
**`Internal`** = VPC-only S2S · **`Provider-sig`** = signature-verified provider webhook.

### Mailpieces — submit & status (print-1, print-4, print-8)
| Method | URI | Purpose | Access | Req |
|---|---|---|---|---|
| POST | `/print/mailpieces` | Submit a mailpiece (template + merge + recipient); honors `mailClass` + `arriveBy` | Internal | print-1.1/6.4 |
| POST | `/print/mailpieces/batch` | Bulk submit for a campaign run (enforces cost-cap allocation at submit) | Internal | print-1.1/6.3 |
| GET | `/print/mailpieces` | List (by campaign / status) | USER | print-8.1 |
| GET | `/print/mailpieces/{id}` | Mailpiece detail (status, cost, address verification) | USER | print-8.1 |
| GET | `/print/mailpieces/{id}/tracking` | USPS tracking-event timeline | USER | print-4.1 |

### Proof, cost & templates (print-1, print-6)
| Method | URI | Purpose | Access | Req |
|---|---|---|---|---|
| POST | `/print/proof` | Render a **proof PDF** for a template + sample merge data | USER | print-1.4 |
| POST | `/print/mailpieces/{id}/approve` | **Approve the proof** (required for large runs) | ACCOUNT | print-1.4 |
| POST | `/print/cost-preview` | **Per-piece × recipients** cost + production/transit **lead-time** estimate | USER | print-6.2/6.3 |
| GET | `/print/templates` | List print templates (schema; designer is web) | USER | print-1.1 |
| POST | `/print/templates` | Create a template (schema → compiles to provider) | USER | print-1.1/3.3 |
| PATCH | `/print/templates/{id}` | Edit a template | USER | print-1.1 |
| DELETE | `/print/templates/{id}` | Archive a template | USER | print-1.1 |

### Address verification (print-2)
| Method | URI | Purpose | Access | Req |
|---|---|---|---|---|
| POST | `/print/address/verify` | **CASS** (+ optional **NCOA**) — standardize + deliverability + deceased/vacant; response indicates **`cacheHit`** + **`charged`** (charge-once-per-account) | USER | print-2.1/2.2/2.7/2.8 |
| POST | `/print/address/verify/batch` | Batch verify (list hygiene); global cache reuse + per-account `AddressUsage` billing | Internal | print-2.1/2.7/2.8 |

### Providers — platform config (print-3)
| Method | URI | Purpose | Access | Req |
|---|---|---|---|---|
| GET | `/print/providers` | List configured providers (PostGrid / Lob) + status | APPLICATION | print-3.1 |
| PUT | `/print/providers/{id}` | Configure a provider (factory / `provider-<id>`) | APPLICATION ⬆ | print-3.1 |

### Webhooks, internal / S2S & ops
| Method | URI | Purpose | Access | Req |
|---|---|---|---|---|
| POST | `/print/webhook/{provider}` | Provider **tracking** webhook (USPS scans) → normalize → analytics | Provider-sig | print-4.1/4.2 |
| GET | `/print/internal/address/verify` | S2S address verify (e.g. contact import hygiene) | Internal | print-2.1 |
| POST | `/print/internal/erase` | S2S forget hook — purge address + merge data in mailpieces (`contact-forget` fan-out) | Internal | print-7.1 |
| GET, PUT | `/print/config` | Read / set the service's own runtime config (AppConfig-backed) | ROOT | print-8.3 |
| GET | `/print/health` | Liveness / readiness | - | print-8.3 |

> **QR/PURL is not minted here** — the [links](../links/SPECS.md) service mints the per-recipient tracked URL;
> print passes it as a merge variable and the provider template renders the glyph (`print-5.1`).

# eof
