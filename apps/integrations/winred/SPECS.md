#
# WinRed integration
#

# Objective

Connect an **account's WinRed committee** as an **inbound trigger source**: turn the **contribution events**
WinRed emits — **one-time donations, recurring/monthly donations, refunds, new donors** — into **normalized events
on the platform bus** that an account's **[workflow](../../core/workflow/SPECS.md)** acts on. *"A supporter gave →
send a thank-you text + an emailed receipt, then start a donor-stewardship journey."* *"A monthly recurring gift
posted → send a renewal nudge."* *"A donor lapsed → fire a win-back."* This is **mainly a trigger** — WinRed is the
**stimulus** (the donation), the platform's channels are the **engagement**.

It is also the platform's **first-class conversion source**: a WinRed **`winred.donation.received`** is the
**commerce/goal event** [analytics](../../core/analytics/SPECS.md) attributes back to the channel touches that
earned it (the analytics **conversion contract**, `analytics-6.5` — *"integration commerce/goal event first… a
Shopify `order.placed`, a donation"*). So the same donation both **triggers** a workflow and **closes the loop** on
attribution — *which text/email actually earned the gift*. **WinRed is the donation-trigger mirror of
[Shopify](../shopify/SPECS.md) orders.**

**Direction = inbound (WinRed → us).** WinRed is **account-connected** (the committee connects *their* WinRed
account), so it lives under **[marketplace](../../core/marketplace/SPECS.md)** governance — **per-account credential
(OAuth or API key + webhook signing secret)**, the **Zapier governance pattern** ([zapier](../zapier/SPECS.md):
accept-to-enable · cross-border gate · metering · egress feature-flag × permission). **The account/committee is the
controller.** WinRed is a **political (Republican/conservative) donation platform**; its mirror sibling is
**[ActBlue](../actblue/SPECS.md)** (Democratic/progressive) — **same connector pattern**, differing only by
provider, credential, webhook shape, and political "side." Both are **first-class for the platform's
[political vertical](../../../docs/SPECS.md)** (the platform leads with political).

This is **not a new data plane**: ingest rides the platform **incoming-webhook intake** (verify → SQS); the
**connector runtime** normalizes; triggers ride the **Kafka backbone** into workflow; engagement rides the
**channels behind `canSend()`**; secrets ride the **marketplace vault**.

# Role & boundaries

**Owns:**
* The **WinRed event contract** — which **webhook deliveries / export rows** map to which **normalized events**,
  and the **payload → context** shape each carries (contribution amount / currency / recurring flag / committee /
  donor ref).
* **Webhook verification + connector normalization** — verify the WinRed **signature / signing secret** at the
  edge, dedupe on the WinRed **contribution / delivery id**, and **normalize** the vendor payload into a platform
  event (the [marketplace](../../core/marketplace/SPECS.md) **`MarketplaceConnectorJob`** pattern).
* **Donor → contact resolution + consent mapping** — resolve the WinRed donor (email / E.164 phone) to a RumbleUp
  **`contactId`** ([contact](../../core/contact/SPECS.md) lookup), store the WinRed donor id in **`externalRefs`**,
  and map a donor's **SMS/email opt-in** onto our consent **as a signal**.
* **Recurring-donation correlation** — distinguish the **first** recurring charge from **subsequent** monthly
  charges so stewardship vs. renewal journeys fire correctly.

**Delegates / does NOT do:**

| Concern | Owner |
|---|---|
| **OAuth / API-key + credential vault + catalog + cross-border gate + metering** | **[marketplace](../../core/marketplace/SPECS.md)** (Zapier governance pattern) |
| **Webhook intake edge** (HTTPS endpoint → SQS) | the platform **incoming-webhook intake** |
| **The trigger graph / what to do next** | **[workflow](../../core/workflow/SPECS.md)** (these events are its **trigger nodes**) |
| **The engagement send** (SMS / email / …) + **consent / suppression / quiet-hours** | the **channel** + **`canSend()`** ([texting](../../core/texting/SPECS.md) / [email](../../core/email/SPECS.md)) |
| **Conversion attribution math** | **[analytics](../../core/analytics/SPECS.md)** (the donation = the conversion event it credits) |
| **Contact identity + suppression + the stable `contactId`** | **[contact](../../core/contact/SPECS.md)** |
| **FEC / campaign-finance reporting** | **the account / committee** — we do **not** file or compute FEC reports |
| **Pacing / retry / DLQ / fair-share** of inbound + outbound | the shared **connector / dispatch framework** |

> **No PII reach-down; the committee is controller.** WinRed is the **account's** system. When a contact is
> forgotten, erasure here = **stop-ingesting + stop-acting + disclose**, not reach-in-delete (the
> [egress erasure boundary](../../../docs/SPECS.md)). **FEC/state campaign-finance reporting is the committee's legal
> obligation, not ours** — we trigger engagement and record the touch→conversion; we never produce a filing.

# Core concepts

* **Connection (installation)** — an account's connected WinRed committee: the credential (vaulted in
  marketplace), the committee identifier, the registered webhook subscription, and connection health. One per
  committee; lifecycle is the marketplace `enable → connect → active → pause → remove` (+ **auto-pause** on
  credential revocation / account-inactive).
* **Trigger event** — a WinRed contribution **normalized** into a platform event (`winred.donation.received`, …).
  These are **dynamic integration trigger events** (marketplace-contributed) — *not* entries in the static core
  [`Events`](../../../packages/endpoint/src/EventTypes.ts) vocabulary — matched by an account's **workflow trigger
  bindings**, exactly like any [marketplace](../../core/marketplace/SPECS.md) integration trigger node.
* **Donor ↔ contact** — the WinRed donor is resolved to a RumbleUp **`contactId`** (by normalized email / E.164
  phone); the WinRed donor id is stored in the contact's
  **[`externalRefs`](../../core/contact/src/model/ContactModel.ts)** (`{ winred: { donorId, committee } }`).
  **Unknown donor** → auto-create (an account-configurable choice) or an **opaque `anonId`** (same rule as
  [analytics](../../core/analytics/SPECS.md) identity resolution).
* **Contribution** — the donation fact: **amount + currency**, **recurring** flag (one-time vs. monthly), the
  committee/entity, and the donor ref. A `refund` reverses it. Carries enough to drive engagement + the
  conversion — **never** the donor's card/PCI data (WinRed owns the checkout).
* **Donor opt-in** — a donor's choice to receive SMS/email updates (captured on the WinRed form) maps onto
  RumbleUp **consent** on the resolved contact. **It does not bypass `canSend()`** — any engagement still passes
  the channel's consent / suppression / quiet-hours / 10DLC gate (TCPA).
* **Conversion** — a donation is emitted **both** as a workflow trigger **and** as the analytics **conversion
  event** (amount + currency + `contactId`) for multi-touch attribution.

# Architecture & flow

```
 INBOUND TRIGGERS  (the headline)
   WinRed committee ──signed webhook (contribution)──► incoming-webhook intake (HTTPS)
        • verify signature / signing secret · dedupe on the contribution/delivery id · ACK fast (200)
        └─► SQS ──► winred CONNECTOR (normalize)
                 • map payload → normalized event ; resolve donor → contactId (+ externalRefs) ; map opt-in
                 └─► emit `winred.<event>` on the Kafka backbone
                          ├─► workflow TRIGGER router ── match account bindings → start / signal instances
                          │        └─► engagement: thank-you text · emailed receipt · recurring nudge  (ALWAYS via canSend())
                          └─► analytics (donation → the `converted` conversion contract → attribution)

 RECURRING vs ONE-TIME  (a normalization distinction, not two pipes)
   contribution.recurring = false                  → `winred.donation.received`            → thank-you / stewardship
   contribution.recurring = true, first charge      → `winred.recurring.donation.received` → welcome-to-monthly
   contribution.recurring = true, subsequent charge → `winred.recurring.donation.received` → renewal nudge / receipt

 CSV / EXPORT FALLBACK  (where a live webhook isn't configured)
   WinRed CSV/export ──► operator/scheduled import ──► same connector normalize → same events (idempotent, dedup on id)

 AUTH:  per-account WinRed credential (OAuth or API key) + webhook signing secret → vaulted via the marketplace broker
 FEC:   campaign-finance reporting is the COMMITTEE's obligation — NOT computed or filed here
```

* **Inbound-first, idempotent.** WinRed can **retry / redeliver** a webhook; the connector dedupes on the
  **contribution / delivery id** and every downstream effect is idempotent — a redelivered donation doesn't
  double-trigger a thank-you or double-count a conversion.
* **No new engine.** Intake = the shared webhook intake; normalize = the marketplace connector runtime; trigger =
  workflow; send = the channels + `canSend()`; throttle = the shared framework. WinRed adds a **connector +
  event map**, not infrastructure — **identical to [ActBlue](../actblue/SPECS.md)**, differing only by dialect.

# Trigger catalog — what WinRed emits → what we do

The WinRed contribution events the connector subscribes to, the **normalized event** each becomes, and the
**engagement** it typically drives. The subscribed set is **config** (add a delivery kind = a map entry).

| WinRed contribution kind | Normalized event | Typical engagement |
|---|---|---|
| one-time contribution | **`winred.donation.received`** | thank-you text/email + emailed **receipt**; start donor-stewardship journey; **conversion** (attribution) |
| recurring/monthly contribution (first charge) | **`winred.recurring.donation.received`** | welcome-to-monthly-donor series; receipt; **conversion** |
| recurring/monthly contribution (subsequent charge) | `winred.recurring.donation.received` | renewal nudge · monthly receipt · upgrade-ask; **conversion** |
| refund / chargeback | **`winred.refund.created`** | refund acknowledgment; suppress the in-flight thank-you/stewardship for that gift |
| new donor record | **`winred.donor.created`** | **welcome** series; consent capture |
| recurring cancelled / lapsed *(derived — later)* | `winred.recurring.lapsed` | **lapsed-donor win-back** (re-engage a stopped monthly gift) |

> **Engagement composes in workflow.** Each normalized event is a **trigger node**; the *journey* (wait, branch,
> send, A/B, suppression on refund) is authored in [workflow](../../core/workflow/SPECS.md). WinRed just says
> *what happened* + *to whom* (`contactId`) + *the facts* (amount, currency, recurring) in the trigger context.

# Donor resolution & consent

* **Resolve → `contactId`.** The connector normalizes the WinRed donor's **email** (lowercased) / **phone**
  (E.164) and asks [contact](../../core/contact/SPECS.md) for the `contactId`; the WinRed donor id is written to
  the contact's **`externalRefs.winred`**. Unknown donor → **auto-create** (account-config) or an **`anonId`**.
* **Consent mapping — donor opt-in → RumbleUp consent.** A donor who opted into SMS/email updates on the WinRed
  form (state + timestamp + source) maps onto the contact's consent record. **Crucially: this is a *signal*, not a
  bypass** — every triggered send still runs **`canSend()`** (consent · suppression · STOP · quiet-hours · 10DLC),
  so a WinRed "opted in" flag never overrides a platform opt-out. Political SMS is squarely TCPA/10DLC-governed.
* **No raw PII on the bus.** The normalized event carries **`contactId`** + contribution facts (amount, currency,
  recurring flag), **not** raw email/phone and **never** card data — PII stays in contact (same discipline as
  analytics events). FEC-required donor attributes (name, address, employer, occupation) are the **committee's**
  to hold for filings, **not** ours to put on the bus.

# Conversion & attribution

* A WinRed **donation** is the platform's **conversion event** (`analytics-6.5`): the connector emits the donation
  as an [analytics](../../core/analytics/SPECS.md) **`converted`** with **amount + currency + `contactId`**, and
  analytics attributes it to the contact's prior channel touches (email → SMS → … → donation) within the lookback
  window, by the account's chosen attribution model — *which message earned the gift*.
* **One event, two consumers** — the same `winred.donation.received` both **triggers** a workflow (thank-you /
  stewardship) and **feeds** attribution. They don't compete; the connector emits once, both subscribe.
* **Recurring counts each charge** — each posted recurring charge is its own conversion (a real gift), so monthly
  donor revenue attributes correctly over time; a `refund` is recorded so attributed totals can be netted.

# Auth, webhooks & governance

* **Per-account credential.** The committee authorizes WinRed (**OAuth** where offered, else an **API key** + a
  **webhook signing secret**); credentials are **minted / validated + vaulted via the
  [marketplace](../../core/marketplace/SPECS.md) broker**, auto-refreshed where applicable, revocable — the
  [zapier](../zapier/SPECS.md) auth model. The connector holds a **reference**, never the secret.
* **Webhook signature verification.** Every inbound webhook is **signature/secret-verified** at the intake edge
  before it's trusted; failures are dropped + alerted. **Dedupe on the contribution / delivery id.**
* **CSV / export ingestion** *(fallback / backfill-bounded)* — where a live webhook isn't available, an
  operator/scheduled **CSV import** feeds the **same** connector normalize (same dedupe id, same events). Bounded,
  rate-limited, **consent-aware** — not a historical PII dragnet (see Reliability).
* **Governance (marketplace / Zapier pattern).** WinRed is a **[marketplace](../../core/marketplace/SPECS.md)
  `IntegrationDefinition`** under the **Zapier governance pattern** ([zapier](../zapier/SPECS.md)):
  **accept-to-enable**, **per-account credential**, the **`dataJurisdiction` cross-border gate**, **metering**
  (donations ingested), and **egress = feature-flag × the connecting user's permission**. The **account/committee
  is the controller**; the connector **contributes trigger nodes** to workflow — it does not own the catalog,
  credentials, or the vault.
* **Kill switches** — disable / **dry-run** (log intended triggers, do nothing) / pause the connection (AppConfig +
  the marketplace lifecycle).

# Reliability

* **Idempotent ingest** — dedupe on the **WinRed contribution / delivery id**; downstream effects keyed so a
  redelivery is a no-op (no double-trigger, no double-count, no duplicate receipt).
* **No backfill at launch — new donations only.** We act on what WinRed emits **after** connect (forward); we do
  **not** replay donation history. A bounded historical **CSV import** ("go back in time" — seed past donors /
  donations) is a **deferred future task** of uncertain value to a forward engagement engine; if ever built it's
  rate-limited + **consent-aware** (gap #10).
* **Throttle + backpressure** — outbound engagement rides the shared **token-bucket × per-account fair-share**;
  429 / 5xx → **computed-delay requeue** → DLQ → **auto-pause + alert** ([monitor](../../core/monitor/SPECS.md)) —
  reused, not reinvented.
* **Webhook re-subscription** — on connect (and a periodic reconcile) ensure the contribution webhook subscription
  exists; re-register if WinRed dropped it.

# Out of scope

* **FEC / state campaign-finance reporting** — generating, computing, or filing reports is the **committee's**
  legal obligation; we record the touch→conversion and trigger engagement, **never** a filing.
* **Donation processing / checkout / payment** — WinRed owns the contribution form, payment, and PCI scope; we
  engage **after** the event. **No card data ever touches us.**
* **Two-way donor-record sync** (a CRM-style continuous mirror) — WinRed here is **trigger-in**, not a CRM mirror;
  a deep sync is a separate, deferred surface.
* **Fundraising-page / WinRed account management** — we consume contribution events; we don't run the committee's
  WinRed account.

# AWS Services and Other Dependencies

**AWS services**
* **API Gateway** — the WinRed **webhook intake** (signature-verified) + the small `/winred/*` config / health surface.
* **SQS** (+ **DLQ**) — webhook ingest buffering + engagement-dispatch hand-off + retry.
* **Kafka (MSK)** — the **normalized trigger events** (to workflow + analytics).
* **EventBridge Scheduler** — periodic webhook-subscription reconcile + scheduled CSV/export poll (where used).
* **DynamoDB** — connection state · webhook-dedupe ids · recurring-charge correlation (WinRed ids live on the
  contact's **`externalRefs`**, not a separate store).
* **Redis (ElastiCache)** — outbound throttle (token-bucket × fair-share) + breaker state.
* **Secrets Manager** (+ **KMS**) — the per-account credential + webhook signing secret (**via marketplace**).

**Third-party**
* **WinRed** (webhooks + CSV/export; OAuth/API where offered) — **WinRed is a sub-processor** of the committee's
  donor data.

**Internal (`@repo/*`) + services**
* `@repo/services` (Sqs, Kafka, Dynamo, Cache, SecretsManager, Kms), `@repo/endpoint` (`Access`), `@repo/common` (`Type`).
* Composes **marketplace** (credential / vault / catalog / governance / connector runtime), **workflow** (trigger
  nodes), **contact** (resolution / consent / `externalRefs`), **analytics** (conversion), **texting / email +
  `canSend()`** (engagement), **monitor** (health / backpressure). **Sibling [ActBlue](../actblue/SPECS.md)** shares
  this connector pattern.

# Compliance & standards mapping

How **this WinRed integration's** controls map to **OWASP Top 10 (2021)**, **ISO/IEC 27001:2022** (Annex A),
**SOC 2** (TSC), **GDPR**, **CCPA/CPRA**, and **messaging law**. WinRed is an **account-controlled inbound
political-donation integration** — its dominant controls are **webhook authenticity (signature)**, **credential
secret custody**, **consent fidelity** (donor opt-in → `canSend()`), **no-PII-on-the-bus**, the **egress erasure
boundary**, and the **FEC-reporting boundary** (the committee's obligation, not ours). **No PCI** (WinRed owns the
contribution checkout — we never touch card data); **no PHI**.

**Legend:** ✅ meets/exceeds · ⚠️ partial / open — see Gaps · ➖ n/a

| WinRed control | OWASP T10 | ISO 27001:2022 | SOC 2 (TSC) | GDPR | CCPA | Messaging | |
|---|---|---|---|---|---|---|---|
| **Webhook authenticity** — signature/secret-verify every inbound at the edge; drop + alert on failure | A08 / A01 | A.8.26 / A.5.14 | CC6.1 / CC7.1 | Art 32 | ➖ | ➖ | ✅ |
| **Credential secret custody** — per-account credential + webhook secret in the **marketplace vault** (Secrets Manager + KMS); reference-only | A02 / A05 | A.8.24 / A.5.17 | CC6.1 | Art 32 | ➖ | ➖ | ✅ |
| **Consent fidelity** — donor opt-in maps to our consent but **`canSend()` always governs**; a WinRed flag never overrides a platform opt-out (political SMS = TCPA/10DLC) | A04 | A.5.34 | CC6.1 | Art 6 / 7 | §1798.120 | **TCPA / 10DLC / opt-in** | ✅ |
| **No PII on the bus** — normalized events carry **`contactId`** + contribution facts, not raw email/phone, never card data | A09 | A.8.11 | (Privacy) | Art 5(1)(c) | §1798.100 | ➖ | ✅ |
| **Idempotent ingest** — dedupe on the contribution/delivery id; no double-trigger / double-count / duplicate receipt | A08 | A.8.26 | CC7.1 | ➖ | ➖ | ➖ | ✅ |
| **Egress erasure boundary** — WinRed is the committee's system; forget = **stop-ingest + stop-act + disclose** | A04 | A.8.10 | (Privacy) | Art 17 | §1798.105 | ➖ | ✅ |
| **FEC-reporting boundary** — campaign-finance filing is the **committee's** obligation; we neither compute nor file | ➖ | A.5.31 | CC1.x | ➖ | ➖ | ➖ | ✅ committee's |
| **Cross-border gate** — an EU-resident donor's data stays in-region per marketplace `dataJurisdiction` | A08 | A.5.14 | CC6.7 | Art 44–49 | ➖ | ➖ | ✅ |
| **Outbound throttle + backpressure** — token-bucket × fair-share; 429 → requeue → DLQ → auto-pause + alert | A08 | A.8.26 | CC7.1 | ➖ | ➖ | ➖ | ✅ |
| **Least-privilege** — request only the scopes the contribution triggers need (reads) | A01 | A.5.15 / A.8.2 | CC6.1 / CC6.3 | Art 25 | ➖ | ➖ | ✅ |
| **Sub-processor governance** — WinRed accept-to-enable; account is controller of donor data | A08 | A.5.19–.23 | CC9.2 | Art 28 | §1798.140 | ➖ | ✅ |
| **Audit** — connect / disconnect / config change + manual resync audited | A09 | A.8.15 | CC7.2 | Art 30 | ➖ | ➖ | ✅ |

> **Design-intent mapping** — how the integration is *intended* to satisfy each control, not an attestation.

# Gaps & decisions

*The one review list.* ✅ = resolved/decided · ⚠️ = **open — needs attention**.

1. ✅ **Direction — DECIDED: inbound trigger-first.** WinRed → normalized events → **workflow triggers**
   (+ analytics conversion). The **donation-trigger mirror of [Shopify](../shopify/SPECS.md) orders**; a
   continuous CRM-style mirror is out of scope.
2. ✅ **Governance — DECIDED: marketplace / Zapier pattern.** Per-account credential, accept-to-enable, cross-border
   gate, metering, egress feature-flag × permission; **account/committee = controller**.
3. ✅ **Events are dynamic integration triggers — DECIDED.** `winred.*` events are **marketplace-contributed**
   trigger nodes the workflow router matches — **not** entries in the static core `Events` vocabulary.
4. ✅ **Identity — DECIDED: resolve to `contactId` upstream.** Connector resolves donor (email/E.164) →
   `contactId` via contact; WinRed id in **`externalRefs`**; unknown → auto-create (config) or `anonId`. No raw
   PII on the bus.
5. ✅ **Consent — DECIDED: map but never bypass.** Donor opt-in maps onto our consent as a **signal**;
   **`canSend()` always governs** the actual send (TCPA / STOP / quiet-hours / 10DLC).
6. ✅ **Conversion — DECIDED.** A donation = the analytics **`converted`** event (amount + currency + `contactId`),
   `analytics-6.5`; one emit, two consumers (workflow + analytics); each recurring charge is its own conversion.
7. ✅ **Recurring vs one-time — DECIDED: a normalization distinction.** `donation.received` (one-time) vs.
   `recurring.donation.received` (monthly), separating first-charge welcome from subsequent-charge renewal.
8. ✅ **Idempotency — DECIDED.** Dedupe on the WinRed contribution / delivery id; all downstream effects idempotent.
9. ✅ **FEC boundary — DECIDED: not ours.** Campaign-finance reporting/filing is the **committee's** legal
   obligation; we trigger engagement + record the conversion only — we never compute or file a report.
10. ✅ **Backfill — DECIDED: none at launch; act on new donations only.** Forward-looking engagement engine. A
    bounded, rate-limited, **consent-aware** CSV/export seed of past donations is a **deferred future task** of
    uncertain relevance (`winred-8.1`); go-forward-only keeps the donor-PII story simple.
11. ⚠️ **Ingestion shape — OPEN (confirm with WinRed).** Whether WinRed delivers contributions via a **live signed
    webhook**, OAuth/API, or **CSV/export only** is **provider-dependent**; the connector supports
    **webhook + CSV** behind one normalize, but the exact signing scheme + delivery id field must be confirmed
    against WinRed's current developer surface (same open as [ActBlue](../actblue/SPECS.md) #11).

# Requirements (traceable register)

The traceable register for the **WinRed integration** (IDs **`winred-N.M`**). **Priority:** **A** = MVP,
**B** = core / hardening, **C** = later. **Boundary:** WinRed owns the **event contract + connector normalize +
donor/consent resolution + recurring correlation**; credential/vault/governance = marketplace, triggers/automation
= workflow, sends + consent = channels/`canSend()`, attribution = analytics, **FEC reporting = the committee**.

## winred-1.0 Connection & auth — A
- **winred-1.1** **Per-account credential** (OAuth where offered, else API key + webhook signing secret) — minted/validated + **vaulted via marketplace**; connector holds a reference, never the secret *(gap #2)* — A
- **winred-1.2** **Lifecycle** — `enable → connect → active → pause → remove`; **auto-pause** on credential revocation / account-inactive; **least-privilege** (read-only contribution scopes) — A
- **winred-1.3** **Webhook subscription management** — register the contribution webhook on connect + **periodic reconcile** (re-register if dropped) — A

## winred-2.0 Inbound webhooks & normalization — A
- **winred-2.1** **Signature/secret verification** at the intake edge; drop + alert on failure — A
- **winred-2.2** **Idempotent ingest** — dedupe on the **WinRed contribution / delivery id**; ACK-fast (200) → SQS → connector — A
- **winred-2.3** **Normalize payload → event** — the connector maps each contribution kind to a **`winred.<event>`** with a payload→context shape; subscribed set is **config** — A
- **winred-2.4** **No raw PII on the bus** — events carry **`contactId`** + contribution facts, never raw email/phone or card data — A
- **winred-2.5** **CSV / export ingestion** — same connector normalize (same dedupe id, same events) where a live webhook isn't configured — B

## winred-3.0 Trigger catalog — A
- **winred-3.1** **One-time donation** — `winred.donation.received` (thank-you + receipt + stewardship) — A
- **winred-3.2** **Recurring donation** — `winred.recurring.donation.received`, distinguishing **first** (welcome-to-monthly) from **subsequent** (renewal nudge / receipt) charges *(gap #7)* — A
- **winred-3.3** **Refund** — `winred.refund.created` (acknowledgment; suppress in-flight stewardship for that gift) — B
- **winred-3.4** **Donor created** — `winred.donor.created` (welcome / consent capture) — B
- **winred-3.5** **Recurring lapsed** *(derived — later)* — `winred.recurring.lapsed` for **lapsed-donor win-back** — C
- **winred-3.6** **Triggers are dynamic** marketplace nodes matched by **workflow** bindings (not the static `Events` catalog) *(gap #3)* — A

## winred-4.0 Donor resolution & consent — A
- **winred-4.1** **Resolve donor → `contactId`** (normalized email / E.164) via [contact](../../core/contact/SPECS.md); store WinRed id in **`externalRefs.winred`** — A
- **winred-4.2** **Unknown donor** → **auto-create** (account-config) or opaque **`anonId`** — B
- **winred-4.3** **Consent mapping** — donor opt-in → our consent **as a signal**; **`canSend()` always governs** the send (TCPA / 10DLC) *(gap #5)* — A

## winred-5.0 Conversion & attribution — A
- **winred-5.1** **Donation → analytics `converted`** (amount + currency + `contactId`), the `analytics-6.5` conversion contract; one emit feeds **both** workflow + analytics; each recurring charge is its own conversion; refund nets *(gap #6)* — A

## winred-6.0 Governance & privacy — A
- **winred-6.1** **Marketplace / Zapier governance** — accept-to-enable · **`dataJurisdiction` cross-border gate** · metering · egress feature-flag × permission; **account/committee = controller** *(gap #2)* — A
- **winred-6.2** **Egress erasure boundary** — WinRed is the committee's system; forget = **stop-ingest + stop-act + disclose**, not reach-in-delete — A
- **winred-6.3** **FEC-reporting boundary** — campaign-finance filing is the **committee's** obligation; we neither compute nor file *(gap #9)* — A
- **winred-6.4** **Kill switches** — disable / **dry-run** (log intent, do nothing) / pause (AppConfig) — A
- **winred-6.5** **Audit** — connect / disconnect / config change / manual resync — B

## winred-7.0 Reliability — B
- **winred-7.1** **No backfill at launch — new donations only** (forward engagement engine). Historical CSV/export seed is a **deferred future task** of uncertain relevance; if built: bounded · rate-limited · **consent-aware** *(gap #10)* — C
- **winred-7.2** **Backpressure + retry + DLQ + auto-pause** on ingest + outbound; **idempotent** throughout — B

## winred-8.0 Infra — A
- **winred-8.1** **API Gateway** (webhook intake + `/winred/*`) · **SQS + DLQ** · **Kafka** (normalized events) · **EventBridge Scheduler** (reconcile + CSV poll) · **DynamoDB** (connection / dedupe / recurring-correlation) · **Redis** (throttle) · **Secrets Manager + KMS** (via marketplace) — A

# Endpoints (first cut)

A first pass, in [`@repo/endpoint`](../../../packages/endpoint/SPECS.md) style — service-prefixed `/winred/*`.
**Ingest is webhook-driven** (WinRed → intake → SQS → connector), and **automation is workflow** — so the HTTP
surface is **OAuth/connect + webhooks + config/health + operator resync**, no per-record public API.
**Access column:** **`-`** public/system · **`Provider-sig`** = signature-verified WinRed webhook · **`State`** =
OAuth `state`-validated callback · account ladder `USER`<`ACCOUNT` · **`Internal`** = VPC-only S2S.

| Method | URI | Purpose | Access | Req |
|---|---|---|---|---|
| POST | `/winred/connect` | Begin connect — OAuth redirect, or **validate + vault** an API key + webhook secret | ACCOUNT | winred-1.1 |
| GET | `/winred/oauth/callback` | OAuth callback — exchange, **vault** credential, register webhook | State | winred-1.1/1.3 |
| POST | `/winred/webhook` | WinRed webhook ingress — **signature-verify** → dedupe → ACK → SQS | Provider-sig | winred-2.1/2.2 |
| GET, PUT | `/winred/connections/{id}/config` | Connection config — subscribed kinds · auto-create · dry-run · CSV-poll | ACCOUNT | winred-2.3/6.4 |
| POST | `/winred/connections/{id}/resync` | Operator/account resync — **re-register webhook** (no historical backfill at launch) | ACCOUNT | winred-1.3 |
| GET | `/winred/connections/{id}/status` | Connection health — subscription · queue depth · backpressure · last donation | USER | winred-7.2 |
| GET | `/winred/health` | Liveness / readiness (intake + connector) | - | winred-8.1 |

# eof
