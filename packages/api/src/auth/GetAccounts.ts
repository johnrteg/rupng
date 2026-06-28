//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { User } from "./model/User";

//
// The accounts the caller can act in (+ their max role) — the account/role switcher list. Account is
// the SoT for membership; auth reads the resolved grant.
//
export class GetAccounts extends RestfulEndpoint<{}, undefined, GetAccounts.Response>
{
    public readonly uri      : string = GetAccounts.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.GET;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    constructor() { super( {} ); }

    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null { return null; }
}

export namespace GetAccounts
{
    export const URI : string = apiPath( "auth", 1, "/accounts" );   // /api/auth/v1/accounts

    export interface Response { accounts : Array<User.Membership>; }

    export enum Error { UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED, INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR }
}

export default GetAccounts;
