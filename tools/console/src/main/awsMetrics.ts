import { DescribeServicesCommand, ListClustersCommand, ListServicesCommand, type DescribeServicesCommandOutput } from "@aws-sdk/client-ecs";
import { GetMetricDataCommand, type GetMetricDataCommandOutput, type MetricDataQuery } from "@aws-sdk/client-cloudwatch";

import type { ContainerInfo } from "../shared/types";
import { awsErr, cwClient, ecsClient } from "./aws";

//
// AWS ECS service metrics (read-only). On a real account there are no local Docker containers to
// `docker stats`, so CPU/memory come from CloudWatch (AWS/ECS CPUUtilization / MemoryUtilization,
// per service, Average). Returned in the same ContainerInfo shape the Containers view renders, so
// the donuts + history charts work identically to the LocalStack path.
//

/** Extract the short cluster name from a full ECS cluster ARN. */
function clusterName( arn : string ) : string { return arn.split( "/" ).pop() ?? arn; }

/** Format a 0–100 utilization number as a 2-decimal percent string (undefined passes through). */
function fmtPct( percent : number | undefined ) : string | undefined { return percent === undefined ? undefined : `${percent.toFixed( 2 )}%`; }

/** Build a single CloudWatch AWS/ECS metric query (per cluster+service, 60s Average) for GetMetricData. */
function query( id : string, metricName : string, cluster : string, service : string ) : MetricDataQuery
{
    return {
        Id         : id,
        ReturnData : true,
        MetricStat : {
            Metric : {
                Namespace  : "AWS/ECS",
                MetricName : metricName,
                Dimensions : [ { Name: "ClusterName", Value: cluster }, { Name: "ServiceName", Value: service } ]
            },
            Period : 60,
            Stat   : "Average"
        }
    };
}

interface Svc { arn : string; name : string; cluster : string; running : number; desired : number; status : string; }

/** Read every ECS service's latest CPU/memory utilization from CloudWatch, shaped as ContainerInfo. */
export async function ecsMetrics() : Promise<{ containers : Array<ContainerInfo>; error? : string }>
{
    try
    {
        const ecs : ReturnType<typeof ecsClient> = ecsClient();
        const clusters : Array<string> = ( await ecs.send( new ListClustersCommand( {} ) ).then( ( listResult ) => listResult.clusterArns ?? [] ) );

        const services : Array<Svc> = [];
        for ( const clusterArn of clusters )
        {
            const serviceArns : Array<string> = ( await ecs.send( new ListServicesCommand( { cluster: clusterArn, maxResults: 100 } ) ) ).serviceArns ?? [];
            const shortClusterName : string = clusterName( clusterArn );
            // DescribeServices accepts at most 10 service ARNs per call, so page through in batches of 10
            for ( let batchStart : number = 0; batchStart < serviceArns.length; batchStart += 10 )
            {
                const batch : Array<string> = serviceArns.slice( batchStart, batchStart + 10 );
                const described : DescribeServicesCommandOutput = await ecs.send( new DescribeServicesCommand( { cluster: clusterArn, services: batch } ) );
                for ( const service of described.services ?? [] )
                    if ( service.serviceArn && service.serviceName )
                        services.push( {
                            arn: service.serviceArn, name: service.serviceName, cluster: shortClusterName,
                            running: service.runningCount ?? 0, desired: service.desiredCount ?? 0, status: service.status ?? ""
                        } );
            }
        }

        if ( services.length === 0 ) return { containers: [] };

        // one CloudWatch call for every service's CPU + memory (latest datapoint)
        const queries : Array<MetricDataQuery> = [];
        services.forEach( ( service, index ) =>
        {
            queries.push( query( `cpu${index}`, "CPUUtilization", service.cluster, service.name ) );
            queries.push( query( `mem${index}`, "MemoryUtilization", service.cluster, service.name ) );
        } );

        const now : number = Date.now();
        const metricData : GetMetricDataCommandOutput = await cwClient().send( new GetMetricDataCommand( {
            StartTime         : new Date( now - 15 * 60 * 1000 ),   // 15-minute window so a recent datapoint exists
            EndTime           : new Date( now ),
            MetricDataQueries : queries,
            ScanBy            : "TimestampDescending"   // Values[0] = most recent
        } ) );

        // pull the most-recent datapoint for a given query id (cpuN / memN)
        const latest = ( id : string ) : number | undefined =>
            metricData.MetricDataResults?.find( ( result ) => result.Id === id )?.Values?.[ 0 ];

        const containers : Array<ContainerInfo> = services.map( ( service, index ) => ( {
            id         : service.arn,
            name       : service.name,
            image      : service.cluster,
            state      : "running",
            status     : `${service.running}/${service.desired} tasks${service.status ? ` · ${service.status}` : ""}`,
            kind       : "ecs-task",
            cpuPercent : fmtPct( latest( `cpu${index}` ) ),
            memPercent : fmtPct( latest( `mem${index}` ) ),
            memUsage   : undefined   // CloudWatch reports % utilization, not bytes
        } ) );

        return { containers };
    }
    catch ( err )
    {
        return { containers: [], error: awsErr( err ) };
    }
}
