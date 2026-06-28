//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { User } from "./model/User";

//
// Complete passkey SIGN-IN — verify the authenticator assertion against the stored credential and, on
// success, issue an auth session. `response` is the browser's `startAuthentication()` result.
//
export class PostLoginPasskeyVerify extends RestfulEndpoint<{}, PostLoginPasskeyVerify.Body, PostLoginPasskeyVerify.Response>
{
    public readonly uri      : string = PostLoginPasskeyVerify.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : Access.Role | undefined = undefined;   // the assertion is the proof
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    constructor( body? : PostLoginPasskeyVerify.Body ) { super( {}, body ); }

    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null
    {
        return { type: 'object', properties: { ceremonyId: { type: 'string', minLength: 1 }, response: { type: 'object' } }, required: ['ceremonyId', 'response'], additionalProperties: true };
    }
}

export namespace PostLoginPasskeyVerify
{
    export const URI : string = apiPath( "auth", 1, "/login/passkey/verify" );   // /api/auth/v1/login/passkey/verify

    export interface Body extends RestfulEndpoint.NonAuthRequest
    {
        ceremonyId : string;
        response   : Record<string, unknown>;   // AuthenticationResponseJSON from @simplewebauthn/browser
    }

    export interface Response
    {
        complete      : boolean;
        sessionToken? : string;        // auth-issued session token (present when complete)
        user?         : User.Entity;
    }

    export enum Error { BAD_REQUEST = NetworkUtils.Status.BAD_REQUEST, UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED, INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR }
}

export default PostLoginPasskeyVerify;
