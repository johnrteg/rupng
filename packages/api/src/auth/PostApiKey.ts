//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { ApiKey } from "./model/ApiKey";

//
// Mint a developer API key for the acting account. The requested `role` is CAPPED at the caller's role (a user
// can't mint a key more powerful than themselves). Returns the created key's view PLUS the full one-time
// `secret` (`rup_<keyId>.<secret>`) — shown to the user ONCE; only its hash is stored server-side.
//
export class PostApiKey extends RestfulEndpoint<{}, PostApiKey.Body, PostApiKey.Response>
{
    public readonly uri      : string = PostApiKey.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    constructor( body? : PostApiKey.Body ) { super( {}, body ?? { name: "", role: Access.AccountRole.USER } ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null
    {
        return { type: "object", additionalProperties: false, required: [ "name", "role" ], properties: {
            name:          { type: "string", minLength: 1, maxLength: 100 },
            role:          { type: "string", enum: Object.values( Access.AccountRole ) },   // capped at the caller's role in the impl
            tier:          { type: "string", enum: Object.values( ApiKey.Tier ) },
            expiresInDays: { type: "number", minimum: 1, maximum: 3650 },
        } };
    }
}

export namespace PostApiKey
{
    export const URI : string = apiPath( "auth", 1, "/api-keys" );
    export interface Body extends RestfulEndpoint.AuthRequest { name : string; role : Access.Role; tier? : ApiKey.Tier; expiresInDays? : number; }
    /** `secret` is the FULL `rup_<keyId>.<secret>` credential — returned ONCE at creation, never again. */
    export interface Response { key : ApiKey.View; secret : string; }
    export enum Error { BAD_REQUEST = NetworkUtils.Status.BAD_REQUEST, UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED, FORBIDDEN = NetworkUtils.Status.FORBIDDEN, INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR }
}

export default PostApiKey;
