//
import { Type } from "@repo/common";
import { Access } from "@repo/endpoint";

import { MfaMethod } from "./AuthMethod";   // shared second-factor vocabulary (SoT — see AuthMethod.ts)
import { Validation } from "../../model/Validation";

//
// User — the **global user identity** contract owned by auth. A user has ONE identity and may belong
// to MANY accounts, each with a maximum role; the **account↔user membership is owned by the account
// service** (auth only *reads* it). This is the PUBLIC wire contract — never carries secrets.
//
// Two stores back a user; this contract splits its fields by source so reads/writes route correctly:
//   • COGNITO  — the credential authority + standard profile attributes (email, phone, name, picture,
//                locale, zoneinfo, MFA, federation). We do NOT duplicate these in our datastore.
//   • DYNAMODB — platform metadata Cognito can't hold (status, forced-reset, roles, timestamps, app icon).
//                The internal storage row is `Auth.UserProfile` (apps/core/auth/src/models/AuthModel.ts).
//
//   GET  /auth/user  → compose `Entity` = Cognito attributes ⊕ the DynamoDB row.
//   POST /auth/user  → `Update` is grouped by store: `cognito` → Cognito AdminUpdateUserAttributes,
//                      `augmented` → the DynamoDB users row. (Password/MFA enrolment go through the
//                      dedicated Cognito flows, never these attribute writes.)
//
// See apps/core/auth/specs/ACCESS-FLOWS.md → "Data model" and SPECS.md → "Identity & accounts".
//
export namespace User
{
    /**
     * Identity lifecycle — mirrors the internal `Auth.UserStatus` (the DynamoDB SoT) 1:1, including
     * `RESET_REQUIRED`. `Entity.resetPassword` is just the convenience projection of this.
     */
    export enum Status
    {
        PENDING        = "pending",          // registered, contact not yet verified / activated
        ACTIVE         = "active",           // normal, may sign in
        LOCKED         = "locked",           // failed-login lockout (temporary — auto-recovers; RISK.md)
        RESET_REQUIRED = "reset_required",   // must reset the password before a full session (admin/forced/seed)
        DISABLED       = "disabled",         // admin hard-disable of access — cannot sign in
    }

    export interface Mfa
    {
        enabled : boolean;
        methods : Array<MfaMethod>;     // enrolled factors (Cognito-managed)
    }

    /**
     * COGNITO-owned attributes — the credential authority + Cognito standard profile attributes.
     * Source of truth is Cognito; do NOT copy these into our datastore. (`email`/`phone` may be
     * mirrored internally ONLY as a verified-uniqueness index, not as a second source of truth.)
     */
    export interface CognitoProfile
    {
        email?        : Type.Email;
        phone?        : Type.PhoneE164;
        emailVerified : boolean;
        phoneVerified : boolean;

        firstName     : string;         // Cognito `given_name`
        lastName      : string;         // Cognito `family_name`
        displayName?  : string;         // Cognito `name`
        avatarUrl?    : Type.Url;        // Cognito `picture`

        locale?       : string;         // Cognito `locale` — BCP-47, e.g. "en-US"
        timezone?     : Type.TimeZone;  // Cognito `zoneinfo` — IANA tz

        mfa           : Mfa;            // Cognito MFA configuration
    }

    /**
     * DYNAMODB-augmented attributes — platform metadata Cognito can't hold. Internal SoT is
     * `Auth.UserProfile`; this is its public-safe projection (no failed-login counters, reset reason, …).
     */
    export interface Augmented
    {
        id            : Type.ID;        // = the Cognito `sub` (the record key)
        status        : Status;
        icon?         : Type.Url;         // app-chosen icon name/key (NOT a Cognito attribute)
        lastLoginAt?  : Type.ISODateTime;
        createdAt     : Type.ISODateTime;
        modifiedAt    : Type.ISODateTime;
    }

    /** The composed read model returned by GET — Cognito attributes ⊕ the DynamoDB row. No secrets. */
    export interface Entity extends CognitoProfile, Augmented
    {
    }

    /**
     * Write shape for POST/PATCH — grouped by store so the service routes each part:
     *   `cognito`   → Cognito AdminUpdateUserAttributes (name/picture/locale/zoneinfo; verified flags +
     *                 email/phone change run their own verification flow, not a bare attribute write).
     *   `augmented` → the DynamoDB users row (icon, and status-side effects via the proper transitions).
     * Credentials (password) + MFA enrolment are NOT here — they go through the dedicated Cognito flows.
     */
    export interface Update
    {
        cognito?   : Partial<CognitoProfile>;
        augmented? : Partial<Pick<Augmented, "icon">>;
    }

    /**
     * A user's membership in an account — **owned by the account service** (its SoT); auth reads it to
     * resolve `(userId, accountId) → roles`. Surfaced for the account/role switcher ("accounts I can act in").
     */
    export interface Membership
    {
        accountId   : Type.UUID;
        accountName : string;
        maxRole     : Access.Role;      // the account-owned ceiling for this user in this account
    }

    // ── Schema + validator for the read model `Entity` (the wire/messaging shape; no secrets) ────────
    export const SCHEMA : Validation.Schema =
    {
        $schema: "http://json-schema.org/draft-07/schema#",
        type: "object", additionalProperties: false,
        // CognitoProfile (required: verified flags, names, mfa) ⊕ Augmented (required: id, status, timestamps)
        required: [ "emailVerified", "phoneVerified", "firstName", "lastName", "mfa", "id", "status", "createdAt", "modifiedAt" ],
        properties:
        {
            // CognitoProfile
            email:         { type: "string", format: "email" },
            phone:         { type: "string" },          // E.164
            emailVerified: { type: "boolean" },
            phoneVerified: { type: "boolean" },
            firstName:     { type: "string" },
            lastName:      { type: "string" },
            displayName:   { type: "string" },
            avatarUrl:     { type: "string", format: "uri" },
            locale:        { type: "string" },          // BCP-47
            timezone:      { type: "string" },          // IANA tz
            mfa:           {
                type: "object", additionalProperties: false, required: [ "enabled", "methods" ],
                properties: {
                    enabled: { type: "boolean" },
                    methods: { type: "array", items: { type: "string", enum: Object.values( MfaMethod ) } },
                },
            },
            // Augmented
            id:          { type: "string" },            // = Cognito sub
            status:      { type: "string", enum: Object.values( Status ) },
            icon:        { type: "string" },            // app icon key/name
            lastLoginAt: { type: "string", format: "date-time" },
            createdAt:   { type: "string", format: "date-time" },
            modifiedAt:  { type: "string", format: "date-time" },
        },
    };

    /** Validate a `User.Entity` (a wire payload, a Kafka/SQS message body). */
    export const validate : Validation.Validator<Entity> = Validation.compile<Entity>( SCHEMA );
}

export default User;
