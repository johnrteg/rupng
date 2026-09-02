//
// TextingConfig — the texting service's runtime configuration (its AppConfig `config/settings` profile):
// non-secret operational policy tunable WITHOUT a redeploy. Picks the DEFAULT send provider and the
// configured provider registry (mirrors EmailConfig's `defaultProvider`/`providers` shape — texting has no
// per-account provider override yet since number-routing (texting-4.x) isn't built; see
// `TextingService.processSend`). Secrets (provider API keys) live in Secrets Manager, referenced here only
// by `secretRef`. Lives in @repo/api (one definition) so the service reads it live + seeds `DEFAULT`, and
// the Console lints against `SCHEMA`.
//
import { Texting } from "./Texting";
import { Validation } from "../../model/Validation";
import { LogLevel } from "../../model/LogLevel";

export namespace TextingConfig
{
    /** A configured provider entry — the factory only offers ENABLED providers as send candidates. The
     *  credential itself (`secretRef`) only NAMES a Secrets Manager entry — never an inline key. */
    export interface ProviderEntry { provider : Texting.Provider; enabled : boolean; secretRef? : string; }

    export interface Config
    {
        defaultProvider : Texting.Provider;                 // the provider used for every send (texting-3.4)
        providers       : Record<string, ProviderEntry>;    // configured provider registry (key = Texting.Provider)
        logLevel?       : LogLevel;                         // minimum log verbosity — applied live, no redeploy (Application.refreshLogLevel)
    }

    // ── Schema + validator (shared: service / web / Console) ────────────────────────────────────
    export const SCHEMA : Validation.Schema =
    {
        $schema: "http://json-schema.org/draft-07/schema#",
        type: "object", additionalProperties: false,
        required: [ "defaultProvider", "providers" ],
        properties:
        {
            defaultProvider: { type: "string", enum: Object.values( Texting.Provider ) },
            providers:       { type: "object", additionalProperties: {
                               type: "object", additionalProperties: false, required: [ "provider", "enabled" ],
                               properties: { provider: { type: "string", enum: Object.values( Texting.Provider ) }, enabled: { type: "boolean" }, secretRef: { type: "string" } } } },
            // minimum log verbosity — optional so older configs tolerate drift (withDefaults fills it)
            logLevel: { type: "string", enum: Object.values( LogLevel ) },
        },
    };

    /** JSON Schema validator for `Config`. */
    export const validate : Validation.Validator<Config> = Validation.compile<Config>( SCHEMA );

    // ── Seeded defaults (the DEFAULT the service seeds + falls back to) ──────────────────────────
    export const DEFAULT : Config =
    {
        // fresh environments seed to the FAKE provider — a safe sink that never sends a real SMS until an
        // operator explicitly switches to a real CPaaS (mirrors EmailConfig's non-prod-safe posture).
        defaultProvider: Texting.Provider.FAKE,
        providers:       { [ Texting.Provider.FAKE ]: { provider: Texting.Provider.FAKE, enabled: true } },
        logLevel:        LogLevel.INFO,   // verbose (trace) logging is opt-in per environment
    };
}

export default TextingConfig;
// eof
