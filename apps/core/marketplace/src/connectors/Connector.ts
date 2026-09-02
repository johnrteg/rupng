//
import type { Type } from "@repo/common";

//
// Connector — the single dialect boundary per marketplace integration (Shopify / HubSpot / Stripe /
// …), mirroring social's `SocialAdapter` (SPECS.md marketplace-5.0/5.1 — "one connector contract").
// `PostMarketplaceWebhookImpl` calls `verifyWebhook`; `MarketplaceConnectorJob` calls `normalize`.
// Outbound actions default to the provider-agnostic OAuth-broker proxy (`MarketplaceActionJob`) — a
// connector implements `execute` only when a call needs bespoke request shaping beyond a plain REST
// call (marketplace-5.4); most, including Shopify today, don't.
//
export interface Connector
{
    /** The catalog `integrationId` this connector serves (the `ConnectorFactory` registry key). */
    readonly integrationId : string;

    /** Verify an inbound webhook's signature against this provider's scheme. REQUIRES the TRUE raw
     *  body bytes (the owning `Service` must call `enableRawBodyCapture()`) — never approximate from
     *  re-serialized JSON (that was social's Meta-webhook bug this pattern fixes). */
    verifyWebhook( rawBody : Uint8Array, headers : Record<string, string | undefined>, signingSecret : string ) : boolean;

    /** Normalize a VERIFIED webhook payload into zero or more platform-agnostic events — the
     *  "connector.normalize" step (marketplace-5.0) `MarketplaceConnectorJob` emits onward to
     *  `workflow` (triggers) / `contact` / `analytics`. Returns an empty array for a topic/payload this
     *  connector doesn't map to a capability yet — dropped, not an error. */
    normalize( payload : unknown, headers : Record<string, string | undefined> ) : Array<Connector.RawEvent>;

    /** Bespoke outbound call — only for a connector whose action needs more than "call this REST
     *  endpoint" (`MarketplaceActionJob`'s generic OAuth-broker proxy covers the common case). */
    execute?( action : Connector.ActionRequest, token : string ) : Promise<Type.Result<unknown>>;
}

export namespace Connector
{
    /** One normalized inbound event, ready to become a workflow trigger. */
    export interface RawEvent
    {
        key:        string;        // catalog capability key, e.g. "order.created"
        externalId: string;        // the provider's own id for this event (the dedupe key)
        occurredAt: Type.ISODateTime;
        data:       Type.Json;     // the provider's own record shape (default mapping — marketplace gap #6)
    }

    /** One outbound action request for a connector's own bespoke `execute`. */
    export interface ActionRequest { key : string; data : Type.Json; }
}

export default Connector;
// eof
