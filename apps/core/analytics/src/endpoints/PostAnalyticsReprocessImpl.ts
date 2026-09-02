//
import { PostAnalyticsReprocess } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";
import AnalyticsService from "../services/AnalyticsService";

//
// Enqueue a backfill/recompute request (analytics-3.7/4.4) — AnalyticsBackfillJob does the actual
// S3-scan + rollup-rewrite off the request path.
//
export class PostAnalyticsReprocessImpl extends PostAnalyticsReprocess
{
    private service : AnalyticsService;
    constructor( service : AnalyticsService ) { super(); this.service = service; }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public async execute( _auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        const body : PostAnalyticsReprocess.Body | null = this.body;
        if( !body?.accountId || !body.channel || !body.from || !body.to )
            return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "accountId, channel, from, and to are required" } };

        const queued : Type.Result<void> = await this.service.sqs.send( "analytics-backfill", {
            accountId: body.accountId, channel: body.channel, from: body.from, to: body.to,
        } );
        if( !queued.ok )
        {
            this.service.log.warn( "reprocess enqueue failed", { accountId: body.accountId, channel: body.channel, error: queued.error } );
            return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "could not queue the reprocess" } };
        }

        return { status: NetworkUtils.Status.OK, data: { queued: true } };
    }
}

export default PostAnalyticsReprocessImpl;
// eof
