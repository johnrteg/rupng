//
import { SocialAccount, SocialInbound, SocialPost } from "@repo/api";
import type { Type } from "@repo/common";

//
// SocialAdapter — the single dialect boundary per platform (Facebook / Instagram / X / TikTok /
// LinkedIn). No platform-SDK type may leak past this interface (SPECS.md §10.4 "provider abstraction
// preserved") — `SocialPublishWorker` stays provider-agnostic and only talks to adapters through this
// contract. A failed publish is a `Type.Result` error, never a throw.
//
export interface SocialAdapter
{
    readonly platform : SocialAccount.Platform;

    /** Whether this platform delivers inbound via webhook or requires polling, and other capability
     *  flags that drive `SocialWebhookService` vs `SocialPollJob` routing. */
    capabilities() : SocialAdapter.Capabilities;

    /** Adapt a post's content to this platform's rules for one target — the "rendition". */
    render( post : SocialPost.Entity, target : SocialPost.PostTarget ) : SocialPost.Rendition;

    /** Publish a rendition using a fresh access token (resolved by the caller via marketplace). */
    publish( rendition : SocialPost.Rendition, accessToken : string ) : Promise<Type.Result<SocialAdapter.PublishResult>>;

    /** Poll-only platforms (`capabilities().webhooks === false`): pull inbound items that arrived since
     *  `sinceISO`. Present only on adapters that support it — `SocialPollJob` skips a platform without it. */
    pollInbound?( connectionId : string, accessToken : string, sinceISO : string ) : Promise<Type.Result<Array<SocialAdapter.RawInbound>>>;

    /** Webhook platforms (`capabilities().webhooks === true`): verify the provider's signature on an
     *  inbound webhook payload. Present only on adapters that support it. */
    verifyWebhook?( rawBody : string, headers : Record<string, string>, signingSecret : string ) : boolean;

    /** Webhook platforms: parse a verified webhook payload into normalized raw inbound items. */
    parseWebhook?( payload : unknown ) : Array<SocialAdapter.RawInbound>;
}

export namespace SocialAdapter
{
    export interface Capabilities
    {
        webhooks:     boolean;   // pushes inbound via webhook (Meta) vs requires polling (X/TikTok/LinkedIn)
        dms:          boolean;   // supports reading/replying to direct messages
        twoStepMedia: boolean;   // requires a container→publish media flow (Meta)
    }

    export interface PublishResult
    {
        platformPostId : string;
    }

    /** One inbound item as the adapter sees it, before `InboundPipeline` normalizes/tags/scores it into
     *  a `SocialInbound.Entity`. */
    export interface RawInbound
    {
        type:         SocialInbound.Type_;
        authorHandle: string;
        text:         string;
        rating?:      number;         // present for REVIEW items
        externalId:   string;         // the platform's id for this item (dedupe key)
        occurredAt:   Type.ISODateTime;
        /** The platform-native id of the destination this arrived on (e.g. a Page id) — set only by
         *  `parseWebhook` (a single webhook payload can span several connected destinations); a poll
         *  caller already knows which connection it's polling and ignores this field. Resolved back to
         *  our `accountId`/`connectionId` via the connections table's `byId` GSI (our simplification
         *  treats `connectionId` as if it WERE the platform-native id — see the adapters' publish notes). */
        sourceId?:    string;
    }
}

export default SocialAdapter;
