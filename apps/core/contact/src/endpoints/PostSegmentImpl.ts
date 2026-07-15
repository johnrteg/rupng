//
import { randomUUID } from "node:crypto";

import { Segment, PostSegment } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";
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

        const now : Type.ISODateTime = new Date().toISOString();
        const id : Type.UUID = randomUUID();
        // a segment with an actual filter starts PENDING (a job materializes its membership); a filterless
        // segment (import-sourced) is ACTIVE immediately (members arrive from the importer)
        const hasFilter : boolean = this.body.query.conditions.length > 0;
        const segment : Segment.Entity =
        {
            id,
            accountId,
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

        return { status: NetworkUtils.Status.OK, data: segment };
    }
}

export default PostSegmentImpl;
