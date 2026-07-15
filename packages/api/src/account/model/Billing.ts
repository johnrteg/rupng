//
import { Type } from "@repo/common";
import { Validation } from "../../model/Validation";

//
// Billing — the **plans / pricing / entitlements / billing** contract for the account domain. Moved
// here (from the account service's internal model + specs) so endpoints can share one canonical set of
// shapes for future usage (plans catalog, subscriptions, invoices, entitlement resolution, …).
//
// The model rests on four separations that keep it scalable:
//   1. Feature (capability)        != Price (what it costs)
//   2. Entitlement (what you get)  != Price (what it costs)
//   3. Plan (catalog template)     != Subscription (an account's instance)
//   4. Public plan vs Private plan  = just a visibility flag (enterprise = private)
//
// And one discipline that makes invoicing + audit correct:
//   * Version + snapshot everything billing-relevant. A Subscription freezes the agreed pricing into a
//     PriceSnapshot; Invoices compute from the snapshot (+ metered usage + applied coupons), never from
//     the live, editable catalog.
//
// See apps/core/account/specs/PRICING.md for the design narrative + worked examples.
//
export namespace Billing
{
    // ── Shared primitives ──────────────────────────────────────────────────────────────────────

    /**
     * A **settled** monetary value — whole cents. Use for balances, invoice amounts, fees, pack prices, top-ups,
     * discounts: anything charged/recorded. For a FRACTIONAL-cent per-unit PRICE, use {@link Rate}.
     */
    export interface Money
    {
        amountMinor : Type.Cents;       // whole cents (minor units)
        currency    : Type.Currency;    // ISO-4217, e.g. "USD"
    }

    /**
     * A **per-unit rate** that may be a FRACTIONAL cent — e.g. $0.025 (2.5¢) per SMS segment, or $0.00002 per
     * AI token. Stored in {@link Type.MilliCents} (thousandths of a cent) so sub-cent pricing is exact; multiply
     * by a quantity and settle to whole cents with `CurrencyUtils.rateTotalCents` at the charge boundary.
     */
    export interface Rate
    {
        amountMilliCents : Type.MilliCents;   // thousandths of a cent (2.5¢ → 2500)
        currency         : Type.Currency;     // ISO-4217, e.g. "USD"
    }

    /** Recurring / reset cadence. */
    export enum Interval
    {
        DAY   = "day",
        WEEK  = "week",
        MONTH = "month",
        YEAR  = "year",
    }

    // ── 1. CATALOG — Feature (universal capability / toggle). NO price here. ─────────────────────

    export interface Feature
    {
        id          : Type.ID;
        key         : string;           // stable toggle key the whole app checks, e.g. "sms.bulk_send"
        name        : string;
        description? : string;
        // Pure capability. How much it costs lives on PlanFeature, not here, so the same feature can be
        // free in one plan and metered in another.
    }

    // ── 2. CATALOG — Plan (commercial package, versioned). Public or Private(enterprise). ────────

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
        id           : Type.ID;
        key          : string;
        name         : string;
        description? : string;

        visibility   : PlanVisibility;
        accountId?   : Type.ID;         // REQUIRED when visibility === PRIVATE (the enterprise account)

        version      : number;          // bump on any change; a published version is never mutated
        status       : PlanStatus;
        currency     : Type.Currency;   // default display currency

        features     : Array<PlanFeature>;     // what this plan includes + how each is priced
        basePrice?   : Array<PriceComponent>;  // plan-level charges not tied to a feature (e.g. flat monthly)

        createdAt    : Type.ISODateTime;
    }

    /**
     * Join of Plan -> Feature. Carries BOTH:
     *   - entitlement: the technical grant the app enforces (independent of price)
     *   - prices:      0..N commercial charges for this feature *in this plan*
     */
    export interface PlanFeature
    {
        featureId    : Type.ID;                 // -> Feature
        entitlement  : Entitlement;
        prices       : Array<PriceComponent>;   // 0..N — a feature may have several (e.g. base + overage)
    }

    // ── 3. ENTITLEMENT — what enabling a feature grants. The app enforces this. ──────────────────

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

    // ── 4. PRICING — PriceComponent: one typed union covering every charge type. ──────────────────

    export enum PriceType
    {
        ONE_TIME     = "one_time",      // setup / activation
        RECURRING    = "recurring",     // flat subscription fee
        USAGE        = "usage",         // metered per-unit (post-paid consumption)
        POOL_OVERAGE = "pool_overage",  // included allowance + overage rate (rate pool)
        TIERED       = "tiered",        // graduated / volume tiers
        FEE          = "fee",           // one-time or usage-triggered fee
        PREPAID      = "prepaid",       // buy a quantity of units UP-FRONT (a credit / data pack) drawn down by usage
    }

    /** Stripe `tax_behavior` — is the price amount tax-**inclusive** or tax-**exclusive** (added on top). */
    export enum TaxBehavior
    {
        INCLUSIVE   = "inclusive",      // the amount already includes tax
        EXCLUSIVE   = "exclusive",      // tax is added on top of the amount
        UNSPECIFIED = "unspecified",    // let Stripe's default apply
    }

    /**
     * Tax treatment of a priced item. An **object** (not a bare flag) so it can grow as tax needs do.
     * These are exactly the per-item inputs **Stripe Tax** consumes to calculate tax automatically:
     *   • `enabled`  — is the item taxable at all (false ⇒ excluded from the tax base; no code sent).
     *   • `taxCode`  — Stripe **product tax code** (`txcd_…`, e.g. SaaS `txcd_10103001`) — this is what
     *                  drives per-jurisdiction taxability; if omitted, Stripe uses the account's default code.
     *   • `behavior` — Stripe **tax_behavior** (inclusive / exclusive).
     * The rest of tax calc — rates per jurisdiction, nexus/registrations, and the **customer's address**
     * (buyer location, held on the account/customer, not the price) — is **delegated to Stripe Tax**.
     */
    export interface Taxable
    {
        enabled   : boolean;            // is this priced item subject to tax
        taxCode?  : string;             // Stripe product tax_code (txcd_…); omit ⇒ Stripe account default
        behavior? : TaxBehavior;        // Stripe tax_behavior (inclusive | exclusive | unspecified)
    }

    export interface PriceBase
    {
        id           : Type.ID;
        type         : PriceType;
        label?       : string;
        taxable      : Taxable;         // tax treatment — see Taxable (detailed calc delegated to Stripe Tax)
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
        metric     : string;            // what is counted — e.g. "data.records", "ai.tokens", "sms.segments"
        unitAmount : Rate;              // per-unit price (fractional-cent) — pay-as-you-go metered; unit granularity per the metric
    }

    export interface PoolOveragePrice extends PriceBase
    {
        type               : PriceType.POOL_OVERAGE;
        metric             : string;
        included           : number;    // allowance before overage kicks in
        overageUnitAmount  : Rate;      // per-unit price (fractional-cent) over the allowance
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

    /**
     * A **prepaid pack** — buy a quantity of units UP-FRONT for a fixed price, then **burn it down** by
     * usage (e.g. "10,000 customer records for $50", "1M AI tokens for $20", lookup / enrichment credits).
     * Distinct from USAGE (post-paid metered) and POOL_OVERAGE (subscription-included allowance): a
     * standalone, pre-purchased balance drawn down by consumption.
     *
     * "Data" isn't its own price type — it's a `metric` ("data.records", "ai.tokens", …) priced either
     * **as-is** (USAGE, $/unit) or **burn-down** (PREPAID, a pack). The pack here defines what's sold;
     * the running balance / draw-down is tracked at runtime via UsageRecord against this metric.
     */
    export interface PrepaidPrice extends PriceBase
    {
        type          : PriceType.PREPAID;
        metric        : string;          // what the pack grants — e.g. "data.records", "ai.tokens", "lookups"
        quantity      : number;          // units granted per purchase
        amount        : Money;           // price of the pack
        expiresInDays? : number;         // optional expiry of unused units (omit = no expiry)
    }

    export interface PriceTier
    {
        upTo       : number | null;     // upper bound of the tier; null = infinity (last tier)
        unitAmount : Rate;              // per-unit price (fractional-cent) within the tier
        flatAmount? : Money;            // optional flat charge (whole cents) for entering the tier
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
        | FeePrice
        | PrepaidPrice;

    // ── 5. COMMERCIAL RELATIONSHIP — Subscription (account <-> plan instance). ────────────────────

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
        id                  : Type.ID;
        accountId           : Type.ID;  // -> Account
        planId              : Type.ID;  // -> Plan
        planVersion         : number;   // the exact plan version that was agreed to

        status              : SubscriptionStatus;
        startAt             : Type.ISODateTime;
        endAt?              : Type.ISODateTime;     // effective-dated; undefined = open-ended
        currentPeriodStart  : Type.ISODateTime;
        currentPeriodEnd    : Type.ISODateTime;

        snapshot            : PriceSnapshot;        // frozen pricing — invoices compute from THIS, not the live Plan
        coupons             : Array<AppliedCoupon>;

        externalRef?        : string;               // e.g. Stripe Subscription id
        createdAt           : Type.ISODateTime;
    }

    /**
     * Immutable copy of a Plan's pricing/entitlements captured at subscribe (or change) time. This is
     * the key to correct invoicing + dispute audit: later catalog edits never retroactively change what
     * an existing subscriber agreed to.
     */
    export interface PriceSnapshot
    {
        capturedAt  : Type.ISODateTime;
        planId      : Type.ID;
        planVersion : number;
        features    : Array<PlanFeature>;       // frozen copy
        basePrice?  : Array<PriceComponent>;    // frozen copy
    }

    // ── 6. COUPONS — modifiers on a subscription, evaluated at invoice time. ──────────────────────

    export enum CouponType
    {
        PERCENT_OFF    = "percent_off",
        AMOUNT_OFF     = "amount_off",
        PRICE_OVERRIDE = "price_override",      // replace specific price component amounts
    }

    export interface Coupon
    {
        id             : Type.ID;
        code           : string;
        type           : CouponType;

        percentOff?    : number;                // when type === PERCENT_OFF (0-100)
        amountOff?     : Money;                 // when type === AMOUNT_OFF
        overrides?     : Array<PriceOverride>;  // when type === PRICE_OVERRIDE

        scope          : CouponScope;           // what the coupon applies to
        window?        : { start? : Type.ISODateTime; end? : Type.ISODateTime };
        maxRedemptions? : number;
        timesRedeemed  : number;

        externalRef?   : string;
    }

    /** Narrow a coupon to a plan / feature / specific price component. Empty = whole subscription. */
    export interface CouponScope
    {
        planId?    : Type.ID;
        featureId? : Type.ID;
        priceId?   : Type.ID;
    }

    export interface PriceOverride
    {
        priceId   : Type.ID;            // -> a PriceComponent (in the snapshot)
        newAmount : Money;
    }

    /** A coupon attached to a specific subscription. */
    export interface AppliedCoupon
    {
        couponId   : Type.ID;
        appliedAt  : Type.ISODateTime;
        appliedBy? : Type.ID;           // user/admin who applied it (audit)
        expiresAt? : Type.ISODateTime;
    }

    // ── 7. USAGE — metered counts fed in by services, read at invoice time. ───────────────────────
    //    (Metering lives in the services/analytics counters; billing only reads aggregates.)

    export interface UsageRecord
    {
        id             : Type.ID;
        accountId      : Type.ID;
        subscriptionId : Type.ID;
        metric         : string;        // matches Limit.metric / a price metric
        quantity       : number;
        periodStart    : Type.ISODateTime;
        periodEnd      : Type.ISODateTime;
        source?        : string;        // which service reported it
    }

    // ── 8. INVOICING — computed, immutable, references its exact inputs (for disputes). ───────────

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
        id             : Type.ID;
        accountId      : Type.ID;
        subscriptionId : Type.ID;
        status         : InvoiceStatus;

        periodStart    : Type.ISODateTime;
        periodEnd      : Type.ISODateTime;
        lineItems      : Array<InvoiceLineItem>;

        subtotal       : Money;
        discountTotal  : Money;
        taxTotal       : Money;
        total          : Money;

        // Audit inputs — exactly what produced this invoice, so a dispute is reconstructable.
        snapshotRef    : { subscriptionId : Type.ID; capturedAt : Type.ISODateTime };
        appliedCoupons : Array<Type.ID>;
        usageRefs      : Array<Type.ID>;

        externalRef?   : string;        // e.g. Stripe Invoice id
        issuedAt?      : Type.ISODateTime;
        createdAt      : Type.ISODateTime;
    }

    export interface InvoiceLineItem
    {
        description : string;
        priceId?    : Type.ID;          // -> the PriceComponent (from snapshot) that produced this line
        featureId?  : Type.ID;
        metric?     : string;
        quantity    : number;
        unitAmount  : Rate;             // the per-unit (fractional-cent) rate applied
        amount      : Money;            // pre-discount line amount (whole cents = rate × quantity, settled)
    }

    // ── 10. ACCOUNT BILLING SURFACE — balance, payment methods, settings (what the /billing UI reads). ──
    // NOTE: mostly SKELETON until Stripe + plans are implemented; shapes are the contract the UI codes to.

    /** How the account pays. */
    export enum BillingType
    {
        CARD    = "card",       // charged to a card on file (Stripe)
        INVOICE = "invoice",    // billed by invoice (net terms), paid out-of-band
    }

    export enum PaymentMethodKind { CARD = "card", BANK_ACCOUNT = "bank_account" }

    /** A stored payment method — display fields only; the PAN lives in Stripe (SAQ-A: ref + last4 + brand). */
    export interface PaymentMethod
    {
        id           : Type.ID;
        kind         : PaymentMethodKind;
        brand?       : string;          // e.g. "Visa" (display)
        last4?       : string;          // last 4 (display)
        expMonth?    : number;
        expYear?     : number;
        isDefault    : boolean;
        externalRef? : string;          // Stripe PaymentMethod id
    }

    /** Prepaid wallet balance, drawn down by PREPAID/usage charges. Positive = credit available. */
    export interface AccountBalance
    {
        balance   : Money;
        updatedAt : Type.ISODateTime;
    }

    /** Auto top-up: when the balance falls below `threshold`, charge the default method for `amount`. */
    export interface AutoReload
    {
        enabled   : boolean;
        threshold : Money;              // trigger when balance < this
        amount    : Money;              // amount to add
    }

    export enum PaymentStatus { SUCCEEDED = "succeeded", PENDING = "pending", FAILED = "failed", REFUNDED = "refunded" }

    /** A payment-history entry (a charge / top-up / refund). */
    export interface Payment
    {
        id           : Type.ID;
        amount       : Money;
        status       : PaymentStatus;
        description?  : string;
        methodLast4? : string;
        createdAt    : Type.ISODateTime;
        externalRef? : string;
    }

    /** Per-account billing settings — how they pay, auto-reload, and whether billing address mirrors the account. */
    export interface BillingSettings
    {
        billingType                 : BillingType;
        autoReload                  : AutoReload;
        billingAddressSameAsAccount : boolean;
    }

    /** One line of "what is currently being charged" (the cost summary on the overview). */
    export interface CostLine
    {
        label     : string;
        amount    : Money;
        interval? : Interval;           // recurring cadence, if applicable
        note?     : string;
    }

    /** Everything the account/billing overview screen needs in one read (skeleton until Stripe/plans land). */
    export interface Overview
    {
        planName?       : string;               // current plan (display); undefined = no plan yet
        subscription?   : Subscription;
        costs           : Array<CostLine>;      // what's currently being charged
        balance         : AccountBalance;
        settings        : BillingSettings;
        billingAddress? : Type.Address;
        defaultMethod?  : PaymentMethod;
    }

    // ── 9. AUDIT — immutable trail for any billing-relevant change. ───────────────────────────────

    export interface AuditEvent
    {
        id        : Type.ID;
        at        : Type.ISODateTime;
        actor     : { type : "user" | "admin" | "system"; id? : Type.ID };
        accountId? : Type.ID;
        action    : string;             // e.g. "subscription.upgraded", "coupon.applied", "plan.price_changed"
        target    : { entity : string; id : Type.ID };
        before?   : unknown;            // state before the change
        after?    : unknown;            // state after the change
    }

    // ── 10. ENTITLEMENT RESOLUTION — the app-facing read model (the universal toggle). ───────────
    //     Built from an account's active Subscription -> snapshot entitlements (+ coupons + usage).
    //     Used like the RBAC Access check: one shared gate across all services.

    export interface ResolvedEntitlements
    {
        accountId : Type.ID;
        asOf      : Type.ISODateTime;
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
        upgrade? : { availableInPlanIds : Array<Type.ID> };
    }

    // ── Schemas + validators for the principal entities (Plan, Subscription) ─────────────────────
    // These flow over endpoints + messaging (catalog sync, subscription events). The PriceComponent
    // union has six variants that differ structurally; rather than enumerate all six (and risk drift
    // with the union), it's validated to its common shape — an object with a known `id` + `type` — and
    // its variant-specific fields are allowed through. Money / Entitlement / PlanFeature are strict.
    /** A price component (any of the six PriceType variants) — common shape; variant fields allowed. */
    const PRICE_COMPONENT_SCHEMA : Validation.Schema =
    {
        type: "object", additionalProperties: true, required: [ "id", "type" ],
        properties: { id: { type: "string" }, type: { type: "string", enum: Object.values( PriceType ) } },
    };

    const ENTITLEMENT_SCHEMA : Validation.Schema =
    {
        type: "object", additionalProperties: false, required: [ "enabled" ],
        properties: {
            enabled: { type: "boolean" },
            limit: {
                type: "object", additionalProperties: false, required: [ "metric", "included", "hardCap" ],
                properties: {
                    metric:   { type: "string" },
                    included: { type: "number" },
                    period:   { type: "string", enum: Object.values( Interval ) },
                    hardCap:  { type: "boolean" },
                },
            },
        },
    };

    const PLAN_FEATURE_SCHEMA : Validation.Schema =
    {
        type: "object", additionalProperties: false, required: [ "featureId", "entitlement", "prices" ],
        properties: {
            featureId:   { type: "string" },
            entitlement: ENTITLEMENT_SCHEMA,
            prices:      { type: "array", items: PRICE_COMPONENT_SCHEMA },
        },
    };

    /** JSON Schema + validator for `Plan` (the catalog template). */
    export const PLAN_SCHEMA : Validation.Schema =
    {
        $schema: "http://json-schema.org/draft-07/schema#",
        type: "object", additionalProperties: false,
        required: [ "id", "key", "name", "visibility", "version", "status", "currency", "features", "createdAt" ],
        properties: {
            id:          { type: "string" },
            key:         { type: "string" },
            name:        { type: "string" },
            description: { type: "string" },
            visibility:  { type: "string", enum: Object.values( PlanVisibility ) },
            accountId:   { type: "string" },     // REQUIRED when visibility === PRIVATE (enforced in service logic)
            version:     { type: "integer", minimum: 1 },
            status:      { type: "string", enum: Object.values( PlanStatus ) },
            currency:    { type: "string" },
            features:    { type: "array", items: PLAN_FEATURE_SCHEMA },
            basePrice:   { type: "array", items: PRICE_COMPONENT_SCHEMA },
            createdAt:   { type: "string", format: "date-time" },
        },
    };

    export const validatePlan : Validation.Validator<Plan> = Validation.compile<Plan>( PLAN_SCHEMA );

    const PRICE_SNAPSHOT_SCHEMA : Validation.Schema =
    {
        type: "object", additionalProperties: false, required: [ "capturedAt", "planId", "planVersion", "features" ],
        properties: {
            capturedAt:  { type: "string", format: "date-time" },
            planId:      { type: "string" },
            planVersion: { type: "integer", minimum: 1 },
            features:    { type: "array", items: PLAN_FEATURE_SCHEMA },
            basePrice:   { type: "array", items: PRICE_COMPONENT_SCHEMA },
        },
    };

    const APPLIED_COUPON_SCHEMA : Validation.Schema =
    {
        type: "object", additionalProperties: false, required: [ "couponId", "appliedAt" ],
        properties: {
            couponId:  { type: "string" },
            appliedAt: { type: "string", format: "date-time" },
            appliedBy: { type: "string" },
            expiresAt: { type: "string", format: "date-time" },
        },
    };

    /** JSON Schema + validator for `Subscription` (an account's plan instance). */
    export const SUBSCRIPTION_SCHEMA : Validation.Schema =
    {
        $schema: "http://json-schema.org/draft-07/schema#",
        type: "object", additionalProperties: false,
        required: [ "id", "accountId", "planId", "planVersion", "status", "startAt", "currentPeriodStart", "currentPeriodEnd", "snapshot", "coupons", "createdAt" ],
        properties: {
            id:                 { type: "string" },
            accountId:          { type: "string" },
            planId:             { type: "string" },
            planVersion:        { type: "integer", minimum: 1 },
            status:             { type: "string", enum: Object.values( SubscriptionStatus ) },
            startAt:            { type: "string", format: "date-time" },
            endAt:              { type: "string", format: "date-time" },
            currentPeriodStart: { type: "string", format: "date-time" },
            currentPeriodEnd:   { type: "string", format: "date-time" },
            snapshot:           PRICE_SNAPSHOT_SCHEMA,
            coupons:            { type: "array", items: APPLIED_COUPON_SCHEMA },
            externalRef:        { type: "string" },
            createdAt:          { type: "string", format: "date-time" },
        },
    };

    export const validateSubscription : Validation.Validator<Subscription> = Validation.compile<Subscription>( SUBSCRIPTION_SCHEMA );
}

export default Billing;
