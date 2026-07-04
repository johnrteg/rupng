//
// Staged-login challenge vocabulary — shared contract (client + server). Login is a negotiation, not a
// single call: the server identifies the user, then issues one or more Challenges (password, OTP, passkey,
// SSO redirect); the client answers each until the flow resolves. These types are what both sides speak.
// Moved here from the auth service's internal model so PostLoginIdentify / PostLoginChallenge and the web
// client agree on one definition (previously challenges were ad-hoc Array<string>).
//
// Internal-only concerns — risk signals that triggered a step-up, the authorizer Context produced on
// success — stay in the auth service's AuthModel; they never cross the wire.
//
import type { Type } from "@repo/common";
import { Validation } from "../../model/Validation";

export namespace Login
{
    /** The kinds of challenge the server can demand. */
    export enum ChallengeType
    {
        IDENTIFIER   = "identifier",    // who are you (email/phone) — step 0 of a unified flow
        PASSWORD     = "password",
        PASSKEY      = "passkey",       // WebAuthn assertion
        EMAIL_OTP    = "email_otp",     // emailed one-time code
        SMS_OTP      = "sms_otp",       // texted one-time code
        TOTP         = "totp",          // authenticator-app code
        SSO_REDIRECT = "sso_redirect",  // hand off to the account's IdP
    }

    /** Which channel an OTP challenge is delivered over (when type is EMAIL_OTP / SMS_OTP). */
    export enum OtpChannel
    {
        EMAIL = "email",
        SMS   = "sms",
    }

    /** Where a login flow stands after the server's last response. */
    export enum ChallengeOutcome
    {
        PENDING       = "pending",        // more challenges remain — answer `next`
        AUTHENTICATED = "authenticated",  // flow complete — tokens issued
        DENIED        = "denied",         // flow failed — see `denyReason` (enumeration-neutral on anon surfaces)
    }

    /** One challenge the client must satisfy. */
    export interface Challenge
    {
        type          : ChallengeType;
        channel?      : OtpChannel;        // for OTP types — where the code was sent (masked destination in `prompt`)
        alternatives? : Array<ChallengeType>;  // other factors the user may choose instead (e.g. passkey vs password)
        redirectUrl?  : string;            // for SSO_REDIRECT — the IdP authorize URL
        prompt?       : string;            // human hint ("Enter the code sent to •••@gmail.com") — not localized server-side
    }

    /** The server's verdict for a login step — what the client renders / does next. */
    export interface ChallengeState
    {
        flowRef     : Type.ID;            // opaque handle threading the multi-step flow (the challengeToken)
        outcome     : ChallengeOutcome;
        next?       : Challenge;          // present when outcome is PENDING
        denyReason? : string;            // present when outcome is DENIED — coarse + enumeration-neutral
    }

    // ── Schema + validator for the staged-login verdict `ChallengeState` (the wire message) ──────
    /** One challenge (`next`) — the factor the client must satisfy. */
    const CHALLENGE_SCHEMA : Validation.Schema =
    {
        type: "object", additionalProperties: false, required: [ "type" ],
        properties: {
            type:         { type: "string", enum: Object.values( ChallengeType ) },
            channel:      { type: "string", enum: Object.values( OtpChannel ) },
            alternatives: { type: "array", items: { type: "string", enum: Object.values( ChallengeType ) } },
            redirectUrl:  { type: "string" },
            prompt:       { type: "string" },
        },
    };

    export const SCHEMA : Validation.Schema =
    {
        $schema: "http://json-schema.org/draft-07/schema#",
        type: "object", additionalProperties: false, required: [ "flowRef", "outcome" ],
        properties: {
            flowRef:    { type: "string" },
            outcome:    { type: "string", enum: Object.values( ChallengeOutcome ) },
            next:       CHALLENGE_SCHEMA,
            denyReason: { type: "string" },
        },
    };

    /** Validate a `Login.ChallengeState` (a wire payload, a Kafka/SQS message body). */
    export const validate : Validation.Validator<ChallengeState> = Validation.compile<ChallengeState>( SCHEMA );
}

export default Login;
