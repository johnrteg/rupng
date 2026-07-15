//
import { Segment, PostSegmentMembers } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";
import ContactService from "../services/ContactService";

//
// Add contacts to a segment's manual membership. Idempotent + de-duped: a contact already in the segment is
// counted as `skipped` (no duplicate row — the join key is segment+contact). Recomputes the segment's size.
//
export class PostSegmentMembersImpl extends PostSegmentMembers
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
        const contactIds : Array<string> = this.body?.contactIds ?? [];
        if( contactIds.length === 0 ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "contactIds required" } };

        // the segment must exist in this account
        const segment : Type.Result<Segment.Entity | undefined> = await this.service.dynamo.get<Segment.Entity>( "segments", { accountId, segmentId } );
        if( !segment.ok )   return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "segment read failed" } };
        if( !segment.data ) return { status: NetworkUtils.Status.NOT_FOUND, data: { message: "segment not found" } };

        // add each contact — skip those already present (idempotent, no dups)
        const userId : string = auth.userId;
        const segmentKey : string = `${ accountId }#${ segmentId }`;
        const now : Type.ISODateTime = new Date().toISOString();
        const outcomes : Array<"added" | "skipped" | "failed"> = await Promise.all( Array.from( new Set( contactIds ) )
            .map( ( contactId : string ) : Promise<"added" | "skipped" | "failed"> => this.addMember( accountId, segmentId, segmentKey, contactId, now, userId ) ) );

        const added : number = outcomes.filter( ( outcome : string ) : boolean => outcome === "added" ).length;
        const skipped : number = outcomes.filter( ( outcome : string ) : boolean => outcome === "skipped" ).length;

        // keep the segment's size count roughly current (self-heals on the next full listing); best-effort
        const size : number = ( segment.data.size ?? 0 ) + added;
        const bumped : Type.Result<void> = await this.service.dynamo.put( "segments", { ...segment.data, segmentId, size } );
        void bumped;   // size is a display cache — a failed bump self-heals, never fails the add

        // recompute the segment's per-channel reachability counts now that its membership changed (async)
        void this.service.enqueueSegmentRefresh( accountId, contactIds[ 0 ] );

        return { status: NetworkUtils.Status.OK, data: { added, skipped, size } };
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // pin a contact IN (MANUAL). Already a real member (MANUAL/QUERY/IMPORT) → skipped; a pinned-out EXCLUDED
    // tombstone is OVERWRITTEN to MANUAL (an explicit re-add wins over a prior manual removal).
    private async addMember( accountId : string, segmentId : string, segmentKey : string, contactId : string, at : Type.ISODateTime, addedBy : string ) : Promise<"added" | "skipped" | "failed">
    {
        const existing : Type.Result<Segment.Member | undefined> = await this.service.dynamo.get<Segment.Member>( "segment_members", { segmentKey, contactId } );
        if( !existing.ok )  return "failed";
        // already an actual member (not a pinned-out tombstone) → idempotent no-op
        if( existing.data && existing.data.source !== Segment.MembershipSource.EXCLUDED ) return "skipped";

        const member : Segment.Member & { segmentKey : string; contactKey : string } =
        {
            segmentKey, contactKey: `${ accountId }#${ contactId }`,
            accountId, segmentId, contactId,
            source: Segment.MembershipSource.MANUAL, addedAt: at, addedBy,
        };
        const wrote : Type.Result<void> = await this.service.dynamo.put( "segment_members", { ...member } );
        return wrote.ok ? "added" : "failed";
    }
}

export default PostSegmentMembersImpl;
