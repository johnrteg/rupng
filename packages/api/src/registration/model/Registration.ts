//
// Registration — the core wire contracts for A2P registration/compliance (see apps/core/registration/SPECS.md).
// TCR/10DLC is the first implementation; the namespace is named `Registration`, not `Tcr`, so toll-free
// verification, short codes, and international registries fit later without a new namespace (registration-8.1).
// Requirements were mined from a legacy CSP's working TCR integration (brand/campaign data model, TCR +
// Campaign Verify webhook-driven state machines, per-carrier provisioning quirks) — see the project memory
// `tcr-requirements-legacy-mining.md`. Registration is a DynamoDB PROJECTION of TCR's state — TCR/the CSP is
// the source of truth; every field here mirrors what TCR reports, reconciled via webhooks + a poll sweep
// (registration-5.0), never treated as locally authoritative.
//
import { Billing } from "../../account/model/Billing";

export namespace Registration
{
    // ── Brand ──────────────────────────────────────────────────────────────────────────────────

    /** The legal entity type of a brand (registration-1.1) — drives which additional KYC fields are required.
     *  A closed set (TCR's own classification). */
    export enum EntityType
    {
        SOLE_PROPRIETOR = "sole-proprietor",
        PRIVATE_PROFIT  = "private-profit",
        PUBLIC_PROFIT   = "public-profit",
        NON_PROFIT      = "non-profit",
        GOVERNMENT      = "government",
    }

    /** TCR's industry/vertical classification for a brand — a closed set, drives use-case eligibility + vetting. */
    export enum Vertical
    {
        AGRICULTURE    = "agriculture",
        COMMUNICATION  = "communication",
        CONSTRUCTION   = "construction",
        EDUCATION      = "education",
        ENERGY         = "energy",
        ENTERTAINMENT  = "entertainment",
        FINANCIAL      = "financial",
        GAMBLING       = "gambling",
        GOVERNMENT     = "government",
        HEALTHCARE     = "healthcare",
        HOSPITALITY    = "hospitality",
        HUMAN_RESOURCES = "human-resources",
        INSURANCE      = "insurance",
        LEGAL          = "legal",
        MANUFACTURING  = "manufacturing",
        MEDIA          = "media",
        NGO            = "ngo",
        POLITICAL      = "political",
        POSTAL         = "postal",
        PROFESSIONAL   = "professional",
        REAL_ESTATE    = "real-estate",
        RETAIL         = "retail",
        TECHNOLOGY     = "technology",
        TRANSPORTATION = "transportation",
    }

    /** Granular sub-classification for POLITICAL brands (registration-1.1) — drives which vetting path
     *  (Campaign Verify vs Aegis) and which use case is expected. */
    export enum PoliticalType
    {
        FEDERAL_CANDIDATE     = "federal-candidate",
        STATE_CANDIDATE       = "state-candidate",
        LOCAL_CANDIDATE       = "local-candidate",
        PARTY_COMMITTEE       = "party-committee",
        PAC                   = "pac",
        NON_PROFIT_501C3      = "501c3",
        NON_PROFIT_501C4      = "501c4",
        NON_PROFIT_501C5      = "501c5",
        NON_PROFIT_501C6      = "501c6",
        TRIBAL_ENTITY         = "tribal-entity",
        POLLING_COMPANY       = "polling-company",
        OTHER                 = "other",
    }

    /** Which external vetting provider ran a brand's identity/trust check (registration-11.3). `CV` (Campaign
     *  Verify) is a distinct 3rd-party product bridged into TCR's own vetting via an imported token; `AEGIS`/
     *  `WMC` are TCR's built-in EVP partners. */
    export enum VettingProvider
    {
        CV    = "campaign-verify",
        AEGIS = "aegis",
        WMC   = "wmc",
    }

    /** The reconciled brand pipeline status (registration-3.1's brand half). Mirrors TCR's identity-verification
     *  + vetting webhooks; a `FAILED` state is reachable only via Campaign Verify's explicit rejection — an
     *  EVP (Aegis/WMC) scoring failure routes to `NEEDS_APPEAL` instead, never silently to `FAILED`. */
    export enum BrandStatus
    {
        DRAFT             = "draft",
        SUBMITTED         = "submitted",
        IN_REVIEW         = "in-review",
        PIN_SENT          = "pin-sent",
        PIN_INPUTTED      = "pin-inputted",
        APPROVED          = "approved",
        NEEDS_APPEAL      = "needs-appeal",
        APPEAL_IN_PROGRESS = "appeal-in-progress",
        FAILED            = "failed",
        EXPIRED           = "expired",
    }

    /** One entry in a brand/campaign's audit trail (registration-9.3) — every status transition is appended,
     *  never overwritten, so the remediation/override history is fully reconstructable. */
    export interface StatusHistoryEntry<Status>
    {
        status    : Status;
        time      : string;
        reason?   : string;
        overridden? : boolean;   // set when this transition came from PostRegistrationOverride (registration-11.6)
    }

    /** A registered TCR Brand (registration-1.0) — brand-per-account (registration-1.1): the account is the
     *  legal sender, we facilitate as a direct CSP (SPECS.md gap #1, resolved). Entity-type-conditional fields
     *  (person name vs company name+EIN vs public-company stock symbol) are ALL declared here as optional and
     *  validated conditionally by `entityType` in the impl/schema, per CLAUDE.md's closed-set convention —
     *  never a second parallel shape per entity type. */
    export interface Brand
    {
        accountId          : string;
        brandId?           : string;      // OUR stable projection key (minted at DRAFT creation) — the DynamoDB sort key
        tcrBrandId?        : string;      // TCR's OWN assigned brand id; absent until TCR accepts the submission
        entityType         : EntityType;

        // sole-proprietor fields
        firstName?         : string;
        lastName?          : string;

        // company fields (private/public-profit, non-profit, government)
        companyName?       : string;
        ein?               : string;
        einIssuingCountry? : string;

        // public-profit-only fields
        stockSymbol?       : string;
        stockExchange?     : string;

        // contact / address (required for every entity type)
        email              : string;
        phone              : string;
        street             : string;
        city               : string;
        state              : string;
        postalCode         : string;
        country             : string;

        website?           : string;
        vertical           : Vertical;
        politicalType?     : PoliticalType;
        altBusinessId?     : string;
        altBusinessIdType? : string;

        // vetting-derived (system-managed, mirrored from TCR/the vetting provider — never user-editable)
        identityStatus?    : string;
        vettingProvider?   : VettingProvider;
        vettingClass?      : string;
        vettingScore?      : number;
        vettingData?       : string;
        cvId?              : string;
        cvStatus?          : string;

        status             : BrandStatus;
        statusHistory      : Array<StatusHistoryEntry<BrandStatus>>;
        rejectionReason?   : string;   // registration-3.2 — surfaced to the account for edit + resubmit
        overridden?        : boolean;  // registration-11.6 — set by a staff override; re-flagged (not cleared) if the next sync disagrees

        // registration-5.3 poll-sweep bookkeeping (system-managed) — the sweep reconciles only rows whose
        // `nextPollAt` is due and backs off via `pollAttempts`; both are CLEARED once the row reaches a
        // terminal status, which is how "stop polling on terminal" is enforced without a second index.
        nextPollAt?        : string;
        pollAttempts?      : number;

        createdAt          : string;
        updatedAt          : string;
    }

    // ── Campaign ───────────────────────────────────────────────────────────────────────────────

    /** TCR's use-case catalog (registration-2.0) — a closed set; each maps to a monthly fee + sub-usecase
     *  cardinality in `RegistrationConfig.USE_CASE_CATALOG`. */
    export enum UseCase
    {
        TWO_FACTOR              = "2fa",
        ACCOUNT_NOTIFICATION    = "account-notification",
        CARRIER_EXEMPTIONS      = "carrier-exemptions",
        CHARITY                 = "charity",
        CUSTOMER_CARE           = "customer-care",
        DELIVERY_NOTIFICATION   = "delivery-notification",
        EMERGENCY               = "emergency",
        FRAUD_ALERT             = "fraud-alert",
        HIGHER_EDUCATION        = "higher-education",
        K12_EDUCATION           = "k12-education",
        LOW_VOLUME_MIXED        = "low-volume-mixed",
        MARKETING               = "marketing",
        MIXED                   = "mixed",
        POLITICAL               = "political",
        POLLING_VOTING          = "polling-voting",
        PROXY                   = "proxy",
        PUBLIC_SERVICE_ANNOUNCEMENT = "public-service-announcement",
        SECURITY_ALERT          = "security-alert",
        SOCIAL                  = "social",
        SOLE_PROPRIETOR         = "sole-proprietor",
        SWEEPSTAKE              = "sweepstake",
        TRIAL                   = "trial",
    }

    /** The carrier network provider (CNP) a campaign's numbers are provisioned through (registration-6.0). A
     *  closed set — one adapter per value, selected by `CarrierFactory` (registration-6.1). Only `FAKE` has an
     *  adapter until a real carrier is wired; adding one is a new adapter + enum value, never a call-site change. */
    export enum CarrierProvider
    {
        FAKE      = "fake",
        BANDWIDTH = "bandwidth",
        TELNYX    = "telnyx",
        VONAGE    = "vonage",
    }

    /** The reconciled campaign pipeline status (registration-3.1) — `draft → submitted → pending-vetting →
     *  approved/rejected → number-associated → active`, with `rejected` looping back to `submitted` via
     *  PostRegistrationResubmit (registration-3.2/11.4), and `suspended`/`expired` as terminal drift states the
     *  poll sweep stops polling on (registration-5.3). */
    export enum CampaignStatus
    {
        DRAFT             = "draft",
        SUBMITTED         = "submitted",
        PENDING_VETTING   = "pending-vetting",
        IN_REVIEW         = "in-review",
        APPROVED          = "approved",
        REJECTED          = "rejected",
        NUMBER_ASSOCIATED = "number-associated",
        ACTIVE            = "active",
        SUSPENDED         = "suspended",
        EXPIRED           = "expired",
    }

    /** Per-MNO (carrier) approval rollup (mirrors TCR's `operationStatus` call) — `INCOMPLETE` unless every
     *  configured MNO reports approved/registered. */
    export enum OperationsStatus
    {
        INCOMPLETE = "incomplete",
        APPROVED   = "approved",
    }

    /** Opt-in / help / opt-out keyword + message block — required on every campaign (registration-2.1); TCR
     *  itself rejects too-short copy, so the length floor here is a pass-through of a real external constraint. */
    export interface ComplianceMessage { keywords : Array<string>; message : string; }

    /** A registered TCR Campaign (registration-2.0) under an APPROVED brand. */
    export interface Campaign
    {
        accountId              : string;
        brandId                : string;
        campaignId?            : string;   // OUR stable projection key (minted at DRAFT creation) — the DynamoDB sort key
        tcrCampaignId?         : string;   // TCR's OWN assigned campaign id; absent until TCR accepts the submission

        usecase                : UseCase;
        subUsecases            : Array<UseCase>;
        description            : string;   // 40-4096 chars — TCR's own floor
        messageFlow            : string;   // 40-4096 chars

        sample1                : string;   // 20-1024 chars
        sample2                : string;
        sample3?               : string;
        sample4?               : string;
        sample5?               : string;

        optin                  : ComplianceMessage;
        help                   : ComplianceMessage;
        optout                 : ComplianceMessage;

        subscriberOptin        : boolean;
        subscriberOptout       : boolean;
        subscriberHelp         : boolean;
        embeddedLink           : boolean;
        embeddedPhone          : boolean;
        numberPool             : boolean;
        ageGated               : boolean;
        directLending          : boolean;
        affiliateMarketing     : boolean;
        autoRenewal            : boolean;

        privacyPolicyLink      : string;
        termsAndConditionsLink? : string;

        provider               : CarrierProvider;
        areaCode?              : string;
        phoneNumbers           : Array<string>;   // E.164 numbers live on this campaign today

        status                 : CampaignStatus;
        statusHistory          : Array<StatusHistoryEntry<CampaignStatus>>;
        operationsStatus?      : OperationsStatus;
        mnoMetadata?           : Record<string, unknown>;   // raw per-carrier metadata (daily caps, TPM) — mirrored, not modeled field-by-field
        rejectionReason?       : string;   // registration-3.2
        overridden?            : boolean;  // registration-11.6

        // registration-7.2 — the published trust-score → MPS interface; mirrored here for read/debug, but
        // texting/dispatch consume the PUBLISHED event (see EVENTS.md), never a lookup into this table.
        mps?                   : { perMinute? : number; perHour? : number; perDay? : number };

        // registration-5.3 poll-sweep bookkeeping (system-managed) — see Brand's identical pair.
        nextPollAt?            : string;
        pollAttempts?          : number;

        createdAt              : string;
        updatedAt              : string;
    }

    // ── Cost estimate (billing stub — see RegistrationConfig fee tables) ──────────────────────────

    /** Which legacy TCR charge point this estimate corresponds to (see the project memory
     *  `tcr-requirements-legacy-mining.md` §6 for the full legacy billing model this simplifies). */
    export enum CostEstimateKind
    {
        BRAND_REGISTRATION    = "brand-registration",
        VETTING               = "vetting",
        CAMPAIGN_REGISTRATION = "campaign-registration",
        CAMPAIGN_MONTHLY      = "campaign-monthly",
    }

    /** A COST-ESTIMATE ledger row — NOT a charge. No billing engine exists yet in this platform (the account
     *  service's billing endpoints are explicit skeletons; no Stripe/invoice engine is wired anywhere), so
     *  registration only records what WOULD be billed at each of the four legacy charge points, reusing the
     *  `Billing.Rate`/`Billing.Money` shapes so a later real billing integration is a drop-in swap of the write
     *  site, not a new shape. Surfaced via the `registration_cost_estimates` report. */
    export interface CostEstimate
    {
        id           : string;
        accountId    : string;
        brandId?     : string;
        campaignId?  : string;
        kind         : CostEstimateKind;
        description  : string;
        quantity     : number;
        unitAmount   : Billing.Rate;    // the per-unit fee resolved from RegistrationConfig at estimate time
        amount       : Billing.Money;   // settled estimate = quantity * unitAmount, rounded to whole cents
        estimatedAt  : string;
    }
}

export default Registration;
// eof
