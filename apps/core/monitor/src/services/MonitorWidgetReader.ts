//
import type { TableDescription } from "@aws-sdk/client-dynamodb";
import type { QueueAttributeName } from "@aws-sdk/client-sqs";
import type { Service as EcsServiceState } from "@aws-sdk/client-ecs";
import type { MetricDataResult } from "@aws-sdk/client-cloudwatch";
import { MonitorConfig, MonitorWidgetStatus } from "@repo/api";
import type { Type } from "@repo/common";
import { CloudWatch } from "@repo/services";
import MonitorService from "./MonitorService";

//
// MonitorWidgetReader — the live-query dispatch for one MonitorConfig.WidgetConfig: branch on
// `widget.type`, call the matching facade, and shape the result into a MonitorWidgetStatus.Data.
// Pulled out of MonitorService so the type-by-type query logic reads as one place, not spread
// across the service class.
//
export namespace MonitorWidgetReader
{
    /** Read a widget's current status from its configured source (NOT cached — the caller wraps
     *  this in {@link MonitorService.cachedWidgetRead}). Never throws — a source failure becomes
     *  an `ERROR`-level status rather than a rejected promise. */
    export async function read( service : MonitorService, widget : MonitorConfig.WidgetConfig ) : Promise<MonitorWidgetStatus.Data>
    {
        try
        {
            switch( widget.type )
            {
                case MonitorConfig.WidgetType.DYNAMO_TABLE: return await readDynamoTable( service, widget );
                case MonitorConfig.WidgetType.SQS_QUEUE:    return await readSqsQueue( service, widget );
                case MonitorConfig.WidgetType.ECS_SERVICE:  return await readEcsService( service, widget );
                case MonitorConfig.WidgetType.LAMBDA_JOB:   return await readLambdaJob( service, widget );
                case MonitorConfig.WidgetType.API_TARGET:   return await readApiTarget( service, widget );
                default:                                    return errorStatus( widget, "unknown widget type" );
            }
        }
        catch( err ) { return errorStatus( widget, String( err ) ); }
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** DynamoDB table — item count is the headline (CloudWatch-derived, updated ~every 6h). */
    async function readDynamoTable( service : MonitorService, widget : MonitorConfig.WidgetConfig ) : Promise<MonitorWidgetStatus.Data>
    {
        const described : Type.Result<TableDescription | undefined> = await service.dynamo.describeTable( widget.target );
        if( !described.ok ) return errorStatus( widget, "describeTable failed" );

        const table : TableDescription | undefined = described.data;
        const itemCount : number = table?.ItemCount ?? 0;
        return {
            widgetId: widget.id,
            level: levelFor( widget, itemCount ),
            primaryValue: itemCount,
            primaryLabel: "items",
            details: { sizeBytes: table?.TableSizeBytes ?? 0, status: table?.TableStatus ?? "UNKNOWN" },
            polledAt: new Date().toISOString(),
        };
    }

    /** SQS queue — visible message count is the headline; in-flight count is detail. Age-of-oldest-message
     *  is a CloudWatch metric, not a `GetQueueAttributes` attribute — not available from this call. */
    async function readSqsQueue( service : MonitorService, widget : MonitorConfig.WidgetConfig ) : Promise<MonitorWidgetStatus.Data>
    {
        const names : Array<QueueAttributeName> = [ "ApproximateNumberOfMessages", "ApproximateNumberOfMessagesNotVisible" ];
        const attributes : Type.Result<Partial<Record<QueueAttributeName, string>>> = await service.sqs.attributesByUrl( widget.target, names );
        if( !attributes.ok ) return errorStatus( widget, "getQueueAttributes failed" );

        const depth : number = Number( attributes.data.ApproximateNumberOfMessages ?? 0 );
        return {
            widgetId: widget.id,
            level: levelFor( widget, depth ),
            primaryValue: depth,
            primaryLabel: "messages",
            details: {
                inFlight: Number( attributes.data.ApproximateNumberOfMessagesNotVisible ?? 0 ),
            },
            polledAt: new Date().toISOString(),
        };
    }

    /** ECS service — running-task count is the headline; `target` is `"<cluster>/<serviceName>"`. */
    async function readEcsService( service : MonitorService, widget : MonitorConfig.WidgetConfig ) : Promise<MonitorWidgetStatus.Data>
    {
        const [ cluster, serviceName ] = widget.target.split( "/" );
        if( !cluster || !serviceName ) return errorStatus( widget, 'target must be "<cluster>/<serviceName>"' );

        const described : Type.Result<Array<EcsServiceState>> = await service.ecs.describeServices( cluster, [ serviceName ] );
        if( !described.ok ) return errorStatus( widget, "describeServices failed" );

        const found : EcsServiceState | undefined = described.data[ 0 ];
        const running : number = found?.runningCount ?? 0;
        const desired : number = found?.desiredCount ?? 0;
        return {
            widgetId: widget.id,
            // below desired capacity is worth flagging even without an explicit threshold
            level: found === undefined ? MonitorWidgetStatus.Level.ERROR : ( running < desired ? MonitorWidgetStatus.Level.WARN : levelFor( widget, running ) ),
            primaryValue: running,
            primaryLabel: "running tasks",
            details: { desired, pending: found?.pendingCount ?? 0, status: found?.status ?? "UNKNOWN" },
            polledAt: new Date().toISOString(),
        };
    }

    /** Lambda job — invocation count over the last 15 minutes is the headline; errors are detail. */
    async function readLambdaJob( service : MonitorService, widget : MonitorConfig.WidgetConfig ) : Promise<MonitorWidgetStatus.Data>
    {
        const window : MonitorWidgetReader.Window = last15Minutes();
        const queries : Array<CloudWatch.MetricQuery> = [
            { id: "invocations", namespace: "AWS/Lambda", metricName: "Invocations", stat: "Sum", dimensions: [ { name: "FunctionName", value: widget.target } ] },
            { id: "errors",      namespace: "AWS/Lambda", metricName: "Errors",      stat: "Sum", dimensions: [ { name: "FunctionName", value: widget.target } ] },
        ];
        const results : Type.Result<Array<MetricDataResult>> = await service.cloudwatch.getMetricData( queries, window.start, window.end );
        if( !results.ok ) return errorStatus( widget, "getMetricData failed" );

        const invocations : number = sumOf( results.data, "invocations" );
        const errors : number = sumOf( results.data, "errors" );
        return {
            widgetId: widget.id,
            level: errors > 0 ? MonitorWidgetStatus.Level.WARN : levelFor( widget, invocations ),
            primaryValue: invocations,
            primaryLabel: "invocations (15m)",
            details: { errors },
            polledAt: new Date().toISOString(),
        };
    }

    /** ALB target group — request count over the last 15 minutes is the headline; 5XX is detail. */
    async function readApiTarget( service : MonitorService, widget : MonitorConfig.WidgetConfig ) : Promise<MonitorWidgetStatus.Data>
    {
        const window : MonitorWidgetReader.Window = last15Minutes();
        const queries : Array<CloudWatch.MetricQuery> = [
            { id: "requests", namespace: "AWS/ApplicationELB", metricName: "RequestCount",              stat: "Sum", dimensions: [ { name: "TargetGroup", value: widget.target } ] },
            { id: "serverErrors", namespace: "AWS/ApplicationELB", metricName: "HTTPCode_Target_5XX_Count", stat: "Sum", dimensions: [ { name: "TargetGroup", value: widget.target } ] },
        ];
        const results : Type.Result<Array<MetricDataResult>> = await service.cloudwatch.getMetricData( queries, window.start, window.end );
        if( !results.ok ) return errorStatus( widget, "getMetricData failed" );

        const requests : number = sumOf( results.data, "requests" );
        const serverErrors : number = sumOf( results.data, "serverErrors" );
        return {
            widgetId: widget.id,
            level: serverErrors > 0 ? MonitorWidgetStatus.Level.WARN : levelFor( widget, requests ),
            primaryValue: requests,
            primaryLabel: "requests (15m)",
            details: { serverErrors },
            polledAt: new Date().toISOString(),
        };
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Derive a widget's status color from its configured thresholds (both optional; no config = OK). */
    function levelFor( widget : MonitorConfig.WidgetConfig, value : number ) : MonitorWidgetStatus.Level
    {
        const thresholds : MonitorConfig.Thresholds | undefined = widget.thresholds;
        if( thresholds?.critical !== undefined && value >= thresholds.critical ) return MonitorWidgetStatus.Level.CRITICAL;
        if( thresholds?.warn     !== undefined && value >= thresholds.warn )     return MonitorWidgetStatus.Level.WARN;
        return MonitorWidgetStatus.Level.OK;
    }

    /** A failed source read — surfaced as an ERROR-level status rather than a thrown/rejected call. */
    function errorStatus( widget : MonitorConfig.WidgetConfig, message : string ) : MonitorWidgetStatus.Data
    {
        return { widgetId: widget.id, level: MonitorWidgetStatus.Level.ERROR, details: {}, error: message, polledAt: new Date().toISOString() };
    }

    /** Sum a named metric's data points from a `GetMetricData` result set (0 if the id is absent/empty). */
    function sumOf( results : Array<MetricDataResult>, id : string ) : number
    {
        const values : Array<number> = results.find( ( result : MetricDataResult ) : boolean => result.Id === id )?.Values ?? [];
        return values.reduce( ( total : number, value : number ) : number => total + value, 0 );
    }

    /** The trailing 15-minute window used for the job/API-target metric queries. */
    function last15Minutes() : MonitorWidgetReader.Window
    {
        const end : Date = new Date();
        const start : Date = new Date( end.getTime() - 15 * 60 * 1000 );
        return { start, end };
    }
}

export namespace MonitorWidgetReader
{
    /** A metric query time window. */
    export interface Window { start : Date; end : Date; }
}

export default MonitorWidgetReader;
