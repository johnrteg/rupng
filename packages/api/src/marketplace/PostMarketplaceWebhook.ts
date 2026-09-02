//
import { RestfulEndpoint, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";

//
// Inbound 3rd-party webhook intake — ONE route shared by every connector (`:integrationId` selects
// which via `ConnectorFactory`); Shopify is the first (marketplace-5.0/5.1). Signature-verified by the
// connector's own scheme in the impl, not JWT/RBAC — hence no `access` role. The header fields below
// are Shopify's; a future connector with a different scheme adds its own header FieldMaps here (one
// shared route, additive headers — mirrors `PostSocialWebhook`'s per-platform header).
//
export class PostMarketplaceWebhook extends RestfulEndpoint< PostMarketplaceWebhook.Query, PostMarketplaceWebhook.Body, PostMarketplaceWebhook.Response >
{
    public readonly uri      : string = PostMarketplaceWebhook.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : undefined = undefined;   // signature-verified, not RBAC
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.PUBLIC;   // internet-reachable (the provider calls in)

    constructor( integrationId? : string, body? : PostMarketplaceWebhook.Body ) { super( { integrationId: integrationId ?? "" }, body ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return [
        { field: "integrationId",         location: RestfulEndpoint.AttrLocation.URI,    required: true },
        { field: "x-shopify-hmac-sha256", location: RestfulEndpoint.AttrLocation.HEADER, required: false },
        { field: "x-shopify-topic",       location: RestfulEndpoint.AttrLocation.HEADER, required: false },
        { field: "x-shopify-shop-domain", location: RestfulEndpoint.AttrLocation.HEADER, required: false },
    ]; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null { return { type: "object", additionalProperties: true }; }
}

export namespace PostMarketplaceWebhook
{
    export const URI : string = apiPath( "marketplace", 1, "/webhooks/:integrationId" );

    export interface Query
    {
        integrationId: string;
        "x-shopify-hmac-sha256"? : string;
        "x-shopify-topic"?       : string;
        "x-shopify-shop-domain"? : string;
    }
    export interface Body extends RestfulEndpoint.NonAuthRequest { [ key : string ] : unknown; }
    export interface Response { ok : boolean; }

    export enum Error
    {
        BAD_REQUEST           = NetworkUtils.Status.BAD_REQUEST,
        UNAUTHORIZED          = NetworkUtils.Status.UNAUTHORIZED,
        INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR,
    }
}

export default PostMarketplaceWebhook;
// eof
