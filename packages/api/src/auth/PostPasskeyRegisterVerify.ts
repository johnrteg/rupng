//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";

//
// Complete passkey ENROLMENT — verify the authenticator's attestation and store the credential.
// `response` is the browser's `startRegistration()` result.
//
export class PostPasskeyRegisterVerify extends RestfulEndpoint<{}, PostPasskeyRegisterVerify.Body, PostPasskeyRegisterVerify.Response>
{
    public readonly uri      : string = PostPasskeyRegisterVerify.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    constructor( body? : PostPasskeyRegisterVerify.Body ) { super( {}, body ); }

    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null
    {
        return { type: 'object', properties: { ceremonyId: { type: 'string', minLength: 1 }, response: { type: 'object' } }, required: ['ceremonyId', 'response'], additionalProperties: true };
    }
}

export namespace PostPasskeyRegisterVerify
{
    export const URI : string = apiPath( "auth", 1, "/passkey/register/verify" );   // /api/auth/v1/passkey/register/verify

    export interface Body extends RestfulEndpoint.NonAuthRequest
    {
        ceremonyId : string;
        response   : Record<string, unknown>;   // RegistrationResponseJSON from @simplewebauthn/browser
    }

    export interface Response { verified : boolean; credentialId? : string; }

    export enum Error { BAD_REQUEST = NetworkUtils.Status.BAD_REQUEST, UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED, INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR }
}

export default PostPasskeyRegisterVerify;
