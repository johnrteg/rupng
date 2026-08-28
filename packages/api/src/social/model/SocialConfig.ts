//
// SocialConfig — the social service's runtime configuration (its AppConfig `config/settings` profile):
// non-secret operational policy tunable WITHOUT a redeploy — poll cadence, the on-demand-refresh
// cooldown, the default approvals-required policy, and the per-network connected-profile quota. Lives
// in @repo/api (one definition) so the service reads it live + seeds `DEFAULT`, the Console's AppConfig
// editor lints against `SCHEMA`, and an admin UI validates.
//
// NOT here: plan/storage QUOTA beyond social's own `maxProfiles` knob (broader entitlements are account
// `ResolvedEntitlements`) and any secrets (those live in marketplace's vault, never here).
//
import { SocialAccount } from "./SocialAccount";
import { Validation } from "../../model/Validation";
import { LogLevel } from "../../model/LogLevel";

export namespace SocialConfig
{
    /** Poll cadence for pull-only platforms (X / TikTok / LinkedIn) — SPECS.md §4.8. */
    export interface Poll { cadenceSeconds : number; windowSeconds : number; }

    /** Minimum gap between on-demand Refresh presses — the abuse guard on `POST /social/inbox/refresh`. */
    export interface Refresh { cooldownSeconds : number; }

    /** Default review-workflow policy — SPECS.md §8. A post snapshots this at submit time. */
    export interface Approvals { requiredDefault : number; }

    export interface Config
    {
        poll        : Poll;
        refresh     : Refresh;
        approvals   : Approvals;
        maxProfiles : Partial<Record<SocialAccount.Platform, number>>;   // per-network connected-profile quota
        logLevel?   : LogLevel;   // minimum log verbosity — applied live, no redeploy (Application.refreshLogLevel)
    }

    // ── Schema + validator (shared: service / web / Console) ────────────────────────────────────
    export const SCHEMA : Validation.Schema =
    {
        $schema: "http://json-schema.org/draft-07/schema#",
        type: "object", additionalProperties: false,
        required: [ "poll", "refresh", "approvals", "maxProfiles" ],
        properties:
        {
            poll: {
                type: "object", additionalProperties: false, required: [ "cadenceSeconds", "windowSeconds" ],
                properties: {
                    cadenceSeconds:  { type: "number", minimum: 1 },
                    windowSeconds:   { type: "number", minimum: 1 },
                },
            },
            refresh: {
                type: "object", additionalProperties: false, required: [ "cooldownSeconds" ],
                properties: { cooldownSeconds: { type: "number", minimum: 0 } },
            },
            approvals: {
                type: "object", additionalProperties: false, required: [ "requiredDefault" ],
                properties: { requiredDefault: { type: "number", minimum: 0 } },
            },
            maxProfiles: { type: "object", additionalProperties: { type: "number", minimum: 0 } },
            logLevel:    { type: "string", enum: Object.values( LogLevel ) },
        },
    };

    /** JSON Schema validator for `Config`. */
    export const validate : Validation.Validator<Config> = Validation.compile<Config>( SCHEMA );

    // ── Seeded defaults (the DEFAULT the service seeds + falls back to) ──────────────────────────
    export const DEFAULT : Config =
    {
        poll:      { cadenceSeconds: 900, windowSeconds: 3600 },   // poll every 15 min, look back 1 hour
        refresh:   { cooldownSeconds: 60 },
        approvals: { requiredDefault: 0 },   // approval workflow off by default
        maxProfiles: {
            [ SocialAccount.Platform.FACEBOOK ]:  5,
            [ SocialAccount.Platform.INSTAGRAM ]: 5,
            [ SocialAccount.Platform.X ]:         3,
            [ SocialAccount.Platform.TIKTOK ]:    3,
            [ SocialAccount.Platform.LINKEDIN ]:  3,
        },
        logLevel: LogLevel.INFO,
    };
}

export default SocialConfig;
// eof
