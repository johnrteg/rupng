//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { User } from "./model/User";
import { Paging } from "../model/Paging";

//
// The accounts the caller can act in (+ their max role) — the account/role switcher list. Account is
// the SoT for membership; auth reads the resolved grant. Paged ({ records, page }); the switcher fetches
// all pages so it always has the complete membership set.
//
export class GetAccounts extends RestfulEndpoint<GetAccounts.Query, undefined, GetAccounts.Response>
{
    public readonly uri      : string = GetAccounts.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.GET;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.PUBLIC;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "listAccounts",
        summary:     "List accounts",
        description: "The accounts the caller can act in, each with the caller's maximum role — the account/role switcher list.",
        tags:        [ "Account" ],
    };

    constructor( query? : GetAccounts.Query ) { super( query ?? {} ); }

    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null { return null; }

    // success body — the caller's memberships (account id/name + their ceiling role)
    public getResponseSchema(): RestfulEndpoint.Schema | null
    {
        return {
            type: "object",
            required: [ "records", "page" ],
            properties: {
                records: {
                    type: "array",
                    description: "Accounts the caller can act in (this page).",
                    items: {
                        type: "object",
                        properties: {
                            accountId:   { type: "string", description: "Account id." },
                            accountName: { type: "string", description: "Account display name." },
                            parentName:  { type: "string", description: "Immediate parent account name (for a sub-account)." },
                            maxRole:     { type: "string", description: "The caller's ceiling role in this account." },
                            owner:       { type: "boolean", description: "True when the caller owns this account." },
                        },
                    },
                },
                page: { type: "object", description: "Paging envelope.", properties: {
                    count: { type: "number" }, total: { type: "number" }, next: { type: "string" } } },
            },
        };
    }
}

export namespace GetAccounts
{
    export const URI : string = apiPath( "auth", 1, "/accounts" );   // /api/auth/v1/accounts

    export interface Query extends Paging.Request {}
    export interface Response extends Paging.Result<User.Membership> {}

    export enum Error { UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED, INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR }
}

export default GetAccounts;
