import { ListClustersCommand, ListServicesCommand, DescribeServicesCommand, ListTasksCommand, DescribeTasksCommand } from "@aws-sdk/client-ecs";
import { DescribeLoadBalancersCommand, DescribeTargetGroupsCommand, DescribeTargetHealthCommand } from "@aws-sdk/client-elastic-load-balancing-v2";
import { GetApisCommand, GetRoutesCommand, GetIntegrationsCommand, GetVpcLinksCommand } from "@aws-sdk/client-apigatewayv2";

import type {
    DiagApi, DiagFinding, DiagIntegration, DiagLoadBalancer, DiagService, DiagTarget,
    DiagTargetGroup, DiagTask, DiagVpcLink, VpcLinkDiagnosis
} from "../shared/types";
import { apigwClient, awsErr, ecsClient, elbv2Client, getTarget } from "./aws";

//
// VpcLink data-path diagnosis — a read-only walk of the API Gateway (HTTP API) → VpcLink → ALB →
// ECS chain. The point is to localize WHERE a request would break. The most telling check is target
// registration: if ECS tasks are Running but the ALB target group has no registered/healthy targets,
// the gateway → ALB → ECS data path has no backend — which is exactly the gap LocalStack tends to
// have (it mocks the control plane but doesn't register Fargate tasks into the target group).
//
// Each section is independently guarded so one failing call still yields a useful partial report.
//

export async function diagnoseVpcLink() : Promise<VpcLinkDiagnosis>
{
    const targetKind : "localstack" | "aws" = getTarget().kind;
    const services : DiagService[] = [];
    const targetGroups : DiagTargetGroup[] = [];
    const loadBalancers : DiagLoadBalancer[] = [];
    const vpcLinks : DiagVpcLink[] = [];
    const apis : DiagApi[] = [];
    let error : string | undefined;

    // ── ECS: clusters → services → tasks (running count + per-task status/IP) ──────────────────────
    try
    {
        const ecs = ecsClient();
        const { clusterArns = [] } = await ecs.send( new ListClustersCommand( {} ) );
        for ( const cluster of clusterArns )
        {
            const { serviceArns = [] } = await ecs.send( new ListServicesCommand( { cluster, maxResults: 100 } ) );
            if ( serviceArns.length === 0 ) continue;

            const { services: descr = [] } = await ecs.send( new DescribeServicesCommand( { cluster, services: serviceArns } ) );
            for ( const svc of descr )
            {
                const serviceName : string = svc.serviceName ?? "?";
                const tasks : DiagTask[] = [];
                try
                {
                    const { taskArns = [] } = await ecs.send( new ListTasksCommand( { cluster, serviceName } ) );
                    if ( taskArns.length > 0 )
                    {
                        const { tasks: td = [] } = await ecs.send( new DescribeTasksCommand( { cluster, tasks: taskArns } ) );
                        for ( const t of td )
                        {
                            const ip : string | undefined = t.attachments
                                ?.flatMap( ( a ) => a.details ?? [] )
                                .find( ( d ) => d.name === "privateIPv4Address" )?.value;
                            tasks.push( {
                                taskArn    : shortArn( t.taskArn ),
                                lastStatus : t.lastStatus ?? "?",
                                healthStatus : t.healthStatus ?? "UNKNOWN",
                                ip
                            } );
                        }
                    }
                }
                catch { /* task detail is best-effort */ }

                services.push( {
                    cluster  : shortArn( cluster ),
                    service  : serviceName,
                    desired  : svc.desiredCount ?? 0,
                    running  : svc.runningCount ?? 0,
                    tasks
                } );
            }
        }
    }
    catch ( err ) { error = `ECS: ${awsErr( err )}`; }

    // ── ELBv2: load balancers + target groups + target HEALTH (the crux) ───────────────────────────
    try
    {
        const elb = elbv2Client();
        const { LoadBalancers = [] } = await elb.send( new DescribeLoadBalancersCommand( {} ) );
        for ( const lb of LoadBalancers )
        {
            loadBalancers.push( {
                name    : lb.LoadBalancerName ?? "?",
                type    : lb.Type,
                scheme  : lb.Scheme,
                state   : lb.State?.Code,
                dnsName : lb.DNSName
            } );
        }

        const { TargetGroups = [] } = await elb.send( new DescribeTargetGroupsCommand( {} ) );
        for ( const tg of TargetGroups )
        {
            const targets : DiagTarget[] = [];
            try
            {
                const { TargetHealthDescriptions = [] } = await elb.send(
                    new DescribeTargetHealthCommand( { TargetGroupArn: tg.TargetGroupArn } ) );
                for ( const th of TargetHealthDescriptions )
                {
                    targets.push( {
                        id     : th.Target?.Id ?? "?",
                        port   : th.Target?.Port,
                        state  : th.TargetHealth?.State ?? "unknown",
                        reason : th.TargetHealth?.Reason
                    } );
                }
            }
            catch ( err ) { error = error ?? `TargetHealth: ${awsErr( err )}`; }

            targetGroups.push( {
                name       : tg.TargetGroupName ?? "?",
                protocol   : tg.Protocol,
                port       : tg.Port,
                targetType : tg.TargetType,
                targets
            } );
        }
    }
    catch ( err ) { error = error ?? `ELBv2: ${awsErr( err )}`; }

    // ── API Gateway (HTTP API) + VpcLinks + integrations ───────────────────────────────────────────
    try
    {
        const gw = apigwClient();
        const { Items: apiItems = [] } = await gw.send( new GetApisCommand( {} ) );
        for ( const a of apiItems )
        {
            const apiId : string = a.ApiId ?? "?";
            const routes : string[] = [];
            const integrations : DiagIntegration[] = [];
            try
            {
                const { Items: routeItems = [] } = await gw.send( new GetRoutesCommand( { ApiId: apiId } ) );
                for ( const r of routeItems ) if ( r.RouteKey ) routes.push( r.RouteKey );
            }
            catch { /* best-effort */ }
            try
            {
                const { Items: intItems = [] } = await gw.send( new GetIntegrationsCommand( { ApiId: apiId } ) );
                for ( const i of intItems )
                    integrations.push( {
                        id             : i.IntegrationId ?? "?",
                        connectionType : i.ConnectionType,
                        connectionId   : i.ConnectionId,
                        uri            : i.IntegrationUri
                    } );
            }
            catch { /* best-effort */ }

            // invoke base URL: LocalStack uses the execute-api subdomain on the edge port; AWS reports it
            const endpoint : string = targetKind === "localstack"
                ? `http://${apiId}.execute-api.localhost.localstack.cloud:4566`
                : ( a.ApiEndpoint ?? "" );

            apis.push( { apiId, name: a.Name, protocol: a.ProtocolType, endpoint, routes, integrations } );
        }

        const { Items: linkItems = [] } = await gw.send( new GetVpcLinksCommand( {} ) );
        for ( const l of linkItems )
            vpcLinks.push( { id: l.VpcLinkId ?? "?", name: l.Name, status: l.VpcLinkStatus } );
    }
    catch ( err ) { error = error ?? `API Gateway: ${awsErr( err )}`; }

    return {
        targetKind,
        generatedAt : Date.now(),
        services, targetGroups, loadBalancers, vpcLinks, apis,
        findings : synthesize( { targetKind, services, targetGroups, loadBalancers, vpcLinks, apis } ),
        error
    };
}

/** Turn the raw resource state into ordered, plain-language findings (the report's verdict). */
function synthesize(
    d : Pick<VpcLinkDiagnosis, "targetKind" | "services" | "targetGroups" | "loadBalancers" | "vpcLinks" | "apis"> )
    : DiagFinding[]
{
    const findings : DiagFinding[] = [];

    const runningTasks : number = d.services.reduce( ( n, s ) => n + s.running, 0 );
    const registered : DiagTarget[] = d.targetGroups.flatMap( ( tg ) => tg.targets );
    const healthy : number = registered.filter( ( t ) => /healthy/i.test( t.state ) ).length;

    // ECS layer
    if ( d.services.length === 0 )
        findings.push( { level: "warn", title: "No ECS services found", detail: "Nothing is deployed to ECS for the active target, so there's no backend to reach." } );
    else if ( runningTasks === 0 )
        findings.push( { level: "error", title: "ECS services have 0 running tasks", detail: `${d.services.length} service(s) found, but none have a running task. The app can't be reached until a task is Running.` } );
    else
        findings.push( { level: "ok", title: `${runningTasks} ECS task(s) running`, detail: `Across ${d.services.length} service(s). The application layer is up.` } );

    // ALB target registration — the crux of the gateway → ALB → ECS path
    if ( d.targetGroups.length === 0 )
        findings.push( { level: "warn", title: "No ALB target groups found", detail: "Without a target group the ALB has nothing to forward to. Expected one per ECS service behind the ALB." } );
    else if ( runningTasks > 0 && registered.length === 0 )
        findings.push( {
            level  : "error",
            title  : "ECS tasks are running but NOT registered in any ALB target group",
            detail : "This breaks the gateway → VpcLink → ALB → ECS path: the ALB has no backend to forward to. " +
                     ( d.targetKind === "localstack"
                         ? "On LocalStack this is the common data-path gap — task→target-group registration isn't exercised. This is strong evidence to share with support."
                         : "On real AWS, check the service's load-balancer config, target group, and that the task is in a subnet the ALB can reach." )
        } );
    else if ( registered.length > 0 && healthy === 0 )
        findings.push( {
            level  : "error",
            title  : "Targets are registered but none are healthy",
            detail : `Target states: ${[ ...new Set( registered.map( ( t ) => t.state ) ) ].join( ", " )}. The ALB won't forward to unhealthy targets, so the gateway gets a 5xx.`
        } );
    else if ( healthy > 0 )
        findings.push( { level: "ok", title: `${healthy} healthy target(s) registered in the ALB`, detail: "The ALB has live backends — the ALB → ECS hop should work." } );

    // VpcLink
    const badLinks : DiagVpcLink[] = d.vpcLinks.filter( ( l ) => l.status && !/AVAILABLE/i.test( l.status ) );
    if ( d.vpcLinks.length === 0 )
        findings.push( { level: "warn", title: "No VpcLink found", detail: "The HTTP API needs a VpcLink to reach a private (internal) ALB." } );
    else if ( badLinks.length > 0 )
        findings.push( { level: "warn", title: "VpcLink not AVAILABLE", detail: badLinks.map( ( l ) => `${l.id}: ${l.status}` ).join( ", " ) } );
    else
        findings.push( { level: "ok", title: `${d.vpcLinks.length} VpcLink(s) AVAILABLE`, detail: "" } );

    // API Gateway private integration
    const privInts : DiagIntegration[] = d.apis.flatMap( ( a ) => a.integrations ).filter( ( i ) => /VPC_LINK/i.test( i.connectionType ?? "" ) );
    if ( d.apis.length === 0 )
        findings.push( { level: "warn", title: "No HTTP APIs found", detail: "No API Gateway API for the active target." } );
    else if ( privInts.length === 0 )
        findings.push( { level: "warn", title: "No VPC_LINK integration on any API", detail: "Expected an integration with connectionType VPC_LINK pointing at the internal ALB listener." } );
    else
        findings.push( { level: "ok", title: `${privInts.length} VPC_LINK integration(s) configured`, detail: "API routes are wired to the ALB via the VpcLink." } );

    // LocalStack caveat — the two checks support often suggests don't apply here
    if ( d.targetKind === "localstack" )
        findings.push( {
            level  : "ok",
            title  : "Note: SG / VPC-reachability checks don't apply on LocalStack",
            detail : "LocalStack doesn't enforce security groups or simulate real VPC networking, so those troubleshooting steps can't prove anything here. Focus on target registration + the trace log."
        } );

    return findings;
}

function shortArn( arn : string | undefined ) : string
{
    if ( !arn ) return "?";
    const slash : number = arn.lastIndexOf( "/" );
    return slash >= 0 ? arn.slice( slash + 1 ) : arn;
}
