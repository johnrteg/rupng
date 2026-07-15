//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";

import { Login } from "./model/Login";   // staged-login challenge vocabulary (shared contract)

//
// Stepped sign-in, step 1 — IDENTIFY. The client posts the account identifier (email or phone) and
// gets back the next challenge(s) to satisfy (password / emailed code / texted code / TOTP) plus a
// short-lived `challengeToken` that ties the subsequent /login/challenge calls together.
// Enumeration-neutral: the response shape is the same whether or not the account exists.
//
//   client:
//   const endpt = new PostLoginIdentify( { account } );
//   const response = await appdata.server.fetch( endpt );
//
export class PostLoginIdentify extends RestfulEndpoint<{}, PostLoginIdentify.Body, PostLoginIdentify.Response>
{
    public readonly uri      : string = PostLoginIdentify.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : Access.Role | undefined = undefined;   // non-authenticated
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;   // first-party app, edge-reachable

    constructor( body? : PostLoginIdentify.Body )
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
            properties: { account: { type: 'string', minLength: 3, maxLength: 320 } },
            required: ['account'],
            additionalProperties: false
        };
    }
}

export namespace PostLoginIdentify
{
    export const URI : string = apiPath( "auth", 1, "/login/identify" );   // /api/auth/v1/login/identify

    export interface Body extends RestfulEndpoint.NonAuthRequest
    {
        account : string;   // email or phone (E.164)
    }

    export interface Response
    {
        challengeToken : string;                      // opaque handle threaded through /login/challenge (the flowRef)
        challenges     : Array<Login.ChallengeType>;  // e.g. [PASSWORD] | [SMS_OTP] | [PASSWORD, TOTP]
    }

    export enum Error
    {
        BAD_REQUEST           = NetworkUtils.Status.BAD_REQUEST,
        INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR,
    }
}

export default PostLoginIdentify;
