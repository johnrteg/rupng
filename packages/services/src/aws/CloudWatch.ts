//
// CloudWatch facade — read-only metric queries over `@aws-sdk/client-cloudwatch`, addressed by
// PHYSICAL metric identifiers (namespace/name/dimensions), not cloud-manifest logical keys — a
// reader (e.g. monitor) queries metrics for resources it does not own.
//
import { CloudWatchClient, GetMetricDataCommand } from "@aws-sdk/client-cloudwatch";
import type { GetMetricDataCommandOutput, MetricDataQuery, MetricDataResult } from "@aws-sdk/client-cloudwatch";
import { ResultUtils } from "@repo/common";
import type { Type } from "@repo/common";
import { ClientUtils } from "./ClientUtils";

/**
 * CloudWatch facade — the routine read-only `GetMetricData` query over
 * `@aws-sdk/client-cloudwatch`. Unlike `Dynamo`/`Sqs`, this facade takes no `CloudResolver` —
 * a caller (e.g. `monitor`) queries metrics for resources across the whole fleet, not just its
 * own, so every query is addressed by physical namespace/metric-name/dimensions.
 *
 * **Use for** on-demand metric reads only (a cache-miss fallback) — never poll this in a tight
 * loop for a dashboard; read through a TTL cache in front of it.
 */
export class CloudWatch
{
    private _client? : CloudWatchClient;

    ///////////////////////////////////////////////////////////////////////////////////////////
    /** The raw `CloudWatchClient` — escape hatch (alarms, dashboards, …). Lazy + cached. */
    get client() : CloudWatchClient { return this._client ??= ClientUtils.createClient( CloudWatchClient ); }

    ///////////////////////////////////////////////////////////////////////////////////////////
    /**
     * Fetch one or more metric time series over a window. Each entry in `queries` names its own
     * `namespace`/`metricName`/`dimensions`/`stat` (e.g. `Sum`/`Average`/`Maximum`); the result
     * array aligns 1:1 with `queries` by `id`.
     *
     * @param queries    the metrics to fetch — see {@link CloudWatch.MetricQuery}.
     * @param startTime  window start.
     * @param endTime    window end.
     * @param periodSec  aggregation period in seconds (e.g. `60`).
     */
    getMetricData( queries : Array<CloudWatch.MetricQuery>, startTime : Date, endTime : Date, periodSec : number = 60 ) : Promise<Type.Result<Array<MetricDataResult>>>
    {
        return ResultUtils.from( async () : Promise<Array<MetricDataResult>> =>
        {
            // translate our simplified per-metric shape into the SDK's MetricDataQuery form
            const metricDataQueries : Array<MetricDataQuery> = queries.map( ( query : CloudWatch.MetricQuery ) : MetricDataQuery => ( {
                Id: query.id,
                MetricStat: {
                    Metric: {
                        Namespace:  query.namespace,
                        MetricName: query.metricName,
                        Dimensions: query.dimensions.map( ( dimension : CloudWatch.Dimension ) => ( { Name: dimension.name, Value: dimension.value } ) ),
                    },
                    Period: periodSec,
                    Stat:   query.stat,
                },
            } ) );

            const result : GetMetricDataCommandOutput = await this.client.send( new GetMetricDataCommand( {
                MetricDataQueries: metricDataQueries,
                StartTime: startTime,
                EndTime:   endTime,
            } ) );
            return result.MetricDataResults ?? [];
        } );
    }
}

export namespace CloudWatch
{
    /** A single metric dimension, e.g. `{ name: "QueueName", value: "process" }`. */
    export interface Dimension
    {
        name  : string;
        value : string;
    }

    /** One metric to fetch via {@link CloudWatch.getMetricData} — `id` must be unique within the batch. */
    export interface MetricQuery
    {
        id         : string;
        namespace  : string;
        metricName : string;
        dimensions : Array<Dimension>;
        stat       : "Sum" | "Average" | "Maximum" | "Minimum" | "SampleCount";
    }
}
