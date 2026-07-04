//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { Account } from "./model/Account";

//
// List the users with access to the caller's ACTING account (the X-Account header) — role, status,
// created, best-effort last-login. Admin-only. See PatchMember / DeleteMember to manage them.
//
export class GetMembers extends RestfulEndpoint<{}, undefined, GetMembers.Response>
{
    public readonly uri      : string = GetMembers.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.GET;
    public readonly access   : Access.Role = Access.AccountRole.ACCOUNT;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    constructor() { super( {} ); }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema():  RestfulEndpoint.Schema | null { return null; }
}

export namespace GetMembers
{
    export const URI : string = apiPath( "acct", 1, "/members" );   // /api/acct/v1/members

    export interface Response { members : Array<Account.Member>; }

    export enum Error { UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED, FORBIDDEN = NetworkUtils.Status.FORBIDDEN, INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR }
}

export default GetMembers;
