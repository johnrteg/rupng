//
// RegistrationConfig — the registration service's runtime configuration (its AppConfig `config/settings`
// profile): non-secret operational policy tunable WITHOUT a redeploy. Mirrors VoiceConfig's shape
// (packages/api/src/voice/model/VoiceConfig.ts). Picks the CSP identity, the carrier-provider registry, the
// use-case → monthly-fee / vetting-provider → fee tables that drive the billing STUB (Registration.CostEstimate
// — see Registration.ts), the per-campaign line cap + reuse grace period (legacy TCR provisioning rules), and
// the poll-sweep backoff cadence (registration-5.3). Secrets (CSP/carrier API keys) live in Secrets Manager,
// referenced here only by `secretRef`.
//
import { Registration } from "./Registration";
import { Billing } from "../../account/model/Billing";
import { Validation } from "../../model/Validation";
import { LogLevel } from "../../model/LogLevel";

export namespace RegistrationConfig
{
    /** A configured carrier-provider entry — the factory only offers ENABLED providers; the credential lives
     *  in Secrets Manager (referenced by `secretRef`, never inline). */
    export interface ProviderEntry { provider : Registration.CarrierProvider; enabled : boolean; secretRef? : string; }

    /** Static per-use-case metadata (registration-2.0): the sub-usecase cardinality TCR enforces, and whether
     *  the use case is TCR's "special" (closer-vetted) category — kept in code (not AppConfig) since it mirrors
     *  a fixed external catalog, only the fee is admin-tunable (see `Config.useCaseMonthlyFee`). */
    export interface UseCaseMeta { minSubUsecases : number; maxSubUsecases : number; special : boolean; }

    export const USE_CASE_CATALOG : Record<Registration.UseCase, UseCaseMeta> =
    {
        [ Registration.UseCase.TWO_FACTOR ]:                    { minSubUsecases: 0, maxSubUsecases: 0, special: false },
        [ Registration.UseCase.ACCOUNT_NOTIFICATION ]:          { minSubUsecases: 0, maxSubUsecases: 0, special: false },
        [ Registration.UseCase.CARRIER_EXEMPTIONS ]:            { minSubUsecases: 0, maxSubUsecases: 0, special: true },
        [ Registration.UseCase.CHARITY ]:                       { minSubUsecases: 0, maxSubUsecases: 0, special: false },
        [ Registration.UseCase.CUSTOMER_CARE ]:                 { minSubUsecases: 0, maxSubUsecases: 0, special: false },
        [ Registration.UseCase.DELIVERY_NOTIFICATION ]:         { minSubUsecases: 0, maxSubUsecases: 0, special: false },
        [ Registration.UseCase.EMERGENCY ]:                     { minSubUsecases: 0, maxSubUsecases: 0, special: false },
        [ Registration.UseCase.FRAUD_ALERT ]:                   { minSubUsecases: 0, maxSubUsecases: 0, special: false },
        [ Registration.UseCase.HIGHER_EDUCATION ]:              { minSubUsecases: 0, maxSubUsecases: 0, special: false },
        [ Registration.UseCase.K12_EDUCATION ]:                 { minSubUsecases: 0, maxSubUsecases: 0, special: false },
        [ Registration.UseCase.LOW_VOLUME_MIXED ]:              { minSubUsecases: 0, maxSubUsecases: 5, special: false },
        [ Registration.UseCase.MARKETING ]:                     { minSubUsecases: 0, maxSubUsecases: 0, special: false },
        [ Registration.UseCase.MIXED ]:                         { minSubUsecases: 2, maxSubUsecases: 5, special: false },
        [ Registration.UseCase.POLITICAL ]:                     { minSubUsecases: 0, maxSubUsecases: 0, special: true },
        [ Registration.UseCase.POLLING_VOTING ]:                { minSubUsecases: 0, maxSubUsecases: 0, special: true },
        [ Registration.UseCase.PROXY ]:                         { minSubUsecases: 0, maxSubUsecases: 0, special: false },
        [ Registration.UseCase.PUBLIC_SERVICE_ANNOUNCEMENT ]:   { minSubUsecases: 0, maxSubUsecases: 0, special: false },
        [ Registration.UseCase.SECURITY_ALERT ]:                { minSubUsecases: 0, maxSubUsecases: 0, special: false },
        [ Registration.UseCase.SOCIAL ]:                        { minSubUsecases: 0, maxSubUsecases: 0, special: false },
        [ Registration.UseCase.SOLE_PROPRIETOR ]:                { minSubUsecases: 0, maxSubUsecases: 0, special: false },
        [ Registration.UseCase.SWEEPSTAKE ]:                    { minSubUsecases: 0, maxSubUsecases: 0, special: false },
        [ Registration.UseCase.TRIAL ]:                         { minSubUsecases: 0, maxSubUsecases: 0, special: false },
    };

    /** Poll-sweep backoff cadence (registration-5.3) — in-flight registrations only, back off between sweeps,
     *  stop entirely once a registration reaches a terminal status. */
    export interface PollSweep { initialDelaySeconds : number; maxDelaySeconds : number; backoffMultiplier : number; }

    export interface Config
    {
        cspId               : string;    // our TCR CSP identity (direct-CSP model — SPECS.md gap #1, resolved)
        resellerId          : string;    // required non-empty per TCR policy; a system-wide default
        secretRef           : string;    // TCR API credentials (Secrets Manager)
        cvSecretRef?        : string;    // Campaign Verify API key, if used for political vetting

        providers           : Record<string, ProviderEntry>;

        useCaseMonthlyFee   : Partial<Record<Registration.UseCase, Billing.Rate>>;
        vettingFee          : Partial<Record<Registration.VettingProvider, Billing.Rate>>;
        defaultVettingFee   : Billing.Rate;   // fallback when a specific EVP+class price isn't configured

        maxLinesPerCampaign : number;   // legacy's hard cap (49); TRIAL use case is exempt (checked in the impl)
        reuseGraceDays      : number;   // released numbers stay reuse-eligible this long before full release
        defaultAreaCode?    : string;

        pollSweep           : PollSweep;
        logLevel?           : LogLevel;
    }

    // ── Schema + validator (shared: service / web / Console) ────────────────────────────────────
    const RATE_SCHEMA : Validation.Schema =
    {
        type: "object", additionalProperties: false, required: [ "amountMilliCents", "currency" ],
        properties: { amountMilliCents: { type: "number", minimum: 0 }, currency: { type: "string" } },
    };

    export const SCHEMA : Validation.Schema =
    {
        $schema: "http://json-schema.org/draft-07/schema#",
        type: "object", additionalProperties: false,
        required: [ "cspId", "resellerId", "secretRef", "providers", "useCaseMonthlyFee", "vettingFee",
                    "defaultVettingFee", "maxLinesPerCampaign", "reuseGraceDays", "pollSweep" ],
        properties:
        {
            cspId:        { type: "string" },
            resellerId:   { type: "string", minLength: 1 },
            secretRef:    { type: "string" },
            cvSecretRef:  { type: "string" },
            providers:    { type: "object", additionalProperties: {
                            type: "object", additionalProperties: false, required: [ "provider", "enabled" ],
                            properties: { provider: { type: "string", enum: Object.values( Registration.CarrierProvider ) }, enabled: { type: "boolean" }, secretRef: { type: "string" } } } },
            useCaseMonthlyFee: { type: "object", additionalProperties: RATE_SCHEMA },
            vettingFee:        { type: "object", additionalProperties: RATE_SCHEMA },
            defaultVettingFee: RATE_SCHEMA,
            maxLinesPerCampaign: { type: "number", minimum: 1 },
            reuseGraceDays:      { type: "number", minimum: 0 },
            defaultAreaCode:     { type: "string" },
            pollSweep:    { type: "object", additionalProperties: false, required: [ "initialDelaySeconds", "maxDelaySeconds", "backoffMultiplier" ],
                            properties: { initialDelaySeconds: { type: "number", minimum: 1 }, maxDelaySeconds: { type: "number", minimum: 1 }, backoffMultiplier: { type: "number", minimum: 1 } } },
            // minimum log verbosity — optional so older configs tolerate drift (withDefaults fills it)
            logLevel: { type: "string", enum: Object.values( LogLevel ) },
        },
    };

    /** JSON Schema validator for `Config`. */
    export const validate : Validation.Validator<Config> = Validation.compile<Config>( SCHEMA );

    // ── Seeded defaults (the DEFAULT the service seeds + falls back to) ──────────────────────────
    export const DEFAULT : Config =
    {
        // omit identity fields (cspId/resellerId/secretRef) from DEFAULT — a deployment missing them is an
        // anomaly to surface, not fabricate, per CLAUDE.md's model-conventions rule; seeded here only so the
        // schema's `required` is satisfiable by a fresh environment before an operator sets the real values
        cspId:      "",
        resellerId: "",
        secretRef:  "",

        // fresh environments seed to the FAKE provider only — a safe sink that never calls a real carrier
        // until an operator explicitly enables one, mirrors VoiceConfig's non-prod-safe posture
        providers: { [ Registration.CarrierProvider.FAKE ]: { provider: Registration.CarrierProvider.FAKE, enabled: true } },

        // legacy's use-case fee table (USD, whole cents expressed as milli-cents)
        useCaseMonthlyFee:
        {
            [ Registration.UseCase.TWO_FACTOR ]:       { amountMilliCents: 1_000_000, currency: "USD" },   // $10.00
            [ Registration.UseCase.CHARITY ]:          { amountMilliCents:   300_000, currency: "USD" },   // $3.00
            [ Registration.UseCase.LOW_VOLUME_MIXED ]: { amountMilliCents:   200_000, currency: "USD" },   // $2.00
            [ Registration.UseCase.SOLE_PROPRIETOR ]:  { amountMilliCents:    75_000, currency: "USD" },   // $0.75
            [ Registration.UseCase.POLITICAL ]:        { amountMilliCents: 1_000_000, currency: "USD" },   // $10.00
            [ Registration.UseCase.TRIAL ]:            { amountMilliCents:         0, currency: "USD" },
        },
        vettingFee:
        {
            [ Registration.VettingProvider.AEGIS ]: { amountMilliCents: 6_600_000, currency: "USD" },   // $66.00 (political)
            [ Registration.VettingProvider.CV ]:    { amountMilliCents: 9_500_000, currency: "USD" },   // $95.00 (political)
        },
        defaultVettingFee: { amountMilliCents: 4_150_000, currency: "USD" },   // $41.50 — legacy's generic fallback

        maxLinesPerCampaign: 49,
        reuseGraceDays:      60,

        pollSweep: { initialDelaySeconds: 60, maxDelaySeconds: 3_600, backoffMultiplier: 2 },
        logLevel:  LogLevel.INFO,   // verbose (trace) logging is opt-in per environment
    };
}

export default RegistrationConfig;
// eof
