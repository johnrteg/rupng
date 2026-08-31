//
import { PostSocialWebhook, SocialAccount } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";
import { Webhook } from "@repo/services";
import SocialService from "../services/SocialService";
import { AdapterFactory } from "../adapters/AdapterFactory";
import { SocialAdapter } from "../adapters/SocialAdapter";

//
// Inbound webhook intake (Meta only — see SocialPollJob for X/TikTok/LinkedIn). Verify → resolve each
// item's owning account (via the connections table's `byId` GSI, since a webhook payload can span
// several connected destinations and arrives with no accountId of its own) → enqueue to
// `social-inbound` for SocialInboundJob to normalize. ACK-fast: a 200 means "queued", not "processed".
// One request can carry SEVERAL items (several destinations' updates in one Meta payload), so this uses the
// shared `Webhook` helper's `verify`/`enqueue` steps SEPARATELY (one verify, then one `enqueue` per item) —
// not `handle()`, which assumes a single payload = one message.
//
// SIMPLIFICATION: signature verification uses one platform-wide `META_APP_SECRET` env var rather than
// a per-account/per-installation secret — the real design vaults a signing secret per marketplace
// installation (SPECS.md's `Credential.signingSecret`), which needs the marketplace webhook-subscription
// flow (a Milestone-6+ marketplace addition) to actually populate.
//
export class PostSocialWebhookImpl extends PostSocialWebhook
{
    private service : SocialService;
    constructor( service : SocialService ) { super(); this.service = service; }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public async execute( _auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        const platform : string = this.query?.platform ?? "";
        if( !Object.values( SocialAccount.Platform ).includes( platform as SocialAccount.Platform ) )
            return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "unknown platform" } };

        const adapter : SocialAdapter | undefined = AdapterFactory.for( platform as SocialAccount.Platform );
        if( !adapter?.verifyWebhook || !adapter.parseWebhook )
            return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: `${ platform } doesn't support webhook intake` } };

        const appSecret : string = process.env.META_APP_SECRET ?? "";
        if( !appSecret ) return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "invalid webhook signature" } };

        // real HMAC-over-TRUE-raw-bytes (fixes the prior re-serialized-JSON approximation) — requires
        // `SocialMainService` to have called `enableRawBodyCapture()`; fails CLOSED without it. `url` is
        // unused by this scheme (Meta HMACs the raw body, not the URL) — `this.uri` is a harmless placeholder.
        const webhook : Webhook = this.service.webhook( Webhook.hmacSha256RawBody( appSecret, "x-hub-signature-256" ) );
        const headers : Record<string, string | undefined> = { "x-hub-signature-256": this.query?.[ "x-hub-signature-256" ] };
        const verified : boolean = await webhook.verify( { headers, url: this.uri, body: this.body, rawBody: this.rawBody } );
        if( !verified ) return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "invalid webhook signature" } };

        const items : Array<SocialAdapter.RawInbound> = adapter.parseWebhook( this.body );
        for( const item of items )
        {
            if( !item.sourceId ) continue;   // can't resolve an owning account without it — drop

            const owner : Type.Result<Array<SocialAccount.Entity>> = await this.service.dynamo.query<SocialAccount.Entity>( "connections", {
                IndexName:                 "byId",
                KeyConditionExpression:    "id = :id",
                ExpressionAttributeValues: { ":id": item.sourceId },
            } );
            if( !owner.ok || !owner.data[ 0 ] )
            {
                this.service.log.warn( "webhook item: no connection owns this source id", { platform, sourceId: item.sourceId } );
                continue;
            }
            const connection : SocialAccount.Entity = owner.data[ 0 ];

            const enqueued : Type.Result<void> = await webhook.enqueue( "social-inbound", {
                accountId: connection.accountId, connectionId: connection.id, platform, item,
            } );
            if( !enqueued.ok ) this.service.log.warn( "webhook item enqueue failed", { accountId: connection.accountId, error: enqueued.error } );
        }

        return { status: NetworkUtils.Status.OK, data: { ok: true } };
    }
}

export default PostSocialWebhookImpl;
