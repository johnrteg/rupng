//
// AccountConfig — the account service's runtime configuration (its AppConfig `config/settings` profile):
// non-secret operational policy tunable without a redeploy — sub-account hierarchy, membership defaults,
// and data-retention windows.
//
// Lives in @repo/api (not the service) so the ONE definition is shared: the account service reads it live
// + seeds `DEFAULT`; the Console's AppConfig editor lints edits against `SCHEMA`; an admin UI validates with
// `validate()`. Plan-driven caps (e.g. members-PER-PLAN) are entitlements (see Billing), not service
// config, and are intentionally excluded here.
//
import { Validation } from "../../model/Validation";
import { LogLevel } from "../../model/LogLevel";

export namespace AccountConfig
{
    /** Sub-account hierarchy (account-2). */
    export interface Hierarchy
    {
        maxDepth                : number;      // how deep sub-accounts may nest
        maxSubAccountsPerParent : number;     // fan-out cap per parent account
        defaultParentAccess     : "open" | "granted";   // default for a new sub-account's parentAccess
    }

    /** Membership defaults (account-3). The per-PLAN member cap is an entitlement, not here. */
    export interface Membership
    {
        inviteExpiryHours : number;           // how long an invite stays valid
        defaultRole       : string;           // role a new member receives (Access account ladder, e.g. "user")
        defaultMaxRole    : string;           // the ceiling a new member may be granted up to
    }

    /** Data-retention windows in days (account-12 / privacy). */
    export interface Retention
    {
        auditDays          : number;          // security/audit events
        deletedAccountDays : number;          // soft-deleted account purge window
        usageRecordDays    : number;          // metered usage records
        erasureSlaDays     : number;          // SLA to complete an erasure request
    }

    export interface Config
    {
        hierarchy  : Hierarchy;
        membership : Membership;
        retention  : Retention;
        logLevel?  : LogLevel;   // minimum log verbosity — applied live, no redeploy (Application.refreshLogLevel)
    }

    // ── Schema + validator (shared: service / web / Console) ────────────────────────────────────
    /** JSON Schema for `Config` — hand off to a JSON editor (CodeMirror linting) or compile to validate. */
    export const SCHEMA : Validation.Schema =
    {
        $schema: "http://json-schema.org/draft-07/schema#",
        type: "object", additionalProperties: false,
        required: [ "hierarchy", "membership", "retention" ],
        properties:
        {
            hierarchy: {
                type: "object", additionalProperties: false,
                required: [ "maxDepth", "maxSubAccountsPerParent", "defaultParentAccess" ],
                properties: {
                    maxDepth:                { type: "integer", minimum: 1 },
                    maxSubAccountsPerParent: { type: "integer", minimum: 1 },
                    defaultParentAccess:     { type: "string", enum: [ "open", "granted" ] },
                },
            },
            membership: {
                type: "object", additionalProperties: false,
                required: [ "inviteExpiryHours", "defaultRole", "defaultMaxRole" ],
                properties: {
                    inviteExpiryHours: { type: "integer", minimum: 1 },
                    defaultRole:       { type: "string", minLength: 1 },
                    defaultMaxRole:    { type: "string", minLength: 1 },
                },
            },
            retention: {
                type: "object", additionalProperties: false,
                required: [ "auditDays", "deletedAccountDays", "usageRecordDays", "erasureSlaDays" ],
                properties: {
                    auditDays:          { type: "integer", minimum: 1 },
                    deletedAccountDays: { type: "integer", minimum: 1 },
                    usageRecordDays:    { type: "integer", minimum: 1 },
                    erasureSlaDays:     { type: "integer", minimum: 1 },
                },
            },
            // minimum log verbosity — optional so older configs tolerate drift (withDefaults fills it)
            logLevel: { type: "string", enum: Object.values( LogLevel ) },
        },
    };

    /** Validate a candidate config (a parsed editor buffer, a fetched profile, a message payload). */
    export const validate : Validation.Validator<Config> = Validation.compile<Config>( SCHEMA );

    /** Seed for a fresh environment — safe, conservative defaults. */
    export const DEFAULT : Config =
    {
        hierarchy: {
            maxDepth:                3,
            maxSubAccountsPerParent: 100,
            defaultParentAccess:     "granted",
        },
        membership: {
            inviteExpiryHours: 168,           // 7 days
            defaultRole:       "user",
            defaultMaxRole:    "user",
        },
        retention: {
            auditDays:          365,
            deletedAccountDays: 30,
            usageRecordDays:    730,          // 2 years
            erasureSlaDays:     30,
        },
        logLevel: LogLevel.INFO,   // verbose (trace) logging is opt-in per environment
    };
}

export default AccountConfig;
