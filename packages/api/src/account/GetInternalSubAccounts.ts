//
import { RestfulEndpoint, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { Account } from "./model/Account";
import { Paging } from "../model/Paging";

//
// S2S: list an EXPLICIT account's direct sub-accounts (children where parentId = the given accountId), paged.
// INTERNAL audience — no user session on an S2S call, so the caller passes `accountId` explicitly instead of
// relying on the ambient X-Account header. First consumer: the `report` service.
//
export class GetInternalSubAccounts extends RestfulEndpoint< GetInternalSubAccounts.Query, undefined, GetInternalSubAccounts.Response >
{
    public readonly uri      : string = GetInternalSubAccounts.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.GET;
    public readonly access   : undefined = undefined;   // S2S (INTERNAL audience) — no RBAC role
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.INTERNAL;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "listInternalSubAccounts",
        summary:     "List an account's sub-accounts (S2S)",
        description: "Lists the given account's direct sub-accounts as a tree (paged — ?count / ?start; returns { records, page }).",
        tags:        [ "Account" ],
    };

    constructor( query? : GetInternalSubAccounts.Query ) { super( query ?? { accountId: "" } ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null
    {
        return {
            type: "object", additionalProperties: false, required: [ "accountId" ],
            properties: {
                accountId: { type: "string" },
                count:     { type: "number" },
                start:     { type: "string" },
            },
        };
    }
    public getBodySchema():  RestfulEndpoint.Schema | null { return null; }
}

export namespace GetInternalSubAccounts
{
    export const URI : string = apiPath( "acct", 1, "/internal/sub-accounts" );   // /api/acct/v1/internal/sub-accounts

    export interface Query extends Paging.Request
    {
        accountId : string;
    }

    export interface Response extends Paging.Result<Account.SubAccount> {}

    export enum Error
    {
        BAD_REQUEST           = NetworkUtils.Status.BAD_REQUEST,
        INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR,
    }
}

export default GetInternalSubAccounts;
// eof
