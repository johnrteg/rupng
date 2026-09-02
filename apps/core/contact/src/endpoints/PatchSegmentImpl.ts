//
import { Segment, PatchSegment } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";
import { Events, Payloads } from "@repo/system";
import ContactService from "../services/ContactService";

//
// Edit a segment — merge name / query / exclusion over the current row, bump the audit stamp. Identity /
// accountId / status / size stay server-owned.
//
export class PatchSegmentImpl extends PatchSegment
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
        // when the filter / sort / limit changes AND the effective query has rules, the membership must be
        // re-derived — flip to PENDING and re-run the materialize job.
        const effectiveQuery : Segment.Query = this.body?.query !== undefined ? this.body.query : got.data.query;
        const filterTouched : boolean = this.body?.query !== undefined || this.body?.sort !== undefined || this.body?.limit !== undefined;
        const rematerialize : boolean = filterTouched && ( effectiveQuery?.conditions.length ?? 0 ) > 0;

        const merged : Segment.Entity =
        {
            ...got.data,
            name:        this.body?.name        !== undefined ? this.body.name        : got.data.name,
            query:       this.body?.query       !== undefined ? this.body.query       : got.data.query,
            isExclusion: this.body?.isExclusion !== undefined ? this.body.isExclusion : got.data.isExclusion,
            tags:        this.body?.tags        !== undefined ? this.body.tags        : got.data.tags,
            sort:        this.body?.sort        !== undefined ? this.body.sort        : got.data.sort,
            limit:       this.body?.limit       !== undefined ? this.body.limit       : got.data.limit,
            id:          got.data.id,
            accountId:   got.data.accountId,
            status:      rematerialize ? Segment.Status.PENDING : got.data.status,
            audit:       { ...got.data.audit, modifiedAt: now, modifiedBy: auth.userId },
        };

        const wrote : Type.Result<void> = await this.service.dynamo.put( "segments", { ...merged, segmentId } );
        if( !wrote.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "segment write failed" } };

        // re-derive membership off the request path (fills members + flips PENDING → ACTIVE)
        if( rematerialize ) void this.service.enqueueSegmentMaterialize( accountId, segmentId, Segment.RunTrigger.EDIT, auth.userId );

        // best-effort CRUD event — never blocks the response
        const payload : Payloads.Segment = { id: merged.id, accountId: merged.accountId, name: merged.name, status: merged.status };
        void this.service.emitSegment( Events.Verb.UPDATED, merged.id, accountId, payload, auth.userId );

        return { status: NetworkUtils.Status.OK, data: merged };
    }
}

export default PatchSegmentImpl;
