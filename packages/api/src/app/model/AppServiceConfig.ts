//
// AppServiceConfig — the app service's OPERATIONAL runtime configuration (its AppConfig `config/settings`
// profile) — distinct from `GetBootstrap.Config` (the `config/web` profile), which is a PUBLIC,
// unauthenticated blob served to every browser at login. This profile is internal ops policy, never
// shipped to clients. Today it's just the dynamic log level (`Application.refreshLogLevel` polls every
// service's `config/settings` profile for this field — see CLAUDE.md "Architecture & boundaries"), with
// room to grow as the app service picks up more non-secret, no-redeploy tunables.
//
import { Validation } from "../../model/Validation";
import { LogLevel } from "../../model/LogLevel";

export namespace AppServiceConfig
{
    export interface Config
    {
        logLevel? : LogLevel;   // minimum log verbosity — applied live, no redeploy (Application.refreshLogLevel)
    }

    // ── Schema + validator (shared: service / Console) ──────────────────────────────────────────
    export const SCHEMA : Validation.Schema =
    {
        $schema: "http://json-schema.org/draft-07/schema#",
        type: "object", additionalProperties: false,
        required: [],
        properties:
        {
            // minimum log verbosity — optional so an older/empty config tolerates drift (withDefaults fills it)
            logLevel: { type: "string", enum: Object.values( LogLevel ) },
        },
    };

    /** JSON Schema validator for `Config`. */
    export const validate : Validation.Validator<Config> = Validation.compile<Config>( SCHEMA );

    // ── Seeded defaults (the DEFAULT the service seeds + falls back to) ──────────────────────────
    export const DEFAULT : Config =
    {
        logLevel: LogLevel.INFO,   // verbose (trace) logging is opt-in per environment
    };
}

export default AppServiceConfig;
