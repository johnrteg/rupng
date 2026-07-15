import { ListClustersCommand, ListServicesCommand, DescribeServicesCommand, ListTasksCommand, DescribeTasksCommand } from "@aws-sdk/client-ecs";
import { DescribeLoadBalancersCommand, DescribeTargetGroupsCommand, DescribeTargetHealthCommand } from "@aws-sdk/client-elastic-load-balancing-v2";
import { GetApisCommand, GetRoutesCommand, GetIntegrationsCommand, GetVpcLinksCommand } from "@aws-sdk/client-apigatewayv2";

import type {
    DiagApi, DiagFinding, DiagIntegration, DiagLoadBalancer, DiagService, DiagTarget,
    DiagTargetGroup, DiagTask, DiagVpcLink, VpcLinkDiagnosis
} from "../shared/types";
import { TargetKind } from "../shared/types";
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

/** Walk the HTTP API → VpcLink → ALB → ECS chain (read-only) and return state + plain-language findings. */
export async function diagnoseVpcLink() : Promise<VpcLinkDiagnosis>
{
    const targetKind : TargetKind = getTarget().kind;
    const services : Array<DiagService> = [];
    const targetGroups : Array<DiagTargetGroup> = [];
    const loadBalancers : Array<DiagLoadBalancer> = [];
    const vpcLinks : Array<DiagVpcLink> = [];
    const apis : Array<DiagApi> = [];
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

            const { services: describedServices = [] } = await ecs.send( new DescribeServicesCommand( { cluster, services: serviceArns } ) );
            for ( const service of describedServices )
            {
                const serviceName : string = service.serviceName ?? "?";
                const tasks : Array<DiagTask> = [];
                try
                {
                    const { taskArns = [] } = await ecs.send( new ListTasksCommand( { cluster, serviceName } ) );
                    if ( taskArns.length > 0 )
                    {
                        const { tasks: describedTasks = [] } = await ecs.send( new DescribeTasksCommand( { cluster, tasks: taskArns } ) );
                        for ( const task of describedTasks )
                        {
                            // the task's private IP lives in an ENI attachment detail
                            const ip : string | undefined = task.attachments
                                ?.flatMap( ( attachment ) => attachment.details ?? [] )
                                .find( ( detail ) => detail.name === "privateIPv4Address" )?.value;
                            tasks.push( {
                                taskArn    : shortArn( task.taskArn ),
                                lastStatus : task.lastStatus ?? "?",
                                healthStatus : task.healthStatus ?? "UNKNOWN",
                                ip
                            } );
                        }
                    }
                }
                catch { /* task detail is best-effort */ }

                services.push( {
                    cluster  : shortArn( cluster ),
                    service  : serviceName,
                    desired  : service.desiredCount ?? 0,
                    running  : service.runningCount ?? 0,
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
        for ( const loadBalancer of LoadBalancers )
        {
            loadBalancers.push( {
                name    : loadBalancer.LoadBalancerName ?? "?",
                type    : loadBalancer.Type,
                scheme  : loadBalancer.Scheme,
                state   : loadBalancer.State?.Code,
                dnsName : loadBalancer.DNSName
            } );
        }

        const { TargetGroups = [] } = await elb.send( new DescribeTargetGroupsCommand( {} ) );
        for ( const targetGroup of TargetGroups )
        {
            const targets : Array<DiagTarget> = [];
            try
            {
                // target health is the crux check — whether tasks are actually registered + healthy
                const { TargetHealthDescriptions = [] } = await elb.send(
                    new DescribeTargetHealthCommand( { TargetGroupArn: targetGroup.TargetGroupArn } ) );
                for ( const targetHealth of TargetHealthDescriptions )
                {
                    targets.push( {
                        id     : targetHealth.Target?.Id ?? "?",
                        port   : targetHealth.Target?.Port,
                        state  : targetHealth.TargetHealth?.State ?? "unknown",
                        reason : targetHealth.TargetHealth?.Reason
                    } );
                }
            }
            catch ( err ) { error = error ?? `TargetHealth: ${awsErr( err )}`; }

            targetGroups.push( {
                name       : targetGroup.TargetGroupName ?? "?",
                protocol   : targetGroup.Protocol,
                port       : targetGroup.Port,
                targetType : targetGroup.TargetType,
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
        for ( const api of apiItems )
        {
            const apiId : string = api.ApiId ?? "?";
            const routes : Array<string> = [];
            const integrations : Array<DiagIntegration> = [];
            try
            {
                const { Items: routeItems = [] } = await gw.send( new GetRoutesCommand( { ApiId: apiId } ) );
                for ( const route of routeItems ) if ( route.RouteKey ) routes.push( route.RouteKey );
            }
            catch { /* best-effort */ }
            try
            {
                const { Items: integrationItems = [] } = await gw.send( new GetIntegrationsCommand( { ApiId: apiId } ) );
                for ( const integration of integrationItems )
                    integrations.push( {
                        id             : integration.IntegrationId ?? "?",
                        connectionType : integration.ConnectionType,
                        connectionId   : integration.ConnectionId,
                        uri            : integration.IntegrationUri
                    } );
            }
            catch { /* best-effort */ }

            // invoke base URL: LocalStack uses the execute-api subdomain on the edge port; AWS reports it
            const endpoint : string = targetKind === TargetKind.LOCALSTACK
                ? `http://${apiId}.execute-api.localhost.localstack.cloud:4566`
                : ( api.ApiEndpoint ?? "" );

            apis.push( { apiId, name: api.Name, protocol: api.ProtocolType, endpoint, routes, integrations } );
        }

        const { Items: linkItems = [] } = await gw.send( new GetVpcLinksCommand( {} ) );
        for ( const link of linkItems )
            vpcLinks.push( { id: link.VpcLinkId ?? "?", name: link.Name, status: link.VpcLinkStatus } );
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
    diagnosis : Pick<VpcLinkDiagnosis, "targetKind" | "services" | "targetGroups" | "loadBalancers" | "vpcLinks" | "apis"> )
    : Array<DiagFinding>
{
    const findings : Array<DiagFinding> = [];

    const runningTasks : number = diagnosis.services.reduce( ( total, service ) => total + service.running, 0 );
    const registered : Array<DiagTarget> = diagnosis.targetGroups.flatMap( ( targetGroup ) => targetGroup.targets );
    const healthy : number = registered.filter( ( target ) => /healthy/i.test( target.state ) ).length;

    // ECS layer
    if ( diagnosis.services.length === 0 )
        findings.push( { level: "warn", title: "No ECS services found", detail: "Nothing is deployed to ECS for the active target, so there's no backend to reach." } );
    else if ( runningTasks === 0 )
        findings.push( { level: "error", title: "ECS services have 0 running tasks", detail: `${diagnosis.services.length} service(s) found, but none have a running task. The app can't be reached until a task is Running.` } );
    else
        findings.push( { level: "ok", title: `${runningTasks} ECS task(s) running`, detail: `Across ${diagnosis.services.length} service(s). The application layer is up.` } );

    // ALB target registration — the crux of the gateway → ALB → ECS path
    if ( diagnosis.targetGroups.length === 0 )
        findings.push( { level: "warn", title: "No ALB target groups found", detail: "Without a target group the ALB has nothing to forward to. Expected one per ECS service behind the ALB." } );
    else if ( runningTasks > 0 && registered.length === 0 )
        findings.push( {
            level  : "error",
            title  : "ECS tasks are running but NOT registered in any ALB target group",
            detail : "This breaks the gateway → VpcLink → ALB → ECS path: the ALB has no backend to forward to. " +
                     ( diagnosis.targetKind === TargetKind.LOCALSTACK
                         ? "On LocalStack this is the common data-path gap — task→target-group registration isn't exercised. This is strong evidence to share with support."
                         : "On real AWS, check the service's load-balancer config, target group, and that the task is in a subnet the ALB can reach." )
        } );
    else if ( registered.length > 0 && healthy === 0 )
        findings.push( {
            level  : "error",
            title  : "Targets are registered but none are healthy",
            detail : `Target states: ${[ ...new Set( registered.map( ( target ) => target.state ) ) ].join( ", " )}. The ALB won't forward to unhealthy targets, so the gateway gets a 5xx.`
        } );
    else if ( healthy > 0 )
        findings.push( { level: "ok", title: `${healthy} healthy target(s) registered in the ALB`, detail: "The ALB has live backends — the ALB → ECS hop should work." } );

    // VpcLink
    const badLinks : Array<DiagVpcLink> = diagnosis.vpcLinks.filter( ( link ) => link.status && !/AVAILABLE/i.test( link.status ) );
    if ( diagnosis.vpcLinks.length === 0 )
        findings.push( { level: "warn", title: "No VpcLink found", detail: "The HTTP API needs a VpcLink to reach a private (internal) ALB." } );
    else if ( badLinks.length > 0 )
        findings.push( { level: "warn", title: "VpcLink not AVAILABLE", detail: badLinks.map( ( link ) => `${link.id}: ${link.status}` ).join( ", " ) } );
    else
        findings.push( { level: "ok", title: `${diagnosis.vpcLinks.length} VpcLink(s) AVAILABLE`, detail: "" } );

    // API Gateway private integration
    const privInts : Array<DiagIntegration> = diagnosis.apis.flatMap( ( api ) => api.integrations ).filter( ( integration ) => /VPC_LINK/i.test( integration.connectionType ?? "" ) );
    if ( diagnosis.apis.length === 0 )
        findings.push( { level: "warn", title: "No HTTP APIs found", detail: "No API Gateway API for the active target." } );
    else if ( privInts.length === 0 )
        findings.push( { level: "warn", title: "No VPC_LINK integration on any API", detail: "Expected an integration with connectionType VPC_LINK pointing at the internal ALB listener." } );
    else
        findings.push( { level: "ok", title: `${privInts.length} VPC_LINK integration(s) configured`, detail: "API routes are wired to the ALB via the VpcLink." } );

    // LocalStack caveat — the two checks support often suggests don't apply here
    if ( diagnosis.targetKind === TargetKind.LOCALSTACK )
        findings.push( {
            level  : "ok",
            title  : "Note: SG / VPC-reachability checks don't apply on LocalStack",
            detail : "LocalStack doesn't enforce security groups or simulate real VPC networking, so those troubleshooting steps can't prove anything here. Focus on target registration + the trace log."
        } );

    return findings;
}

/** Reduce an ARN to its final "/"-delimited segment (its short name), or "?" when absent. */
function shortArn( arn : string | undefined ) : string
{
    if ( !arn ) return "?";
    const slash : number = arn.lastIndexOf( "/" );
    return slash >= 0 ? arn.slice( slash + 1 ) : arn;
}
