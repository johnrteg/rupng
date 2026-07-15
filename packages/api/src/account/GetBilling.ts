//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { Billing } from "./model/Billing";

//
// Billing overview for the acting account (X-Account) — plan + costs + balance + settings + billing
// address + default method, in one read. SKELETON until Stripe/plans land.
//
export class GetBilling extends RestfulEndpoint<{}, undefined, GetBilling.Response>
{
    public readonly uri      : string = GetBilling.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.GET;
    public readonly access   : Access.Role = Access.AccountRole.BILLING;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    constructor() { super( {} ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema():  RestfulEndpoint.Schema | null { return null; }
}

export namespace GetBilling
{
    export const URI : string = apiPath( "acct", 1, "/billing" );   // /api/acct/v1/billing
    export interface Response { overview : Billing.Overview; }
    export enum Error { UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED, FORBIDDEN = NetworkUtils.Status.FORBIDDEN, INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR }
}

export default GetBilling;
