//
import { PutCommand } from "@aws-sdk/lib-dynamodb";
import { Analytics } from "@repo/api";
import { Events } from "@repo/system";
import { S3 } from "@repo/services";
import type { Type } from "@repo/common";

import AnalyticsConsumer from "./AnalyticsConsumer";

// how long a dedup claim marker survives — long enough to catch the common at-least-once
// redelivery window (analytics-1.3/gap #7); TTL lets DynamoDB reclaim it for free after that.
const DEDUP_TTL_SECONDS : number = 7 * 24 * 60 * 60;

// flush a partition bucket after this many events OR this many ms, whichever comes first — the
// MVP stand-in for the spec's Kafka→S3 sink buffering (analytics-3.3), which needs Kafka Connect
// (not built anywhere on the platform yet — see the SPECS gap register). Keeps raw writes from
// becoming a flood of one-object-per-event S3 puts.
const FLUSH_MAX_EVENTS : number = 200;
const FLUSH_MAX_MS     : number = 15_000;

// a partition bucket is keyed by "accountId#channel#date" — matches the S3.Domain.EVENTS path
type Row    = Analytics.Event | Analytics.BehaviorEvent;
type Bucket = { accountId : string; channel : string; date : string; rows : Array<Row>; firstAt : number };

//
// AnalyticsIngestConsumer — the ingestion consumer (analytics-1.x/3.x): subscribes to BOTH analytics
// streams (`Events.Stream.ENGAGEMENT` + `BEHAVIOR`), dedups on a stable id, buffers by
// `account/channel/date`, and flushes each bucket to the raw S3 lake as newline-delimited JSON.
// MVP deviation from SPECS.md (documented there): plain JSON, not Parquet — Kafka Connect + Athena/
// Glue don't exist anywhere on the platform yet (report hit the same wall). Swapping the flush
// target to a real Parquet writer later doesn't change this consumer's dedup/buffering shape.
//
export class AnalyticsIngestConsumer extends AnalyticsConsumer
{
    private readonly buckets : Map<string, Bucket> = new Map();
    private flushTimer? : ReturnType<typeof setInterval>;

    ////////////////////////////////////////////////////////////////////////////////////////////
    constructor() { super( "ingest" ); }

    ////////////////////////////////////////////////////////////////////////////////////////////
    protected async consume() : Promise<void>
    {
        // periodic time-based flush — `.unref()` so it never blocks shutdown on its own
        this.flushTimer = setInterval( () => { void this.flushDue(); }, 5_000 );
        this.flushTimer.unref();

        await this.kafka.subscribeStream<Analytics.Event>(
            "analytics-ingest", Events.Stream.ENGAGEMENT,
            ( value : Analytics.Event ) : Promise<void> => this.ingestEngagement( value ) );
        await this.kafka.subscribeStream<Analytics.BehaviorEvent>(
            "analytics-ingest", Events.Stream.BEHAVIOR,
            ( value : Analytics.BehaviorEvent ) : Promise<void> => this.ingestBehavior( value ) );

        // both subscriptions run their consume loops in the background (kafkajs); block here until
        // a shutdown signal arrives, then let aboutToQuit() drain the buffers + disconnect.
        while( !this.isShuttingDown() ) await AnalyticsIngestConsumer.sleep( 1_000 );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Dedup on `(provider, providerEventId)` (analytics-1.3), then buffer for the `channel` lake path. */
    private async ingestEngagement( event : Analytics.Event ) : Promise<void>
    {
        const claimed : boolean = await this.claim( `${ event.provider }#${ event.providerEventId }` );
        if( !claimed ) { this.log.info( "ingest: duplicate delivery — already ingested", { eventId: event.eventId } ); return; }
        this.buffer( event.accountId, event.channel, event.occurredAt, event );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Dedup on the producer-assigned `eventId` (internally generated events — gap #7), buffered
     *  under a synthetic `"app"` channel (behavior events aren't a messaging channel). */
    private async ingestBehavior( event : Analytics.BehaviorEvent ) : Promise<void>
    {
        const claimed : boolean = await this.claim( event.eventId );
        if( !claimed ) { this.log.info( "ingest: duplicate delivery — already ingested", { eventId: event.eventId } ); return; }
        this.buffer( event.accountId, "app", event.occurredAt, event );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Claim a dedup key via a conditional Put — `false` means a prior delivery already won (same
     *  pattern as AuditSinkJob.claimEventId). Never throws. */
    private async claim( dedupKey : string ) : Promise<boolean>
    {
        try
        {
            await this.dynamo.client.send( new PutCommand( {
                TableName:           this.dynamo.table( "dedup" ),
                Item:                { dedupKey, expiresAt: Math.floor( Date.now() / 1000 ) + DEDUP_TTL_SECONDS },
                ConditionExpression: "attribute_not_exists(dedupKey)",
            } ) );
            return true;
        }
        catch( err : any )
        {
            if( err?.name === "ConditionalCheckFailedException" ) return false;
            this.log.error( "ingest: dedup claim failed — ingesting anyway (better a rare double-count than a lost event)", { dedupKey, error: String( err?.message ?? err ) } );
            return true;
        }
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Append to the (accountId, channel, date) bucket; flush immediately if it's hit the size cap. */
    private buffer( accountId : string, channel : string, occurredAt : string, row : Row ) : void
    {
        const date : string = occurredAt.slice( 0, 10 );   // YYYY-MM-DD — the S3 partition date
        const key  : string = `${ accountId }#${ channel }#${ date }`;
        const bucket : Bucket = this.buckets.get( key ) ?? { accountId, channel, date, rows: [], firstAt: Date.now() };
        bucket.rows.push( row );
        this.buckets.set( key, bucket );
        if( bucket.rows.length >= FLUSH_MAX_EVENTS ) void this.flush( key, bucket );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Time-based sweep (runs every 5s) — flush any bucket that's been open past `FLUSH_MAX_MS`,
     *  regardless of size, so a low-traffic account's events don't sit unflushed indefinitely. */
    private async flushDue() : Promise<void>
    {
        const now : number = Date.now();
        for( const [ key, bucket ] of Array.from( this.buckets.entries() ) )
            if( now - bucket.firstAt >= FLUSH_MAX_MS ) await this.flush( key, bucket );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Write one bucket's rows as newline-delimited JSON to the raw lake and clear it. Best-effort —
     *  a write failure leaves the bucket in place to retry on the next tick rather than dropping data. */
    private async flush( key : string, bucket : Bucket ) : Promise<void>
    {
        if( bucket.rows.length === 0 ) return;
        const built : Type.Result<string> = this.s3.key( {
            domain: S3.Domain.EVENTS, accountId: bucket.accountId, channel: bucket.channel, date: bucket.date,
            variant: `${ Date.now() }-${ Math.floor( Math.random() * 1_000_000 ) }`, ext: "json",
        } );
        if( !built.ok ) { this.log.error( "ingest: could not build an S3 key — dropping this batch (malformed channel/date segment)", { key, error: built.error } ); this.buckets.delete( key ); return; }

        const body : string = bucket.rows.map( ( row : Row ) : string => JSON.stringify( row ) ).join( "\n" );
        const wrote : Type.Result<void> = await this.s3.put( "raw", built.data, body );
        if( !wrote.ok ) { this.log.error( "ingest: raw lake write failed — will retry next flush", { key, count: bucket.rows.length, error: wrote.error } ); return; }

        this.log.info( "ingest: flushed to raw lake", { key, count: bucket.rows.length, objectKey: built.data } );
        this.buckets.delete( key );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Drain in-flight buffers before the process exits — a shutdown mid-buffer would otherwise
     *  silently drop whatever hadn't hit the size/time flush yet. */
    protected async aboutToQuit() : Promise<void>
    {
        if( this.flushTimer ) clearInterval( this.flushTimer );
        for( const [ key, bucket ] of Array.from( this.buckets.entries() ) ) await this.flush( key, bucket );   // flush EVERYTHING, not just stale buckets
        try { await this.kafka.disconnect(); } catch( err ) { this.log.error( "kafka disconnect failed", err ); }
        await super.aboutToQuit();
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    private static sleep( ms : number ) : Promise<void> { return new Promise( ( resolve ) => setTimeout( resolve, ms ) ); }
}

export default AnalyticsIngestConsumer;
// eof
