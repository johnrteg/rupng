# Plans, Pricing, Entitlements & Billing — Design Guide

> Source of truth for the types described here: [`src/Model.ts`](src/Model.ts).
> This document explains *why* the model is shaped the way it is, *how* you use it
> day to day, and *how* it maps onto Stripe.

---

## 1. The one big idea

Most billing systems rot because they glue four unrelated questions into a single
object: *what can you do*, *what do you get*, *what does it cost*, and *what did you
actually agree to*. When those are one thing, every pricing experiment forces a
schema change, and every invoice dispute becomes an archaeology project.

This model keeps them apart. Four separations, and one discipline:

| # | Separation | Why it matters |
|---|-----------|----------------|
| 1 | **Feature** (capability) ≠ **Price** (cost) | The *same* feature can be free in one plan and metered in another. |
| 2 | **Entitlement** (what you get) ≠ **Price** (cost) | The app enforces entitlements without knowing or caring about money. |
| 3 | **Plan** (catalog template) ≠ **Subscription** (an account's instance) | You can edit the catalog freely without touching anyone's live deal. |
| 4 | **Public plan** vs **Private plan** | "Enterprise" is just a visibility flag + an `accountId` — not a separate system. |

**The discipline: snapshot everything billing-relevant.** When an account subscribes,
the agreed pricing is *frozen* into a `PriceSnapshot`. Invoices are computed from the
snapshot (plus metered usage, plus coupons) — **never** from the live, editable
catalog. Later catalog edits cannot retroactively rewrite what someone already agreed
to. This is what makes invoicing correct and disputes reconstructable.

---

## 2. The map

```
   CATALOG (editable templates)                COMMERCIAL (an account's reality)
   ─────────────────────────────              ──────────────────────────────────
   Feature  ──included in──►  Plan            Account ──subscribes──► Subscription
   (capability)               (versioned)                            │
       ▲                        │                                    │ freezes
       │ via PlanFeature        │                                    ▼
       │ {entitlement+prices}   │                              PriceSnapshot
       │                        ▼                              (frozen Plan vN)
   Entitlement            PriceComponent                            │
   {enabled, limit}       (6 charge types)        Coupons ──modify──┤
                                                                    ▼
   Usage ──fed by services──────────────────────────────►  Invoice (immutable)
                                                                    │
   App ──reads──► ResolvedEntitlements ◄──built from──────── snapshot + usage + coupons
       (the universal feature-toggle check)
```

Two worlds. The **catalog** (Features, Plans, Prices) is freely editable marketing/
product surface. The **commercial** side (Subscriptions, Snapshots, Invoices) is an
account's actual, audited reality and is mostly immutable.

---

## 3. The pieces, in plain terms

### Feature — a capability, no price
A [`Feature`](src/Model.ts) is a pure on/off capability identified by a stable `key`
like `"sms.bulk_send"`. The *whole app* checks features by that key. There is **no
price on a Feature** — pricing lives where the feature meets a plan.

### Plan — a commercial package, versioned, public or private
A [`Plan`](src/Model.ts) bundles features. Key fields:
- `visibility`: `PUBLIC` (anyone can subscribe) or `PRIVATE` (enterprise — requires
  `accountId`, scoped to exactly one customer).
- `version`: bumped on any change. **A published version is never mutated.** New deal
  terms = new version; existing subscribers keep the version they agreed to.
- `status`: `DRAFT` → `ACTIVE` → `RETIRED` (retired = no new sign-ups, existing
  subscriptions keep running off their snapshot).
- `features: PlanFeature[]` and optional `basePrice: PriceComponent[]` (plan-level
  charges not tied to any feature, e.g. a flat platform fee).

### PlanFeature — where capability meets money
A [`PlanFeature`](src/Model.ts) is the join of Plan→Feature and carries **both**:
- `entitlement`: the technical grant the app enforces (price-independent).
- `prices: PriceComponent[]`: 0..N charges for this feature *in this plan* (e.g. a
  base fee **and** an overage rate).

### Entitlement & Limit — what the app enforces
[`Entitlement`](src/Model.ts) is `{ enabled, limit? }`. A [`Limit`](src/Model.ts) is a
quota:
- `metric` (e.g. `"messages"`, `"seats"`) — matches the usage/price metric.
- `included` — the pool size per period.
- `period` — reset cadence (undefined = lifetime/non-resetting).
- `hardCap` — `true` blocks at the limit; `false` allows overage (billed via a
  `USAGE`/`POOL_OVERAGE` price).

`hardCap` is the whole difference between "you hit your cap, upgrade to continue" and
"keep going, we'll bill the overage."

### PriceComponent — one union for every charge shape
[`PriceComponent`](src/Model.ts) is a discriminated union (switch on `.type`):

| `PriceType` | Shape | Use it for |
|-------------|-------|-----------|
| `ONE_TIME` | `amount` | Setup / activation charge |
| `RECURRING` | `amount`, `interval` | Flat subscription fee |
| `USAGE` | `metric`, `unitAmount` | Pure metered, per-unit |
| `POOL_OVERAGE` | `included`, `overageUnitAmount`, `interval` | Allowance + overage rate |
| `TIERED` | `tiers[]`, `mode` | Graduated or volume tiers |
| `FEE` | `amount`, `trigger` | One-off or usage-triggered fee |

`TIERED` `mode` is `GRADUATED` (each tier's units priced at that tier's rate) vs
`VOLUME` (all units priced at the reached tier's rate). Every price carries an
optional `externalRef` — its mapping to the billing provider (see §6).

### Subscription & PriceSnapshot — the frozen deal
A [`Subscription`](src/Model.ts) ties an `accountId` to a `planId` + `planVersion`,
tracks `status` and the current billing period, and holds the
[`PriceSnapshot`](src/Model.ts) — an immutable copy of the plan's features/prices
captured at subscribe (or change) time. **Invoices compute from the snapshot, not the
live Plan.** It also holds `coupons` and an `externalRef` (e.g. Stripe Subscription
id).

### Coupon — a modifier evaluated at invoice time
A [`Coupon`](src/Model.ts) is `PERCENT_OFF`, `AMOUNT_OFF`, or `PRICE_OVERRIDE` (replace
specific snapshot price amounts — the enterprise discount lever). It has a `scope`
(whole subscription, or narrowed to a plan/feature/price), an optional active
`window`, and redemption limits. An [`AppliedCoupon`](src/Model.ts) records *who*
applied it and *when* (audit).

> **Non-price overrides (optional).** A coupon may also carry an **entitlement / gate waiver** — e.g. waive a
> plan's `requireBusinessEmail` signup gate (promo / partner signups, see
> [access-flows](../../auth/specs/ACCESS-FLOWS.md)). Same apply-at-redemption + audit mechanics; it toggles a
> plan flag rather than a price.

### UsageRecord — metered counts, read at invoice time
Services meter usage (in analytics/counters) and report aggregates as
[`UsageRecord`](src/Model.ts)s keyed by `metric`. **Billing only reads aggregates** —
it is not the metering system.

### Invoice — computed, immutable, audited
An [`Invoice`](src/Model.ts) has line items, totals (`subtotal`/`discountTotal`/
`taxTotal`/`total`), and — crucially — **references its exact inputs**: `snapshotRef`,
`appliedCoupons`, `usageRefs`. Given those three, any historical invoice is fully
reconstructable, which is what makes a dispute winnable.

### ResolvedEntitlements — the universal toggle
[`ResolvedEntitlements`](src/Model.ts) is the **app-facing read model**, built from an
account's active subscription snapshot + usage + coupons. Keyed by `Feature.key`, each
[`ResolvedFeature`](src/Model.ts) gives `enabled`, a live `{ included, used, remaining }`
limit, and an `upgrade` hint (which plans would grant a disabled/exhausted feature —
this drives the "Upgrade now" CTA). Think of it as the billing world's equivalent of
the RBAC access check: **one shared gate every service calls.**

### AuditEvent — the immutable trail
Every billing-relevant change emits an [`AuditEvent`](src/Model.ts) with actor,
action, target, and `before`/`after` state.

---

## 4. How you actually use it

### a) Gate a feature in app code (the 90% case)
Services never read plans or prices. They read the resolved toggle:

```ts
const ent = await entitlements.resolve(accountId);          // ResolvedEntitlements

const bulk = ent.features["sms.bulk_send"];
if (!bulk?.enabled) return denyWithUpgrade(bulk?.upgrade);  // CTA: availableInPlanIds

const quota = ent.features["sms.send"].limit;
if (quota && quota.remaining <= 0 && /* hardCap */ true)
    return denyWithUpgrade(...);                            // hard cap reached
// else: allow; overage will bill at invoice time
```

### b) Subscribe an account
1. Pick a `Plan` (+ its current `version`).
2. **Freeze** its `features`/`basePrice` into a `PriceSnapshot`.
3. Create the `Subscription` (status `TRIALING`/`ACTIVE`) pointing at that snapshot.
4. Mirror to Stripe and store `externalRef`s (§6).

### c) Change plans (upgrade/downgrade)
A change captures a **new snapshot** (and usually a new `planVersion`). The old
snapshot stays attached to past invoices — history doesn't move. Proration is a
billing-engine concern handed to Stripe.

### d) Meter & bill usage
Services emit `UsageRecord`s as they work. At period close, the invoicer reads the
aggregates, computes line items **from the snapshot's price components**, applies
coupons, and writes an immutable `Invoice` referencing exactly those `usageRefs`,
`snapshotRef`, and `appliedCoupons`.

### e) Apply a discount
Attach a `Coupon` to the subscription as an `AppliedCoupon`. It's evaluated at invoice
time against its `scope` — nothing about the snapshot changes.

---

## 5. Examples — simple → enterprise

> Examples elide `id`/`createdAt` for readability and use the real interfaces.

### Example 1 — Free plan (simplest possible)
A public plan, one capability, a hard monthly cap, **no prices at all**.

```ts
const smsSend: Feature = { id: "f_sms", key: "sms.send", name: "Send SMS" };

const freePlan: Plan = {
  id: "p_free", key: "free", name: "Free", visibility: PlanVisibility.PUBLIC,
  version: 1, status: PlanStatus.ACTIVE, currency: "USD",
  features: [{
    featureId: "f_sms",
    entitlement: { enabled: true,
      limit: { metric: "messages", included: 100, period: Interval.MONTH, hardCap: true } },
    prices: [],                       // free
  }],
  createdAt: "2026-01-01T00:00:00Z",
};
```
Resolved at runtime: `sms.send` enabled, 100/month, blocks at 100.

### Example 2 — SMB SaaS plan (the common case)
Flat monthly base, **seats** as a hard-capped quota, and **SMS with an included pool +
metered overage** (soft cap).

```ts
const proPlan: Plan = {
  id: "p_pro", key: "pro", name: "Pro", visibility: PlanVisibility.PUBLIC,
  version: 3, status: PlanStatus.ACTIVE, currency: "USD",

  // Plan-level flat fee, not tied to a feature.
  basePrice: [{
    id: "pr_base", type: PriceType.RECURRING,
    amount: { amountMinor: 4900, currency: "USD" }, interval: Interval.MONTH,
    externalRef: "price_pro_base_monthly",      // Stripe Price id
  }],

  features: [
    { featureId: "f_seats",
      entitlement: { enabled: true,
        limit: { metric: "seats", included: 5, period: Interval.MONTH, hardCap: true } },
      prices: [] },                              // 5 seats included; more requires upgrade

    { featureId: "f_sms",
      entitlement: { enabled: true,
        limit: { metric: "messages", included: 5000, period: Interval.MONTH, hardCap: false } },
      prices: [{                                 // soft cap -> overage billed
        id: "pr_sms_overage", type: PriceType.POOL_OVERAGE, metric: "messages",
        included: 5000, overageUnitAmount: { amountMinor: 1, currency: "USD" },  // $0.01/msg
        interval: Interval.MONTH, externalRef: "price_sms_overage",
      }] },
  ],
  createdAt: "2026-01-01T00:00:00Z",
};
```
An account using 6,200 messages is billed `(6200 − 5000) × $0.01 = $12.00` overage on
top of the `$49.00` base. Seats hard-cap at 5.

### Example 3 — Enterprise plan (private + negotiated)
A **private** plan scoped to one account, with a one-time onboarding fee, **volume
tiers** for messaging, and a negotiated discount applied via a `PRICE_OVERRIDE` coupon
— all frozen into the subscription's snapshot.

```ts
const enterprisePlan: Plan = {
  id: "p_acme", key: "acme-2026", name: "Acme Corp — 2026",
  visibility: PlanVisibility.PRIVATE, accountId: "acct_acme",     // scoped to Acme only
  version: 1, status: PlanStatus.ACTIVE, currency: "USD",

  basePrice: [{
    id: "pr_onboard", type: PriceType.ONE_TIME,
    amount: { amountMinor: 500000, currency: "USD" },             // $5,000 onboarding
    externalRef: "price_acme_onboarding",
  }],

  features: [{
    featureId: "f_sms",
    entitlement: { enabled: true,
      limit: { metric: "messages", included: 0, period: Interval.MONTH, hardCap: false } },
    prices: [{
      id: "pr_sms_tiers", type: PriceType.TIERED, metric: "messages",
      mode: TierMode.VOLUME,                                      // all units at reached tier's rate
      tiers: [
        { upTo: 1_000_000,  unitAmount: { amountMinor: 1, currency: "USD" } },   // $0.010
        { upTo: 10_000_000, unitAmount: { amountMinor: 1, currency: "USD" } },   // (illustrative)
        { upTo: null,       unitAmount: { amountMinor: 1, currency: "USD" } },   // 10M+
      ],
    }],
  }],
  createdAt: "2026-01-01T00:00:00Z",
};

// Negotiated 15% off the messaging line, applied to Acme's subscription:
const acmeDiscount: Coupon = {
  id: "c_acme15", code: "ACME-2026", type: CouponType.PERCENT_OFF, percentOff: 15,
  scope: { planId: "p_acme", priceId: "pr_sms_tiers" },          // narrowed scope
  timesRedeemed: 0, externalRef: "coupon_acme15",
};
```

When Acme subscribes, `enterprisePlan` v1 is copied into a `PriceSnapshot`. If you
later create v2 with different rates, Acme's invoices keep computing from v1 until they
explicitly move — **no retroactive surprises.**

---

## 6. How it works with Stripe

The guiding principle: **we own the catalog, entitlements, snapshots and audit; Stripe
is the money rail.** We never store card data and never reimplement dunning. The model
already carries `externalRef` on every billable thing so the two systems stay linked.

### Payment-method & card-data storage *(decided)*

We **never store card data.** The card is captured by **Stripe Elements / Checkout** and vaulted by Stripe;
our storage only ever holds:

- **Stripe `externalRef`s** — `cus_…` (Customer, on the account record), `sub_…`, `price_…`, `in_…`, and a
  payment-method handle (`pm_…`) when a default is referenced.
- **Display-only card metadata returned by Stripe** — the **last 4 digits** and **card brand** (and, if the
  UI wants it, `expMonth`/`expYear`) so we can render *"Visa •••• 4242"*. **Never** the PAN, CVV, magnetic
  stripe, or any full account number.

`last4` + `brand` are **not** PAN and fall outside PCI's stored-"account data" prohibition — safe to persist
and display. Anything richer is fetched **live from the Stripe API**, never kept. This is what holds us at
**PCI SAQ-A** (no cardholder-data environment to defend) — see §9.

### Division of responsibility

| Concern | Owner |
|--------|-------|
| Feature catalog & **entitlement enforcement** | **Us** (Stripe never gates features) |
| Plan / price **definitions** (source of truth) | **Us**, mirrored into Stripe |
| Card vault, PCI scope, payment methods | **Stripe** |
| Dunning, retries, receipts, payment UI | **Stripe** |
| Tax calculation (optional) | **Stripe Tax** |
| Usage **aggregation** | **Us** (services) → reported to Stripe |
| **Snapshots & immutable audit** | **Us** (Stripe has no per-deal snapshot) |
| Invoice generation & collection | **Hybrid** (see below) |

### Object mapping

| Our model | Stripe object | Linked via |
|-----------|---------------|-----------|
| `Plan` | Product | (Product per plan; new `version` → new Prices) |
| `PriceComponent` | Price | `PriceBase.externalRef` = Stripe Price id |
| `Subscription` | Subscription (+ items) | `Subscription.externalRef` = `sub_…` |
| `Account` | Customer | (stored on the account record) |
| `Coupon` (%/amount) | Coupon / Promotion Code | `Coupon.externalRef` |
| `UsageRecord` | Usage record / Meter event | reported to the metered subscription item |
| `Invoice` | Invoice | `Invoice.externalRef` = `in_…` |

### Mapping each `PriceType` to a Stripe Price

| `PriceType` | Stripe Price config |
|-------------|---------------------|
| `RECURRING` | `recurring` price, `interval` mapped from our `Interval` |
| `ONE_TIME` | one-off price → invoice item at checkout |
| `USAGE` | `recurring` + `usage_type: metered` |
| `POOL_OVERAGE` | metered **graduated tiered** price: first tier `up_to: included` at `0`, then `overageUnitAmount` |
| `TIERED` | tiered price; our `GRADUATED`/`VOLUME` → Stripe `tiers_mode` |
| `FEE` | one-off price or ad-hoc invoice item (by `trigger`) |

> Note: Stripe Prices are **immutable** — you create a new Price to change anything.
> That aligns perfectly with our "never mutate a published plan version" rule: a
> version bump creates new Stripe Prices, and existing subscription items keep pointing
> at the old ones (mirroring our snapshot guarantee).

### Two ways to invoice — pick per plan

- **Stripe-generated (standard plans).** Mirror snapshot prices to Stripe subscription
  items, push usage, and let Stripe assemble & collect the invoice. We mirror the
  resulting invoice into our immutable `Invoice` via webhook. Lowest effort; best for
  public/self-serve plans.
- **We-compute, Stripe-collects (enterprise / `PRICE_OVERRIDE`).** Some constructs have
  no clean Stripe analog — notably `PRICE_OVERRIDE` coupons and bespoke negotiated
  terms. There we compute line items from the snapshot ourselves and push them to
  Stripe as invoice items purely for collection, keeping our `Invoice` authoritative.

A clean default: **standard plans → Stripe-generated; private/enterprise plans →
we-compute.** The `externalRef` fields make either path traceable.

### Usage reporting
Services accumulate counts → we aggregate into `UsageRecord`s → a billing worker
reports those to the matching Stripe metered subscription item (use **idempotency
keys** keyed by `(subscriptionItem, period, metric)` so retries don't double-count).
We keep the `UsageRecord`s; the `Invoice.usageRefs` point back to them for audit.

### Staying in sync — webhooks
Subscribe to Stripe events and reconcile into our model:

| Stripe event | Our reaction |
|--------------|--------------|
| `invoice.paid` | `Invoice.status = PAID`; ensure `Subscription.status = ACTIVE` |
| `invoice.payment_failed` | `Subscription.status = PAST_DUE`; emit `AuditEvent` |
| `customer.subscription.updated` | sync `status`/period dates |
| `customer.subscription.deleted` | `status = CANCELED` |
| `invoice.finalized` | store `Invoice.externalRef`, snapshot line items |

Every reconciliation writes an `AuditEvent`, so the billing timeline is complete on our
side regardless of which system originated a change.

### Webhook strategy — security + reliability *(decided)*

Webhooks drive our billing state, so the endpoint is **untrusted input until verified** and the handler is
built to run safely more than once:

- **Verify the signature** — every request must carry a valid **`Stripe-Signature`**, checked against the
  **endpoint signing secret** (Secrets Manager) via Stripe's SDK; reject unsigned/invalid with `400`. No
  signature ⇒ no processing — this is what stops a forged `invoice.paid` from marking an unpaid invoice paid.
- **Replay tolerance** — enforce the signature **timestamp window** (~5 min) so a captured payload can't be
  replayed later.
- **Idempotent processing** — dedupe by the Stripe **event `id`** (persist processed ids in DynamoDB w/ TTL,
  no-op on a repeat); Stripe **retries** deliveries, so every handler must be safe to run twice.
- **Order-independent** — never assume delivery order; reconcile against the **object's current state**
  (compare `created` / re-fetch from Stripe) and **drop stale** updates rather than blindly applying.
- **Ack fast, work async** — verify + enqueue, return `2xx` immediately, do the model reconciliation on a
  **`WorkQueue`** worker so a slow handler doesn't trigger Stripe retries; **DLQ** on repeated failure.
- **Reconcile + audit** — each handled event updates our model (table above) and writes an `AuditEvent`; a
  periodic **reconciliation sweep** polls Stripe for drift to catch any missed/undelivered event.
- **Dedicated, signature-authed route** — a billing-internal `/account/billing/webhook` path, **not**
  user-facing and **not** JWT-gated; its only auth is the Stripe signature.

---

## 7. Why the snapshot is non-negotiable

Without snapshots, this sequence is a lawsuit:

1. Customer subscribes to "Pro" at `$49`, `$0.01`/overage.
2. Product edits "Pro" to `$59`, `$0.02`/overage for a new campaign.
3. You generate last month's invoice → it reads the **live** plan → customer is billed
   rates they never agreed to, retroactively.

With snapshots, step 2 creates a new plan *version*; the customer's subscription still
computes from the frozen v-they-agreed-to. The `Invoice` records `snapshotRef`,
`usageRefs`, and `appliedCoupons` — so months later you can reproduce the exact math.
Stripe's immutable Prices reinforce the same guarantee on the money-rail side.

---

## 8. FAQ

**Where do I check if a customer can use a feature?**
`entitlements.resolve(accountId)` → `ResolvedEntitlements`. Never read `Plan`/`Price`
in feature code.

**Same feature, free in one plan and paid in another?**
Yes — that's the whole point of separating `Feature` from `PlanFeature.prices`.

**How is "enterprise" different from a normal plan?**
Only `visibility: PRIVATE` + an `accountId`. Same machinery; bespoke terms ride on
`PRICE_OVERRIDE` coupons and private plan versions.

**Do we store credit cards?**
No. Stripe holds all payment data; we hold catalog, entitlements, snapshots, and audit.

**Customer disputes a charge from 8 months ago.**
Pull the `Invoice` → follow `snapshotRef` + `usageRefs` + `appliedCoupons` →
recompute. The inputs are immutable, so the answer is deterministic.

**Hard cap vs overage?**
`Limit.hardCap`: `true` blocks at the limit (upgrade to continue); `false` allows usage
and bills it via the feature's `USAGE`/`POOL_OVERAGE` price.

---

## 9. Compliance & standards mapping (billing / PCI focus)

How the **pricing / billing** surface maps to **OWASP Top 10 (2021)**, **ISO/IEC 27001:2022** (Annex A),
**SOC 2 Type 2** (TSC), **PCI-DSS v4.0**, **HIPAA**, **GDPR**, and **CCPA/CPRA**. Clause refs are
**indicative**; this is
a **design-intent** self-assessment (real assurance = audited operating effectiveness + a PCI **SAQ/QSA**
attestation). Two regimes dominate here: **PCI-DSS** (payments) and **SOC 2 Processing Integrity** (invoice
correctness). The broader account-service controls (tenant isolation, closure, block-list) live in the
[account compliance table](SPECS.md#compliance--standards-mapping); identity/RBAC + the hashed audit pattern
live in [auth](../../auth/specs/SPECS.md). **HIPAA is ➖ throughout** — billing/pricing data is **not PHI**;
any HIPAA / BAA obligation sits on the **messaging path + auth**, not here.

**Legend:** ✅ meets/exceeds · ⚠️ partial — see Gaps · ➖ n/a

| Billing surface / control | OWASP T10 | ISO 27001:2022 | SOC 2 (TSC) | PCI-DSS v4.0 | HIPAA | GDPR | CCPA | |
|---|---|---|---|---|---|---|---|---|
| **Card data never stored** — Stripe Elements/Checkout tokenization; we hold only `externalRef`s | A02 | A.8.24 | CC6.1 | **Req 3 / 4 → SAQ-A** | ➖ | Art 32 | §1798.81.5 | ✅ exceeds (out of scope by design) |
| **Payment UI / dunning / receipts** — delegated to Stripe | A02 | A.8.24 | CC6.1 | Req 4 / 6 | ➖ | Art 32 | ➖ | ✅ (delegated) |
| **Stripe webhook ingestion** (`invoice.paid`, `payment_failed`, …) | A08 / A01 | A.8.24 / A.8.26 | CC6.1 / CC7.2 | **Req 6.4** | ➖ | Art 32 | ➖ | ⚠️ verify signature + idempotency |
| **Third-party processor** (Stripe = processor / sub-processor) | ➖ | A.5.19 / A.5.20 / A.5.23 | CC9.2 | **Req 12.8** (TPSP) | ➖ | Art 28 | §1798.140 | ⚠️ DPA + vendor review |
| **Immutable invoices + `PriceSnapshot`** (disputes reconstructable from `snapshotRef`+`usageRefs`+coupons) | A08 | A.8.15 | **CC7.1 Processing Integrity** | Req 10 (trail) | ➖ | ➖ | ➖ | ✅ exceeds |
| **Versioned plans/prices — never mutate a published version** (mirrors Stripe immutable Prices) | A08 | A.8.32 | CC8.1 | ➖ | ➖ | ➖ | ➖ | ✅ |
| **Billing-change `AuditEvent`** on every edit + webhook reconcile | A09 | A.8.15 | CC7.2 | **Req 10** | ➖ | ➖ | ➖ | ✅ · ⚠️ adopt hashed audit |
| **Coupon / `PRICE_OVERRIDE` application** (`AppliedCoupon` records who/when) | A01 | A.5.15 / A.8.3 | CC6.3 | ➖ | ➖ | ➖ | ➖ | ⚠️ gate who may discount |
| **Usage → invoice idempotency** (keys on `(item, period, metric)`; no double-count) | A04 | A.8.15 | **CC7.1 Processing Integrity** | ➖ | ➖ | ➖ | ➖ | ✅ |
| **Pricing-visibility gated by hierarchy** (private/enterprise plans; agency markup) | A01 | A.8.12 | CC6.3 | ➖ | ➖ | ➖ | ➖ | ✅ · ⚠️ enforce at read-model |
| **Invoice / billing read access** — account-scoped + role-gated | A01 | A.5.15 | CC6.3 | ➖ | ➖ | Art 15 | §1798.110 | ✅ (RBAC) |
| **Billing PII minimization** — only the Stripe `Customer` id + minimal account record | A04 | A.8.11 | CC6.x | Req 3 (no PAN) | ➖ | Art 5 / 32 | §1798.100 | ✅ |

### Gaps to address

✅ = resolved/decided · ⚠️ = **open — needs attention**.

* ✅ **PCI-DSS posture (SAQ-A)** — **decided** — see [§6 Payment-method & card-data storage](#payment-method--card-data-storage-decided):
  **Stripe Elements/Checkout, PAN never in our systems**, store only `externalRef`s + `last4`/`brand`(+`exp`).
  Req 3/4 satisfied by not holding the data; residuals are **Req 6.4** (webhook integrity, decided below),
  **Req 12.8** (manage Stripe, below), **Req 10** logging only if a CDE ever appears. **Remaining:** complete
  the **SAQ-A** attestation as part of the compliance program.
* ✅ **Stripe-webhook integrity** *(PCI Req 6.4 · OWASP A08)* — **decided** — see [§6 Webhook strategy](#webhook-strategy--security--reliability-decided):
  **`Stripe-Signature` verification**, replay window, **idempotent** dedupe by event id, order-independent
  reconcile, ack-fast/work-async, + a reconciliation sweep.
* ⚠️ **TPSP / sub-processor governance** *(PCI Req 12.8 · GDPR Art 28 · ISO A.5.19–23 · SOC 2 CC9)* — a **DPA**, a
  maintained **sub-processor list**, an annual **vendor security review** of Stripe, and confirmation Stripe's
  data region honors the **EU-account residency** rule.
* ⚠️ **Billing-audit integrity + retention** *(SOC 2 CC7 · PCI Req 10)* — adopt the **hashed, append-only,
  verify-on-read** audit defined in [auth](../../auth/specs/SPECS.md) for billing `AuditEvent`s, and set the
  **financial-records retention** (typically ~7 yrs — longer than operational logs).
* ⚠️ **Discount / override authorization** *(OWASP A01 · SOC 2 CC6.3)* — **gate who may apply** a `PRICE_OVERRIDE`
  or a large coupon (a discount is money); consider **maker-checker** for negotiated enterprise overrides.
  `AppliedCoupon`'s who/when is the audit half — the **authorization half** still needs enforcing.
* ⚠️ **Pricing-data leakage** *(OWASP A01 · ISO A.8.12)* — ensure sub-account / agency responses never expose
  **platform pricing** or **another tenant's private plan**; enforce at the **read model**, not just the UI.
* ⚠️ **Usage↔invoice reconciliation** *(SOC 2 CC7.1)* — beyond idempotent reporting, run a **periodic reconcile**
  of our `UsageRecord` aggregates vs Stripe's metered totals to catch drift before it reaches an invoice.
