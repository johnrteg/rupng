//
// ReportConfig — the report service's runtime configuration (its AppConfig `config/settings` profile):
// non-secret operational policy tunable WITHOUT a redeploy. Mirrors VoiceConfig's shape (packages/api/src/
// voice/model/VoiceConfig.ts). Today this is just the environment-max artifact retention (report-11.1) — a
// PER-ACCOUNT override (an account may set its own TTL <= this environment max) is EXPLICITLY DEFERRED; when
// it lands it belongs on the account's own config, not here, since report has no per-account config surface
// today.
//
import { Validation } from "../../model/Validation";
import { LogLevel } from "../../model/LogLevel";

export namespace ReportConfig
{
    export interface Config
    {
        retentionDays : number;      // environment-max artifact retention (S3 lifecycle expiry, by object age)
        logLevel?     : LogLevel;
    }

    // ── Schema + validator (shared: service / web / Console) ────────────────────────────────────
    export const SCHEMA : Validation.Schema =
    {
        $schema: "http://json-schema.org/draft-07/schema#",
        type: "object", additionalProperties: false,
        required: [ "retentionDays" ],
        properties:
        {
            retentionDays: { type: "number", minimum: 1, description: "Environment-max artifact retention, in days (S3 lifecycle expiry by object age)." },
            // minimum log verbosity — optional so older configs tolerate drift (withDefaults fills it)
            logLevel: { type: "string", enum: Object.values( LogLevel ) },
        },
    };

    /** JSON Schema validator for `Config`. */
    export const validate : Validation.Validator<Config> = Validation.compile<Config>( SCHEMA );

    // ── Seeded defaults (the DEFAULT the service seeds + falls back to) ──────────────────────────
    export const DEFAULT : Config =
    {
        // a conservative baseline retention — artifacts are regenerable, so this errs short rather than
        // accumulating PII-bearing exports indefinitely (report-11.1); an operator raises it per environment.
        retentionDays: 90,
        logLevel:      LogLevel.INFO,   // verbose (trace) logging is opt-in per environment
    };
}

export default ReportConfig;
// eof
