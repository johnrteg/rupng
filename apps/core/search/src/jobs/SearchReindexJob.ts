//
import type { Context, SQSEvent, SQSRecord } from "aws-lambda";
import { Search as SearchModel } from "@repo/api";

import SearchJob from "./SearchJob";

/** One reindex request — `type` omitted means "every searchable type" (`PostSearchInternalReindexImpl`'s
 *  enqueue shape, `owns.queues` key `"search-reindex"`). */
interface ReindexRequest { type? : SearchModel.DocType; }

//
// SearchReindexJob — search-1.4/7.4's rebuild/backfill path, triggered off the `search-reindex` SQS
// queue (enqueued by `PostSearchInternalReindexImpl`). STAYS a genuine Lambda `Job` (unlike the
// indexer) — the queue trigger this needs (`"queue"`) IS supported by the platform's `makeJob`.
//
// HONEST STUB — documented gap, not a hidden shortcut: a real rebuild needs a per-type "list every
// entity for account X" read path into EACH owning service (contact/campaign/email), and none of
// those exist yet (no `GetInternalContacts`-shaped "list ALL, unbounded, for reindex" endpoint, no
// equivalent on campaign/email either — the existing S2S internal list endpoints are scoped for
// report's generators, not a full-table walk). A working `SearchReindexJob` would, per requested
// `type` (or all 4 types): page through the owning service's S2S list endpoint, re-derive each
// `Search.IndexDoc` (the SAME per-type mapping `SearchIndexerConsumer` uses) and `Search.index(...)`
// it, then (per SPECS.md's "zero-downtime alias swap") build into a fresh index + flip an alias
// rather than upsert-in-place. None of that read path exists today, so faking a "success" here would
// silently lie about coverage — this job logs receipt of the request and returns, leaving the real
// backfill as the next concrete step (SPECS.md search-1.4/7.4 stays a tracked gap, not silently
// scoped out).
//
export class SearchReindexJob extends SearchJob<SQSEvent, void>
{
    ////////////////////////////////////////////////////////////////////////////////////////////
    constructor() { super( "reindex" ); }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public async handler( event : SQSEvent, _context : Context ) : Promise<void>
    {
        for( const record of event.Records ?? [] )
            this.acknowledge( record );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Parse + log the request — see the class header for exactly why this doesn't rebuild anything yet. */
    private acknowledge( record : SQSRecord ) : void
    {
        let request : ReindexRequest;
        try { request = JSON.parse( record.body ) as ReindexRequest; }
        catch { this.log.warn( "reindex: unparsable message body — skipping" ); return; }

        this.log.warn( "reindex: request received but NOT rebuilt — no per-type owning-service list-all read path exists yet (documented gap, search-1.4/7.4)", {
            type: request.type ?? "all",
        } );
    }
}

//
// Lambda entrypoint — manifest `jobs.reindex`, handler "jobs/SearchReindexJob.handler".
//
const job : SearchReindexJob = new SearchReindexJob();
export const handler = ( event : SQSEvent, context : Context ) : Promise<void> => job.invoke( event, context );

export default SearchReindexJob;
// eof
