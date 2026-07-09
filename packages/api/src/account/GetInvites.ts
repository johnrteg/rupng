//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { Account } from "./model/Account";
import { Paging } from "../model/Paging";

//
// List the acting account's **pending** invitations (email, role, how old). Admin-only. Paged ({ records, page }).
//
export class GetInvites extends RestfulEndpoint<GetInvites.Query, undefined, GetInvites.Response>
{
    public readonly uri      : string = GetInvites.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.GET;
    public readonly access   : Access.Role = Access.AccountRole.ACCOUNT;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    constructor( query? : GetInvites.Query ) { super( query ?? {} ); }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema():  RestfulEndpoint.Schema | null { return null; }
}

export namespace GetInvites
{
    export const URI : string = apiPath( "acct", 1, "/invites" );   // /api/acct/v1/invites

    export interface Query extends Paging.Request {}
    export interface Response extends Paging.Result<Account.Invite> {}

    export enum Error { UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED, FORBIDDEN = NetworkUtils.Status.FORBIDDEN, INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR }
}

export default GetInvites;
