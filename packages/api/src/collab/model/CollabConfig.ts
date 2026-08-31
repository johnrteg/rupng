//
// CollabConfig — the collab service's runtime configuration (its AppConfig `config/settings` profile):
// non-secret operational policy tunable WITHOUT a redeploy. Mirrors VoiceConfig's shape (packages/api/src/
// voice/model/VoiceConfig.ts). v1 simplification: ONE global message-retention default, not a per-account
// override (SPECS.md collab-6.6's "account-configurable" TTL is a deferred gap — see apps/core/collab/SPECS.md).
//
import { Validation } from "../../model/Validation";
import { LogLevel } from "../../model/LogLevel";

export namespace CollabConfig
{
    export interface Config
    {
        messageTtlDays : number;    // chat message retention (DynamoDB per-item TTL) — durable long-term
                                    // retention opt-in (collab-6.6) is a deferred gap; one global value today
        logLevel?      : LogLevel;
    }

    // ── Schema + validator (shared: service / web / Console) ────────────────────────────────────
    export const SCHEMA : Validation.Schema =
    {
        $schema: "http://json-schema.org/draft-07/schema#",
        type: "object", additionalProperties: false,
        required: [ "messageTtlDays" ],
        properties:
        {
            messageTtlDays: { type: "number", minimum: 1 },
            // minimum log verbosity — optional so older configs tolerate drift (withDefaults fills it)
            logLevel: { type: "string", enum: Object.values( LogLevel ) },
        },
    };

    /** JSON Schema validator for `Config`. */
    export const validate : Validation.Validator<Config> = Validation.compile<Config>( SCHEMA );

    // ── Seeded defaults (the DEFAULT the service seeds + falls back to) ──────────────────────────
    export const DEFAULT : Config =
    {
        messageTtlDays: 90,          // short-ish default — shrinks the GDPR erasure surface (SPECS.md's stance)
        logLevel:       LogLevel.INFO,
    };
}

export default CollabConfig;
// eof
