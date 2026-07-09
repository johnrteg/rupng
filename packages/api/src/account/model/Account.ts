//
import { Type } from "@repo/common";
import { Access } from "@repo/endpoint";
import { Validation } from "../../model/Validation";
import { Contact } from "../../contact/model/Contact";

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

    /** A brand font — a PUBLIC web-font reference (name + a public, CORS-permissive, non-expiring URL) so it
     *  renders anywhere the brand does: the image editor, exported images, and email recipients' clients. Shared
     *  by Account + Campaign brand identity. */
    export interface BrandFont
    {
        name : string;   // font family name (as referenced in CSS)
        href : string;   // public stylesheet/font URL (e.g. a Google Fonts URL)
    }

    /** A brand SVG — a named vector graphic stored as inline MARKUP (not a URL) so it can be RECOLORED to the
     *  brand palette when placed in an editor. Shared by Account + Campaign brand identity (BYO marks/graphics). */
    export interface BrandSvg
    {
        name : string;   // display name
        svg  : string;   // the raw <svg>…</svg> markup
    }

    /** The account record as exposed by the API. */
    export interface Entity
    {
        id              : Type.UUID;
        parentId?       : Type.UUID;          // parent account (sub-account hierarchy)
        ownerId?        : Type.UUID;          // the user who created/owns this account (their "own" account)
        name            : string;
        status          : Status;
        organization    : Organization;       // type + sub-type (e.g. nonprofit · 501(c)(3))
        parentAccess    : ParentAccess;       // parent's ability to act in this account
        tags            : Array<string>;
        suspendedReason : string;
        suspendedByAncestor? : boolean;       // true = suspended only because an ancestor was (cleared on the ancestor's reactivation; independent suspensions stay)

        poc             : Poc;                // primary point of contact { name, email }
        billingPoc?     : Poc;                // primary point of contact { name, email }
        
        website?        : Type.Url;
        brandedDomain?  : string;             // whitelabel custom domain
        logoUrl?        : Type.Url;           // whitelabel logo
        palette?        : Array<string>;      // brand color palette (ordered hex values) — content creation + image search
        fonts?          : Array<BrandFont>;   // brand fonts (public web-font references) — content creation + image editor
        svgs?           : Array<BrandSvg>;    // brand SVG graphics (inline markup, recolorable) — image editor
        timezone        : Type.TimeZone;      // IANA tz — the account default
        featureFlags    : FeatureFlags;       // per-account flag overrides
        joinCode        : string;             // shareable code to join this account
        address         : Type.Address;
        billingAddress? : Type.Address;
        channels?       : Array<Contact.Channel>;   // outreach channels this account is allowed to use (undefined = all)
        createdAt       : Type.ISODateTime;
        modifiedAt      : Type.ISODateTime;
    }

    /**
     * Editable subset of the account — the PUT write shape (admins only). Identity + lifecycle fields
     * (id, ownerId, status, joinCode, parentAccess, featureFlags, timestamps) are NOT editable here; they
     * change via provisioning / admin transitions, not a self-service account edit.
     */
    export interface Update
    {
        name?         : string;
        organization? : Organization;
        poc?          : Poc;
        billingPoc?   : Poc;
        website?      : Type.Url;
        palette?      : Array<string>;            // brand color palette (ordered hex values)
        fonts?        : Array<BrandFont>;         // brand fonts (public web-font references)
        svgs?         : Array<BrandSvg>;          // brand SVG graphics (inline markup, recolorable)
        timezone?     : Type.TimeZone;
        address?      : Type.Address;
        channels?     : Array<Contact.Channel>;   // allowed outreach channels (account-determined)
    }

    /**
     * Read-time DEFAULTs — the safe baseline for fields an older / partial `accounts` row may be missing.
     * Apply with `ObjectUtils.withDefaults( row, Account.DEFAULT )` after a datastore read so callers always
     * get a complete-enough entity. Identity / lifecycle fields (`id`, `ownerId`, `parentId`, `name`,
     * `joinCode`, `createdAt`, `modifiedAt`) are intentionally OMITTED: a row genuinely missing them is an
     * anomaly we want to surface, not paper over with junk values.
     */
    export const DEFAULT : Partial<Entity> =
    {
        status:          Status.ACTIVE,
        organization:    { type: OrganizationType.OTHER },
        parentAccess:    ParentAccess.GRANTED,
        tags:            [],
        suspendedReason: "",
        poc:             { name: "", email: "" as Type.Email },
        timezone:        "UTC" as Type.TimeZone,
        featureFlags:    {},
        address:         {} as Type.Address,
        channels:        Object.values( Contact.Channel ),   // all channels allowed until narrowed
        palette:         [],                                 // no brand colors until the account sets them
        fonts:           [],                                 // no brand fonts until the account adds them
        svgs:            [],                                 // no brand SVGs until the account adds them
    };

    /** A member's access status within an account. */
    export enum MemberStatus
    {
        ACTIVE    = "active",       // normal access
        SUSPENDED = "suspended",    // access paused by an admin (NOT removed — reversible)
    }

    /** A user with access to an account — the account↔user membership, enriched for display. */
    export interface Member
    {
        userId       : Type.UUID;
        role         : Access.Role;          // the member's role in this account (the account ladder)
        status       : MemberStatus;
        name?        : string;               // denormalized display name (captured on add)
        email?       : Type.Email;           // denormalized email (captured on add)
        avatarAssetId? : string;             // denormalized avatar media guid — kept fresh by the media.asset (USER) event (media-23)
        owner?       : boolean;              // true = the account owner (can't be suspended / removed)
        createdAt    : Type.ISODateTime;     // when they were added
        lastLoginAt? : Type.ISODateTime;     // best-effort last-seen (optional)
    }

    /** A child account in the hierarchy, summarized for the sub-accounts list (account-2). Carries its own
     *  descendants (`children`) so the UI can render the full sub-tree as an expandable tree. */
    export interface SubAccount
    {
        id           : Type.UUID;
        name         : string;
        status       : Status;
        ownerId?     : Type.UUID;            // the sub-account's owner (the admin who created it)
        createdAt    : Type.ISODateTime;
        children?    : Array<SubAccount>;    // nested sub-accounts (present when this node has its own children)
    }

    /** Lifecycle of an invitation to join an account. */
    export enum InviteStatus
    {
        PENDING   = "pending",      // created / queued — the invite email hasn't gone out yet
        INVITED   = "invited",      // the invite email has been sent; awaiting the invitee
        ACCEPTED  = "accepted",     // materialized into a membership (the invitee joined)
        DECLINED  = "declined",     // the invitee declined the invitation
        CANCELLED = "cancelled",    // revoked by an admin (soft — kept for the record)
    }

    export interface Invite
    {
        inviteId   : Type.UUID;
        email      : Type.Email;
        role       : Access.Role;            // the role the invitee gets on accept
        status     : InviteStatus;
        invitedAt  : Type.ISODateTime;       // when first sent (how old the invite is)
        lastSentAt?: Type.ISODateTime;       // when last (re)sent
        invitedBy? : Type.UUID;              // the admin who invited
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
            ownerId:      { type: "string", format: "uuid" },
            name:         { type: "string" },
            status:       { type: "string", enum: Object.values( Status ) },
            organization: {
                type: "object", additionalProperties: false, required: [ "type" ],
                properties: { type: { type: "string", enum: Object.values( OrganizationType ) }, subType: { type: "string" } },
            },
            parentAccess:    { type: "string", enum: Object.values( ParentAccess ) },
            tags:            { type: "array", items: { type: "string" } },
            suspendedReason: { type: "string" },
            suspendedByAncestor: { type: "boolean" },
            poc:             POC_SCHEMA,
            billingPoc:      POC_SCHEMA,
            website:         { type: "string", format: "uri" },
            brandedDomain:   { type: "string" },
            logoUrl:         { type: "string", format: "uri" },
            palette:         { type: "array", items: { type: "string" } },   // ordered brand hex values
            fonts:           { type: "array", items: {
                type: "object", additionalProperties: false, required: [ "name", "href" ],
                properties: { name: { type: "string" }, href: { type: "string" } },
            } },
            svgs:            { type: "array", items: {
                type: "object", additionalProperties: false, required: [ "name", "svg" ],
                properties: { name: { type: "string" }, svg: { type: "string" } },
            } },
            timezone:        { type: "string" },          // IANA tz
            featureFlags:    { type: "object", additionalProperties: { type: [ "boolean", "string", "number" ] } },
            joinCode:        { type: "string" },
            address:         { type: "object" },          // Type.Address (owned by @repo/common)
            billingAddress:  { type: "object" },
            channels:        { type: "array", items: { type: "string", enum: Object.values( Contact.Channel ) } },
            createdAt:       { type: "string", format: "date-time" },
            modifiedAt:      { type: "string", format: "date-time" },
        },
    };

    /** Validate an `Account.Entity` (a wire payload, a Kafka/SQS message body). */
    export const validate : Validation.Validator<Entity> = Validation.compile<Entity>( SCHEMA );
}

export default Account;
