//
import { PostSegmentPreview, Segment, Contact } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";
import ContactService from "../services/ContactService";
import SegmentMatch from "../model/SegmentMatch";

//
// Preview a segment query — evaluate the filter against the account's contacts (via the shared evaluator) and
// return the match COUNT + a small sample, honoring the optional sort + top-N limit. Bounded per account;
// production-scale evaluation runs against the search service (see contact SPECS).
//
export class PostSegmentPreviewImpl extends PostSegmentPreview
{
    private service : ContactService;
    constructor( service : ContactService ) { super(); this.service = service; }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId )   return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };
        const accountId : string | undefined = auth.accountId;
        if( !accountId )     return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "no acting account (X-Account)" } };
        const query : Segment.Query | undefined = this.body?.query;
        if( !query )         return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "query required" } };

        // evaluate the filter (shared with the materialize job)
        const evaluated : Type.Result<ContactService.Evaluation> = await this.service.evaluateQuery( accountId, query );
        if( !evaluated.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "preview evaluation failed" } };
        const total : number = evaluated.data.matches.length;

        // sort (optional) then apply the top-N limit (only with a sort)
        const ordered : Array<Contact.Entity> = this.body?.sort ? SegmentMatch.orderBy( evaluated.data.matches, this.body.sort, evaluated.data.context ) : evaluated.data.matches;
        const limit : number | undefined = this.body?.sort ? this.body?.limit : undefined;
        const limited : Array<Contact.Entity> = limit && limit > 0 ? ordered.slice( 0, limit ) : ordered;

        // a small display sample (the count matters more than the rows) + the fields we couldn't fully evaluate
        const sample : number = this.body?.sample ?? 12;
        const records : Array<Contact.Entity> = limited.slice( 0, sample );

        const response : PostSegmentPreview.Response =
        {
            total, count: limited.length, records,
            unsupportedFields: evaluated.data.unsupported.length > 0 ? evaluated.data.unsupported : undefined,
        };
        return { status: NetworkUtils.Status.OK, data: response };
    }
}

export default PostSegmentPreviewImpl;
