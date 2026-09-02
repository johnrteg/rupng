//
// AuditConfig — the audit service's runtime configuration (its AppConfig `config/settings` profile):
// retention tiers + the tamper-evidence toggle (audit-4.1), tunable WITHOUT a redeploy. Lives in
// @repo/api (one definition) so the service reads it live + seeds `DEFAULT`, and the Console's generic
// AppConfig editor (`tools/console/.../configEditor/`) lints against `SCHEMA` — no bespoke Console
// component needed (unlike a service with a nested-object config, this one is flat enough for the
// existing schema-driven editor).
//
import { Audit } from "./Audit";
import { Validation } from "../../model/Validation";
import { LogLevel } from "../../model/LogLevel";

export namespace AuditConfig
{
    /** A per-class retention override — e.g. financial records kept 7 years regardless of the default. */
    export interface RetentionTier { retentionClass : Audit.RetentionClass; days : number; }

    export interface Config
    {
        defaultRetentionDays : number;               // env default (dev 7 / prod 365 — matches auth-19.5)
        retentionTiers        : Array<RetentionTier>; // per-class overrides (e.g. financial -> 2555 days)
        hashChainEnabled       : boolean;              // tamper-evidence (audit-3.2) — a dev/debug kill-switch only
        archiveEnabled?        : boolean;              // whether AuditArchiveJob mirrors to S3 Object Lock (default true)
        logLevel?              : LogLevel;             // minimum log verbosity — applied live (Application.refreshLogLevel)
    }

    // ── Schema + validator (shared: service / Console) ──────────────────────────────────────────
    export const SCHEMA : Validation.Schema =
    {
        $schema: "http://json-schema.org/draft-07/schema#",
        type: "object", additionalProperties: false,
        required: [ "defaultRetentionDays", "retentionTiers", "hashChainEnabled" ],
        properties:
        {
            defaultRetentionDays: { type: "number", minimum: 1 },
            retentionTiers: {
                type: "array",
                items: {
                    type: "object", additionalProperties: false, required: [ "retentionClass", "days" ],
                    properties: {
                        retentionClass: { type: "string", enum: Object.values( Audit.RetentionClass ) },
                        days:           { type: "number", minimum: 1 },
                    },
                },
            },
            hashChainEnabled: { type: "boolean" },
            archiveEnabled:   { type: "boolean" },
            logLevel:         { type: "string", enum: Object.values( LogLevel ) },
        },
    };

    /** JSON Schema validator for `Config`. */
    export const validate : Validation.Validator<Config> = Validation.compile<Config>( SCHEMA );

    // ── Seeded defaults (the DEFAULT the service seeds + falls back to) ────────────────────────
    export const DEFAULT : Config =
    {
        defaultRetentionDays: 7,   // dev-safe default; a prod deploy raises this to 365 via the Console (ROOT)
        retentionTiers: [
            { retentionClass: Audit.RetentionClass.FINANCIAL, days: 2555 },   // ~7 years
        ],
        hashChainEnabled: true,
        archiveEnabled:   true,
        logLevel:         LogLevel.INFO,
    };
}

export default AuditConfig;
// eof
