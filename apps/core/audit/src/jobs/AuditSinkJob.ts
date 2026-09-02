//
import { Context, SQSEvent, SQSRecord } from "aws-lambda";
import { PutCommand } from "@aws-sdk/lib-dynamodb";
import type { Type } from "@repo/common";

import AuditJob from "./AuditJob";
import { Audit } from "../AuditModel";

//
// AuditSinkJob — THE SINGLE WRITER (audit-2.1 / audit-7.4). Triggered by the platform-shared
// `audit-events` SQS queue every OTHER service's `Application.audit()` enqueues to. Per record:
// validate -> idempotency-claim -> stamp (seq + hash-chain) -> append to the hot DDB store. No service,
// and no human, has any other write path to this table.
//
export class AuditSinkJob extends AuditJob<SQSEvent, void>
{
    /////////////////////////////////////////////////////////////////////
    constructor() { super( "auditSinkJob" ); }

    /////////////////////////////////////////////////////////////////////
    public async handler( event : SQSEvent, _context : Context ) : Promise<void>
    {
        for( const record of event.Records ?? [] )
            await this.ingest( record );
    }

    /////////////////////////////////////////////////////////////////////
    /** Ingest one SQS record. Never throws — a malformed/duplicate message is logged and skipped so it
     *  never poisons the rest of the batch (Lambda's SQS integration retries the WHOLE batch on a thrown
     *  error unless partial-batch-failure reporting is wired, which this manifest doesn't opt into). */
    private async ingest( record : SQSRecord ) : Promise<void>
    {
        // 1. parse + structurally validate the envelope.
        let parsed : unknown;
        try { parsed = JSON.parse( record.body ); }
        catch { this.log.warn( "auditSinkJob: unparsable message body — skipping" ); return; }

        const validated : Type.Result<Audit.Event> = this.validate( parsed );
        if( !validated.ok ) { this.log.warn( "auditSinkJob: invalid envelope — skipping", { error: validated.error } ); return; }
        const event : Audit.Event = validated.data;

        // 2. idempotency claim — a conditional Put on an `ID#<eventId>` marker item BEFORE allocating a
        //    seq, so an at-least-once SQS redelivery never consumes a seq number or double-appends. A
        //    conditional-check failure here means "already ingested" (a prior delivery won), not an error.
        const claimed : Type.Result<void> = await this.claimEventId( event.accountId, event.eventId );
        if( !claimed.ok )
        {
            this.log.info( "auditSinkJob: duplicate delivery — already ingested", { eventId: event.eventId } );
            return;
        }

        // 3. resolve the retention class — the emitter's hint, else fall back to the least-privileged
        //    default (the sink doesn't read AuditConfig per-message; AuditRetentionJob applies the policy
        //    default/overrides at expiry time against whatever class is stamped here).
        const retentionClass : Audit.RetentionClass = event.retentionClass ?? Audit.RetentionClass.OPERATIONAL;

        // 4. stamp (seq + hash-chain) and append to the hot store.
        const stamped : Type.Result<Audit.StoredEvent> = await this.stamp( event.accountId, event, retentionClass );
        if( !stamped.ok ) { this.log.error( "auditSinkJob: stamp failed", { eventId: event.eventId, error: stamped.error } ); return; }

        const wrote : Type.Result<void> = await this.dynamo.put( "events", { sk: AuditJob.eventSk( stamped.data.seq ), ...stamped.data } );
        if( !wrote.ok ) this.log.error( "auditSinkJob: append failed", { eventId: event.eventId, seq: stamped.data.seq, error: wrote.error } );
    }

    /////////////////////////////////////////////////////////////////////
    /** Claim an `eventId` for this account via a conditional Put — fails (idempotency hit) if a prior
     *  delivery already claimed it. `.client` escape hatch: `Dynamo.put` has no ConditionExpression param. */
    private async claimEventId( accountId : Type.ID, eventId : Type.ID ) : Promise<Type.Result<void>>
    {
        try
        {
            await this.dynamo.client.send( new PutCommand( {
                TableName:           this.dynamo.table( "events" ),
                Item:                { accountId, sk: `ID#${ eventId }` },
                ConditionExpression: "attribute_not_exists(sk)",
            } ) );
            return { ok: true, data: undefined };
        }
        catch( err : any )
        {
            if( err?.name === "ConditionalCheckFailedException" ) return { ok: false, error: "duplicate eventId" };
            return { ok: false, error: String( err?.message ?? err ), cause: err };
        }
    }
}

//
// Lambda entrypoint — manifest `jobs.auditSinkJob`, handler "jobs/AuditSinkJob.handler".
//
const job : AuditSinkJob = new AuditSinkJob();
export const handler = ( event : SQSEvent, context : Context ) : Promise<void> => job.invoke( event, context );

export default AuditSinkJob;
// eof
