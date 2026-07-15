//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";

//
// Cancel / remove a pending invite. Admin-only. `{inviteId}` is the invite.
//
export class DeleteInvite extends RestfulEndpoint<DeleteInvite.Query, undefined, DeleteInvite.Response>
{
    public readonly uri      : string = DeleteInvite.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.DELETE;
    public readonly access   : Access.Role = Access.AccountRole.ACCOUNT;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    constructor( inviteId? : string ) { super( { inviteId: inviteId ?? "" } ); }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return [ { field: "inviteId", location: RestfulEndpoint.AttrLocation.URI, required: true } ]; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema():  RestfulEndpoint.Schema | null { return null; }
}

export namespace DeleteInvite
{
    export const URI : string = apiPath( "acct", 1, "/invites/:inviteId" );   // /api/acct/v1/invites/:inviteId

    export interface Query { inviteId : string; }
    export interface Response { removed : boolean; }

    export enum Error { UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED, FORBIDDEN = NetworkUtils.Status.FORBIDDEN, INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR }
}

export default DeleteInvite;
