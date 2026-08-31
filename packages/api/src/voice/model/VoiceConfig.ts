//
// VoiceConfig — the voice service's runtime configuration (its AppConfig `config/settings` profile): non-secret
// operational policy tunable WITHOUT a redeploy. Mirrors EmailConfig's shape (packages/api/src/email/model/
// EmailConfig.ts). Picks the DEFAULT provider, per-account send LIMITS, a simple recipient-local QUIET HOURS
// window, and the configured provider registry. Secrets (provider API keys) live in Secrets Manager, referenced
// here only by `secretRef`.
//
import { Voice } from "./Voice";
import { Validation } from "../../model/Validation";
import { LogLevel } from "../../model/LogLevel";

export namespace VoiceConfig
{
    /** A configured provider entry — the factory only offers ENABLED providers; the credential lives in Secrets
     *  Manager (referenced by `secretRef`, never inline). */
    export interface ProviderEntry { provider : Voice.Provider; enabled : boolean; secretRef? : string; }

    /** Per-account send LIMITS (defaults; a plan/entitlement may raise them). */
    export interface Limits { maxRecipientsPerSend : number; defaultRatePerMinute : number; }

    /** A simple recipient-local QUIET HOURS window (voice-4.1) — the hour-of-day range calls may be placed in.
     *  A first-cut simplification: an hour window, not full timezone-aware quiet-hours resolution (that needs a
     *  timezone source per number, a documented gap — see SPECS.md voice-4.1/4.7). */
    export interface QuietHours { startHour : number; endHour : number; }

    export interface Config
    {
        defaultProvider   : Voice.Provider;
        limits            : Limits;
        quietHours        : QuietHours;
        providers         : Record<string, ProviderEntry>;
        recordingEnabled     : boolean;
        amdEnabled           : boolean;   // answering-machine detection (voice-2.4) — Twilio only today
        transcriptionEnabled : boolean;   // speech-to-text on the downloaded recording (@repo/ai SPEECH_TO_TEXT) — requires recordingEnabled
        logLevel?            : LogLevel;
    }

    // ── Schema + validator (shared: service / web / Console) ────────────────────────────────────
    export const SCHEMA : Validation.Schema =
    {
        $schema: "http://json-schema.org/draft-07/schema#",
        type: "object", additionalProperties: false,
        required: [ "defaultProvider", "limits", "quietHours", "providers", "recordingEnabled", "amdEnabled", "transcriptionEnabled" ],
        properties:
        {
            defaultProvider: { type: "string", enum: Object.values( Voice.Provider ) },
            limits:          { type: "object", additionalProperties: false, required: [ "maxRecipientsPerSend", "defaultRatePerMinute" ],
                               properties: { maxRecipientsPerSend: { type: "number", minimum: 1 }, defaultRatePerMinute: { type: "number", minimum: 1 } } },
            quietHours:      { type: "object", additionalProperties: false, required: [ "startHour", "endHour" ],
                               properties: { startHour: { type: "number", minimum: 0, maximum: 23 }, endHour: { type: "number", minimum: 0, maximum: 23 } } },
            providers:       { type: "object", additionalProperties: {
                               type: "object", additionalProperties: false, required: [ "provider", "enabled" ],
                               properties: { provider: { type: "string", enum: Object.values( Voice.Provider ) }, enabled: { type: "boolean" }, secretRef: { type: "string" } } } },
            recordingEnabled:     { type: "boolean" },
            amdEnabled:           { type: "boolean" },
            transcriptionEnabled: { type: "boolean" },
            // minimum log verbosity — optional so older configs tolerate drift (withDefaults fills it)
            logLevel: { type: "string", enum: Object.values( LogLevel ) },
        },
    };

    /** JSON Schema validator for `Config`. */
    export const validate : Validation.Validator<Config> = Validation.compile<Config>( SCHEMA );

    // ── Seeded defaults (the DEFAULT the service seeds + falls back to) ──────────────────────────
    export const DEFAULT : Config =
    {
        // fresh environments seed to the FAKE provider — a safe sink that never dials a real number until an
        // operator explicitly switches to Twilio (mirrors EmailConfig's non-prod-safe posture).
        defaultProvider:  Voice.Provider.FAKE,
        limits:           { maxRecipientsPerSend: 50, defaultRatePerMinute: 30 },
        quietHours:       { startHour: 8, endHour: 21 },
        providers:        { [ Voice.Provider.FAKE ]: { provider: Voice.Provider.FAKE, enabled: true } },
        recordingEnabled:     false,
        amdEnabled:           false,   // opt-in — adds Twilio cost + latency to every call until explicitly enabled
        transcriptionEnabled: false,   // opt-in — adds an @repo/ai transcribe call per recorded call
        logLevel:         LogLevel.INFO,   // verbose (trace) logging is opt-in per environment
    };
}

export default VoiceConfig;
// eof
