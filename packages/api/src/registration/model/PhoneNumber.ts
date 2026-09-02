//
// PhoneNumber — the standalone number-acquisition model (registration-4.x extension): search/order/release
// for LONG_CODE + TOLL_FREE numbers, toll-free verification (TFV), and the short-code application record.
// Distinct from `Registration.Campaign.phoneNumbers` (the bare E.164 array a campaign's bulk
// `provisionNumbers` call still populates) — this is the account's OWN inventory row per number, with its
// own lifecycle, so a person can search/pick/order ONE specific number rather than only a blind bulk count.
//
// Reuses `Texting.NumberType` (LONG_CODE/TOLL_FREE/SHORT_CODE) rather than redefining it — one closed set,
// shared across registration (which provisions) and texting (which consumes), per CLAUDE.md's "define the
// model once" rule.
//
import { Texting } from "../../texting/model/Texting";
import { Registration } from "./Registration";

export namespace PhoneNumber
{
    // ── Number order (LONG_CODE / TOLL_FREE) ──────────────────────────────────────────────────────

    /** A number order's lifecycle — `PENDING` while the carrier's order is in flight (some carriers confirm
     *  async), `ACTIVE` once owned, `FAILED`/`RELEASED` terminal. */
    export enum OrderStatus { PENDING = "pending", ACTIVE = "active", FAILED = "failed", RELEASED = "released" }

    /** Toll-free verification status (TFV) — a separate, async, carrier-reviewed business attestation a
     *  TOLL_FREE number needs for A2P eligibility. Modeled after the real Telnyx/Bandwidth/Vonage TFV APIs:
     *  submit → webhook/poll → verified|rejected. */
    export enum TfvStatus { NOT_STARTED = "not-started", SUBMITTED = "submitted", IN_REVIEW = "in-review", VERIFIED = "verified", REJECTED = "rejected" }

    /** The business-attestation fields every carrier's real TFV submission requires (registration-4.x). */
    export interface TollFreeVerification
    {
        status            : TfvStatus;
        businessName      : string;
        businessWebsite   : string;
        useCase           : string;
        optInWorkflow     : string;   // how the recipient opted in — carriers require this described in prose
        monthlyVolume     : number;
        submittedAt?      : string;
        decidedAt?        : string;
        rejectionReason?  : string;
    }

    /** One account-owned number (registration-4.x). `campaignId` is required to ORDER a LONG_CODE (the carrier
     *  won't sell one without an approved campaign to bind it to); TOLL_FREE has no campaign requirement, only
     *  the separate TFV attestation. `number` is undefined while `PENDING` on a carrier whose order confirms
     *  asynchronously. */
    export interface PhoneNumber
    {
        id                    : string;    // OUR stable id (minted at order time) — the DynamoDB sort key
        accountId             : string;
        number?               : string;    // E.164 — set once the carrier confirms
        numberType            : Texting.NumberType;
        carrier               : Registration.CarrierProvider;
        carrierOrderId?       : string;    // the carrier's own order/reference id, for support + reconciliation
        status                : OrderStatus;
        campaignId?           : string;    // LONG_CODE — the approved campaign this number is bound to
        tollFreeVerification? : TollFreeVerification;   // TOLL_FREE only
        failureReason?        : string;

        // poll-sweep bookkeeping (system-managed) — mirrors Registration.Brand/Campaign's identical pair;
        // cleared once the row (and any in-flight TFV) reaches a terminal state.
        nextPollAt?           : string;
        pollAttempts?         : number;

        orderedAt             : string;
        activatedAt?          : string;
        releasedAt?           : string;
    }

    // ── Short code application ────────────────────────────────────────────────────────────────────

    /** Vanity (a chosen, memorable digit string, subject to availability) vs random (carrier-assigned) —
     *  the only two real-world short-code request shapes. */
    export enum ShortCodePreference { VANITY = "vanity", RANDOM = "random" }

    /** No carrier exposes a self-serve short-code ORDER api (verified — Telnyx/Bandwidth/Vonage all require a
     *  sales/ops-mediated application + 8-12+ week carrier certification). This status set is therefore
     *  STAFF-progressed (`PatchRegistrationShortCodeApplication`, ROOT-gated), not carrier-webhook-driven. */
    export enum ShortCodeStatus { SUBMITTED = "submitted", CARRIER_REVIEW = "carrier-review", ACTIVE = "active", REJECTED = "rejected" }

    export interface ShortCodeApplication
    {
        id             : string;
        accountId      : string;
        preference     : ShortCodePreference;
        vanityCode?    : string;   // requested digits, when preference = VANITY
        useCase        : string;
        campaignId?    : string;   // the campaign the eventual short-code traffic will run under
        status         : ShortCodeStatus;
        shortCode?     : string;   // assigned once ACTIVE
        staffNote?     : string;
        submittedAt    : string;
        decidedAt?     : string;
    }
}

export default PhoneNumber;
// eof
