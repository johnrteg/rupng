//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";

import { Login } from "./model/Login";   // staged-login challenge vocabulary (shared contract)

//
// Stepped sign-in — RESEND a code-based login challenge (emailed / texted code). Carries the
// `challengeToken` from /login/identify and the challenge `type` to re-send.
//
//   client:
//   const endpt = new PostLoginChallengeResend( { challengeToken, type } );
//
export class PostLoginChallengeResend extends RestfulEndpoint<{}, PostLoginChallengeResend.Body, PostLoginChallengeResend.Response>
{
    public readonly uri      : string = PostLoginChallengeResend.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : Access.Role | undefined = undefined;   // non-authenticated
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    constructor( body? : PostLoginChallengeResend.Body )
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
                challengeToken: { type: 'string' },
                type:           { type: 'string', enum: [ 'email_otp', 'sms_otp' ] }   // only code-based (OTP) challenges are resendable
            },
            required: ['challengeToken', 'type'],
            additionalProperties: false
        };
    }
}

export namespace PostLoginChallengeResend
{
    export const URI : string = apiPath( "auth", 1, "/login/challenge/resend" );   // /api/auth/v1/login/challenge/resend

    export interface Body extends RestfulEndpoint.NonAuthRequest
    {
        challengeToken : string;
        type           : Login.ChallengeType;   // an OTP type (EMAIL_OTP / SMS_OTP)
    }

    export interface Response
    {
        sent : boolean;
    }

    export enum Error
    {
        BAD_REQUEST           = NetworkUtils.Status.BAD_REQUEST,
        TOO_MANY_REQUESTS     = NetworkUtils.Status.TOO_MANY_REQUESTS,
        INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR,
    }
}

export default PostLoginChallengeResend;
