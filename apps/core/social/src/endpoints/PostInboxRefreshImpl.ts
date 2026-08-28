//
import { PostInboxRefresh, SocialAccount, SocialConfig } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";
import SocialService from "../services/SocialService";
import { AdapterFactory } from "../adapters/AdapterFactory";
import { SocialAdapter } from "../adapters/SocialAdapter";

//
// Trigger an on-demand poll for a pull-only connection. Sets the in-flight lock synchronously (so a
// racing second request sees it immediately) then enqueues the actual poll — the endpoint stays fast.
//
export class PostInboxRefreshImpl extends PostInboxRefresh
{
    private service : SocialService;
    constructor( service : SocialService ) { super(); this.service = service; }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId )   return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };
        const accountId : string | undefined = auth.accountId;
        if( !accountId )     return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "no acting account (X-Account)" } };
        const connectionId : string | undefined = this.body?.connectionId;
        if( !connectionId )  return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "connectionId required" } };

        const got : Type.Result<SocialAccount.Entity | undefined> = await this.service.dynamo.get<SocialAccount.Entity>( "connections", { accountId, id: connectionId } );
        if( !got.ok )   return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "connection read failed" } };
        if( !got.data ) return { status: NetworkUtils.Status.NOT_FOUND, data: { message: "connection not found" } };

        const adapter : SocialAdapter | undefined = AdapterFactory.for( got.data.platform );
        if( adapter?.capabilities().webhooks )
            return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: `${ got.data.platform } delivers inbound via webhook — refresh doesn't apply` } };

        const now : Type.ISODateTime = new Date().toISOString();
        const pull : SocialAccount.Pull | undefined = got.data.pull;
        if( pull?.status === SocialAccount.PullStatus.IN_FLIGHT || ( pull?.cooldownUntil && pull.cooldownUntil > now ) )
            return { status: NetworkUtils.Status.CONFLICT, data: { message: "already refreshing or cooling down", cooldownUntil: pull?.cooldownUntil } };

        const config : SocialConfig.Config = await this.service.socialConfig();
        const nextPull : SocialAccount.Pull = {
            cadenceSeconds:  pull?.cadenceSeconds  ?? config.poll.cadenceSeconds,
            cooldownSeconds: pull?.cooldownSeconds ?? config.refresh.cooldownSeconds,
            status:          SocialAccount.PullStatus.IN_FLIGHT,
            lastPullAt:      pull?.lastPullAt,
        };

        const wrote : Type.Result<void> = await this.service.dynamo.put( "connections", { ...got.data, pull: nextPull } );
        if( !wrote.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "connection lock write failed" } };

        const enqueued : Type.Result<void> = await this.service.sqs.send( "social-poll", { accountId, connectionId } );
        if( !enqueued.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "refresh enqueue failed" } };

        return { status: NetworkUtils.Status.OK, data: { accepted: true } };
    }
}

export default PostInboxRefreshImpl;
