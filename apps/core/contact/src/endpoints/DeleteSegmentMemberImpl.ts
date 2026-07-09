//
import { Segment, DeleteSegmentMember } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";
import ContactService from "../services/ContactService";

//
// Remove a contact from a segment's manual membership (delete the join row) and decrement the segment size.
//
export class DeleteSegmentMemberImpl extends DeleteSegmentMember
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
        const contactId : string = this.query?.contactId ?? "";
        if( !segmentId || !contactId ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "id and contactId required" } };

        const segmentKey : string = `${ accountId }#${ segmentId }`;

        // was this contact an actual member? (so we only decrement the size when we really removed one)
        const existing : Type.Result<Segment.Member | undefined> = await this.service.dynamo.get<Segment.Member>( "segment_members", { segmentKey, contactId } );
        const wasMember : boolean = existing.ok && existing.data !== undefined && existing.data.source !== Segment.MembershipSource.EXCLUDED;

        // "remove from segment" = PIN OUT: write an EXCLUDED tombstone so a future refresh won't re-add a
        // contact that still matches the filter. (A manual re-add overwrites it; Reset overrides clears it.)
        const now : Type.ISODateTime = new Date().toISOString();
        const tombstone : Segment.Member & { segmentKey : string; contactKey : string } =
        {
            segmentKey, contactKey: `${ accountId }#${ contactId }`,
            accountId, segmentId, contactId,
            source: Segment.MembershipSource.EXCLUDED, addedAt: now, addedBy: auth.userId,
        };
        const wrote : Type.Result<void> = await this.service.dynamo.put( "segment_members", { ...tombstone } );
        if( !wrote.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "membership remove failed" } };

        // decrement the segment's size count (floored at 0), best-effort — only if a real member was removed
        const segment : Type.Result<Segment.Entity | undefined> = await this.service.dynamo.get<Segment.Entity>( "segments", { accountId, segmentId } );
        let size : number = segment.ok && segment.data ? ( segment.data.size ?? 0 ) : 0;
        if( segment.ok && segment.data && wasMember )
        {
            size = Math.max( 0, ( segment.data.size ?? 0 ) - 1 );
            const bumped : Type.Result<void> = await this.service.dynamo.put( "segments", { ...segment.data, segmentId, size } );
            void bumped;   // size is a display cache — best-effort
        }

        return { status: NetworkUtils.Status.OK, data: { removed: true, size } };
    }
}

export default DeleteSegmentMemberImpl;
