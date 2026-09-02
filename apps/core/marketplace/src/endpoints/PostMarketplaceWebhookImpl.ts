//
import { PostMarketplaceWebhook, Marketplace } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";
import MarketplaceService from "../services/MarketplaceService";
import { ConnectorFactory } from "../connectors/ConnectorFactory";
import { Connector } from "../connectors/Connector";

//
// Inbound 3rd-party webhook intake — the connector runtime's front door (marketplace-5.0), previously
// blocked on picking a first concrete connector to build against (Shopify). Lives on MAIN, not a
// dedicated `MarketplaceWebhookService` role — the platform's API Gateway integration only backs ONE
// ECS role's ALB per manifest, the SAME constraint that keeps social's webhook intake on ITS MAIN role
// (see apps/core/social/src/CloudManifest.ts); revisit once multi-ALB gateway routing lands.
//
// Verify (the connector's own scheme) → resolve the owning installation by `externalRef` (a webhook
// payload carries no installationId of its own — e.g. Shopify sends the shop domain) → enqueue the
// RAW payload+headers for `MarketplaceConnectorJob` to normalize. ACK-fast: 200 means "queued", not
// "processed".
//
export class PostMarketplaceWebhookImpl extends PostMarketplaceWebhook
{
    private service : MarketplaceService;
    constructor( service : MarketplaceService ) { super(); this.service = service; }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public async execute( _auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        const integrationId : string = this.query?.integrationId ?? "";
        const connector : Connector | undefined = ConnectorFactory.for( integrationId );
        if( !connector ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: `${ integrationId } has no connector registered` } };

        // today only Shopify is wired — its app secret is platform-wide (every installing shop shares
        // it), the SAME simplification social's Meta webhook already uses for `META_APP_SECRET`.
        const signingSecret : string = process.env.SHOPIFY_APP_SECRET ?? "";
        const rawBody : Uint8Array | undefined = this.rawBody;
        if( !signingSecret || !rawBody ) return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "invalid webhook signature" } };

        const headers : Record<string, string | undefined> = {
            "x-shopify-hmac-sha256": this.query?.[ "x-shopify-hmac-sha256" ],
            "x-shopify-topic":       this.query?.[ "x-shopify-topic" ],
        };
        if( !connector.verifyWebhook( rawBody, headers, signingSecret ) )
            return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "invalid webhook signature" } };

        const externalRef : string = this.query?.[ "x-shopify-shop-domain" ] ?? "";
        if( !externalRef ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "no shop/destination identifier on this webhook" } };

        const owner : Type.Result<Array<Marketplace.Installation>> = await this.service.dynamo.query<Marketplace.Installation>( "installations", {
            IndexName:                 "byExternalRef",
            KeyConditionExpression:    "externalRef = :externalRef",
            ExpressionAttributeValues: { ":externalRef": externalRef },
        } );
        if( !owner.ok )
            return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "installation lookup failed" } };
        if( !owner.data[ 0 ] )
        {
            this.service.log.warn( "webhook: no installation owns this external ref", { integrationId, externalRef } );
            return { status: NetworkUtils.Status.OK, data: { ok: true } };   // ack anyway — nothing more we can do with an orphaned webhook
        }
        const installation : Marketplace.Installation = owner.data[ 0 ];

        const enqueued : Type.Result<void> = await this.service.sqs.send( "marketplace-connector", {
            accountId: installation.accountId, installationId: installation.installationId, integrationId, payload: this.body, headers,
        } );
        if( !enqueued.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "enqueue failed" } };

        return { status: NetworkUtils.Status.OK, data: { ok: true } };
    }
}

export default PostMarketplaceWebhookImpl;
// eof
