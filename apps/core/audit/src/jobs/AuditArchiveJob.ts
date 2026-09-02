//
import { Context, DynamoDBStreamEvent, DynamoDBRecord } from "aws-lambda";
import { randomUUID } from "crypto";
import type { Type } from "@repo/common";

import AuditJob from "./AuditJob";
import { Audit } from "../AuditModel";

//
// AuditArchiveJob — mirrors newly-INSERTED hot-store rows to the S3 Object Lock (WORM) archive for
// durable, multi-year retention (audit-2.3 / audit-3.1). Triggered by the `events` table's DynamoDB
// Stream. INSERT-only by contract: the sink NEVER updates or deletes a row (audit-2.1/2.2), so a
// MODIFY/REMOVE stream record here is itself a tamper/bug signal, not a normal case.
//
// FORMAT NOTE: SPECS.md's target format is Parquet (columnar, Athena-friendly, avoids per-event small
// files). This build writes NEWLINE-DELIMITED JSON instead — no Parquet-writer dependency exists
// anywhere in this repo yet, and adding one is a deliberate, separate decision (library choice +
// bundling impact), not something to slip in silently under this task. NDJSON is still Athena-queryable
// (its JSON SerDe reads NDJSON directly) and preserves every other invariant (WORM lock, one file per
// batch, partitioned by account/date) — swapping the write format later is a contained change inside
// `writeBatch` alone.
//
export class AuditArchiveJob extends AuditJob<DynamoDBStreamEvent, void>
{
    /////////////////////////////////////////////////////////////////////
    constructor() { super( "auditArchiveJob" ); }

    /////////////////////////////////////////////////////////////////////
    public async handler( event : DynamoDBStreamEvent, _context : Context ) : Promise<void>
    {
        // group INSERT-only new images by accountId so each tenant gets its OWN archive object (never
        // mixed across tenants, matching residency/jurisdiction pinning elsewhere in the platform).
        const byAccount : Map<Type.ID, Array<Audit.StoredEvent>> = new Map();

        for( const record of event.Records ?? [] )
        {
            const stored : Audit.StoredEvent | undefined = this.newImageOf( record );
            if( !stored ) continue;
            const rows : Array<Audit.StoredEvent> = byAccount.get( stored.accountId ) ?? [];
            rows.push( stored );
            byAccount.set( stored.accountId, rows );
        }

        for( const [ accountId, rows ] of byAccount )
            await this.writeBatch( accountId, rows );
    }

    /////////////////////////////////////////////////////////////////////
    /** Extract a `StoredEvent` from an INSERT stream record; `undefined` (+ a log line) for anything
     *  else — a MODIFY/REMOVE here would mean the write-once contract was violated somewhere upstream. */
    private newImageOf( record : DynamoDBRecord ) : Audit.StoredEvent | undefined
    {
        if( record.eventName !== "INSERT" )
        {
            this.log.warn( "auditArchiveJob: non-INSERT stream record on a write-once table — possible tamper/bug", { eventName: record.eventName } );
            return undefined;
        }
        const image : Record<string, unknown> | undefined = record.dynamodb?.NewImage as unknown as Record<string, unknown> | undefined;
        if( !image ) return undefined;

        // the tail-pointer row (sk = "SEQ") and the idempotency-claim rows (sk = "ID#…") aren't audit
        // events — skip them; only `EVT#…` rows are real StoredEvents.
        const sk : unknown = ( image as { sk? : { S? : string } } ).sk?.S ?? ( image as { sk?: string } ).sk;
        if( typeof sk !== "string" || !sk.startsWith( "EVT#" ) ) return undefined;

        // Lambda's raw DynamoDB Streams payload is AttributeValue-wrapped ({ S: "…" }, { N: "…" }, …); the
        // stream trigger here is configured for NEW_IMAGE, and AWS's Node runtime for a DynamoDB event
        // source ALREADY unmarshalls to plain JS for `record.dynamodb.NewImage` when using the standard
        // event shape — so this is already the plain object shape `Audit.StoredEvent` expects.
        return image as unknown as Audit.StoredEvent;
    }

    /////////////////////////////////////////////////////////////////////
    /** Write one tenant's batch as a single NDJSON object under a date-partitioned key (Athena-friendly:
     *  `<accountId>/<yyyy>/<mm>/<dd>/<batchId>.ndjson`) into the Object-Lock archive bucket. The bucket's
     *  own default retention (set at creation — see CloudManifest `buckets.archive.objectLock`) applies;
     *  no per-object override is needed. */
    private async writeBatch( accountId : Type.ID, rows : Array<Audit.StoredEvent> ) : Promise<void>
    {
        if( rows.length === 0 ) return;
        const now : Date = new Date();
        const yyyy : string = String( now.getUTCFullYear() );
        const mm   : string = String( now.getUTCMonth() + 1 ).padStart( 2, "0" );
        const dd   : string = String( now.getUTCDate() ).padStart( 2, "0" );
        const key  : string = `${ accountId }/${ yyyy }/${ mm }/${ dd }/${ randomUUID() }.ndjson`;

        const body : string = rows.map( ( row ) => JSON.stringify( row ) ).join( "\n" );
        const wrote : Type.Result<void> = await this.s3.put( "archive", key, body, "application/x-ndjson" );
        if( !wrote.ok ) this.log.error( "auditArchiveJob: archive write failed", { accountId, key, rowCount: rows.length, error: wrote.error } );
    }
}

//
// Lambda entrypoint — manifest `jobs.auditArchiveJob`, handler "jobs/AuditArchiveJob.handler".
//
const job : AuditArchiveJob = new AuditArchiveJob();
export const handler = ( event : DynamoDBStreamEvent, context : Context ) : Promise<void> => job.invoke( event, context );

export default AuditArchiveJob;
// eof
