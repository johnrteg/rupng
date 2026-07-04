//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { Billing } from "./model/Billing";

//
// Add funds to the acting account's prepaid balance (a one-off top-up). SKELETON — charges the default
// method via Stripe when wired; for now returns the (unchanged) balance.
//
export class PostBalanceTopup extends RestfulEndpoint<{}, PostBalanceTopup.Body, PostBalanceTopup.Response>
{
    public readonly uri      : string = PostBalanceTopup.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : Access.Role = Access.AccountRole.BILLING;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    constructor( body? : PostBalanceTopup.Body ) { super( {}, body ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null
    {
        return { type: "object", properties: { amountMinor: { type: "number", minimum: 1 } }, required: [ "amountMinor" ], additionalProperties: false };
    }
}

export namespace PostBalanceTopup
{
    export const URI : string = apiPath( "acct", 1, "/billing/balance/topup" );
    export interface Body extends RestfulEndpoint.AuthRequest { amountMinor : number; }   // minor units (cents)
    export interface Response { balance : Billing.AccountBalance; }
    export enum Error { BAD_REQUEST = NetworkUtils.Status.BAD_REQUEST, UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED, FORBIDDEN = NetworkUtils.Status.FORBIDDEN, INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR }
}

export default PostBalanceTopup;
