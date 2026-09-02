//
// Print — the core wire contracts for the print SEND channel (see apps/core/print/SPECS.md). Defined ONCE here
// in @repo/api so the print service, its jobs, and S2S callers (campaign / workflow) share one vocabulary — the
// same shape as Voice (packages/api/src/voice/model/Voice.ts) and Email. Print is a PHYSICAL channel: a
// Mailpiece is rendered → address-verified → submitted to a mail-fulfillment provider (PostGrid/Lob) → tracked
// via USPS scan events. Address verification is a SEPARATE, decoupled provider factory (AddressVerifierId) from
// mail fulfillment (Provider) — you can verify with one source and mail with another (print-2.6).
//
export namespace Print
{
    /** The mail-fulfillment provider a mailpiece is submitted through — the provider factory selects by this
     *  value. A closed set (one adapter per value). Adding a partner (print-3.1) is a new adapter + a new enum
     *  value, not a new pipeline. */
    export enum Provider
    {
        POSTGRID = "postgrid",
        LOB      = "lob",
        FAKE     = "fake",
    }

    /** An address-verification source (print-2.6) — a SEPARATE, independent typed factory from the mail
     *  provider above (verify with one, mail with another). Each source declares its `Capability` set; NCOA
     *  routes only to a licensed NCOALink source. */
    export enum AddressVerifierId
    {
        USPS           = "usps",
        POSTGRID       = "postgrid",
        LOB            = "lob",
        MELISSA        = "melissa",
        SMARTYSTREETS  = "smartystreets",
        FAKE           = "fake",
    }

    /** What an `AddressVerifier` source can do — a source declares one or both; the service routes per
     *  operation (print-2.6). NCOA is regulated (licensed NCOALink only); CASS is standardization/DPV. */
    export enum Capability
    {
        CASS = "cass",
        NCOA = "ncoa",
    }

    /** The physical form of one mailpiece (print-1.1). */
    export enum MailpieceType
    {
        POSTCARD    = "postcard",
        LETTER      = "letter",
        SELF_MAILER = "self-mailer",
        CHECK       = "check",
    }

    /** First-Class vs Marketing Mail/Standard (print-6.4) — drives lead-time + cost; account default,
     *  campaign-overridable. */
    export enum MailClass
    {
        FIRST_CLASS = "first-class",
        MARKETING   = "marketing",
    }

    /** A mailpiece's lifecycle status — the render/verify/submit/track spine (print-1/2/3/4) plus the
     *  pre-send gates (proof approval, suppression). */
    export enum MailpieceStatus
    {
        DRAFT           = "draft",
        PENDING_PROOF   = "pending-proof",
        PROOF_APPROVED  = "proof-approved",
        RENDERING       = "rendering",
        READY           = "ready",           // rendered + verified; queued for paced submit
        SUBMITTED       = "submitted",       // handed to the mail-fulfillment provider
        IN_PRODUCTION   = "in-production",
        MAILED          = "mailed",
        IN_TRANSIT      = "in-transit",
        DELIVERED       = "delivered",
        RETURNED        = "returned",
        UNDELIVERABLE   = "undeliverable",
        FAILED          = "failed",
        SUPPRESSED      = "suppressed",       // blocked before submit — do-not-mail / deceased / vacant / bad address
    }

    /** A USPS scan lifecycle status, as relayed by the mail-fulfillment provider's tracking webhook
     *  (print-4.1) — a strict subset of `MailpieceStatus`'s physical states. */
    export enum TrackingStatus
    {
        IN_PRODUCTION = "in-production",
        MAILED        = "mailed",
        IN_TRANSIT    = "in-transit",
        DELIVERED     = "delivered",
        RETURNED      = "returned",
        UNDELIVERABLE = "undeliverable",
    }

    /** A postal address — the recipient or sender/return address on a mailpiece. Print does NOT own address
     *  storage (that's [contact](../contact/SPECS.md) `Contact.AddressEntry`) — this is the shape a mailpiece
     *  carries at submit time (a snapshot, not a live reference). */
    export interface Address
    {
        name?:       string;   // recipient/sender display name for the address block
        line1:       string;
        line2?:      string;
        city:        string;
        region:      string;   // state / province
        postalCode:  string;
        country:     string;   // ISO 3166-1 alpha-2
    }

    /** The verification result STAMPED on a mailpiece (print-2) — composed from the two caches: the
     *  address-intrinsic layer (`standardized`/`deliverability`/`vacant`, from the global `VerifiedAddress`
     *  cache) and the person-specific layer (`ncoaApplied`/`deceased`, cached on the contact — print doesn't
     *  own that cache, it only reads/writes the stamp here). */
    export interface AddressVerification
    {
        standardized:     Address;
        deliverability:   Deliverability;
        ncoaApplied?:     boolean;
        deceased?:        boolean;
        vacant?:          boolean;
        verifier:         AddressVerifierId;
        verifiedAt:       string;
        cacheHit?:        boolean;   // true when served from the global VerifiedAddress cache (no vendor call)
    }

    /** CASS/DPV deliverability scoring (print-2.1). */
    export enum Deliverability
    {
        DELIVERABLE   = "deliverable",
        UNDELIVERABLE = "undeliverable",
        UNKNOWN       = "unknown",
    }

    /** One mailpiece — what to mail (print-8.1). `pk=ACCOUNT#<accountId> sk=MAIL#<mailId>`. Archived, never
     *  silently dropped (print-8.2). */
    export interface Mailpiece
    {
        accountId:          string;
        mailId:             string;
        type:               MailpieceType;
        templateId:         string;
        mergeData:          Record<string, unknown>;
        recipient:          Address;
        sender:             Address;
        provider:           Provider;
        mailClass:          MailClass;
        status:             MailpieceStatus;
        costEstimateCents?: number;
        addressVerification?: AddressVerification;
        purl?:              string;    // per-recipient tracked URL (links/tracking — print-5.1); a merge variable, not minted here
        proofUrl?:          string;    // presigned URL to the rendered proof PDF (S3)
        renderedPdfKey?:    string;    // the S3 object key of the print-ready PDF (post-render)
        approvedAt?:        string;
        approvedBy?:        string;
        campaignId?:        string;
        contactId?:         string;    // the contact this piece addresses — resolves the S2S forget hook's fan-out
        arriveBy?:          string;    // ISO date the campaign wants this delivered by (drives PrintScheduleJob)
        providerRefId?:     string;    // the mail-fulfillment provider's own reference (post-submit)
        error?:             string;
        createdAt:          string;
        updatedAt:          string;
    }

    // ── Address database (print-2.7/2.8) — ONE global, contact-free, cross-account cache ────────

    /** The verification record — GLOBAL, cross-account, person-free (print-2.7). `pk=ADDR#<hash(normalized
     *  address)> sk=META`. NO contact, NO name — not tied to a person; a contact's OWN copy of the result lives
     *  in [contact](../contact/SPECS.md), not here. */
    export interface VerifiedAddress
    {
        addrHash:        string;
        standardized:    Address;
        deliverability:  Deliverability;
        vacant?:         boolean;
        verifier:        AddressVerifierId;
        externalRefId?:  string;
        verifiedAt:      string;
        freshUntil?:     string;   // optional TTL — a refresh past this is a new cold lookup (cost event)
    }

    /** The address tracks WHICH ACCOUNTS accessed/paid for the lookup (print-2.8) — commercial data (an
     *  `accountId`, never a contact). `pk=ADDR#<hash> sk=ACCT#<accountId>`. Existence = "this account already
     *  paid" → charge-once-per-account idempotency. */
    export interface AddressUsage
    {
        addrHash:       string;
        accountId:      string;
        chargedAt:      string;
        amountChargedCents: number;
        wasVendorCost:  boolean;   // true only on the FIRST requester overall (we incurred the vendor cost)
        ourCostCents?:  number;    // the vendor cost we incurred — set only when wasVendorCost is true
    }

    /** A request to verify one address (print-2.1/2.2) — `ncoa` opts into the person-specific move-update
     *  layer (contact-scoped cache — the caller supplies `contactId` so the hybrid cache (gap #5) can be
     *  consulted/written there). */
    export interface AddressVerifyRequest
    {
        accountId:   string;
        address:     Address;
        contactId?:  string;
        ncoa?:       boolean;
        verifier?:   AddressVerifierId;   // override the resolved default
    }

    /** The result of an address verification (print-2). */
    export interface AddressVerifyResult
    {
        verification: AddressVerification;
        cacheHit:     boolean;
        charged:      boolean;
    }

    // ── Tracking (print-4) ────────────────────────────────────────────────────────────────────

    /** One USPS scan event relayed by the mail-fulfillment provider (print-4.1). `pk=ACCOUNT#<accountId>
     *  sk=MAIL#<mailId>#<at>`. `occurredAt` is the USPS scan time (not our ingest time). */
    export interface TrackingEvent
    {
        accountId:      string;
        mailId:         string;
        status:         TrackingStatus;
        occurredAt:     string;
        providerEventId?: string;
        note?:          string;
    }

    // ── Templates (print-1/3.3) — this service owns the SCHEMA + render; the SVG designer UI is web ────

    /** A print template — the SVG-canvas schema (print-2.1) merges data into a print-ready artifact; v1
     *  compiles down to a BOUGHT provider template (gap #4) via `providerTemplateId`. `schema` is an opaque
     *  designer document (the web app's SVG canvas JSON) — print doesn't interpret its internals, only compiles
     *  + renders it. */
    export interface Template
    {
        id:                string;
        accountId:         string;
        name:              string;
        type:              MailpieceType;
        schema:            Record<string, unknown>;
        providerTemplateId?: string;
        archived?:         boolean;
        createdAt:         string;
        updatedAt:         string;
    }

    // ── Cost & scheduling (print-6) ───────────────────────────────────────────────────────────

    /** A cost + lead-time preview request (print-6.2) — per-piece cost × recipient count, plus the
     *  production+transit lead-time estimate for the chosen mail class. */
    export interface CostPreviewRequest { accountId : string; type : MailpieceType; mailClass : MailClass; recipients : number; provider? : Provider; }

    /** The cost + lead-time preview result. */
    export interface CostPreviewResult { perPieceCents : number; recipients : number; totalCents : number; leadTimeDays : number; mailClass : MailClass; }

    /** A rendered proof preview (print-1.4). */
    export interface ProofResult { proofUrl : string; mailId? : string; }

    // ── Retry / DLQ (mirrors voice-5.0) ────────────────────────────────────────────────────────

    /** The source queues that can dead-letter (each has a `<key>-dlq` companion — print-9). */
    export enum DlqQueue
    {
        RENDER   = "print-render",
        SUBMIT   = "print-submit",
        TRACKING = "print-tracking",
    }

    /** One dead-lettered message, as read back from its `<queue>-dlq` companion. */
    export interface DlqItem
    {
        queue               : DlqQueue;
        messageId           : string;
        receiptHandle       : string;
        body                : string;
        approxReceiveCount? : number;
    }
}

export default Print;
// eof
