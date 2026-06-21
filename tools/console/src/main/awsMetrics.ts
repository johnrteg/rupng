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

function clusterName( arn : string ) : string { return arn.split( "/" ).pop() ?? arn; }

function fmtPct( v : number | undefined ) : string | undefined { return v === undefined ? undefined : `${v.toFixed( 2 )}%`; }

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

export async function ecsMetrics() : Promise<{ containers : ContainerInfo[]; error? : string }>
{
    try
    {
        const ecs : ReturnType<typeof ecsClient> = ecsClient();
        const clusters : string[] = ( await ecs.send( new ListClustersCommand( {} ) ).then( ( r ) => r.clusterArns ?? [] ) );

        const services : Svc[] = [];
        for ( const clusterArn of clusters )
        {
            const arns : string[] = ( await ecs.send( new ListServicesCommand( { cluster: clusterArn, maxResults: 100 } ) ) ).serviceArns ?? [];
            const cname : string = clusterName( clusterArn );
            for ( let i : number = 0; i < arns.length; i += 10 )
            {
                const batch : string[] = arns.slice( i, i + 10 );
                const d : DescribeServicesCommandOutput = await ecs.send( new DescribeServicesCommand( { cluster: clusterArn, services: batch } ) );
                for ( const s of d.services ?? [] )
                    if ( s.serviceArn && s.serviceName )
                        services.push( {
                            arn: s.serviceArn, name: s.serviceName, cluster: cname,
                            running: s.runningCount ?? 0, desired: s.desiredCount ?? 0, status: s.status ?? ""
                        } );
            }
        }

        if ( services.length === 0 ) return { containers: [] };

        // one CloudWatch call for every service's CPU + memory (latest datapoint)
        const queries : MetricDataQuery[] = [];
        services.forEach( ( s, i ) =>
        {
            queries.push( query( `cpu${i}`, "CPUUtilization", s.cluster, s.name ) );
            queries.push( query( `mem${i}`, "MemoryUtilization", s.cluster, s.name ) );
        } );

        const now : number = Date.now();
        const res : GetMetricDataCommandOutput = await cwClient().send( new GetMetricDataCommand( {
            StartTime         : new Date( now - 15 * 60 * 1000 ),
            EndTime           : new Date( now ),
            MetricDataQueries : queries,
            ScanBy            : "TimestampDescending"   // Values[0] = most recent
        } ) );

        const latest = ( id : string ) : number | undefined =>
            res.MetricDataResults?.find( ( r ) => r.Id === id )?.Values?.[ 0 ];

        const containers : ContainerInfo[] = services.map( ( s, i ) => ( {
            id         : s.arn,
            name       : s.name,
            image      : s.cluster,
            state      : "running",
            status     : `${s.running}/${s.desired} tasks${s.status ? ` · ${s.status}` : ""}`,
            kind       : "ecs-task",
            cpuPercent : fmtPct( latest( `cpu${i}` ) ),
            memPercent : fmtPct( latest( `mem${i}` ) ),
            memUsage   : undefined   // CloudWatch reports % utilization, not bytes
        } ) );

        return { containers };
    }
    catch ( err )
    {
        return { containers: [], error: awsErr( err ) };
    }
}
