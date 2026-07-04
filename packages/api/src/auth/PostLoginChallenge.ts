//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";

import { Login } from "./model/Login";   // staged-login challenge vocabulary (shared contract)

//
// Stepped sign-in, step 2 — CHALLENGE. The client answers a challenge issued by /login/identify
// (a password, an emailed/texted code, a TOTP, …) carrying the `challengeToken`. The response is
// either `complete` (a session is issued) OR another set of `challenges` to satisfy next (e.g. MFA
// after a correct password).
//
//   client:
//   const endpt = new PostLoginChallenge( { challengeToken, type, value } );
//
export class PostLoginChallenge extends RestfulEndpoint<{}, PostLoginChallenge.Body, PostLoginChallenge.Response>
{
    public readonly uri      : string = PostLoginChallenge.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : Access.Role | undefined = undefined;   // non-authenticated
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    constructor( body? : PostLoginChallenge.Body )
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
                challengeToken: { type: 'string', minLength: 1 },
                type:           { type: 'string', enum: [ 'password', 'passkey', 'email_otp', 'sms_otp', 'totp' ] },  // = Login.ChallengeType (answerable factors)
                value:          { type: 'string', minLength: 1 }    // the password / code / OTP
            },
            required: ['challengeToken', 'type', 'value'],
            additionalProperties: false
        };
    }
}

export namespace PostLoginChallenge
{
    export const URI : string = apiPath( "auth", 1, "/login/challenge" );   // /api/auth/v1/login/challenge

    export interface Body extends RestfulEndpoint.NonAuthRequest
    {
        challengeToken : string;
        type           : Login.ChallengeType;   // which challenge is being answered
        value          : string;                // the answer (password / code / OTP)
    }

    export interface Response
    {
        complete       : boolean;                      // true → fully authenticated
        sessionToken?  : string;                       // present when complete
        challenges?    : Array<Login.ChallengeType>;   // present when more challenges remain (e.g. [TOTP])
        challengeToken? : string;                      // opaque handle to answer the next challenge (MFA continuation)
    }

    export enum Error
    {
        BAD_REQUEST           = NetworkUtils.Status.BAD_REQUEST,
        UNAUTHORIZED          = NetworkUtils.Status.UNAUTHORIZED,
        INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR,
    }
}

export default PostLoginChallenge;
