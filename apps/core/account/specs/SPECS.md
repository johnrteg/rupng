#
# Account
#

# Objective

The **commercial + tenancy backbone** of the platform — the system of record for **who the customer is, what
they're entitled to, and what they owe**. It owns:

* **Accounts & multi-tenancy** — account identity, status lifecycle (pending → active → suspended → closed),
  branding / whitelabel, preferences, limits, and the **`accountId`-scoped isolation** every other service keys
  off (the tenant boundary).
* **Hierarchy & the agency/reseller model** — parent ↔ sub-account (one parent each), config cascade, billing
  fold-up, and **pricing-visibility gated by hierarchy**.
* **The account↔user relationship** — the **SoT for membership, per-account role + max-role ceiling, and
  switch-eligibility** ([auth](../../auth/specs/SPECS.md) *reads* this; it never stores it).
* **Plans, pricing & entitlements** — the versioned `Feature` / `Plan` / `PriceComponent` catalog and the
  universal **`ResolvedEntitlements`** gate (`hasFeature` / `getLimit`) every service checks — the commercial
  twin of auth's RBAC.
* **Subscriptions, billing & invoicing** — effective-dated subscriptions with **price snapshots**, immutable
  invoices, coupons, metered-usage ingest, and dunning, with **Stripe as the money rail** (PCI **SAQ-A** — PAN
  never touches us).
* **The account-level block list** — global do-not-contact (phone / email) by value, checked at send time
  alongside per-contact consent.
* **Governance** — full audit on change (emitted via the shared `Application.audit()` → **[audit](../../audit/SPECS.md)**
  service), the **AUP / no-PHI acknowledgment**, and the closure → retention → erasure lifecycle.

**Boundaries:** account *owns* the relationship + commercial state; **auth** owns identity + the session / authz
runtime (and reads membership); the **channels** enforce the block list at send; the **audit** service owns the
immutable trail. **Money is authoritative in Stripe; entitlements + behavior are authoritative here.**

# Requirements
* Multi-tenant
* Account creation
* Allow child-parent account relationship for sub-account creation.. one parent per account.
* Assign user's to account and the max-role access allowed
* Allow user to switch accounts that they have access to
* **Cross-account grant settings** (the account fields behind [auth → Cross-account delegation grants](../../auth/specs/SPECS.md)):
    * **`grantable`** — is this account a valid **grantee** (may be granted access into others)? **Default
      off** (private — not discoverable in any grant picker); **set only by an `AppRole` (staff)** — curated
      enablement for vetted accounts (sending teams, the CS team, agencies).
    * **`grantableAs`** — the **role ceiling** this account may be granted as (e.g. a sending team =
      `sender`, the CS team = `support`). Staff sets the ceiling on enable; the account **may narrow within
      it**. The grant picker offers only roles ≤ this.
    * **`grantIssuanceMinRole`** — **who may issue** an outbound grant: the **minimum role** a user must hold
      to delegate this account's access to another account *at all* — or **`disabled`** (no outbound grants,
      *"if any"*). Governs *whether/by whom*, separate from the level cap (conferral ceiling). **Default
      conservative** (`account`-admin only); consent/support grants always require `account`.
    * **`maxGrantWindowDays`** — account-configurable cap on how long a grant it *issues* may last, within a
      platform hard ceiling; **default 30 (~1 month)**. Grants are always time-limited.
    * **`requireApprovalForSupportAccess`** — opt-in stricter mode: CS/staff may enter only via an active,
      account-issued (windowed) grant (break-glass excepted). Default off (standing audited support access).
    * **`parentAccess`** (sub-accounts) — how the **parent** account reaches this child: **`open`** (parent
      users have implicit standing access, capped by this account's ceiling) vs **`granted`** (parent needs an
      explicit grant from a user here). **Default `granted`**.
* Configuration: name, branding, feature flags, perferences, config, limits, etc.
* Parent configuration filters down to sub-account unless over written by sub account.  Replace or merge? (e.g. feature flags). Groupd edit from parent?
* Status: pending, active, suspended, closed, etc.
* **Acceptable Use & no-PHI acknowledgment** — the platform **prohibits PHI / regulated health data** (no BAA)
  via the **AUP / Terms**; each account records a **one-time acknowledgment** (*"no PHI / regulated health
  data without a BAA"*), **audited**. This is the **enforcement mechanism for the no-PHI / HIPAA-➖ decision**
  (not a per-save warning) — see [auth → HIPAA](../../auth/specs/SPECS.md). *(If a HIPAA-enabled tier is ever
  offered, it's a separate plan with a signed BAA + safeguards.)*
* Full audit on change: who, when, what
* Utilization
    * Track usage of entitlements (in account or metrics service?)
* Plans
    * create entitlements
    * Pricing
* Billing
    * Coupons (discounts), percent, price, limits
    * Allow for differnet payment providers (e.g. stripe) system configurable if possible.
    * Billing address, plan, payment method (CC,invoice), subscriptions, pricing
    * Invoice history
    * Sub-account fold up and itemization
    * **Agency / reseller model** — the typical sub-account case is an **agency managing client
      accounts**. The **top (agency) account owns billing** (the plan + payment provider/Stripe
      customer); usage from **all sub-accounts folds up** to it. **Sub-accounts do *not* see platform
      plan pricing** — the agency resells, optionally at a **markup**, and controls what (if anything) a
      client sees. The platform bills the **agency** at platform rates; the agency↔client billing +
      markup is the **agency's** concern (platform may optionally facilitate, later). So **pricing
      visibility is gated by hierarchy role**.
    * PCI compliant
    * Injest web-hooks on payment updates
    * Failed payment, retry schedule, grace period -> suspension
* Account-level **block list** (do-not-contact) for phone + email — global suppression by
  value, covering non-contacts. See below.

# Block list (account-level suppression)

A global do-not-contact list owned by the account, matched by **raw value** — so it blocks
sends to phone numbers and emails even when they are **not** a known contact (e.g. a STOP
reply from an unknown number). Complements the **per-contact** suppression that lives in
the contact service; the two are checked together at send time.

* Entries keyed by **normalized value**: phone (E.164) and email (lowercased).
* Per entry: **channel** (`sms` | `voice` | `email` | `all`), **source/origin** (STOP
  reply, manual, complaint, regulator/litigator, import), **reason** (why), `addedAt`,
  `addedBy`.
* Applies to **every send for the account**, regardless of whether the value matches a contact.
* **Parent blocks cascade** to sub-accounts; a sub-account may add its own but **cannot
  remove an inherited block** (mirrors the `inherit` mode used for contact custom fields).
* **Unblock is soft + fully audited** (who / when / why); import/export supported.
* **Dispatch verifies the block list AND per-contact consent/suppression before sending.**
  An inbound STOP from an unknown number is recorded here.
* **Preference — auto-promote contact opt-outs to the block list** (account config /
  preference): when a contact replies STOP / opts out, optionally copy that value into the
  account block list so the suppression is **durable** — surviving contact deletion or a
  later re-import. Default **on** (compliance-safe); accounts may disable to keep
  per-contact suppression and the global block list independent.
* GDPR nuance: a block stores minimal data (the value + reason). A forget request **never deletes the
  suppression** — it is **always retained** as the do-not-contact **and** the **audit proof that suppression
  remains enforced** (TCPA/CAN-SPAM legal-obligation basis overrides erasure). PII is purged elsewhere; the
  block-list value survives.

# Account ↔ user relationship (decided)

**Account owns the account↔user relationship** — it is the **source of truth** for **membership** (which users
belong to an account), each member's **role + max-role ceiling** within that account, and the membership
**lifecycle** (invite / add / change-role / remove). **[auth](../../auth/specs/SPECS.md) owns identity + the
session / authz runtime and *reads* this** — it never stores the relationship.

* **User–account–role management → account.** Assigning a user to an account, raising/lowering their max-role,
  and removing them are **account** operations (`account-3.1`). Auth's RBAC `Access` check resolves a user's
  **effective role from account membership** at request time.
* **Account switching → eligibility is account-owned; the session switch is auth runtime.** **Account** is the
  SoT for *which accounts a user may switch to and the role ceiling per account*; **auth** performs the actual
  **session switch** (`/auth/session/switch`) by **reading** that membership — minting a session scoped to the
  target account ≤ its ceiling. **Account decides *who may*; auth executes *the how*** (`account-3.2`).
* **Cross-account grants** follow the same split: the *settings* (`grantable` / `grantableAs` / …) are
  **account-owned** (above); the grant *runtime* (issue / redeem / expire a delegated session) is **auth**.

> **The rule:** *account owns the relationship + policy; auth owns the session mechanics + identity.* One
> authority for the access boundary (account), the other reads it (auth) — no ambiguous co-ownership.

# Model
Plan and Pricing

## The four separations (this is the whole game)
1. `Feature ≠ Price`. A Feature is a universal capability (a toggle key the whole app checks). Its price is not a property of the feature — it's a property of how a plan includes that feature. Same feature can be free in Pro, metered in Starter. Bake price into the feature and you lose that forever.
2. `Entitlement ≠ Price`. The entitlement is the technical grant (enabled? limit? counter/quota?) — what the app enforces. The price is the commercial charge. They travel together on a plan but are different concerns (the app checks entitlements; billing reads prices).
3. `Plan (template) ≠ Subscription (instance)`. A `Plan` is the catalog definition; a `Subscription` is an account's instance of it — with effective dates, coupons, and a price snapshot. This separation is what makes invoicing + audit correct (below).
4. `Public Plan vs Private Plan` is just a flag. Enterprise pricing isn't a special system — it's a Plan with visibility=private scoped to an accountId. Same model.


## The lean core model — ✅ migrated to code
> **Migrated.** The concrete object + field definitions now live in **`@repo/api` → `Billing`**
> ([`packages/api/src/account/Billing.ts`](../../../../packages/api/src/account/Billing.ts)) as the shared
> contract — don't re-declare them here. Migrated: `Feature`, `Plan` (+ `PlanVisibility`/`PlanStatus`),
> `PlanFeature`, `Entitlement`/`Limit`, the `PriceComponent` union (+ `PriceType`/`TierMode`/`PriceTier`),
> `Subscription` (+ `PriceSnapshot`/`SubscriptionStatus`), `Coupon` (+ `CouponType`/`CouponScope`/
> `PriceOverride`/`AppliedCoupon`), `UsageRecord`, `Invoice` (+ `InvoiceLineItem`/`InvoiceStatus`),
> `AuditEvent`, and `ResolvedEntitlements`/`ResolvedFeature`. The sections below remain as **design
> rationale** (the *why*), not field definitions.

## One abstraction covers all your charge types: PriceComponent
Rather than separate models per charge type, make `PriceComponent` a typed union with parameters:

* one_time (setup/activation fee)
* recurring (flat subscription — interval, amount)
* usage (metered — per-unit rate, needs a counter)
* pool_overage (included allowance + overage rate — your "rate pools + counters": e.g. 10k messages included, $X/each over)
* tiered (graduated volume pricing)
* fee (one-time or usage-triggered)

A `PlanFeature` can have multiple components (e.g., a recurring base and usage overage). This one extensible abstraction handles "price varies by feature" without N bespoke pricing models — and it maps cleanly onto Stripe's price types (below).

## Coupons = modifiers on the subscription, applied at invoice time
A Coupon carries: type (%off / fixed / feature-price-override), scope (whole plan / specific feature / specific component), value, time window, redemption limits. It attaches to a subscription (the account-plan relationship) and is applied during invoice computation — it never mutates the plan. So "override pricing for this account" is a coupon (or a private plan), not a plan edit.

## The key to "invoice properly + audit disputes": version + snapshot, never mutate
This is the principle that makes billing correct:

* Plans/prices are versioned; nothing billing-relevant is edited in place. `A price change creates a new version`.
* The Subscription snapshots the agreed pricing at subscribe (or change) time. Invoices compute from the snapshot + metered usage for the period + applied coupons — not from the live catalog (which may have changed since).
* Invoices are immutable and reference the exact inputs (snapshot version, usage figures, coupons applied).

Now a dispute is fully reconstructable: "on date X you were on Plan P v3, coupon C active, usage U, computed as these line items." That single discipline — effective-date + snapshot everything — is what gets billing audit right.

## Entitlements drive the app (and the "upgrade now" button)
The app never asks about plans directly — it asks the resolved entitlement: hasFeature(account, featureKey) / getLimit(account, featureKey), resolved from the account's active subscription → plan entitlements (+ coupon overrides). Make this a shared check, exactly like the RBAC Access library — one universal feature gate used across all services.

For "upgrade now": the catalog must support reverse lookup — "which plan(s) grant featureKey / a higher limit?" So when the app hits a disabled feature or a reached limit, the entitlement check returns not just deny but what would grant it, and the UI renders the CTA pointing at that plan. Design the entitlement check to answer both.

## Metering feeds in; billing only reads aggregates
Usage/pool pricing needs counters — but don't put metering inside the billing model. Services emit usage events → the metering store (the same per-account counters from the dispatch/analytics discussions) → billing reads aggregated usage at invoice time. `Keep them decoupled`: metering is high-volume operational; billing is periodic computation.

`Plan` → `Stripe Product`
`PriceComponent` → `Stripe Price` (their types align with your union)
`Subscription` → `Stripe Subscription`
`Coupon` → `Stripe Coupon/Promotion`
`usage` → `Stripe metered usage`.

Your model is authoritative for app behavior (entitlements/toggles); Stripe is authoritative for money (invoices/proration/tax/dunning). Audit = your snapshot/decision log + Stripe's invoice/payment history.


Q Where should metering reside?  Per service?

# Compliance & standards mapping

How **this account service's** surfaces map to **OWASP Top 10 (2021)**, **ISO/IEC 27001:2022** (Annex A),
**SOC 2 Type 2** (TSC), **PCI-DSS v4.0**, **HIPAA** (Security Rule, if PHI), **GDPR**, and **CCPA/CPRA**. Clause
refs are **indicative**; this is
a **design-intent** self-assessment (certification is operating-effectiveness over time + an ISMS / a QSA/SAQ
for PCI — beyond a spec). Identity/authn + the cross-account **grant runtime** live in
[auth](../../auth/specs/SPECS.md) (this service owns the **grant *settings***); data-residency / no-cross-region is
the platform [AWS topology](../../../../packages/services/src/aws/SPECS.md). **PCI scope is deliberately
narrow** — only the **payment surface** is in scope; **tokenization (Stripe Elements / SAQ-A) keeps PAN out
of our systems**, so most rows are ➖ for PCI by design (see Gaps). **HIPAA applies only if the platform
handles PHI** (a healthcare customer) and needs a **BAA** — account holds billing/tenant data, little/no PHI,
so most HIPAA cells are ➖; see Gaps.

**Legend:** ✅ meets/exceeds · ⚠️ partial — see Gaps · ➖ n/a

| Account surface / control | OWASP T10 | ISO 27001:2022 | SOC 2 (TSC) | PCI-DSS v4.0 | HIPAA (if PHI) | GDPR | CCPA | |
|---|---|---|---|---|---|---|---|---|
| **Multi-tenant isolation** — **`accountId`-scoped on every layer** (endpoint · DDB partition + GSI · S3 per-account prefix · cache key); siblings/sub-accounts isolated (parent via `parentAccess` only) | A01 | A.5.15 / A.8.3 | CC6.1 / CC6.3 | ➖ (no CDE) | §164.312(a)(1) | Art 32 | ➖ | ✅ |
| **Per-account role ceiling** (max-role assigned per account) | A01 | A.5.15 | CC6.3 | ➖ | §164.308(a)(4) | Art 32 | ➖ | ✅ (enforced via auth) |
| **Parent→child access** (`parentAccess` open\|granted, default granted) | A01 | A.5.18 | CC6.3 | ➖ | §164.308(a)(4) | Art 32 | ➖ | ✅ |
| **Cross-account grant settings** (`grantable` staff-only, `grantableAs`, issuance min-role, window cap) | A01 / A04 | A.5.18 | CC6.2 / CC6.3 | ➖ | §164.308(a)(4) | Art 32 | ➖ | ✅ |
| **Pricing-visibility gated by hierarchy** (sub-accounts don't see platform pricing) | A01 / A04 | A.8.12 | CC6.3 | ➖ | ➖ | ➖ | ➖ | ✅ · ⚠️ enforce at read-model |
| **Full audit on change** (who / when / what) | A09 | A.8.15 | CC7.2 | Req 10 (if CDE) | §164.312(b) | Art 5(2) | ➖ | ⚠️ adopt hashed-immutable audit |
| **Immutable, versioned invoices + price snapshots** (disputes reconstructable) | A08 | A.8.15 | CC7.1 **Processing Integrity** | ➖ | ➖ | ➖ | ➖ | ✅ exceeds |
| **Versioned plans / coupons** — never mutate in place | A08 | A.8.32 | CC8.1 | ➖ | ➖ | ➖ | ➖ | ✅ |
| **Payment / card data** — Stripe-vaulted; store only ref + last4 + brand | A02 | A.8.24 | CC6.1 | **Req 3 / 4** (SAQ-A) | ➖ | Art 32 | §1798.81.5 | ✅ decided |
| **Payment webhook ingestion** — signature + idempotency + reconcile | A08 / A01 | A.8.24 / A.8.26 | CC6.1 / CC7.2 | **Req 6.4** | ➖ | Art 32 | ➖ | ✅ decided |
| **Third-party payment processor** (Stripe = processor / sub-processor) | ➖ | A.5.19 / A.5.20 / A.5.23 | CC9.2 | **Req 12.8** (TPSP) | §164.308(b) (BAA, if PHI) | Art 28 | §1798.140 | ✅ Stripe + controls · ⚠️ DPA / EU-region verify (legal — RUNBOOK) |
| **Block list** (do-not-contact phone/email; durable, audited unblock; **suppression always retained as enforcement proof**) | A01 | A.5.34 / A.8.15 | CC7.2 | ➖ | §164.502(b) (min necessary) | Art 5 / 17 / 21 | §1798.120 | ✅ |
| **Account closure / suspension lifecycle** — prod: **retain 1 y → purge PII +3 mo** (configurable); tombstone keeps financial (~7 y) + opt-out proof | ➖ | A.5.34 / A.8.10 | (Privacy) | ➖ | §164.316(b) (retention) | Art 17 / 5(1)(e) | §1798.105 | ✅ |
| **Per-account config / feature flags** (toggled by support, audited) | A01 / A09 | A.8.9 / A.8.15 | CC8.1 | ➖ | ➖ | ➖ | ➖ | ✅ |

## Gaps to address

✅ = resolved/decided · ⚠️ = **open — needs your decision**.

* ✅ **Account ↔ user ownership — DECIDED: account owns the relationship.** Membership, role + max-role, and
  **switch-eligibility** are **account-owned** (the SoT); **auth** owns identity + the session / authz runtime and
  **reads** membership (`/auth/session/switch` reads it; RBAC resolves effective role from it). Resolves the two
  former open questions — see *Account ↔ user relationship* (`account-3.1` / `3.2`).
* ✅ **Tenant isolation mechanism — DECIDED: `accountId`-scoped on every layer.**
  * **Every endpoint carries / derives an `accountId`** — a request is always bound to one account (the acting
    account from the session; auth supplies it). No account-data endpoint runs unscoped.
  * **Every account-specific record carries `accountId`** — it is the **DynamoDB partition key** (or its leading
    component), and **every query + GSI is partitioned by it**, so one account's items are never in another's
    read path.
  * **S3 is isolated by `accountId`** — objects live under a **per-account prefix** (`{accountId}/…`), enforced by
    IAM key scoping; no cross-account object path. **Cache keys are `accountId`-prefixed** the same way.
  * **Sub-accounts** are just distinct `accountId`s — a parent reaches a child **only** via `parentAccess`
    (open/granted), never by raw query, so the hierarchy can't leak data sideways.
  A request scoped to account A therefore **cannot** read account B's data at the query, index, object, or cache
  layer — ownership of the boundary is account's (above), and this is the enforcement (`account-1.2`).
* ✅ **Immutable + tamper-evident audit — DECIDED: emit via `Application.audit()` → audit service.** Account does
  **not** build its own audit store. All account / billing / role / grant-setting changes are emitted through the
  shared **`Application.audit()`** base method, which **sends the event over SQS to the central
  [audit](../../audit/SPECS.md) service** — and **that service owns immutability + tamper-evidence**
  (append-only / WORM / verify-on-read). Account's job is only to **emit** (PII-light); the immutable store is the
  audit service's concern (`account-12.1` / `12.2`).
* ✅ **PCI-DSS v4.0 scope (billing)** — **decided** — **SAQ-A** posture: Stripe Elements/Checkout, **PAN never
  in our systems**, store only the **Stripe `externalRef` + last4 + card brand** (+ optional exp for display).
  See [PRICING → Payment-method & card-data storage](PRICING.md#payment-method--card-data-storage-decided).
  Residuals: Req 6.4 (below, decided), Req 12.8 (TPSP, below), Req 10 only if a CDE appears. **Remaining:**
  complete the SAQ-A attestation.
* ✅ **Payment-webhook integrity** *(OWASP A08 · ISO A.8.24 · PCI Req 6.4)* — **decided** — `Stripe-Signature`
  verification + replay window + **idempotent** dedupe by event id + order-independent reconcile + ack-async +
  reconciliation sweep. See [PRICING → Webhook strategy](PRICING.md#webhook-strategy--security--reliability-decided).
* ✅ **Processor / sub-processor governance — DECIDED (Stripe); verification = legal/procurement task.** Stripe
  is the payment **processor**, and the **technical** controls are in place — PAN never stored (ref + last4 +
  brand only, **SAQ-A**) + signature-verified webhooks. The **governance verification** — execute the **DPA**,
  add Stripe to the maintained **sub-processor register**, run a **vendor security review**, and **confirm
  Stripe's data region honors the EU-account residency** rule (US *and* EU) — is **not yet done**; it's a
  **legal / procurement process** (not code), tracked in
  [RUNBOOK → vendor / sub-processor governance](../../../../docs/RUNBOOK.md).
* ✅ **Account-closure data lifecycle — DECIDED (configurable; prod defaults).** On `closed`: **retain the
  account 1 year** (prod default — **configurable** per env/policy; recoverable + available for disputes), then
  **purge account PII 3 months after** that (~15 mo post-closure) as a **redacted tombstone** (mirrors the
  [auth](../../auth/specs/SPECS.md) / contact pattern): erase billing address + contact-of-record PII, but
  **retain** financial / invoice records (~7 yrs — legal/tax) + the block-list **opt-out proof** + the opaque
  `accountId` shell (so historical references stay intact). Runs via `AccountErasureJob` (`account-1.6` / `12.4`).
* ✅ **Block-list erasure vs opt-out proof — DECIDED: suppression is ALWAYS retained.** A forget / erasure
  request **never deletes a block-list entry** — the suppression (value + reason + source) is **kept
  permanently** as the durable do-not-contact **and** the **audit proof that suppression is still enforced**
  (TCPA / CAN-SPAM **legal-obligation** basis overrides the right to erasure). PII may be purged *elsewhere*
  (contact / account), but the block-list value **survives** so a forgotten or re-imported contact can't be
  re-contacted — **by design + disclosed** (`account-11.7`).
* ✅ **HIPAA / PHI — DECIDED: no PHI** *(45 CFR §164.308/.312)* — the platform **does not support PHI** (no
  BAA); prohibited by the **AUP/Terms** + a **one-time account acknowledgment** (see *Acceptable Use & no-PHI
  acknowledgment* above). HIPAA stays **➖** across the table — there's no PHI to protect. Revisit only if a
  **HIPAA-enabled tier** is pursued.

# Service & Job topology

**Convention (platform-wide).** Each service layers **framework base → domain base → concrete role** on both the
HTTP and worker sides. A **domain Service base** (`AccountService extends Service`) and a **domain Job base**
(`AccountJob extends Job`) hold the **shared domain code** — repository / DAO over the tables, the
**tenancy guard**, the **membership / role** model, the **entitlement resolver** (`ResolvedEntitlements`), the
**Stripe / payment-provider** adapter (factory), the **change-history diff writer**, and the **audit emitter** —
so **every concrete role inherits it**. Concrete **roles extend the domain base, never the framework base
directly.** Assume specialized roles **will** appear (the entitlements gate + block-list check are hot,
send-path reads), so the base exists from day one.

```
Application
├── Service (Fastify, long-running — ECS)
│     └── AccountService            (domain base — repo · tenancy · membership/role · entitlement resolver · Stripe adapter · change-history · audit; not deployed alone)
│           ├── AccountMainService  (full /account/* API · hierarchy · members/roles · plans · subscriptions · invoices · billing methods · block-list admin · inbound Stripe webhook receiver)
│           └── AccountReadService  (hot send-path reads: the ENTITLEMENTS gate + the BLOCK-LIST check — scales independently, read-only)
└── Job (Lambda, event-driven)
      └── AccountJob                (domain base — Stripe adapter · idempotency · WorkQueue/DLQ · change-history · audit)
            ├── AccountBillingJob   (SQS — process Stripe webhook events off the HTTP path: dedupe · order-independent reconcile · DLQ + sweep)
            ├── AccountInvoiceJob   (EventBridge — period-close invoice compute from snapshot+usage+coupons; usage↔Stripe reconciliation drift)
            ├── AccountDunningJob   (EventBridge — failed-payment state machine: retry → grace → suspend; triggers billing notices)
            ├── AccountUsageJob     (SQS/stream — aggregate UsageRecords into the per-period counters billing reads; metering stays decoupled)
            ├── AccountErasureJob   (SQS — account-closure tombstone: purge account PII, RETAIN financial records ~7y + block-list opt-out proof)
            └── AccountStreamJob    (DDB Streams — emit account.* / entitlement-change events to Kafka + write change-history diff + emit audit)
```

**Services (HTTP, ECS Fargate)**

| Class | Extends | Role |
|---|---|---|
| **`AccountService`** | `Service` | **Domain base** — shared repo / tenancy guard / membership-role model / **entitlement resolver** / **Stripe adapter** / change-history / audit; **not deployed alone** (health-only if instantiated). |
| **`AccountMainService`** | `AccountService` | The primary service — full **read/write** `/account/*` (accounts, hierarchy, **members/roles**, plans, subscriptions, invoices, billing methods, block-list admin, audit, config) **+ the inbound Stripe webhook receiver** (`POST /account/billing/webhook` — signature-verify, **ack-fast → enqueue**). |
| **`AccountReadService`** | `AccountService` | **Read-optimized**, **hot send-path** role — the **entitlements gate** (`/account/internal/{id}/entitlements`, the universal `hasFeature`/`getLimit` called by **every** service) + the **block-list check** (`/account/internal/block-list/check`, called by **dispatch before every send**); **scales independently** on **read-only** data access. |

**Jobs (Lambda, event-driven)** — each extends `AccountJob`:

| Class | Trigger | Role | Req |
|---|---|---|---|
| **`AccountBillingJob`** | SQS (from the webhook receiver) | Process Stripe events **off the HTTP path** — **idempotent** dedupe by event id, **order-independent reconcile** (paid / payment_failed / sub.updated/deleted / finalized), DLQ + **reconciliation sweep** | account-9.2/9.4/9.5 |
| **`AccountInvoiceJob`** | EventBridge (period close) | **Compute invoices** from `PriceSnapshot` + metered usage + applied coupons (the we-compute / enterprise path); **usage↔Stripe reconciliation** drift check | account-6.4 / 7.4 |
| **`AccountDunningJob`** | EventBridge (scheduled) | Advance the **failed-payment state machine** — retry schedule → grace period → **suspension**; trigger billing notices (via email/SES) | account-10.2 |
| **`AccountUsageJob`** | SQS / stream | **Aggregate** ingested `UsageRecord`s into the per-period counters billing reads — keeps high-volume metering **decoupled** from periodic billing | account-7.1/7.2/7.3 |
| **`AccountErasureJob`** | SQS / scheduled (prod: retain 1y → purge +3mo) | Closure **tombstone** — purge account PII (billing address, contact-of-record), **RETAIN** financial records (~7y) + block-list **opt-out proof** (TCPA/CAN-SPAM) + `accountId` shell | account-1.6 / 11.7 / 12.4 |
| **`AccountStreamJob`** | **DynamoDB Streams** | CDC bridge — emit **`account.*` / entitlement-change** events to Kafka (entitlement-cache invalidation + downstream services), **write the field-level change-history diff**, and **emit audit** events | account-12.1 / 13.3 |

> **Shared modules (not deployables).** The **Stripe / payment-provider adapter** (the money rail, behind the
> account-8 provider factory) is reused by `AccountMainService` (SetupIntents, billing portal), `AccountBillingJob`
> (reconcile), `AccountInvoiceJob` (push/compute), and `AccountDunningJob` — one implementation, many callers. The
> **`EntitlementResolver`** (the `ResolvedEntitlements` `hasFeature`/`getLimit` gate) is the shared lib behind
> `AccountReadService` + `AccountMainService`. **Block-list auto-promote** (contact opt-out → block list,
> `account-11.6`) is a **Kafka-consumer handler** (consumes contact opt-out events) — folded into a consumer, not
> a separate deployable until volume warrants. Change-history + audit ride the shared `Application` mechanisms.

# AWS Services and Other Dependencies

**AWS services**
* **DynamoDB** — accounts, plans, subscriptions, entitlements, the block-list, audit.
* **KMS** — encryption at rest / envelope keys.
* **Secrets Manager** — Stripe API keys + webhook signing secret.
* **EventBridge** — plan / subscription lifecycle events.
* **SQS / SNS** — async events + notifications.

**Third-party libraries / services**
* **Stripe** — billing system of record (Products / Prices / Subscriptions / Coupons / metered usage); **Elements / Checkout** for PCI **SAQ-A** (PAN never touches us); signature-verified webhooks. Processor / sub-processor → **DPA**.

**Internal (`@repo/*`)**
* `@repo/services` (AppConfig, Dynamo, Kms, Secrets), `@repo/endpoint` (`Access`), `@repo/common` (`Type`). Identity/authn runtime → [auth](../../auth/specs/SPECS.md).

# Requirements (traceable register)

The authoritative, traceable requirement register for the **account service** — covering account management
*and* the plans/pricing/billing model in [PRICING.md](PRICING.md). (The narrative `# Requirements` section at
the top + PRICING.md remain the design rationale; this is the coded list.) IDs are stable handles
(**`account-N.M`**) — cite them in code, tickets, and tests. **Priority:** **A** = MVP (ship first), **B** =
core hardening / common features, **C** = advanced / later-phase. One level of sub-requirements only; a
group's priority is its floor. **Identity/authn + the grant *runtime* live in [auth](../../auth/specs/SPECS.md)**;
this service **owns the account↔user relationship** (membership + roles + switch-eligibility) **+ grant
*settings*** — auth *reads* them.

## account-1.0 Accounts & multi-tenancy — A
- **account-1.1** Account create / read / update — A
- **account-1.2** Multi-tenant isolation — **`accountId`-scoped on every layer**: every endpoint carries/derives `accountId`; every account record has `accountId` (DDB partition key + GSI partition); **S3 per-account prefix** (`{accountId}/…`) + `accountId`-prefixed cache keys; sub-accounts are distinct `accountId`s (parent reaches child only via `parentAccess`) — A
- **account-1.3** Status lifecycle (pending / active / suspended / closed) — A
- **account-1.4** Configuration: name, branding/whitelabel, preferences, limits — A
- **account-1.5** Feature flags (platform + per-account, support-toggled) — B
- **account-1.6** Account-closure data lifecycle — **configurable; prod default: retain 1 year → purge PII 3 months after** (~15 mo); redacted tombstone keeps financial records (~7 y) + opt-out proof + `accountId` shell — B

## account-2.0 Hierarchy & sub-accounts — B
- **account-2.1** Parent–child relationship (one parent per account) — B
- **account-2.2** Config cascade parent→child (replace vs merge) — B
- **account-2.3** `parentAccess` (open | granted) — B
- **account-2.4** Group edit from parent — C

## account-3.0 Members, roles & access — account OWNS the account↔user relationship — A
- **account-3.1** **Own the account↔user membership** — SoT for which users belong to an account, their **role + max-role ceiling**, and the lifecycle (invite / add / change-role / remove); **auth reads** it for RBAC — A
- **account-3.2** **Switch eligibility is account-owned** — account is SoT for which accounts a user may switch to + the per-account ceiling; **auth runs** the session switch (`/auth/session/switch`) by reading it (≤ ceiling) — A
- **account-3.3** Cross-account grant **settings** (`grantable`/`grantableAs`/`grantIssuanceMinRole`/`maxGrantWindowDays`/`requireApprovalForSupportAccess`) — account-owned; the grant *runtime* = auth — B

## account-4.0 Feature catalog & entitlements — A
- **account-4.1** `Feature` — capability key, no price — A
- **account-4.2** `PlanFeature` — entitlement + prices join — A
- **account-4.3** `Entitlement` + `Limit` (included / period / `hardCap`) — A
- **account-4.4** `ResolvedEntitlements` — the universal `hasFeature`/`getLimit` gate — A
- **account-4.5** Upgrade hint (reverse lookup → "Upgrade now" CTA) — B

## account-5.0 Plans & pricing catalog — A
- **account-5.1** `Plan` — versioned, public/private, `DRAFT→ACTIVE→RETIRED` — A
- **account-5.2** `PriceComponent` union (ONE_TIME/RECURRING/USAGE/POOL_OVERAGE/TIERED/FEE) — A
- **account-5.3** Never mutate a published plan version (new version on change) — A
- **account-5.4** Private/enterprise plan (visibility + `accountId`) — B
- **account-5.5** Coupons (`PERCENT_OFF`/`AMOUNT_OFF`/`PRICE_OVERRIDE`, scope, window, limits) — B

## account-6.0 Subscriptions & invoicing — A
- **account-6.1** `Subscription` (account ↔ plan+version, status, period) — A
- **account-6.2** `PriceSnapshot` — freeze terms at subscribe/change — A
- **account-6.3** Plan change → new snapshot; history preserved — B
- **account-6.4** Immutable `Invoice` (line items + `snapshotRef`/`usageRefs`/`appliedCoupons`) — A
- **account-6.5** Coupon applied at invoice time (`AppliedCoupon` who/when) — B
- **account-6.6** Discount / `PRICE_OVERRIDE` authorization — who may discount (+ maker-checker for enterprise) — B

## account-7.0 Usage & metering — B
- **account-7.1** Ingest `UsageRecord` aggregates from services — B
- **account-7.2** Billing reads aggregates only (metering stays decoupled) — B
- **account-7.3** Usage→invoice idempotency (keys on `(item, period, metric)`) — B
- **account-7.4** Periodic usage ↔ Stripe reconciliation (drift check) — C

## account-8.0 Payments (Stripe) & PCI — A
- **account-8.1** Stripe as the money rail; `externalRef` on every billable thing — A
- **account-8.2** Card data never stored — only **ref + last4 + brand** (PCI **SAQ-A**) — A
- **account-8.3** Stripe object mapping (Product/Price/Subscription/Customer/Invoice/Coupon) — A
- **account-8.4** Invoice strategy: Stripe-generated (standard) vs we-compute (enterprise) — B
- **account-8.5** TPSP/DPA governance + EU-region residency confirmation — B
- **account-8.6** Stripe Tax (optional) — C

## account-9.0 Stripe webhooks & sync — A
- **account-9.1** `Stripe-Signature` verification (endpoint secret) — A
- **account-9.2** Idempotent processing (dedupe by event id) — A
- **account-9.3** Replay window + order-independent reconcile — B
- **account-9.4** Event→model reconciliation (paid / payment_failed / sub.updated/deleted / finalized) — A
- **account-9.5** Ack-fast / work-async (`WorkQueue` + DLQ) + reconciliation sweep — B
- **account-9.6** `AuditEvent` on every reconciliation — A

## account-10.0 Billing operations & agency/reseller — B
- **account-10.1** Billing address, payment-method display, invoice history — B
- **account-10.2** Failed-payment retry schedule → grace period → suspension — B
- **account-10.3** Sub-account fold-up + itemization — B
- **account-10.4** Agency/reseller — top account owns billing; pricing visibility gated by hierarchy — B
- **account-10.5** Coupon/discount admin surface — B

## account-11.0 Block list (do-not-contact) — A
- **account-11.1** Global suppression by normalized value (phone E.164 / email) — A
- **account-11.2** Per entry: channel / source / reason / addedBy — A
- **account-11.3** Dispatch checks block list + per-contact consent before send — A
- **account-11.4** Parent blocks cascade; sub-account can't remove an inherited block — B
- **account-11.5** Soft + audited unblock; import / export — B
- **account-11.6** Auto-promote contact opt-outs to the block list (config) — B
- **account-11.7** **Suppression always retained** — a forget **never deletes** a block-list entry; value + reason + source kept **permanently** as do-not-contact + **audit proof of enforcement** (TCPA/CAN-SPAM legal-obligation basis overrides erasure) — B

## account-12.0 Audit, privacy & compliance — A
- **account-12.1** **Emit `AuditEvent` via shared `Application.audit()`** on every account/billing/role/grant change → **SQS → [audit](../../audit/SPECS.md)** service (PII-light) — A
- **account-12.2** **Immutability lives in the audit service** (append-only / WORM / verify-on-read) — account does **not** build its own audit store — B
- **account-12.3** Pricing-data leakage prevention (enforce at the read model) — B
- **account-12.4** Financial-records retention (~7 yrs) reconciled with erasure — B

## account-13.0 Infra footprint & dependencies — A
- **account-13.1** DynamoDB: accounts, memberships, plans/features, subscriptions, invoices, usage, block_list, audit, processed_webhook_events — A
- **account-13.2** Stripe (catalog mirror + webhooks) via `externalRef` — A
- **account-13.3** Kafka (entitlement/account change events) + SES (billing notices) — B
- **account-13.4** `WorkQueue` for webhook + billing jobs — B

## account-14.0 Service & Job topology — B
- **account-14.1** **Domain bases** — `AccountService extends Service` + `AccountJob extends Job` hold the shared domain code (repo · tenancy guard · membership/role model · entitlement resolver · Stripe adapter · change-history · audit); **concrete roles extend the domain base, not the framework base** — B
- **account-14.2** **`AccountMainService`** — full read/write `/account/*` API + inbound Stripe webhook receiver (ack-fast → enqueue) — A
- **account-14.3** **`AccountReadService`** — read-optimized **hot send-path** role (the **entitlements gate** + the **block-list check**); **scales independently** on read-only access — B
- **account-14.4** **Jobs extend `AccountJob`** — `AccountBillingJob` / `AccountInvoiceJob` / `AccountDunningJob` / `AccountUsageJob` / `AccountErasureJob` / `AccountStreamJob`, each a Lambda on the shared base — A
- **account-14.5** **`AccountStreamJob` (DDB Streams)** — emit `account.*` / entitlement-change events to Kafka **and** write the field-level **change-history** diff + emit **audit** events — A
- **account-14.6** **Shared modules** — the **Stripe/payment-provider adapter** (factory) + the **`EntitlementResolver`** are reused across services + jobs (not deployables); block-list auto-promote (`account-11.6`) is a Kafka-consumer handler — B

# Endpoints (first cut)

A first pass at the endpoint surface implied by the requirements above, in
[`@repo/endpoint`](../../../../packages/endpoint/SPECS.md) style. **Conventions:** every path is
service-prefixed **`/account/*`**; collections/items + actions follow the
[REST patterns](../../../../packages/endpoint/SPECS.md#method--path-patterns--standard-rest); list endpoints
return the `{ data, page }` paged envelope with query-string filters; exports/PDF return a **presigned URL or
redirect**, never bytes.

**Access column:** the recommended **`minAccess`** on the `Access` ladder — **`-`** = public · account ladder
**`SENDER`<`USER`<`BILLING`<`ACCOUNT`** · staff ladder **`SUPPORT`<`APPLICATION`<`ROOT`** · **`⬆`** = also
requires **step-up** · **`Internal`** = VPC-only S2S · **`Stripe-sig`** = authenticated by the Stripe webhook
signature (not a user role). A senior role satisfies any junior minimum.

> Boundaries: **identity/authn + the grant *runtime* live in [auth](../../auth/specs/SPECS.md)**;
> **account-switching** is `auth`'s `/auth/session/switch` (auth *reads* membership). This service owns
> **membership/role *assignment*, plans, billing, entitlements, and the block list**. **Card data is never
> stored** — payment-method endpoints return only `ref + last4 + brand`; capture is via Stripe Elements
> (a `SetupIntent` client secret). These are APP/INTERNAL shapes; the published API is the `/v1/...` facade.

### Accounts & configuration (account-1)
| Method | URI | Purpose | Access | Req |
|---|---|---|---|---|
| POST | `/account` | Create an account (top-level: staff; sub-account: admin) | ACCOUNT ⬆ | account-1.1 |
| GET | `/account` | List accounts I can see (mine / children) | USER | account-1.1 |
| GET | `/account/{id}` | Get one account | USER | account-1.1 |
| PATCH | `/account/{id}` | Update name / branding / preferences / limits | ACCOUNT | account-1.4 |
| PATCH | `/account/{id}/status` | Change status (suspend / close / reactivate) | ACCOUNT ⬆ | account-1.3 |
| GET | `/account/{id}/config` | Resolved config / branding / limits | USER | account-1.4 |
| GET, PUT | `/account/{id}/feature-flags` | Per-account feature flags (support-toggled) | ACCOUNT ⬆ | account-1.5 |
| POST | `/account/{id}/erasure` | Close + erase account PII (app/root, audited) | APPLICATION ⬆ | account-1.6/12.4 |

### Hierarchy & sub-accounts (account-2)
| Method | URI | Purpose | Access | Req |
|---|---|---|---|---|
| GET | `/account/{id}/children` | List sub-accounts | USER | account-2.1 |
| POST | `/account/{id}/children` | Create a sub-account | ACCOUNT ⬆ | account-2.1 |
| GET, PUT | `/account/{id}/parent-access` | `parentAccess` (open \| granted) setting | ACCOUNT ⬆ | account-2.3 |

### Members, roles & grant settings (account-3)
| Method | URI | Purpose | Access | Req |
|---|---|---|---|---|
| GET | `/account/{id}/members` | List members + roles + max-role | ACCOUNT | account-3.1 |
| POST | `/account/{id}/members` | Add/invite a user with a max-role | ACCOUNT ⬆ | account-3.1 |
| PATCH | `/account/{id}/members/{userId}` | Change a member's roles / max-role | ACCOUNT ⬆ | account-3.1 |
| DELETE | `/account/{id}/members/{userId}` | Remove a member | ACCOUNT ⬆ | account-3.1 |
| GET, PUT | `/account/{id}/grant-settings` | Cross-account grant settings (`grantable`/`grantableAs`/…) | ACCOUNT ⬆ | account-3.3 |

### Feature catalog & entitlements (account-4)
| Method | URI | Purpose | Access | Req |
|---|---|---|---|---|
| GET | `/account/features` | List the feature catalog | USER | account-4.1 |
| POST | `/account/features` | Create a feature (staff) | APPLICATION ⬆ | account-4.1 |
| GET | `/account/entitlements` | `ResolvedEntitlements` for my current account (the gate) | USER | account-4.4 |
| GET | `/account/{id}/entitlements` | Resolved entitlements for an account | USER | account-4.4 |
| GET | `/account/internal/{id}/entitlements` | S2S entitlement resolve (shared gate, cached) | Internal | account-4.4 |

### Plans & pricing catalog (account-5)
| Method | URI | Purpose | Access | Req |
|---|---|---|---|---|
| GET | `/account/plans` | List plans (public catalog; private if entitled) | USER | account-5.1 |
| POST | `/account/plans` | Create a plan (staff) | APPLICATION ⬆ | account-5.1 |
| GET | `/account/plans/{id}` | One plan (+ current version) | USER | account-5.1 |
| POST | `/account/plans/{id}/versions` | Publish a new plan version (never mutate published) | APPLICATION ⬆ | account-5.3 |
| PATCH | `/account/plans/{id}/status` | `DRAFT → ACTIVE → RETIRED` | APPLICATION ⬆ | account-5.1 |
| GET | `/account/coupons` | List coupons | ACCOUNT | account-5.5 |
| POST | `/account/coupons` | Create a coupon (incl. `PRICE_OVERRIDE`) | APPLICATION ⬆ | account-5.5/6.6 |
| DELETE | `/account/coupons/{id}` | Retire a coupon | APPLICATION ⬆ | account-5.5 |

### Subscriptions & invoicing (account-6)
| Method | URI | Purpose | Access | Req |
|---|---|---|---|---|
| GET | `/account/{id}/subscription` | Current subscription (+ `PriceSnapshot`) | BILLING | account-6.1 |
| POST | `/account/{id}/subscription` | Subscribe to a plan (freeze the snapshot) | BILLING ⬆ | account-6.1/6.2 |
| PATCH | `/account/{id}/subscription` | Change plan (new snapshot; history preserved) | BILLING ⬆ | account-6.3 |
| DELETE | `/account/{id}/subscription` | Cancel the subscription | BILLING ⬆ | account-6.1 |
| POST | `/account/{id}/subscription/coupons` | Apply a coupon (`AppliedCoupon`) | BILLING ⬆ | account-6.5/6.6 |
| DELETE | `/account/{id}/subscription/coupons/{couponId}` | Remove an applied coupon | BILLING ⬆ | account-6.5 |
| GET | `/account/{id}/invoices` | Invoice history | BILLING | account-6.4/10.1 |
| GET | `/account/{id}/invoices/{invoiceId}` | One invoice (line items + refs) | BILLING | account-6.4 |
| GET | `/account/{id}/invoices/{invoiceId}/pdf` | Invoice PDF (redirect to Stripe/presigned) | BILLING | account-10.1 |

### Usage & metering (account-7)
| Method | URI | Purpose | Access | Req |
|---|---|---|---|---|
| GET | `/account/{id}/usage` | Usage for the current period (per metric) | USER | account-7.1 |
| POST | `/account/internal/usage` | S2S ingest of `UsageRecord` aggregates from services | Internal | account-7.1 |

### Payments & billing methods (account-8, account-10)
| Method | URI | Purpose | Access | Req |
|---|---|---|---|---|
| GET | `/account/{id}/billing` | Billing summary (address, default method `last4`/`brand`, status) | BILLING | account-10.1 |
| PUT | `/account/{id}/billing/address` | Update the billing address | BILLING ⬆ | account-10.1 |
| GET | `/account/{id}/billing/payment-methods` | List methods (ref + last4 + brand only) | BILLING | account-8.2 |
| POST | `/account/{id}/billing/payment-methods/setup` | Start a Stripe `SetupIntent` (client secret for Elements) | BILLING ⬆ | account-8.2 |
| DELETE | `/account/{id}/billing/payment-methods/{pmId}` | Remove a payment method | BILLING ⬆ | account-8.2 |
| POST | `/account/{id}/billing/portal` | Create a Stripe Billing Portal session (redirect) | BILLING | account-10.1 |

### Stripe webhooks (account-9)
| Method | URI | Purpose | Access | Req |
|---|---|---|---|---|
| POST | `/account/billing/webhook` | Stripe webhook receiver — signature-verified, idempotent, async reconcile | Stripe-sig | account-9.1/9.2/9.4 |

### Block list — do-not-contact (account-11)
| Method | URI | Purpose | Access | Req |
|---|---|---|---|---|
| GET | `/account/{id}/block-list` | List suppressions (filters) | USER | account-11.1 |
| POST | `/account/{id}/block-list` | Add a suppression (value / channel / source / reason) | USER | account-11.1 |
| DELETE | `/account/{id}/block-list/{entryId}` | Soft unblock (audited) | ACCOUNT ⬆ | account-11.5 |
| POST | `/account/{id}/block-list/import` | Bulk import | ACCOUNT ⬆ | account-11.5 |
| GET | `/account/{id}/block-list/export` | Export (CSV → presigned URL) | USER | account-11.5 |
| POST | `/account/internal/block-list/check` | S2S — dispatch checks value(s) before send | Internal | account-11.3 |

### Audit & ops (account-12, account-13)
| Method | URI | Purpose | Access | Req |
|---|---|---|---|---|
| GET | `/account/{id}/audit` | Query account/billing audit events (RBAC-scoped) | ACCOUNT | account-12.1 |
| GET | `/account/{id}/audit/{eventId}` | One audit event (+ hash-verify result) | ACCOUNT | account-12.2 |
| GET | `/account/config` | Read the service's own runtime config (AppConfig-backed) | ROOT | account-13 |
| PUT | `/account/config` | Update service runtime config → reconfigure-without-restart; audited | ROOT ⬆ | account-13 |
| GET | `/account/health` | Liveness/readiness (read-only smoke) | Internal | account-13 |
