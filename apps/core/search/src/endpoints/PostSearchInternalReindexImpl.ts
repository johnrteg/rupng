//
import { PostSearchInternalReindex } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";

import SearchService from "../services/SearchService";

//
// Enqueue a rebuild/backfill request (search-1.4) — S2S, INTERNAL audience, no RBAC role. Anything
// that can take more than ~500ms must be a job, never inline in a request handler (root CLAUDE.md);
// `SearchReindexJob` (triggered off the `search-reindex` queue) does the actual work off this path.
//
export class PostSearchInternalReindexImpl extends PostSearchInternalReindex
{
    private service : SearchService;
    constructor( service : SearchService ) { super(); this.service = service; }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public async execute( _auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        const body : PostSearchInternalReindex.Body | null = this.body;
        const queued : Type.Result<void> = await this.service.sqs.send( "search-reindex", { type: body?.type } );
        if( !queued.ok )
        {
            this.service.log.warn( "reindex enqueue failed", { type: body?.type, error: queued.error } );
            return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { accepted: false } };
        }

        return { status: NetworkUtils.Status.OK, data: { accepted: true } };
    }
}

export default PostSearchInternalReindexImpl;
// eof
