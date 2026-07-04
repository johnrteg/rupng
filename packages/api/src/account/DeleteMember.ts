//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";

//
// Remove a user's access to the acting account (deletes the membership — NOT the user). Admin-only; the
// account **owner** can't be removed. `{userId}` is the member.
//
export class DeleteMember extends RestfulEndpoint<DeleteMember.Query, undefined, DeleteMember.Response>
{
    public readonly uri      : string = DeleteMember.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.DELETE;
    public readonly access   : Access.Role = Access.AccountRole.ACCOUNT;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    constructor( userId? : string ) { super( { userId: userId ?? "" } ); }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return [ { field: "userId", location: RestfulEndpoint.AttrLocation.URI, required: true } ]; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema():  RestfulEndpoint.Schema | null { return null; }
}

export namespace DeleteMember
{
    export const URI : string = apiPath( "acct", 1, "/members/:userId" );   // /api/acct/v1/members/:userId

    export interface Query { userId : string; }
    export interface Response { removed : boolean; }

    export enum Error { UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED, FORBIDDEN = NetworkUtils.Status.FORBIDDEN, INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR }
}

export default DeleteMember;
