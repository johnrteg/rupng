//
// PrintConfig — the print service's runtime configuration (its AppConfig `config/settings` profile): non-secret
// operational policy tunable WITHOUT a redeploy. Mirrors VoiceConfig's shape (packages/api/src/voice/model/
// VoiceConfig.ts). Picks the DEFAULT mail-fulfillment provider + the DEFAULT address-verification source (two
// INDEPENDENT registries — print-2.6/9.6), per-account submit limits, the account-default mail class, and the
// NCOA cache window. Secrets (provider API keys) live in Secrets Manager, referenced here only by `secretRef`.
//
import { Print } from "./Print";
import { Validation } from "../../model/Validation";
import { LogLevel } from "../../model/LogLevel";

export namespace PrintConfig
{
    /** A configured mail-fulfillment provider entry — the factory only offers ENABLED providers; the
     *  credential lives in Secrets Manager (referenced by `secretRef`, never inline). */
    export interface ProviderEntry { provider : Print.Provider; enabled : boolean; secretRef? : string; }

    /** A configured address-verification source entry — capability-declared (print-2.6): a source offers
     *  `cass` and/or `ncoa`; NCOA requests route ONLY to a source whose `capabilities` include it. */
    export interface VerifierEntry { verifier : Print.AddressVerifierId; enabled : boolean; capabilities : Array<Print.Capability>; secretRef? : string; }

    /** Per-account submit LIMITS (defaults; a plan/entitlement may raise them). */
    export interface Limits { maxRecipientsPerBatch : number; defaultRatePerMinute : number; }

    export interface Config
    {
        defaultProvider:         Print.Provider;
        providers:               Record<string, ProviderEntry>;
        defaultAddressVerifier:  Print.AddressVerifierId;
        addressVerifiers:        Record<string, VerifierEntry>;
        defaultMailClass:        Print.MailClass;   // account default (print-6.4); campaign may override per submit
        ncoaMaxAgeDays:          number;             // NCOA cache reuse window (print-2.2/gap #5 — regulated ≤95d)
        addressFreshDays?:       number;             // optional VerifiedAddress freshUntil TTL (gap #8); omit = no forced refresh
        limits:                  Limits;
        logLevel?:               LogLevel;
    }

    // ── Schema + validator (shared: service / web / Console) ────────────────────────────────────
    export const SCHEMA : Validation.Schema =
    {
        $schema: "http://json-schema.org/draft-07/schema#",
        type: "object", additionalProperties: false,
        required: [ "defaultProvider", "providers", "defaultAddressVerifier", "addressVerifiers", "defaultMailClass", "ncoaMaxAgeDays", "limits" ],
        properties:
        {
            defaultProvider: { type: "string", enum: Object.values( Print.Provider ) },
            providers:       { type: "object", additionalProperties: {
                               type: "object", additionalProperties: false, required: [ "provider", "enabled" ],
                               properties: { provider: { type: "string", enum: Object.values( Print.Provider ) }, enabled: { type: "boolean" }, secretRef: { type: "string" } } } },
            defaultAddressVerifier: { type: "string", enum: Object.values( Print.AddressVerifierId ) },
            addressVerifiers:       { type: "object", additionalProperties: {
                               type: "object", additionalProperties: false, required: [ "verifier", "enabled", "capabilities" ],
                               properties: {
                                   verifier: { type: "string", enum: Object.values( Print.AddressVerifierId ) },
                                   enabled: { type: "boolean" },
                                   capabilities: { type: "array", items: { type: "string", enum: Object.values( Print.Capability ) } },
                                   secretRef: { type: "string" },
                               } } },
            defaultMailClass: { type: "string", enum: Object.values( Print.MailClass ) },
            ncoaMaxAgeDays:   { type: "number", minimum: 1, maximum: 95 },
            addressFreshDays: { type: "number", minimum: 1 },
            limits:           { type: "object", additionalProperties: false, required: [ "maxRecipientsPerBatch", "defaultRatePerMinute" ],
                               properties: { maxRecipientsPerBatch: { type: "number", minimum: 1 }, defaultRatePerMinute: { type: "number", minimum: 1 } } },
            // minimum log verbosity — optional so older configs tolerate drift (withDefaults fills it)
            logLevel: { type: "string", enum: Object.values( LogLevel ) },
        },
    };

    /** JSON Schema validator for `Config`. */
    export const validate : Validation.Validator<Config> = Validation.compile<Config>( SCHEMA );

    // ── Seeded defaults (the DEFAULT the service seeds + falls back to) ──────────────────────────
    export const DEFAULT : Config =
    {
        // fresh environments seed to the FAKE provider/verifier — a safe sink that never mails a real address
        // or bills a real vendor until an operator explicitly switches to PostGrid/Lob/a real verifier.
        defaultProvider: Print.Provider.FAKE,
        providers:       { [ Print.Provider.FAKE ]: { provider: Print.Provider.FAKE, enabled: true } },
        defaultAddressVerifier: Print.AddressVerifierId.FAKE,
        addressVerifiers:       { [ Print.AddressVerifierId.FAKE ]: { verifier: Print.AddressVerifierId.FAKE, enabled: true, capabilities: [ Print.Capability.CASS, Print.Capability.NCOA ] } },
        defaultMailClass: Print.MailClass.MARKETING,
        ncoaMaxAgeDays:   95,   // USPS move-update regulated window for presort discounts (gap #5)
        limits:           { maxRecipientsPerBatch: 5000, defaultRatePerMinute: 60 },
        logLevel:         LogLevel.INFO,   // verbose (trace) logging is opt-in per environment
    };
}

export default PrintConfig;
// eof
