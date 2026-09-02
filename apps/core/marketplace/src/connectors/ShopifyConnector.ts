//
import { createHmac, timingSafeEqual } from "node:crypto";

import type { Type } from "@repo/common";

import { Connector } from "./Connector";

//
// ShopifyConnector — the platform's FIRST concrete connector (SPECS.md's CloudManifest note: webhook
// intake + `MarketplaceConnectorJob` were blocked on picking one to build against). E-commerce
// (marketplace's catalog already lists Shopify) is the natural pick — order/checkout/customer events
// are exactly the "universal message" triggers (abandoned-cart → SMS, order → receipt email) workflow
// exists to run.
//
// Shopify signs every webhook with the APP's OWN client secret — the SAME secret for every shop that
// installs the app (unlike a per-installation signing secret) — so `signingSecret` here is the
// platform's Shopify app secret (env `SHOPIFY_APP_SECRET`, read by the endpoint — same simplification
// social's Meta webhook already uses for its platform-wide `META_APP_SECRET`), not a vaulted
// `Credential.signingSecret`. Topics map 1:1 onto catalog capability keys; the payload is passed
// through as-is (default mapping — marketplace gap #6; a visual field-mapper is a later follow-on).
//
export class ShopifyConnector implements Connector
{
    public static readonly INTEGRATION_ID : string = "shopify";
    public readonly integrationId : string = ShopifyConnector.INTEGRATION_ID;

    /** Shopify webhook topic (`X-Shopify-Topic`) → catalog capability key. Extend as more topics are
     *  subscribed; an unmapped topic is simply dropped by `normalize` below. */
    private static readonly TOPIC_KEYS : Record<string, string> =
    {
        "orders/create":     "order.created",
        "orders/paid":       "order.paid",
        "orders/fulfilled":  "order.fulfilled",
        "orders/cancelled":  "order.cancelled",
        "checkouts/create":  "checkout.created",   // the abandoned-cart trigger candidate
        "checkouts/update":  "checkout.updated",
        "customers/create":  "customer.created",
        "customers/update":  "customer.updated",
        "refunds/create":    "refund.created",
    };

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Shopify's scheme: `HMAC-SHA256` over the TRUE raw body, BASE64-encoded (not hex — unlike Meta/
     *  Stripe's `sha256=<hex>` convention), header `X-Shopify-Hmac-Sha256`, no scheme prefix. */
    public verifyWebhook( rawBody : Uint8Array, headers : Record<string, string | undefined>, signingSecret : string ) : boolean
    {
        const header : string | undefined = headers[ "x-shopify-hmac-sha256" ];
        if( !header || !signingSecret ) return false;

        const expected : Buffer = createHmac( "sha256", signingSecret ).update( rawBody ).digest();
        let provided : Buffer;
        try { provided = Buffer.from( header, "base64" ); } catch { return false; }

        if( expected.length !== provided.length ) return false;
        return timingSafeEqual( expected, provided );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** One webhook delivery = one topic = one event; `X-Shopify-Topic` selects the capability key. */
    public normalize( payload : unknown, headers : Record<string, string | undefined> ) : Array<Connector.RawEvent>
    {
        const topic : string | undefined = headers[ "x-shopify-topic" ];
        const key   : string | undefined = topic ? ShopifyConnector.TOPIC_KEYS[ topic ] : undefined;
        if( !key ) return [];   // an unmapped/unsubscribed topic — nothing to emit

        const record : Record<string, unknown> = ( payload ?? {} ) as Record<string, unknown>;
        const externalId : string | undefined = record.id !== undefined ? String( record.id ) : undefined;
        if( !externalId ) return [];   // no id to dedupe on — drop rather than risk a duplicate downstream trigger

        const occurredAt : Type.ISODateTime = typeof record.created_at === "string" ? record.created_at as Type.ISODateTime : new Date().toISOString();
        return [ { key, externalId, occurredAt, data: payload as Type.Json } ];
    }
}

export default ShopifyConnector;
// eof
