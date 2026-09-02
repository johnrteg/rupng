//
import { Analytics } from "@repo/api";
import type { Type } from "@repo/common";

//
// RollupKey — pure helpers for the rollups table's bucket key (accountId partition + a composite
// sort key), shared by AnalyticsRollupConsumer (the streaming ADD path) and AnalyticsBackfillJob
// (the recompute SET path — analytics-3.7/4.4) so the two can never compute a different key for the
// same (dimensions, granularity, period) and silently split one logical bucket into two rows.
//
export namespace RollupKey
{
    /** Truncate `occurredAt` to the bucket start for `granularity` (UTC). */
    export function periodStart( occurredAt : Type.ISODateTime, granularity : Analytics.Granularity ) : Type.ISODateTime
    {
        const date : Date = new Date( occurredAt );
        if( granularity === "hour" ) date.setUTCMinutes( 0, 0, 0 );
        else if( granularity === "day" ) date.setUTCHours( 0, 0, 0, 0 );
        return date.toISOString();
    }

    /** The rollups table's sort key — one row per unique dimension-combination + period. A
     *  null/absent dimension buckets under a fixed `_all` token (per `Analytics.RollupDimensions`'s
     *  "absent = all" contract), never left out of the key (that would collide two distinct buckets). */
    export function sortKey( dimensions : Analytics.RollupDimensions, granularity : Analytics.Granularity, periodStart : Type.ISODateTime ) : string
    {
        return [
            "channel", dimensions.channel ?? "_all",
            "provider", dimensions.provider ?? "_all",
            "campaign", dimensions.campaignId ?? "_all",
            "event", dimensions.eventType ?? "_all",
            "gran", granularity,
            "period", periodStart,
        ].join( "#" );
    }
}

export default RollupKey;
// eof
