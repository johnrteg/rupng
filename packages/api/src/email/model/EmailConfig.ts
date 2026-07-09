//
// EmailConfig — the email service's runtime configuration (its AppConfig `config/settings` profile): non-secret
// operational policy tunable WITHOUT a redeploy. Picks the DEFAULT account provider + the SYSTEM/platform
// provider (reset / verification mail, email-4.9), the per-account SEND LIMITS, and the configured provider
// registry (a marketplace provider is one of many). Secrets (provider API keys, BYO-SMTP creds) live in Secrets
// Manager, referenced here only by `secretRef`. Lives in @repo/api (one definition) so the service reads it live
// + seeds `DEFAULT`, and the Console lints against `SCHEMA`.
//
import { Email } from "./Email";
import { Validation } from "../../model/Validation";

export namespace EmailConfig
{
    /** A configured provider entry — the factory only offers ENABLED providers; the credential lives in Secrets
     *  Manager (referenced by `secretRef`, never inline). */
    export interface ProviderEntry { provider : Email.Provider; enabled : boolean; secretRef? : string; region? : string; }

    /** Per-account send LIMITS (defaults; a plan/entitlement may raise them). Guards the default provider from
     *  a single account's runaway volume. `defaultRatePerMinute` is the steady-state throttle a batch/scheduled
     *  send uses when its `SendSchedule` doesn't specify one (deliverability — don't look bursty). */
    export interface Limits { perAccountPerDay : number; perAccountPerMonth : number; maxRecipientsPerSend : number; defaultRatePerMinute : number; }

    /** SCHEDULING policy (email-6). `minLeadMinutes` is the safe buffer — a scheduled send's `startAt` must be
     *  at least this far in the future (else it's clamped up); it protects against immediate-fire mistakes and
     *  gives the operator a cancel window. `maxLeadDays` caps how far out a send can be scheduled.
     *  `defaultTimezone` is the tz a `startAt` is interpreted against when the request omits one (sends are
     *  relative to a timezone, not just UTC wall-clock). */
    export interface Scheduling { minLeadMinutes : number; maxLeadDays : number; defaultTimezone : string; }

    export interface Config
    {
        defaultProvider       : Email.Provider;                 // the default provider for ACCOUNT sends
        systemProvider        : Email.Provider;                 // provider for PLATFORM/system mail (reset, verification)
        systemSenders         : Array<Email.Sender>;            // the platform's outbound from-identities (per need)
        defaultSystemSenderKey : string;                        // the sender used when a case has no routing entry
        systemSenderRouting   : Partial<Record<Email.NotificationType, string>>;  // notification case → sender `key`
        limits                : Limits;                         // per-account send caps (defaults)
        scheduling            : Scheduling;                     // scheduled-send policy (safe buffer + timezone)
        providers             : Record<string, ProviderEntry>;  // configured provider registry (key = Email.Provider)
        marketplaceEnabled    : boolean;                        // allow account-installed marketplace providers
        webFonts?             : Array<{ name : string; href : string }>;  // the PLATFORM (app-level) web-font library
    }

    // ── Schema + validator (shared: service / web / Console) ────────────────────────────────────
    export const SCHEMA : Validation.Schema =
    {
        $schema: "http://json-schema.org/draft-07/schema#",
        type: "object", additionalProperties: false,
        required: [ "defaultProvider", "systemProvider", "systemSenders", "defaultSystemSenderKey", "systemSenderRouting", "limits", "scheduling", "providers", "marketplaceEnabled" ],
        properties:
        {
            defaultProvider: { type: "string", enum: Object.values( Email.Provider ) },
            systemProvider:  { type: "string", enum: Object.values( Email.Provider ) },
            systemSenders:   { type: "array", items: {
                               type: "object", additionalProperties: false, required: [ "key", "email", "name" ],
                               properties: { key: { type: "string" }, email: { type: "string" }, name: { type: "string" }, purpose: { type: "string" } } } },
            defaultSystemSenderKey: { type: "string" },
            systemSenderRouting: { type: "object", additionalProperties: { type: "string" } },
            limits:          { type: "object", additionalProperties: false, required: [ "perAccountPerDay", "perAccountPerMonth", "maxRecipientsPerSend", "defaultRatePerMinute" ],
                               properties: { perAccountPerDay: { type: "number", minimum: 0 }, perAccountPerMonth: { type: "number", minimum: 0 }, maxRecipientsPerSend: { type: "number", minimum: 1 }, defaultRatePerMinute: { type: "number", minimum: 1 } } },
            scheduling:      { type: "object", additionalProperties: false, required: [ "minLeadMinutes", "maxLeadDays", "defaultTimezone" ],
                               properties: { minLeadMinutes: { type: "number", minimum: 0 }, maxLeadDays: { type: "number", minimum: 1 }, defaultTimezone: { type: "string" } } },
            providers:       { type: "object", additionalProperties: {
                               type: "object", additionalProperties: false, required: [ "provider", "enabled" ],
                               properties: { provider: { type: "string", enum: Object.values( Email.Provider ) }, enabled: { type: "boolean" }, secretRef: { type: "string" }, region: { type: "string" } } } },
            marketplaceEnabled: { type: "boolean" },
            webFonts:        { type: "array", items: {
                               type: "object", additionalProperties: false, required: [ "name", "href" ],
                               properties: { name: { type: "string" }, href: { type: "string" } } } },
        },
    };

    /** JSON Schema validator for `Config`. */
    export const validate : Validation.Validator<Config> = Validation.compile<Config>( SCHEMA );

    // ── Seeded defaults (the DEFAULT the service seeds + falls back to) ──────────────────────────
    export const DEFAULT : Config =
    {
        // fresh environments seed to the FAKE provider — a safe sink that never delivers to real inboxes until
        // an operator explicitly switches to SES / a real ESP (email-3.7 non-prod-safe posture).
        defaultProvider: Email.Provider.FAKE,
        systemProvider:  Email.Provider.FAKE,
        // the platform's outbound identities for different needs; SECURITY_ALERT + MFA route to the security
        // sender, everything else falls back to the default (no-reply). Operators add/edit these in Settings → Email.
        systemSenders:
        [
            { key: "no-reply", email: "no-reply@platform.local", name: "Platform",          purpose: "Default system mail — verification, welcome, invite" },
            { key: "security", email: "security@platform.local", name: "Platform Security", purpose: "Security alerts + MFA codes" },
        ],
        defaultSystemSenderKey: "no-reply",
        systemSenderRouting:
        {
            [ Email.NotificationType.SECURITY_ALERT ]: "security",
            [ Email.NotificationType.MFA_CODE ]:       "security",
        },
        limits:          { perAccountPerDay: 10000, perAccountPerMonth: 200000, maxRecipientsPerSend: 50, defaultRatePerMinute: 60 },
        scheduling:      { minLeadMinutes: 15, maxLeadDays: 90, defaultTimezone: "UTC" },
        providers:       { [ Email.Provider.FAKE ]: { provider: Email.Provider.FAKE, enabled: true } },
        marketplaceEnabled: false,
        webFonts:        [],
    };
}

export default EmailConfig;
// eof
