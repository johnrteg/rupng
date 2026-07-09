//
import { PostSegmentRefresh, Segment } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";
import ContactService from "../services/ContactService";

//
// Refresh a segment — flip it to PENDING and enqueue the materialize job (trigger REFRESH, actor = caller).
// The job reconciles QUERY membership (honoring pins) and logs a run. Returns immediately.
//
export class PostSegmentRefreshImpl extends PostSegmentRefresh
{
    private service : ContactService;
    constructor( service : ContactService ) { super(); this.service = service; }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId )   return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };
        const accountId : string | undefined = auth.accountId;
        if( !accountId )     return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "no acting account (X-Account)" } };
        const segmentId : string = this.query?.id ?? "";
        if( !segmentId )     return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "id required" } };

        const got : Type.Result<Segment.Entity | undefined> = await this.service.dynamo.get<Segment.Entity>( "segments", { accountId, segmentId } );
        if( !got.ok )   return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "segment read failed" } };
        if( !got.data ) return { status: NetworkUtils.Status.NOT_FOUND, data: { message: "segment not found" } };

        // reflect the queued state immediately, then run the job off the request path
        const wrote : Type.Result<void> = await this.service.dynamo.put( "segments", { ...got.data, segmentId, status: Segment.Status.PENDING } );
        if( !wrote.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "segment write failed" } };
        void this.service.enqueueSegmentMaterialize( accountId, segmentId, Segment.RunTrigger.REFRESH, auth.userId );

        return { status: NetworkUtils.Status.OK, data: { segmentId, status: Segment.Status.PENDING } };
    }
}

export default PostSegmentRefreshImpl;
