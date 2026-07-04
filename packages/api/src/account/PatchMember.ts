//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { Account } from "./model/Account";

//
// Change a member's role and/or access status (suspend / reactivate) in the acting account. Admin-only.
// The account **owner** can't be changed. `{userId}` is the member. Returns the updated Member.
//
export class PatchMember extends RestfulEndpoint<PatchMember.Query, PatchMember.Body, PatchMember.Response>
{
    public readonly uri      : string = PatchMember.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.PATCH;
    public readonly access   : Access.Role = Access.AccountRole.ACCOUNT;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    constructor( userId? : string, body? : PatchMember.Body ) { super( { userId: userId ?? "" }, body ); }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return [ { field: "userId", location: RestfulEndpoint.AttrLocation.URI, required: true } ]; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null
    {
        return { type: "object", properties: { role: { type: "string" }, status: { type: "string" } }, additionalProperties: false };
    }
}

export namespace PatchMember
{
    export const URI : string = apiPath( "acct", 1, "/members/:userId" );   // /api/acct/v1/members/:userId

    export interface Query { userId : string; }
    export interface Body extends RestfulEndpoint.AuthRequest
    {
        role?   : Access.Role;
        status? : Account.MemberStatus;
    }
    export interface Response { member : Account.Member; }

    export enum Error { BAD_REQUEST = NetworkUtils.Status.BAD_REQUEST, UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED, FORBIDDEN = NetworkUtils.Status.FORBIDDEN, NOT_FOUND = NetworkUtils.Status.NOT_FOUND, INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR }
}

export default PatchMember;
