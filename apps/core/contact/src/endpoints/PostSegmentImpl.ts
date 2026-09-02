//
import { randomUUID } from "node:crypto";

import { Segment, PostSegment } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";
import { Events, Payloads } from "@repo/system";
import ContactService from "../services/ContactService";

//
// Create a segment (a saved boolean query over contacts). Server assigns id / accountId / status / audit; the
// stored row carries a `segmentId` sort-key mirroring `id`. Membership materialization runs later (search).
//
export class PostSegmentImpl extends PostSegment
{
    private service : ContactService;
    constructor( service : ContactService ) { super(); this.service = service; }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId )   return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };
        const accountId : string | undefined = auth.accountId;
        if( !accountId )     return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "no acting account (X-Account)" } };
        const name : string = this.body?.name ?? "";
        if( !name || !this.body?.query ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "name and query required" } };

        // allocate the per-account sequential reference number (immutable once set) BEFORE the write — a failed
        // allocation aborts the create so we never persist an unnumbered segment
        const ref : Type.Result<number> = await this.service.nextRef( accountId, ContactService.SequenceKind.SEGMENT );
        if( !ref.ok )        return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "segment ref allocation failed" } };

        const now : Type.ISODateTime = new Date().toISOString();
        const id : Type.UUID = randomUUID();
        // a segment with an actual filter starts PENDING (a job materializes its membership); a filterless
        // segment (import-sourced) is ACTIVE immediately (members arrive from the importer)
        const hasFilter : boolean = this.body.query.conditions.length > 0;
        const segment : Segment.Entity =
        {
            id,
            accountId,
            ref:         ref.data,
            name,
            query:       this.body.query,
            isExclusion: this.body.isExclusion ?? false,
            tags:        this.body.tags ?? [],
            sort:        this.body.sort,
            limit:       this.body.sort ? this.body.limit : undefined,   // limit only meaningful with a sort
            status:      hasFilter ? Segment.Status.PENDING : Segment.Status.ACTIVE,
            audit:       { createdAt: now, createdBy: auth.userId, modifiedAt: now, modifiedBy: auth.userId },
        };

        const wrote : Type.Result<void> = await this.service.dynamo.put( "segments", { ...segment, segmentId: id } );
        if( !wrote.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "segment write failed" } };

        // materialize the membership from the filter off the request path (fills members + flips PENDING → ACTIVE)
        if( hasFilter ) void this.service.enqueueSegmentMaterialize( accountId, id, Segment.RunTrigger.INITIAL, auth.userId );

        // best-effort CRUD event — never blocks the response
        const payload : Payloads.Segment = { id: segment.id, accountId: segment.accountId, name: segment.name, status: segment.status };
        void this.service.emitSegment( Events.Verb.CREATED, segment.id, accountId, payload, auth.userId );

        return { status: NetworkUtils.Status.OK, data: segment };
    }
}

export default PostSegmentImpl;
