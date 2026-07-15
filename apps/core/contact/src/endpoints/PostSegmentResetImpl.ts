//
import { PostSegmentReset, Segment } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";
import ContactService from "../services/ContactService";

//
// Reset a segment's manual overrides ("unpin") — delete the pinned-IN (MANUAL) rows and/or the pinned-OUT
// (EXCLUDED) tombstones, then re-materialize so membership reverts to the pure query. Defaults to clearing
// BOTH when neither flag is set.
//
export class PostSegmentResetImpl extends PostSegmentReset
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

        const segment : Type.Result<Segment.Entity | undefined> = await this.service.dynamo.get<Segment.Entity>( "segments", { accountId, segmentId } );
        if( !segment.ok )   return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "segment read failed" } };
        if( !segment.data ) return { status: NetworkUtils.Status.NOT_FOUND, data: { message: "segment not found" } };

        // default: clear BOTH override kinds when the caller didn't narrow it
        const narrowed : boolean = this.body?.clearPins === true || this.body?.clearExclusions === true;
        const clearPins : boolean = narrowed ? this.body?.clearPins === true : true;
        const clearExclusions : boolean = narrowed ? this.body?.clearExclusions === true : true;

        // find the override rows to drop
        const members : Type.Result<Array<Segment.Member>> = await this.service.dynamo.query<Segment.Member>( "segment_members", {
            KeyConditionExpression:    "segmentKey = :sk",
            ExpressionAttributeValues: { ":sk": `${ accountId }#${ segmentId }` },
        } );
        if( !members.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "membership read failed" } };
        const toClear : Array<Segment.Member> = members.data.filter( ( row : Segment.Member ) : boolean =>
            ( clearPins && row.source === Segment.MembershipSource.MANUAL ) || ( clearExclusions && row.source === Segment.MembershipSource.EXCLUDED ) );

        // delete them, then re-materialize (job reconciles QUERY membership fresh + flips PENDING → ACTIVE)
        const removals : Array<Promise<Type.Result<void>>> = toClear
            .map( ( row : Segment.Member ) : Promise<Type.Result<void>> => this.service.dynamo.remove( "segment_members", { segmentKey: `${ accountId }#${ segmentId }`, contactId: row.contactId } ) );
        const settled : Array<Type.Result<void>> = await Promise.all( removals );
        void settled;   // best-effort

        const marked : Type.Result<void> = await this.service.dynamo.put( "segments", { ...segment.data, segmentId, status: Segment.Status.PENDING } );
        void marked;
        void this.service.enqueueSegmentMaterialize( accountId, segmentId, Segment.RunTrigger.REFRESH, auth.userId );

        return { status: NetworkUtils.Status.OK, data: { segmentId, cleared: toClear.length } };
    }
}

export default PostSegmentResetImpl;
