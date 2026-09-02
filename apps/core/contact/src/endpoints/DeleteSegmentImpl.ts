//
import { Segment, DeleteSegment } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";
import { Events, Payloads } from "@repo/system";
import ContactService from "../services/ContactService";

//
// Archive a segment (soft — status → ARCHIVED; never hard-deleted so past runs / audit keep referencing it).
// Membership rows are left intact (archival is reversible).
//
export class DeleteSegmentImpl extends DeleteSegment
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

        const now : Type.ISODateTime = new Date().toISOString();
        const archived : Segment.Entity = { ...got.data, status: Segment.Status.ARCHIVED, audit: { ...got.data.audit, modifiedAt: now, modifiedBy: auth.userId } };

        const wrote : Type.Result<void> = await this.service.dynamo.put( "segments", { ...archived, segmentId } );
        if( !wrote.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "segment archive failed" } };

        // best-effort CRUD event — never blocks the response
        const payload : Payloads.Segment = { id: archived.id, accountId: archived.accountId, name: archived.name, status: archived.status };
        void this.service.emitSegment( Events.Verb.DELETED, archived.id, accountId, payload, auth.userId );

        return { status: NetworkUtils.Status.OK, data: { id: segmentId, archived: true } };
    }
}

export default DeleteSegmentImpl;
