//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";

//
// Revoke a developer API key (by keyId) belonging to the acting account. Sets status = revoked (the key stops
// authenticating immediately); the row is kept for audit until its TTL. USER role.
//
export class DeleteApiKey extends RestfulEndpoint<DeleteApiKey.Query, undefined, DeleteApiKey.Response>
{
    public readonly uri      : string = DeleteApiKey.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.DELETE;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    constructor( keyId? : string ) { super( { keyId: keyId ?? "" } ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return [ { field: "keyId", location: RestfulEndpoint.AttrLocation.URI, required: true } ]; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null { return null; }
}

export namespace DeleteApiKey
{
    export const URI : string = apiPath( "auth", 1, "/api-keys/:keyId" );
    export interface Query { keyId : string; }
    export interface Response { revoked : boolean; }
    export enum Error { BAD_REQUEST = NetworkUtils.Status.BAD_REQUEST, UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED, NOT_FOUND = NetworkUtils.Status.NOT_FOUND, INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR }
}

export default DeleteApiKey;
