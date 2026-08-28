//
import { PostSocialWebhook, SocialAccount } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";
import SocialService from "../services/SocialService";
import { AdapterFactory } from "../adapters/AdapterFactory";
import { SocialAdapter } from "../adapters/SocialAdapter";

//
// Inbound webhook intake (Meta only — see SocialPollJob for X/TikTok/LinkedIn). Verify → resolve each
// item's owning account (via the connections table's `byId` GSI, since a webhook payload can span
// several connected destinations and arrives with no accountId of its own) → enqueue to
// `social-inbound` for SocialInboundJob to normalize. ACK-fast: a 200 means "queued", not "processed".
//
// SIMPLIFICATION: signature verification uses one platform-wide `META_APP_SECRET` env var rather than
// a per-account/per-installation secret — the real design vaults a signing secret per marketplace
// installation (SPECS.md's `Credential.signingSecret`), which needs the marketplace webhook-subscription
// flow (a Milestone-6+ marketplace addition) to actually populate. Also see MetaWebhookUtils' caveat on
// verifying against a re-serialized body rather than the original raw bytes.
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
        const signature : string = this.query?.[ "x-hub-signature-256" ] ?? "";
        const rawBody : string = JSON.stringify( this.body ?? {} );
        if( !appSecret || !adapter.verifyWebhook( rawBody, { "x-hub-signature-256": signature }, appSecret ) )
            return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "invalid webhook signature" } };

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

            const enqueued : Type.Result<void> = await this.service.sqs.send( "social-inbound", {
                accountId: connection.accountId, connectionId: connection.id, platform, item,
            } );
            if( !enqueued.ok ) this.service.log.warn( "webhook item enqueue failed", { accountId: connection.accountId, error: enqueued.error } );
        }

        return { status: NetworkUtils.Status.OK, data: { ok: true } };
    }
}

export default PostSocialWebhookImpl;
