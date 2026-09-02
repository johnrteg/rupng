//
import { randomUUID } from "node:crypto";

import { PostSegmentCopy, Segment } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";
import { Events, Payloads } from "@repo/system";
import ContactService from "../services/ContactService";

//
// Copy a segment — clone its filter / sort / limit / exclusion / tags into a NEW segment, optionally carrying
// the manual pins (MANUAL) and/or pin-outs (EXCLUDED). Copying WITHOUT the pins is the clean "unpin" path. The
// new segment starts PENDING (if it has a filter) and re-materializes off the request path.
//
export class PostSegmentCopyImpl extends PostSegmentCopy
{
    private service : ContactService;
    constructor( service : ContactService ) { super(); this.service = service; }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId )   return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };
        const accountId : string | undefined = auth.accountId;
        if( !accountId )     return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "no acting account (X-Account)" } };
        const sourceId : string = this.query?.id ?? "";
        if( !sourceId )      return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "id required" } };

        const source : Type.Result<Segment.Entity | undefined> = await this.service.dynamo.get<Segment.Entity>( "segments", { accountId, segmentId: sourceId } );
        if( !source.ok )   return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "segment read failed" } };
        if( !source.data ) return { status: NetworkUtils.Status.NOT_FOUND, data: { message: "segment not found" } };

        // a copy is a NEW segment → allocate its OWN fresh reference number (never inherit the source's)
        const ref : Type.Result<number> = await this.service.nextRef( accountId, ContactService.SequenceKind.SEGMENT );
        if( !ref.ok )      return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "segment ref allocation failed" } };

        // clone the definition into a new segment (fresh identity + ref + audit; membership is re-derived)
        const now : Type.ISODateTime = new Date().toISOString();
        const newId : Type.UUID = randomUUID();
        const hasFilter : boolean = source.data.query.conditions.length > 0;
        const copy : Segment.Entity =
        {
            id:          newId,
            accountId,
            ref:         ref.data,
            name:        this.body?.name ?? `${ source.data.name } (copy)`,
            query:       source.data.query,
            isExclusion: source.data.isExclusion,
            tags:        source.data.tags,
            sort:        source.data.sort,
            limit:       source.data.limit,
            status:      hasFilter ? Segment.Status.PENDING : Segment.Status.ACTIVE,
            audit:       { createdAt: now, createdBy: auth.userId, modifiedAt: now, modifiedBy: auth.userId },
        };
        const wrote : Type.Result<void> = await this.service.dynamo.put( "segments", { ...copy, segmentId: newId } );
        if( !wrote.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "segment copy write failed" } };

        // carry over the chosen manual overrides (MANUAL pins and/or EXCLUDED tombstones)
        const copyPins : boolean = this.body?.copyPins === true;
        const copyExclusions : boolean = this.body?.copyExclusions === true;
        if( copyPins || copyExclusions ) await this.copyOverrides( accountId, sourceId, newId, copyPins, copyExclusions, now, auth.userId );

        // materialize the copy from its filter (fills QUERY membership + flips PENDING → ACTIVE)
        if( hasFilter ) void this.service.enqueueSegmentMaterialize( accountId, newId, Segment.RunTrigger.INITIAL, auth.userId );

        // best-effort CRUD event — never blocks the response
        const payload : Payloads.Segment = { id: copy.id, accountId: copy.accountId, name: copy.name, status: copy.status };
        void this.service.emitSegment( Events.Verb.CREATED, copy.id, accountId, payload, auth.userId );

        return { status: NetworkUtils.Status.OK, data: copy };
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // copy the selected override rows (MANUAL and/or EXCLUDED) from the source segment onto the new one
    private async copyOverrides( accountId : string, sourceId : string, newId : string, pins : boolean, exclusions : boolean, at : Type.ISODateTime, by : string ) : Promise<void>
    {
        const members : Type.Result<Array<Segment.Member>> = await this.service.dynamo.query<Segment.Member>( "segment_members", {
            KeyConditionExpression:    "segmentKey = :sk",
            ExpressionAttributeValues: { ":sk": `${ accountId }#${ sourceId }` },
        } );
        if( !members.ok ) return;
        const chosen : Array<Segment.Member> = members.data.filter( ( row : Segment.Member ) : boolean =>
            ( pins && row.source === Segment.MembershipSource.MANUAL ) || ( exclusions && row.source === Segment.MembershipSource.EXCLUDED ) );
        const writes : Array<Promise<Type.Result<void>>> = chosen
            .map( ( row : Segment.Member ) : Promise<Type.Result<void>> => this.service.dynamo.put( "segment_members", { segmentKey: `${ accountId }#${ newId }`, contactKey: `${ accountId }#${ row.contactId }`, accountId, segmentId: newId, contactId: row.contactId, source: row.source, addedAt: at, addedBy: by } ) );
        const settled : Array<Type.Result<void>> = await Promise.all( writes );
        void settled;
    }
}

export default PostSegmentCopyImpl;
