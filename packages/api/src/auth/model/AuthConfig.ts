//
// AuthConfig — the auth service's runtime configuration (its AppConfig `config/settings` profile). The
// tunables you change WITHOUT a redeploy: lockout/risk, MFA policy, token/session lifetimes, contact
// verification, WebAuthn/passkey RP config, abuse rate-limits, and SSO.
//
// Lives in @repo/api (not the service) so the ONE definition is shared: the auth service reads it live +
// seeds `DEFAULT`; the Console's AppConfig editor lints edits against `SCHEMA`; the web admin UI validates
// with `validate()`. Secrets (Cognito client secret, the session-signing secret, SSO client secrets) do
// NOT belong here — they live in Secrets Manager. This profile is non-secret operational policy.
//
import { MfaMethod } from "./AuthMethod";
import { Validation } from "../../model/Validation";
import { LogLevel } from "../../model/LogLevel";

export namespace AuthConfig
{
    /** Failed-login lockout + adaptive risk (RISK.md). */
    export interface Lockout
    {
        maxFailedAttempts     : number;          // fails before a temporary lock
        backoffMinutes        : Array<number>;   // escalating lock durations, e.g. [5, 10, 20]
        lockoutsBeforeDisable : number;          // repeated locks → hard-disable + notify admins
        adaptiveMfa           : boolean;         // require MFA on anomalous (new device/geo) sign-in
    }

    /** Multi-factor policy (auth-3). */
    export interface Mfa
    {
        methods           : Array<MfaMethod>;    // allowed factors (shared MfaMethod vocabulary)
        enforcement       : "off" | "optional" | "required";
        stepUpOnElevation : boolean;             // re-challenge for sensitive operations
    }

    /** Token + session lifetimes (auth-6, auth-7). */
    export interface Tokens
    {
        accessTtlSeconds      : number;
        refreshTtlSeconds     : number;
        rotateRefresh         : boolean;         // rotate the refresh token on use (reuse-detection)
        idleTimeoutSeconds    : number;          // server-side idle window (role-keyed in future)
        maxConcurrentSessions : number;
    }

    /** Contact verification (email/phone codes). */
    export interface Verification
    {
        codeLength            : number;
        codeTtlSeconds        : number;
        resendCooldownSeconds : number;
        emailRequired         : boolean;         // email must be verified before activation
        phoneRequired         : boolean;         // phone must be verified at signup
    }

    /** WebAuthn / passkey relying-party config (auth-4). Origins must match the served web origin. */
    export interface WebAuthn
    {
        rpName           : string;
        rpId             : string;               // the RP ID (registrable domain), e.g. "rumbleup.com" / "localhost"
        origins          : Array<string>;        // allowed origins, e.g. ["https://app.rumbleup.com"]
        userVerification : "preferred" | "required" | "discouraged";
        residentKey      : "preferred" | "required" | "discouraged";
        attestation      : "none" | "direct" | "indirect" | "enterprise";
    }

    /** A single rate-limit tier. */
    export interface RateLimit { perMinute : number; burst : number; }

    /** Abuse controls — per-IP and per-identity rate limits on the sensitive surfaces. */
    export interface Abuse
    {
        byIp       : boolean;                    // apply limits keyed by client IP
        byIdentity : boolean;                    // apply limits keyed by the target identity
        login      : RateLimit;
        register   : RateLimit;
        reset      : RateLimit;                  // password forgot/reset
        resend     : RateLimit;                  // verification/challenge code resends
    }

    /** SSO / federation (auth-5). */
    export interface Sso
    {
        providers      : Array<string>;          // enabled social providers: "google" | "microsoft" | "apple"
        ssoOnlyDefault : boolean;                // new account default for SSO-only enforcement
        scimEnabled    : boolean;                // directory-driven provisioning
    }

    export interface Config
    {
        lockout      : Lockout;
        mfa          : Mfa;
        tokens       : Tokens;
        verification : Verification;
        webauthn     : WebAuthn;
        abuse        : Abuse;
        sso          : Sso;
        logLevel?    : LogLevel;   // minimum log verbosity — applied live, no redeploy (Application.refreshLogLevel)
    }

    // ── Schema + validator (shared: service / web / Console) ────────────────────────────────────
    const RATE_LIMIT : Validation.Schema =
    {
        type: "object", additionalProperties: false,
        required: [ "perMinute", "burst" ],
        properties: { perMinute: { type: "integer", minimum: 0 }, burst: { type: "integer", minimum: 0 } },
    };

    /** JSON Schema for `Config` — hand off to a JSON editor (CodeMirror linting) or compile to validate. */
    export const SCHEMA : Validation.Schema =
    {
        $schema: "http://json-schema.org/draft-07/schema#",
        type: "object", additionalProperties: false,
        required: [ "lockout", "mfa", "tokens", "verification", "webauthn", "abuse", "sso" ],
        properties:
        {
            lockout: {
                type: "object", additionalProperties: false,
                required: [ "maxFailedAttempts", "backoffMinutes", "lockoutsBeforeDisable", "adaptiveMfa" ],
                properties: {
                    maxFailedAttempts:     { type: "integer", minimum: 1 },
                    backoffMinutes:        { type: "array", items: { type: "integer", minimum: 0 } },
                    lockoutsBeforeDisable: { type: "integer", minimum: 1 },
                    adaptiveMfa:           { type: "boolean" },
                },
            },
            mfa: {
                type: "object", additionalProperties: false,
                required: [ "methods", "enforcement", "stepUpOnElevation" ],
                properties: {
                    methods:           { type: "array", items: { type: "string", enum: Object.values( MfaMethod ) } },
                    enforcement:       { type: "string", enum: [ "off", "optional", "required" ] },
                    stepUpOnElevation: { type: "boolean" },
                },
            },
            tokens: {
                type: "object", additionalProperties: false,
                required: [ "accessTtlSeconds", "refreshTtlSeconds", "rotateRefresh", "idleTimeoutSeconds", "maxConcurrentSessions" ],
                properties: {
                    accessTtlSeconds:      { type: "integer", minimum: 1 },
                    refreshTtlSeconds:     { type: "integer", minimum: 1 },
                    rotateRefresh:         { type: "boolean" },
                    idleTimeoutSeconds:    { type: "integer", minimum: 1 },
                    maxConcurrentSessions: { type: "integer", minimum: 1 },
                },
            },
            verification: {
                type: "object", additionalProperties: false,
                required: [ "codeLength", "codeTtlSeconds", "resendCooldownSeconds", "emailRequired", "phoneRequired" ],
                properties: {
                    codeLength:            { type: "integer", minimum: 4, maximum: 12 },
                    codeTtlSeconds:        { type: "integer", minimum: 1 },
                    resendCooldownSeconds: { type: "integer", minimum: 0 },
                    emailRequired:         { type: "boolean" },
                    phoneRequired:         { type: "boolean" },
                },
            },
            webauthn: {
                type: "object", additionalProperties: false,
                required: [ "rpName", "rpId", "origins", "userVerification", "residentKey", "attestation" ],
                properties: {
                    rpName:           { type: "string", minLength: 1 },
                    rpId:             { type: "string", minLength: 1 },
                    origins:          { type: "array", items: { type: "string" } },
                    userVerification: { type: "string", enum: [ "preferred", "required", "discouraged" ] },
                    residentKey:      { type: "string", enum: [ "preferred", "required", "discouraged" ] },
                    attestation:      { type: "string", enum: [ "none", "direct", "indirect", "enterprise" ] },
                },
            },
            abuse: {
                type: "object", additionalProperties: false,
                required: [ "byIp", "byIdentity", "login", "register", "reset", "resend" ],
                properties: {
                    byIp:       { type: "boolean" },
                    byIdentity: { type: "boolean" },
                    login:      RATE_LIMIT,
                    register:   RATE_LIMIT,
                    reset:      RATE_LIMIT,
                    resend:     RATE_LIMIT,
                },
            },
            sso: {
                type: "object", additionalProperties: false,
                required: [ "providers", "ssoOnlyDefault", "scimEnabled" ],
                properties: {
                    providers:      { type: "array", items: { type: "string", enum: [ "google", "microsoft", "apple" ] } },
                    ssoOnlyDefault: { type: "boolean" },
                    scimEnabled:    { type: "boolean" },
                },
            },
            // minimum log verbosity — optional so older configs tolerate drift (withDefaults fills it)
            logLevel: { type: "string", enum: Object.values( LogLevel ) },
        },
    };

    /** Validate a candidate config (a parsed editor buffer, a fetched profile, a message payload). */
    export const validate : Validation.Validator<Config> = Validation.compile<Config>( SCHEMA );

    /** Seed for a fresh environment — safe, conservative defaults. */
    export const DEFAULT : Config =
    {
        lockout: {
            maxFailedAttempts:     5,
            backoffMinutes:        [ 5, 10, 20 ],
            lockoutsBeforeDisable: 5,
            adaptiveMfa:           true,
        },
        mfa: {
            methods:           [ MfaMethod.TOTP, MfaMethod.SMS ],
            enforcement:       "optional",
            stepUpOnElevation: true,
        },
        tokens: {
            accessTtlSeconds:      3600,        // 1h
            refreshTtlSeconds:     2_592_000,   // 30d
            rotateRefresh:         true,
            idleTimeoutSeconds:    1800,        // 30m
            maxConcurrentSessions: 10,
        },
        verification: {
            codeLength:            6,
            codeTtlSeconds:        600,         // 10m
            resendCooldownSeconds: 30,
            emailRequired:         true,
            phoneRequired:         false,
        },
        webauthn: {
            rpName:           "RumbleUp",
            rpId:             "localhost",
            origins:          [ "http://localhost:5173" ],
            userVerification: "preferred",
            residentKey:      "preferred",
            attestation:      "none",
        },
        abuse: {
            byIp:       true,
            byIdentity: true,
            login:      { perMinute: 10, burst: 20 },
            register:   { perMinute: 5,  burst: 10 },
            reset:      { perMinute: 5,  burst: 10 },
            resend:     { perMinute: 3,  burst: 5 },
        },
        sso: {
            providers:      [ "google", "microsoft", "apple" ],
            ssoOnlyDefault: false,
            scimEnabled:    false,
        },
        logLevel: LogLevel.INFO,   // verbose (trace) logging is opt-in per environment
    };
}

export default AuthConfig;
