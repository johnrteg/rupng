//
import { GetSegmentRuns, Segment, Paging } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";
import ContactService from "../services/ContactService";

//
// List a segment's materialization run history, newest first (paged). Reads the segment_runs partition.
//
export class GetSegmentRunsImpl extends GetSegmentRuns
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

        const runs : Type.Result<Array<Segment.Run>> = await this.service.dynamo.query<Segment.Run>( "segment_runs", {
            KeyConditionExpression:    "segmentKey = :sk",
            ExpressionAttributeValues: { ":sk": `${ accountId }#${ segmentId }` },
        } );
        if( !runs.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "runs read failed" } };

        // newest first
        const ordered : Array<Segment.Run> = runs.data.sort( ( first : Segment.Run, second : Segment.Run ) : number => second.at.localeCompare( first.at ) );
        const paged : Paging.Result<Segment.Run> = Paging.paginate( ordered, this.query ?? {} );
        return { status: NetworkUtils.Status.OK, data: paged };
    }
}

export default GetSegmentRunsImpl;
