//
import { PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { Analytics } from "@repo/api";
import { Events } from "@repo/system";
import type { Type } from "@repo/common";

import AnalyticsConsumer from "./AnalyticsConsumer";
import RollupKey from "../RollupKey";

// same TTL posture as the ingest consumer's dedup table (analytics-1.3/gap #7) — a SEPARATE claim
// namespace (its own table) because this is a DIFFERENT consumer group reading the SAME Kafka
// streams; sharing the ingest consumer's dedup table would make every rollup claim collide with
// the (already-won) ingest claim for the same event.
const DEDUP_TTL_SECONDS : number = 7 * 24 * 60 * 60;

type Granularity = Analytics.Granularity;
const GRANULARITIES : Array<Granularity> = [ "hour", "day" ];

//
// AnalyticsRollupConsumer — near-real-time rollups (analytics-4.x): subscribes to the SAME two
// analytics streams as the ingest consumer (its own consumer group — Kafka lets many groups read
// one topic independently), dedups on the stable event id, and atomically increments one counter
// row per (accountId, channel, campaignId, eventType, granularity, periodStart). Per gap #7,
// ROLLUPS are the authoritative dedup layer — the `ADD` counter is only safe because a duplicate
// delivery is rejected by the claim BEFORE it reaches the increment.
//
// MVP cut: no lateness/grace window or straggler recompute yet (analytics-4.3/4.4) — a late event
// still increments its bucket whenever it arrives, which is CORRECT for the count (it's exact
// either way) but doesn't yet reopen a `closed` period for a consumer that already read it as
// final. Deferred to when the Query API actually reads `closed` (Phase 5 doesn't yet).
//
export class AnalyticsRollupConsumer extends AnalyticsConsumer
{
    ////////////////////////////////////////////////////////////////////////////////////////////
    constructor() { super( "rollup" ); }

    ////////////////////////////////////////////////////////////////////////////////////////////
    protected async consume() : Promise<void>
    {
        await this.kafka.subscribeStream<Analytics.Event>(
            "analytics-rollup", Events.Stream.ENGAGEMENT,
            ( value : Analytics.Event ) : Promise<void> => this.rollupEngagement( value ) );
        await this.kafka.subscribeStream<Analytics.BehaviorEvent>(
            "analytics-rollup", Events.Stream.BEHAVIOR,
            ( value : Analytics.BehaviorEvent ) : Promise<void> => this.rollupBehavior( value ) );

        while( !this.isShuttingDown() ) await AnalyticsRollupConsumer.sleep( 1_000 );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    private async rollupEngagement( event : Analytics.Event ) : Promise<void>
    {
        const claimed : boolean = await this.claim( `${ event.provider }#${ event.providerEventId }` );
        if( !claimed ) return;   // already counted by a prior delivery

        const dimensions : Analytics.RollupDimensions =
        { accountId: event.accountId, channel: event.channel, campaignId: event.campaignId ?? undefined, eventType: event.eventType, provider: event.provider };
        for( const granularity of GRANULARITIES )
            await this.increment( dimensions, granularity, event.occurredAt );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    private async rollupBehavior( event : Analytics.BehaviorEvent ) : Promise<void>
    {
        const claimed : boolean = await this.claim( event.eventId );
        if( !claimed ) return;

        const dimensions : Analytics.RollupDimensions = { accountId: event.accountId, channel: "app", eventType: event.event };
        for( const granularity of GRANULARITIES )
            await this.increment( dimensions, granularity, event.occurredAt );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Claim a dedup key for THIS consumer group — same conditional-put pattern as
     *  AnalyticsIngestConsumer.claim, against the separate `rollup_dedup` table. */
    private async claim( dedupKey : string ) : Promise<boolean>
    {
        try
        {
            await this.dynamo.client.send( new PutCommand( {
                TableName:           this.dynamo.table( "rollup_dedup" ),
                Item:                { dedupKey, expiresAt: Math.floor( Date.now() / 1000 ) + DEDUP_TTL_SECONDS },
                ConditionExpression: "attribute_not_exists(dedupKey)",
            } ) );
            return true;
        }
        catch( err : any )
        {
            if( err?.name === "ConditionalCheckFailedException" ) return false;
            this.log.error( "rollup: dedup claim failed — counting anyway (better a rare double-count than a lost event)", { dedupKey, error: String( err?.message ?? err ) } );
            return true;
        }
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Atomically bump one (dimensions + granularity + period) bucket's count. Idempotent on the
     *  bucket key — safe to retry; the dedup claim above is what prevents double-COUNTING the same
     *  source event, not this write itself. */
    private async increment( dimensions : Analytics.RollupDimensions, granularity : Granularity, occurredAt : Type.ISODateTime ) : Promise<void>
    {
        const periodStart : Type.ISODateTime = RollupKey.periodStart( occurredAt, granularity );
        const sk : string = RollupKey.sortKey( dimensions, granularity, periodStart );

        try
        {
            await this.dynamo.client.send( new UpdateCommand( {
                TableName:                 this.dynamo.table( "rollups" ),
                Key:                       { accountId: dimensions.accountId, sk },
                UpdateExpression:          "ADD #cnt :one SET channel = :channel, campaignId = :campaignId, eventType = :eventType, provider = :provider, granularity = :granularity, periodStart = :periodStart, computedAt = :now, closed = if_not_exists( closed, :false )",
                ExpressionAttributeNames:  { "#cnt": "count" },
                ExpressionAttributeValues:
                {
                    ":one": 1, ":channel": dimensions.channel ?? null, ":campaignId": dimensions.campaignId ?? null,
                    ":eventType": dimensions.eventType ?? null, ":provider": dimensions.provider ?? null,
                    ":granularity": granularity, ":periodStart": periodStart,
                    ":now": new Date().toISOString(), ":false": false,
                },
            } ) );
        }
        catch( err : any )
        {
            this.log.error( "rollup: increment failed", { accountId: dimensions.accountId, sk, error: String( err?.message ?? err ) } );
        }
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    protected async aboutToQuit() : Promise<void>
    {
        try { await this.kafka.disconnect(); } catch( err ) { this.log.error( "kafka disconnect failed", err ); }
        await super.aboutToQuit();
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    private static sleep( ms : number ) : Promise<void> { return new Promise( ( resolve ) => setTimeout( resolve, ms ) ); }
}

export default AnalyticsRollupConsumer;
// eof
