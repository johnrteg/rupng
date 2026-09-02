//
import type { Context, SQSEvent, SQSRecord } from "aws-lambda";
import { ListObjectsV2Command, GetObjectCommand } from "@aws-sdk/client-s3";
import type { ListObjectsV2CommandOutput, GetObjectCommandOutput, _Object } from "@aws-sdk/client-s3";
import { UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { Analytics } from "@repo/api";

import AnalyticsJob from "./AnalyticsJob";
import RollupKey from "../RollupKey";

/** One backfill request — re-derive every rollup bucket for one account/channel/date-range directly
 *  from the raw lake, REPLACING (not adding to) whatever the live rollup consumer already computed.
 *  `channel` is required — the raw lake is partitioned `account/channel/date` (SPECS.md), so a
 *  channel-less request would mean listing every channel; scope the request instead of guessing. */
interface BackfillRequest { accountId : string; channel : string; from : string; to : string; }

const GRANULARITIES : Array<Analytics.Granularity> = [ "hour", "day" ];

type Bucket = { dimensions : Analytics.RollupDimensions; granularity : Analytics.Granularity; periodStart : string; count : number };

//
// AnalyticsBackfillJob — the reprocessing/recompute path (analytics-3.7/4.4/8.0): re-reads the raw
// S3 lake for one account/channel/date-range and REBUILDS the affected rollup rows from scratch, so
// a normalization-logic fix or a late-arriving straggler (past the rollup consumer's window) can be
// corrected without waiting on a reprocess of the whole platform. Triggered via the `analytics-backfill`
// SQS queue (enqueued by `POST /analytics/reprocess`, staff-only).
//
export class AnalyticsBackfillJob extends AnalyticsJob<SQSEvent, void>
{
    ////////////////////////////////////////////////////////////////////////////////////////////
    constructor() { super( "backfill" ); }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public async handler( event : SQSEvent, _context : Context ) : Promise<void>
    {
        for( const record of event.Records ?? [] )
            await this.backfill( record );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    private async backfill( record : SQSRecord ) : Promise<void>
    {
        let request : BackfillRequest;
        try { request = JSON.parse( record.body ) as BackfillRequest; }
        catch { this.log.warn( "backfill: unparsable message body — skipping" ); return; }
        if( !request.accountId || !request.channel || !request.from || !request.to )
        { this.log.warn( "backfill: incomplete request — skipping", { request } ); return; }

        const buckets : Map<string, Bucket> = new Map();
        for( const date of AnalyticsBackfillJob.dateRange( request.from, request.to ) )
            await this.accumulateDate( request.accountId, request.channel, date, buckets );

        this.log.info( "backfill: recomputed buckets", { accountId: request.accountId, channel: request.channel, from: request.from, to: request.to, buckets: buckets.size } );
        for( const bucket of buckets.values() ) await this.setCount( request.accountId, bucket );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** List + read every raw object under `acct/<accountId>/channel/<channel>/date/<date>/`, and fold
     *  each line's event into `buckets` (keyed on the rollup sort key, so re-listing the same date
     *  twice — e.g. a retried SQS delivery — just recomputes the same totals, not a double-count). */
    private async accumulateDate( accountId : string, channel : string, date : string, buckets : Map<string, Bucket> ) : Promise<void>
    {
        const prefix : string = `acct/${ accountId }/channel/${ channel }/date/${ date }/`;
        let continuationToken : string | undefined = undefined;

        for( ;; )
        {
            const listed : ListObjectsV2CommandOutput = await this.s3.client.send( new ListObjectsV2Command( {
                Bucket: this.s3.bucket( "raw" ), Prefix: prefix, ContinuationToken: continuationToken,
            } ) );
            for( const object of listed.Contents ?? [] )
                await this.accumulateObject( object, buckets );

            if( !listed.IsTruncated || !listed.NextContinuationToken ) break;
            continuationToken = listed.NextContinuationToken;
        }
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    private async accumulateObject( object : _Object, buckets : Map<string, Bucket> ) : Promise<void>
    {
        if( !object.Key ) return;
        let body : string;
        try
        {
            const got : GetObjectCommandOutput = await this.s3.client.send( new GetObjectCommand( { Bucket: this.s3.bucket( "raw" ), Key: object.Key } ) );
            body = ( await got.Body?.transformToString() ) ?? "";
        }
        catch( err : any ) { this.log.error( "backfill: raw object read failed — skipping", { key: object.Key, error: String( err?.message ?? err ) } ); return; }

        // the raw lake is written by AnalyticsIngestConsumer already-deduped (analytics-1.3), so
        // every line here counts once — no re-dedup needed on this path
        for( const line of body.split( "\n" ) )
        {
            if( !line.trim() ) continue;
            let parsed : Analytics.Event | Analytics.BehaviorEvent;
            try { parsed = JSON.parse( line ); }
            catch { this.log.warn( "backfill: unparsable raw line — skipping", { key: object.Key } ); continue; }

            const dimensions : Analytics.RollupDimensions = "provider" in parsed
                ? { accountId: parsed.accountId, channel: parsed.channel, campaignId: parsed.campaignId ?? undefined, eventType: parsed.eventType, provider: parsed.provider }
                : { accountId: parsed.accountId, channel: "app", eventType: parsed.event };

            for( const granularity of GRANULARITIES )
            {
                const periodStart : string = RollupKey.periodStart( parsed.occurredAt, granularity );
                const sk : string = RollupKey.sortKey( dimensions, granularity, periodStart );
                const bucket : Bucket = buckets.get( sk ) ?? { dimensions, granularity, periodStart, count: 0 };
                bucket.count += 1;
                buckets.set( sk, bucket );
            }
        }
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Overwrite (SET, not ADD) one rollup row with the freshly recomputed total — a recompute
     *  REPLACES the bucket rather than adding on top of whatever the live consumer already wrote. */
    private async setCount( accountId : string, bucket : Bucket ) : Promise<void>
    {
        const sk : string = RollupKey.sortKey( bucket.dimensions, bucket.granularity, bucket.periodStart );
        try
        {
            await this.dynamo.client.send( new UpdateCommand( {
                TableName:                 this.dynamo.table( "rollups" ),
                Key:                       { accountId, sk },
                UpdateExpression:          "SET #cnt = :count, channel = :channel, campaignId = :campaignId, eventType = :eventType, provider = :provider, granularity = :granularity, periodStart = :periodStart, computedAt = :now, closed = :false",
                ExpressionAttributeNames:  { "#cnt": "count" },
                ExpressionAttributeValues:
                {
                    ":count": bucket.count, ":channel": bucket.dimensions.channel ?? null, ":campaignId": bucket.dimensions.campaignId ?? null,
                    ":eventType": bucket.dimensions.eventType ?? null, ":provider": bucket.dimensions.provider ?? null,
                    ":granularity": bucket.granularity, ":periodStart": bucket.periodStart,
                    ":now": new Date().toISOString(), ":false": false,
                },
            } ) );
        }
        catch( err : any )
        {
            this.log.error( "backfill: rollup overwrite failed", { accountId, sk, error: String( err?.message ?? err ) } );
        }
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Inclusive `YYYY-MM-DD` date range (UTC) — the S3 lake's partition granularity. */
    private static dateRange( from : string, to : string ) : Array<string>
    {
        const dates : Array<string> = [];
        const cursor : Date = new Date( `${ from }T00:00:00.000Z` );
        const end    : Date = new Date( `${ to }T00:00:00.000Z` );
        while( cursor.getTime() <= end.getTime() )
        {
            dates.push( cursor.toISOString().slice( 0, 10 ) );
            cursor.setUTCDate( cursor.getUTCDate() + 1 );
        }
        return dates;
    }
}

//
// Lambda entrypoint — manifest `jobs.backfill`, handler "jobs/AnalyticsBackfillJob.handler".
//
const job : AnalyticsBackfillJob = new AnalyticsBackfillJob();
export const handler = ( event : SQSEvent, context : Context ) : Promise<void> => job.invoke( event, context );

export default AnalyticsBackfillJob;
// eof
