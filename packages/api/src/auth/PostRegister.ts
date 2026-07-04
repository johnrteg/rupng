//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { ContactMethod } from "./model/AuthMethod";

//
// Sign-up — create the pending account. Posted after the bot check; collects the identifier (email
// or phone), the user's name, the account/workspace name, the chosen password, and the ToS
// acceptance. Returns a `registrationToken` + which contact `verify` channel is required (email or
// phone). Enumeration-neutral: an already-registered identifier is handled out-of-band.
// See apps/core/auth/specs/REGISTRATION.md.
//
//   client:
//   const endpt = new PostRegister( { method, account, firstName, lastName, accountName, password, acceptedTerms } );
//
export class PostRegister extends RestfulEndpoint<{}, PostRegister.Body, PostRegister.Response>
{
    public readonly uri      : string = PostRegister.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : Access.Role | undefined = undefined;   // non-authenticated
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    constructor( body? : PostRegister.Body )
    {
        super( {}, body );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }

    public getBodySchema(): RestfulEndpoint.Schema | null
    {
        return {
            type: 'object',
            properties: {
                method:        { type: 'string', enum: [ 'email', 'phone' ] },
                account:       { type: 'string', minLength: 3, maxLength: 320 },   // email or phone (E.164)
                firstName:     { type: 'string', minLength: 1, maxLength: 100 },
                lastName:      { type: 'string', minLength: 1, maxLength: 100 },
                accountName:   { type: 'string', maxLength: 200 },                // optional — no longer prompted; personal account defaults to the user's name
                password:      { type: 'string', minLength: 8, maxLength: 256 },
                acceptedTerms: { type: 'boolean', const: true },                  // must accept the ToS
                botToken:      { type: 'string' }                                 // anti-bot proof (optional until wired)
            },
            required: ['method', 'account', 'firstName', 'lastName', 'password', 'acceptedTerms'],
            additionalProperties: false
        };
    }
}

export namespace PostRegister
{
    export const URI : string = apiPath( "auth", 1, "/register" );   // /api/auth/v1/register

    // How long the emailed/texted verification code stays valid. Cognito's email/SMS verification codes
    // are valid for 24h and that is FIXED by AWS (no per-pool setting), so this is the authoritative value
    // we surface to the client for its expiry countdown — change here if AWS ever exposes a TTL knob.
    export const CODE_EXPIRES_SEC    : number = 24 * 60 * 60;   // 86400
    // Minimum gap between code resends — drives the verify screen's "Resend code in N" cooldown.
    export const RESEND_COOLDOWN_SEC : number = 30;

    export interface Body extends RestfulEndpoint.NonAuthRequest
    {
        method        : ContactMethod;    // which contact rail `account` is on (email | phone)
        account       : string;    // the identifier (email or E.164 phone)
        firstName     : string;
        lastName      : string;
        accountName?  : string;    // optional — registration no longer prompts for it (invited users skip a personal account entirely)
        password      : string;
        acceptedTerms : boolean;
        botToken?     : string;    // CAPTCHA / Turnstile / hCaptcha token (when wired)
    }

    export interface Response
    {
        registrationToken : string;   // threaded through /register/verify + /verify/*
        verify            : ContactMethod;   // the channel a code was sent to (email | phone)
        codeExpiresInSec  : number;   // validity of the just-sent code (drives the verify-screen expiry countdown)
        resendCooldownSec : number;   // seconds before "Resend code" re-enables
    }

    export enum Error
    {
        BAD_REQUEST           = NetworkUtils.Status.BAD_REQUEST,
        CONFLICT              = NetworkUtils.Status.CONFLICT,   // identifier already in use (handled out-of-band)
        INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR,
    }
}

export default PostRegister;
