//
import { Context, ScheduledEvent } from "aws-lambda";
import { ScanCommand } from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import type { Type } from "@repo/common";
import { AuditConfig } from "@repo/api";

import AuditJob from "./AuditJob";
import { Audit } from "../AuditModel";

//
// AuditRetentionJob — defensible, LOGGED expiry by retention tier; legal hold overrides (audit-4.1 /
// 4.2). EventBridge-scheduled (daily — see CloudManifest `eventBuses`). Deletes from the HOT DDB store
// ONLY: the S3 Object Lock archive is (a) the actual compliance artifact and (b) physically can't be
// deleted before its own lock expires anyway, so there is nothing for this job to do there.
//
// SCALE NOTE: this reads the ENTIRE `events` table via `Scan` (no cross-account GSI exists to target
// just "old" rows cheaply). Fine for a once-a-day batch at today's volume; flagged here — not hidden —
// as the thing to revisit (e.g. a `retentionClass`+`ingestedAt` GSI) once the table is large enough
// that a full scan's cost/duration becomes a problem.
//
export class AuditRetentionJob extends AuditJob<ScheduledEvent, void>
{
    /////////////////////////////////////////////////////////////////////
    constructor() { super( "auditRetentionJob" ); }

    /////////////////////////////////////////////////////////////////////
    public async handler( _event : ScheduledEvent, _context : Context ) : Promise<void>
    {
        // 1. load the current retention policy (AppConfig `config/settings` — falls back to DEFAULT so a
        //    fresh/undeployed environment still runs a sane, dev-safe sweep).
        const configResult : Type.Result<AuditConfig.Config | undefined> = await this.appConfig.json<AuditConfig.Config>( "config", "settings" );
        const config : AuditConfig.Config = configResult.ok && configResult.data ? configResult.data : AuditConfig.DEFAULT;

        // 2. load every ACTIVE legal hold (small, rare table — a full scan here is cheap).
        const holds : Array<Audit.LegalHold> = await this.activeLegalHolds();

        // 3. scan the events table (see SCALE NOTE) for EVT# rows past their resolved retention window,
        //    deleting each one NOT covered by an active hold — logging the decision BEFORE deleting, since
        //    that log line is the durable evidence of "expired on schedule per policy X" once the row is gone.
        let scanned : number = 0, expired : number = 0, held : number = 0;
        let exclusiveStartKey : Record<string, any> | undefined;
        do
        {
            const page = await this.dynamo.client.send( new ScanCommand( {
                TableName: this.dynamo.table( "events" ),
                FilterExpression: "begins_with(sk, :evt)",
                ExpressionAttributeValues: { ":evt": { S: "EVT#" } },
                ExclusiveStartKey: exclusiveStartKey,
            } ) );
            exclusiveStartKey = page.LastEvaluatedKey;

            for( const raw of page.Items ?? [] )
            {
                scanned++;
                const row : Audit.StoredEvent = unmarshall( raw ) as Audit.StoredEvent;
                const retentionDays : number = this.resolvedRetentionDays( row.retentionClass, config );
                if( !this.isExpired( row.ingestedAt, retentionDays ) ) continue;

                if( this.isHeld( row, holds ) ) { held++; continue; }

                this.log.info( "auditRetentionJob: expiring record", { accountId: row.accountId, seq: row.seq, retentionClass: row.retentionClass, retentionDays, ingestedAt: row.ingestedAt } );
                const removed : Type.Result<void> = await this.dynamo.remove( "events", { accountId: row.accountId, sk: AuditJob.eventSk( row.seq ) } );
                if( removed.ok ) expired++;
                else this.log.error( "auditRetentionJob: expiry delete failed", { accountId: row.accountId, seq: row.seq, error: removed.error } );
            }
        }
        while( exclusiveStartKey );

        this.log.info( "auditRetentionJob: sweep complete", { scanned, expired, held } );
    }

    /////////////////////////////////////////////////////////////////////
    /** The retention window for a class — a per-class override if configured, else the env default. */
    private resolvedRetentionDays( retentionClass : Audit.RetentionClass, config : AuditConfig.Config ) : number
    {
        const tier = config.retentionTiers.find( ( t ) => t.retentionClass === retentionClass );
        return tier?.days ?? config.defaultRetentionDays;
    }

    /////////////////////////////////////////////////////////////////////
    private isExpired( ingestedAt : Type.ISODateTime, retentionDays : number ) : boolean
    {
        const ageMs : number = Date.now() - new Date( ingestedAt ).getTime();
        return ageMs > retentionDays * 24 * 60 * 60 * 1000;
    }

    /////////////////////////////////////////////////////////////////////
    /** Every active hold for the record's account, matched by optional subject-id + time-range scope. */
    private isHeld( row : Audit.StoredEvent, holds : Array<Audit.LegalHold> ) : boolean
    {
        return holds.some( ( hold ) =>
        {
            if( hold.accountId !== row.accountId ) return false;
            if( hold.subjectId && hold.subjectId !== row.actor.id && hold.subjectId !== row.target.id ) return false;
            if( hold.from && row.occurredAt < hold.from ) return false;
            if( hold.to && row.occurredAt > hold.to ) return false;
            return true;
        } );
    }

    /////////////////////////////////////////////////////////////////////
    private async activeLegalHolds() : Promise<Array<Audit.LegalHold>> {
        const page = await this.dynamo.client.send( new ScanCommand( { TableName: this.dynamo.table( "legal_holds" ) } ) );
        return ( page.Items ?? [] )
            .map( ( raw ) => unmarshall( raw ) as Audit.LegalHold )
            .filter( ( hold ) => !hold.releasedAt );
    }
}

//
// Lambda entrypoint — manifest `jobs.auditRetentionJob`, handler "jobs/AuditRetentionJob.handler".
//
const job : AuditRetentionJob = new AuditRetentionJob();
export const handler = ( event : ScheduledEvent, context : Context ) : Promise<void> => job.invoke( event, context );

export default AuditRetentionJob;
// eof
