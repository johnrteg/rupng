//
import { RestfulEndpoint, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";

//
// The mail-fulfillment provider's ASYNC tracking webhook (print-4.1/9.2) — USPS scan events (in_production /
// mailed / in_transit / delivered / returned / undeliverable). ACK-fast → enqueue (low volume — print is
// batch + lead-time, not TPS — so no separate webhook service, unlike texting). `access` is undefined — the
// provider's signature IS the auth, verified inside `execute()`, not the RBAC ladder.
//
export class PostPrintWebhook extends RestfulEndpoint< PostPrintWebhook.Query, PostPrintWebhook.Body, PostPrintWebhook.Response >
{
    public readonly uri      : string = PostPrintWebhook.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : undefined = undefined;   // provider-signature verified, not RBAC
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    constructor( provider? : string, body? : PostPrintWebhook.Body ) { super( { provider: provider ?? "" }, body ); }

    public getMappings(): Array<RestfulEndpoint.FieldMap>
    { return [ { field: "provider", location: RestfulEndpoint.AttrLocation.URI, required: true } ]; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    // the provider's own tracking-webhook payload shape (varies per vendor) — passed through as-is
    public getBodySchema(): RestfulEndpoint.Schema | null { return { type: "object", additionalProperties: true }; }
}

export namespace PostPrintWebhook
{
    export const URI : string = apiPath( "print", 1, "/webhook/:provider" );
    export interface Query { provider : string; }
    export interface Body extends RestfulEndpoint.NonAuthRequest { [ key : string ] : unknown; }
    export interface Response { received : true; }
    export enum Error { BAD_REQUEST = NetworkUtils.Status.BAD_REQUEST, FORBIDDEN = NetworkUtils.Status.FORBIDDEN }
}

export default PostPrintWebhook;
// eof
