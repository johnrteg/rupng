//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";

// Begin adding a payment method — a Stripe SetupIntent (client secret for Stripe Elements). SKELETON —
// returns an empty client secret until Stripe is wired. PAN never touches our servers (SAQ-A).
export class PostPaymentMethodSetup extends RestfulEndpoint<{}, {}, PostPaymentMethodSetup.Response>
{
    public readonly uri      : string = PostPaymentMethodSetup.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : Access.Role = Access.AccountRole.BILLING;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    constructor() { super( {}, {} ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema():  RestfulEndpoint.Schema | null { return null; }
}

export namespace PostPaymentMethodSetup
{
    export const URI : string = apiPath( "acct", 1, "/billing/payment-methods/setup" );
    export interface Response { clientSecret : string; }   // Stripe SetupIntent client secret ("" = not wired)
    export enum Error { UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED, FORBIDDEN = NetworkUtils.Status.FORBIDDEN, INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR }
}

export default PostPaymentMethodSetup;
