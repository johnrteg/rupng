//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";

//
// Remove one of the signed-in caller's passkeys by credential id (path param). Scoped to the caller.
//
export class DeletePasskey extends RestfulEndpoint<DeletePasskey.Query, undefined, DeletePasskey.Response>
{
    public readonly uri      : string = DeletePasskey.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.DELETE;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    constructor( query? : DeletePasskey.Query ) { super( query ?? { credentialId: "" }, undefined ); }

    public getMappings(): Array<RestfulEndpoint.FieldMap> { return [ { field: "credentialId", location: RestfulEndpoint.AttrLocation.URI, required: true } ]; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null { return null; }
}

export namespace DeletePasskey
{
    export const URI : string = apiPath( "auth", 1, "/passkeys/:credentialId" );   // /api/auth/v1/passkeys/:credentialId

    export interface Query { credentialId : string; }
    export interface Response { deleted : boolean; }

    export enum Error { UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED, NOT_FOUND = NetworkUtils.Status.NOT_FOUND, INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR }
}

export default DeletePasskey;
