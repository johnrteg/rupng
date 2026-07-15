//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { Billing } from "./model/Billing";
import { Type } from "@repo/common";

// Update the acting account's billing settings — billing type (card | invoice), auto-reload, and whether
// the billing address mirrors the account address. SKELETON — persists the settings; Stripe hookup later.
export class PutBillingSettings extends RestfulEndpoint<{}, PutBillingSettings.Body, PutBillingSettings.Response>
{
    public readonly uri      : string = PutBillingSettings.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.PUT;
    public readonly access   : Access.Role = Access.AccountRole.BILLING;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    constructor( body? : PutBillingSettings.Body ) { super( {}, body ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null { return { type: "object", additionalProperties: true }; }
}

export namespace PutBillingSettings
{
    export const URI : string = apiPath( "acct", 1, "/billing/settings" );
    export interface Body extends RestfulEndpoint.AuthRequest
    {
        billingType?                 : Billing.BillingType;
        autoReload?                  : Billing.AutoReload;
        billingAddressSameAsAccount? : boolean;
        billingAddress?              : Type.Address;   // used when not "same as account"
    }
    export interface Response { settings : Billing.BillingSettings; billingAddress? : Type.Address; }
    export enum Error { BAD_REQUEST = NetworkUtils.Status.BAD_REQUEST, UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED, FORBIDDEN = NetworkUtils.Status.FORBIDDEN, INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR }
}

export default PutBillingSettings;
