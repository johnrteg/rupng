//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";

//
// Rotate the refresh token → a new access token (Cognito REFRESH_TOKEN_AUTH; reuse-detection later).
// Authenticated by the refresh token in the body, not the access role.
//
export class PostSessionRefresh extends RestfulEndpoint<{}, PostSessionRefresh.Body, PostSessionRefresh.Response>
{
    public readonly uri      : string = PostSessionRefresh.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : Access.Role | undefined = undefined;   // the refresh token is the proof
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    constructor( body? : PostSessionRefresh.Body ) { super( {}, body ); }

    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null
    {
        return { type: 'object', properties: { refreshToken: { type: 'string', minLength: 1 } }, required: ['refreshToken'], additionalProperties: false };
    }
}

export namespace PostSessionRefresh
{
    export const URI : string = apiPath( "auth", 1, "/session/refresh" );   // /api/auth/v1/session/refresh

    export interface Body extends RestfulEndpoint.NonAuthRequest { refreshToken : string; }
    export interface Response { sessionToken : string; expiresIn? : number; }

    export enum Error { BAD_REQUEST = NetworkUtils.Status.BAD_REQUEST, UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED, INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR }
}

export default PostSessionRefresh;
