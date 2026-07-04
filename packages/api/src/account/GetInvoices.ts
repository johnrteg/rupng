//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { Billing } from "./model/Billing";

// Invoice history for the acting account, optionally bounded by an ISO date range. SKELETON — empty until Stripe.
export class GetInvoices extends RestfulEndpoint<GetInvoices.Query, undefined, GetInvoices.Response>
{
    public readonly uri      : string = GetInvoices.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.GET;
    public readonly access   : Access.Role = Access.AccountRole.BILLING;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    constructor( query? : GetInvoices.Query ) { super( query ?? {} ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap>
    {
        return [
            { field: "from", location: RestfulEndpoint.AttrLocation.QUERY_PARAM, required: false },
            { field: "to",   location: RestfulEndpoint.AttrLocation.QUERY_PARAM, required: false },
        ];
    }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema():  RestfulEndpoint.Schema | null { return null; }
}

export namespace GetInvoices
{
    export const URI : string = apiPath( "acct", 1, "/billing/invoices" );
    export interface Query { from? : string; to? : string; }
    export interface Response { invoices : Array<Billing.Invoice>; }
    export enum Error { UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED, FORBIDDEN = NetworkUtils.Status.FORBIDDEN, INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR }
}

export default GetInvoices;
