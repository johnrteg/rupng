//
import { Type } from "@repo/common";
import { Validation } from "../../model/Validation";

//
// Account — the shared **wire contract** types for the account domain: the `Account.Entity` record
// plus its enums/value objects. Defined ONCE here so every account endpoint (GetAccount, PostAccount,
// PatchAccount, the list query, …) imports the same canonical shapes and can't drift. Endpoint files
// keep only their own request/response wiring.
//
// This is the API DTO layer — distinct from the service-internal storage/billing model in
// apps/core/account/src/Model.ts (which holds fields the API never exposes). Scalars come from
// @repo/common's `Type`.
//
export namespace Account
{
    /** Account lifecycle status. */
    export enum Status
    {
        PENDING   = "pending",      // created, awaiting verification / activation
        ACTIVE    = "active",       // normal, in good standing
        REVIEW    = "review",       // flagged — under manual review
        SUSPENDED = "suspended",    // temporarily halted (admin / billing)
        DISABLED  = "disabled",     // turned off by an admin
        INACTIVE  = "inactive",     // dormant — no activity
        HIDDEN    = "hidden",       // hidden from listings (staff-only visibility)
        CANCELLED = "cancelled",    // closed by the account
        DELETED   = "deleted",      // soft-deleted / erased
    }

    /** Whether a parent account may act in this (sub-)account (account-2.3). */
    export enum ParentAccess
    {
        OPEN    = "open",           // parent may act in this account without an explicit grant
        GRANTED = "granted",        // parent requires an explicit cross-account grant
    }

    /** High-level organization classification. */
    export enum OrganizationType
    {
        BUSINESS   = "business",
        NONPROFIT  = "nonprofit",
        GOVERNMENT = "government",
        POLITICAL  = "political",
        EDUCATION  = "education",
        INDIVIDUAL = "individual",
        OTHER      = "other",
    }

    export interface Organization
    {
        type     : OrganizationType;
        subType? : string;          // legal/tax classification, e.g. "501(c)(3)", "PAC", "LLC"
    }

    /** Primary point of contact for the account. */
    export interface Poc
    {
        name  : string;
        email : Type.Email;
    }

    /** Per-account feature-flag overrides — boolean on/off, string A/B variant, or numeric gate. */
    export type FeatureFlags = Record<string, boolean | string | number>;

    /** The account record as exposed by the API. */
    export interface Entity
    {
        id              : Type.UUID;
        parentId?       : Type.UUID;          // parent account (sub-account hierarchy)
        name            : string;
        status          : Status;
        organization    : Organization;       // type + sub-type (e.g. nonprofit · 501(c)(3))
        parentAccess    : ParentAccess;       // parent's ability to act in this account
        tags            : Array<string>;
        suspendedReason : string;
        
        poc             : Poc;                // primary point of contact { name, email }
        billingPoc?     : Poc;                // primary point of contact { name, email }
        
        website?        : Type.Url;
        brandedDomain?  : string;             // whitelabel custom domain
        logoUrl?        : Type.Url;           // whitelabel logo
        timezone        : Type.TimeZone;      // IANA tz — the account default
        featureFlags    : FeatureFlags;       // per-account flag overrides
        joinCode        : string;             // shareable code to join this account
        address         : Type.Address;
        billingAddress? : Type.Address;
        createdAt       : Type.ISODateTime;
        modifiedAt      : Type.ISODateTime;
    }

    // ── Schema + validator for the API record `Entity` (wire + messaging shape) ──────────────────
    // `address` / `billingAddress` are @repo/common Type.Address — validated loosely here (the address
    // shape is owned by @repo/common); featureFlags values are boolean | string | number.
    /** Primary point of contact { name, email }. */
    const POC_SCHEMA : Validation.Schema =
    {
        type: "object", additionalProperties: false, required: [ "name", "email" ],
        properties: { name: { type: "string" }, email: { type: "string", format: "email" } },
    };

    export const SCHEMA : Validation.Schema =
    {
        $schema: "http://json-schema.org/draft-07/schema#",
        type: "object", additionalProperties: false,
        required: [ "id", "name", "status", "organization", "parentAccess", "tags", "suspendedReason", "poc", "timezone", "featureFlags", "joinCode", "address", "createdAt", "modifiedAt" ],
        properties:
        {
            id:           { type: "string", format: "uuid" },
            parentId:     { type: "string", format: "uuid" },
            name:         { type: "string" },
            status:       { type: "string", enum: Object.values( Status ) },
            organization: {
                type: "object", additionalProperties: false, required: [ "type" ],
                properties: { type: { type: "string", enum: Object.values( OrganizationType ) }, subType: { type: "string" } },
            },
            parentAccess:    { type: "string", enum: Object.values( ParentAccess ) },
            tags:            { type: "array", items: { type: "string" } },
            suspendedReason: { type: "string" },
            poc:             POC_SCHEMA,
            billingPoc:      POC_SCHEMA,
            website:         { type: "string", format: "uri" },
            brandedDomain:   { type: "string" },
            logoUrl:         { type: "string", format: "uri" },
            timezone:        { type: "string" },          // IANA tz
            featureFlags:    { type: "object", additionalProperties: { type: [ "boolean", "string", "number" ] } },
            joinCode:        { type: "string" },
            address:         { type: "object" },          // Type.Address (owned by @repo/common)
            billingAddress:  { type: "object" },
            createdAt:       { type: "string", format: "date-time" },
            modifiedAt:      { type: "string", format: "date-time" },
        },
    };

    /** Validate an `Account.Entity` (a wire payload, a Kafka/SQS message body). */
    export const validate : Validation.Validator<Entity> = Validation.compile<Entity>( SCHEMA );
}

export default Account;
