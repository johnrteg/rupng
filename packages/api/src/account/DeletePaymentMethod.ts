//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";

// Remove a stored payment method. SKELETON — detaches from Stripe when wired.
export class DeletePaymentMethod extends RestfulEndpoint<DeletePaymentMethod.Query, undefined, DeletePaymentMethod.Response>
{
    public readonly uri      : string = DeletePaymentMethod.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.DELETE;
    public readonly access   : Access.Role = Access.AccountRole.BILLING;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    constructor( methodId? : string ) { super( { methodId: methodId ?? "" } ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return [ { field: "methodId", location: RestfulEndpoint.AttrLocation.URI, required: true } ]; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema():  RestfulEndpoint.Schema | null { return null; }
}

export namespace DeletePaymentMethod
{
    export const URI : string = apiPath( "acct", 1, "/billing/payment-methods/:methodId" );
    export interface Query { methodId : string; }
    export interface Response { removed : boolean; }
    export enum Error { UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED, FORBIDDEN = NetworkUtils.Status.FORBIDDEN, INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR }
}

export default DeletePaymentMethod;
