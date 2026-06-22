//
// Plans / Pricing / Entitlements / Billing domain model
//
// Reading guide — the model rests on four separations that keep it scalable:
//   1. Feature (capability)        != Price (what it costs)
//   2. Entitlement (what you get)  != Price (what it costs)
//   3. Plan (catalog template)     != Subscription (an account's instance)
//   4. Public plan vs Private plan  = just a visibility flag (enterprise = private)
//
// And one discipline that makes invoicing + audit correct:
//   * Version + snapshot everything billing-relevant. A Subscription freezes the
//     agreed pricing into a PriceSnapshot; Invoices compute from the snapshot
//     (+ metered usage + applied coupons), never from the live, editable catalog.
//
// Relationship at a glance:
//   Feature  --included in-->  Plan (via PlanFeature: entitlement + price components)
//   Account  --subscribes-->   Subscription (snapshot of a Plan version) --modified by--> Coupons
//   Usage    --fed by services-->  read at invoice time
//   Invoice  --computed from-->  snapshot + usage + coupons  (immutable, audited)
//   App      --reads-->         ResolvedEntitlements (the universal feature toggle check)
//

// ────────────────────────────────────────────────────────────────────────────
// Shared primitives
// ────────────────────────────────────────────────────────────────────────────

export type ID = string;            // opaque identifier (uuid)
export type ISODateTime = string;   // ISO-8601 timestamp

/** A monetary value. amountMinor is in the currency's minor unit (e.g. cents). */
export interface Money
{
    amountMinor : number;
    currency    : string;           // ISO-4217, e.g. "USD"
}

/** Recurring / reset cadence. */
export enum Interval
{
    DAY   = "day",
    WEEK  = "week",
    MONTH = "month",
    YEAR  = "year",
}

// ────────────────────────────────────────────────────────────────────────────
// 1. CATALOG — Feature (universal capability / toggle). NO price here.
// ────────────────────────────────────────────────────────────────────────────

export interface Feature
{
    id          : ID;
    key         : string;           // stable toggle key the whole app checks, e.g. "sms.bulk_send"
    name        : string;
    description? : string;
    // Pure capability. How much it costs lives on PlanFeature, not here, so the
    // same feature can be free in one plan and metered in another.
}

// ────────────────────────────────────────────────────────────────────────────
// 2. CATALOG — Plan (commercial package, versioned). Public or Private(enterprise).
// ────────────────────────────────────────────────────────────────────────────

export enum PlanVisibility
{
    PUBLIC  = "public",             // listed, anyone can subscribe
    PRIVATE = "private",            // enterprise — scoped to one account
}

export enum PlanStatus
{
    DRAFT   = "draft",
    ACTIVE  = "active",
    RETIRED = "retired",            // no new subscriptions; existing ones keep their snapshot
}

export interface Plan
{
    id           : ID;
    key          : string;
    name         : string;
    description? : string;

    visibility   : PlanVisibility;
    accountId?   : ID;              // REQUIRED when visibility === PRIVATE (the enterprise account)

    version      : number;          // bump on any change; a published version is never mutated
    status       : PlanStatus;
    currency     : string;          // default display currency

    features     : Array<PlanFeature>;     // what this plan includes + how each is priced
    basePrice?   : Array<PriceComponent>;  // plan-level charges not tied to a feature (e.g. flat monthly)

    createdAt    : ISODateTime;
}

/**
 * Join of Plan -> Feature. Carries BOTH:
 *   - entitlement: the technical grant the app enforces (independent of price)
 *   - prices:      0..N commercial charges for this feature *in this plan*
 */
export interface PlanFeature
{
    featureId    : ID;                      // -> Feature
    entitlement  : Entitlement;
    prices       : Array<PriceComponent>;   // 0..N — a feature may have several (e.g. base + overage)
}

// ────────────────────────────────────────────────────────────────────────────
// 3. ENTITLEMENT — what enabling a feature grants. The app enforces this.
// ────────────────────────────────────────────────────────────────────────────

export interface Entitlement
{
    enabled : boolean;
    limit?  : Limit;                // optional quota / counter
}

export interface Limit
{
    metric   : string;              // e.g. "messages", "seats", "storage_bytes" (matches usage/price metric)
    included : number;              // included quantity per period (the "pool")
    period?  : Interval;            // counter reset cadence; undefined = non-resetting / lifetime
    hardCap  : boolean;             // true = block at limit; false = allow overage (billed via a USAGE/POOL price)
}

// ────────────────────────────────────────────────────────────────────────────
// 4. PRICING — PriceComponent: one typed union covering every charge type.
// ────────────────────────────────────────────────────────────────────────────

export enum PriceType
{
    ONE_TIME     = "one_time",      // setup / activation
    RECURRING    = "recurring",     // flat subscription fee
    USAGE        = "usage",         // metered per-unit
    POOL_OVERAGE = "pool_overage",  // included allowance + overage rate (rate pool)
    TIERED       = "tiered",        // graduated / volume tiers
    FEE          = "fee",           // one-time or usage-triggered fee
}

export interface PriceBase
{
    id           : ID;
    type         : PriceType;
    label?       : string;
    externalRef? : string;          // mapping to the billing provider (e.g. Stripe Price id)
}

export interface OneTimePrice extends PriceBase
{
    type   : PriceType.ONE_TIME;
    amount : Money;
}

export interface RecurringPrice extends PriceBase
{
    type     : PriceType.RECURRING;
    amount   : Money;
    interval : Interval;
}

export interface UsagePrice extends PriceBase
{
    type       : PriceType.USAGE;
    metric     : string;            // what is counted
    unitAmount : Money;             // price per unit
}

export interface PoolOveragePrice extends PriceBase
{
    type               : PriceType.POOL_OVERAGE;
    metric             : string;
    included           : number;    // allowance before overage kicks in
    overageUnitAmount  : Money;     // price per unit over the allowance
    interval           : Interval;  // pool reset cadence
}

export interface TieredPrice extends PriceBase
{
    type   : PriceType.TIERED;
    metric : string;
    mode   : TierMode;
    tiers  : Array<PriceTier>;
}

export interface FeePrice extends PriceBase
{
    type    : PriceType.FEE;
    amount  : Money;
    trigger : "one_time" | "usage";
}

export interface PriceTier
{
    upTo       : number | null;     // upper bound of the tier; null = infinity (last tier)
    unitAmount : Money;             // per-unit price within the tier
    flatAmount? : Money;            // optional flat charge for entering the tier
}

export enum TierMode
{
    GRADUATED = "graduated",        // each tier's units priced at that tier's rate
    VOLUME    = "volume",           // all units priced at the rate of the reached tier
}

/** Discriminated union — switch on `.type`. */
export type PriceComponent =
    | OneTimePrice
    | RecurringPrice
    | UsagePrice
    | PoolOveragePrice
    | TieredPrice
    | FeePrice;

// ────────────────────────────────────────────────────────────────────────────
// 5. COMMERCIAL RELATIONSHIP — Subscription (account <-> plan instance).
// ────────────────────────────────────────────────────────────────────────────

export enum SubscriptionStatus
{
    TRIALING = "trialing",
    ACTIVE   = "active",
    PAST_DUE = "past_due",
    PAUSED   = "paused",
    CANCELED = "canceled",
}

export interface Subscription
{
    id                  : ID;
    accountId           : ID;       // -> Account
    planId              : ID;       // -> Plan
    planVersion         : number;   // the exact plan version that was agreed to

    status              : SubscriptionStatus;
    startAt             : ISODateTime;
    endAt?              : ISODateTime;          // effective-dated; undefined = open-ended
    currentPeriodStart  : ISODateTime;
    currentPeriodEnd    : ISODateTime;

    snapshot            : PriceSnapshot;        // frozen pricing — invoices compute from THIS, not the live Plan
    coupons             : Array<AppliedCoupon>;

    externalRef?        : string;               // e.g. Stripe Subscription id
    createdAt           : ISODateTime;
}

/**
 * Immutable copy of a Plan's pricing/entitlements captured at subscribe (or change)
 * time. This is the key to correct invoicing + dispute audit: later catalog edits
 * never retroactively change what an existing subscriber agreed to.
 */
export interface PriceSnapshot
{
    capturedAt  : ISODateTime;
    planId      : ID;
    planVersion : number;
    features    : Array<PlanFeature>;       // frozen copy
    basePrice?  : Array<PriceComponent>;    // frozen copy
}

// ────────────────────────────────────────────────────────────────────────────
// 6. COUPONS — modifiers on a subscription, evaluated at invoice time.
// ────────────────────────────────────────────────────────────────────────────

export enum CouponType
{
    PERCENT_OFF    = "percent_off",
    AMOUNT_OFF     = "amount_off",
    PRICE_OVERRIDE = "price_override",      // replace specific price component amounts
}

export interface Coupon
{
    id             : ID;
    code           : string;
    type           : CouponType;

    percentOff?    : number;                // when type === PERCENT_OFF (0-100)
    amountOff?     : Money;                 // when type === AMOUNT_OFF
    overrides?     : Array<PriceOverride>;  // when type === PRICE_OVERRIDE

    scope          : CouponScope;           // what the coupon applies to
    window?        : { start? : ISODateTime; end? : ISODateTime };
    maxRedemptions? : number;
    timesRedeemed  : number;

    externalRef?   : string;
}

/** Narrow a coupon to a plan / feature / specific price component. Empty = whole subscription. */
export interface CouponScope
{
    planId?    : ID;
    featureId? : ID;
    priceId?   : ID;
}

export interface PriceOverride
{
    priceId   : ID;                 // -> a PriceComponent (in the snapshot)
    newAmount : Money;
}

/** A coupon attached to a specific subscription. */
export interface AppliedCoupon
{
    couponId   : ID;
    appliedAt  : ISODateTime;
    appliedBy? : ID;                // user/admin who applied it (audit)
    expiresAt? : ISODateTime;
}

// ────────────────────────────────────────────────────────────────────────────
// 7. USAGE — metered counts fed in by services, read at invoice time.
//    (Metering lives in the services/analytics counters; billing only reads aggregates.)
// ────────────────────────────────────────────────────────────────────────────

export interface UsageRecord
{
    id             : ID;
    accountId      : ID;
    subscriptionId : ID;
    metric         : string;        // matches Limit.metric / a price metric
    quantity       : number;
    periodStart    : ISODateTime;
    periodEnd      : ISODateTime;
    source?        : string;        // which service reported it
}

// ────────────────────────────────────────────────────────────────────────────
// 8. INVOICING — computed, immutable, references its exact inputs (for disputes).
// ────────────────────────────────────────────────────────────────────────────

export enum InvoiceStatus
{
    DRAFT         = "draft",
    OPEN          = "open",
    PAID          = "paid",
    VOID          = "void",
    UNCOLLECTIBLE = "uncollectible",
}

export interface Invoice
{
    id             : ID;
    accountId      : ID;
    subscriptionId : ID;
    status         : InvoiceStatus;

    periodStart    : ISODateTime;
    periodEnd      : ISODateTime;
    lineItems      : Array<InvoiceLineItem>;

    subtotal       : Money;
    discountTotal  : Money;
    taxTotal       : Money;
    total          : Money;

    // Audit inputs — exactly what produced this invoice, so a dispute is reconstructable.
    snapshotRef    : { subscriptionId : ID; capturedAt : ISODateTime };
    appliedCoupons : Array<ID>;
    usageRefs      : Array<ID>;

    externalRef?   : string;        // e.g. Stripe Invoice id
    issuedAt?      : ISODateTime;
    createdAt      : ISODateTime;
}

export interface InvoiceLineItem
{
    description : string;
    priceId?    : ID;               // -> the PriceComponent (from snapshot) that produced this line
    featureId?  : ID;
    metric?     : string;
    quantity    : number;
    unitAmount  : Money;
    amount      : Money;            // pre-discount line amount
}

// ────────────────────────────────────────────────────────────────────────────
// 9. AUDIT — immutable trail for any billing-relevant change.
// ────────────────────────────────────────────────────────────────────────────

export interface AuditEvent
{
    id        : ID;
    at        : ISODateTime;
    actor     : { type : "user" | "admin" | "system"; id? : ID };
    accountId? : ID;
    action    : string;             // e.g. "subscription.upgraded", "coupon.applied", "plan.price_changed"
    target    : { entity : string; id : ID };
    before?   : unknown;            // state before the change
    after?    : unknown;            // state after the change
}

// ────────────────────────────────────────────────────────────────────────────
// 10. ENTITLEMENT RESOLUTION — the app-facing read model (the universal toggle).
//     Built from an account's active Subscription -> snapshot entitlements (+ coupons + usage).
//     Used like the RBAC Access check: one shared gate across all services.
// ────────────────────────────────────────────────────────────────────────────

export interface ResolvedEntitlements
{
    accountId : ID;
    asOf      : ISODateTime;
    features  : Record<string, ResolvedFeature>;    // keyed by Feature.key
}

export interface ResolvedFeature
{
    enabled : boolean;
    limit?  : {
        metric    : string;
        included  : number;
        used      : number;
        remaining : number;
        period?   : Interval;
    };
    // Drives the "upgrade now" CTA: if disabled or limit-reached, which plan(s) would grant it.
    upgrade? : { availableInPlanIds : Array<ID> };
}
