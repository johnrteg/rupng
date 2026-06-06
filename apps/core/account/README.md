#
# Account
#

# Objectives:
Manage accounts

# Requirements
* Multi-tenant
* Account creation
* Allow child-parent account relationship for sub-account creation.. one parent per account.
* Assign user's to account and the max-role access allowed
* Allow user to switch accounts that they have access to
* Configuration: name, branding, feature flags, perferences, config, limits, etc.
* Parent configuration filters down to sub-account unless over written by sub account.  Replace or merge? (e.g. feature flags). Groupd edit from parent?
* Status: pending, active, suspended, closed, etc.
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
* GDPR nuance: a block stores minimal data (the value + reason); a forget request must
  reconcile with the legal need to retain opt-out **proof**.

Questions:
1) Should auth control the user - account - role management?
2) Switching accounts governed by auth or account?

# Model
Plan and Pricing

## The four separations (this is the whole game)
1. `Feature ≠ Price`. A Feature is a universal capability (a toggle key the whole app checks). Its price is not a property of the feature — it's a property of how a plan includes that feature. Same feature can be free in Pro, metered in Starter. Bake price into the feature and you lose that forever.
2. `Entitlement ≠ Price`. The entitlement is the technical grant (enabled? limit? counter/quota?) — what the app enforces. The price is the commercial charge. They travel together on a plan but are different concerns (the app checks entitlements; billing reads prices).
3. `Plan (template) ≠ Subscription (instance)`. A `Plan` is the catalog definition; a `Subscription` is an account's instance of it — with effective dates, coupons, and a price snapshot. This separation is what makes invoicing + audit correct (below).
4. `Public Plan vs Private Plan` is just a flag. Enterprise pricing isn't a special system — it's a Plan with visibility=private scoped to an accountId. Same model.


## The lean core model (~6 entities)
# Catalog (definitions, versioned):
* `Feature` — key (the universal toggle the app checks), name. Pure capability. No price here.
* `Plan` — name, visibility (public/private), accountId? (if private/enterprise), status, version.
* `PlanFeature` — links `Plan` → `Feature`, carrying the entitlement (enabled, limit/quota/counter config) and 0–N `PriceComponents`.
* `PriceComponent` — a small typed union (see below) attached to a `PlanFeature` (or to the Plan for a base fee).

# Commercial relationship (instances):
* `Subscription` — accountId, planId+version, status, start/end (effective-dated), and a priceSnapshot captured at subscribe time.
* `Coupon`+ `SubscriptionCoupon` — discounts applied to a subscription (below).

Feeding + output: UsageRecord (metered, from services) → Invoice (computed) + AuditLog (immutable).

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
