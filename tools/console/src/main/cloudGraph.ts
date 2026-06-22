import { request, type ClientRequest } from "node:http";
import {
    DescribeStackResourcesCommand, DescribeStacksCommand, GetTemplateCommand, type DescribeStacksCommandOutput
} from "@aws-sdk/client-cloudformation";
import { FilterLogEventsCommand, type FilterLogEventsCommandOutput } from "@aws-sdk/client-cloudwatch-logs";
import { ListObjectsV2Command, type ListObjectsV2CommandOutput } from "@aws-sdk/client-s3";
import { GetApiCommand, GetRoutesCommand } from "@aws-sdk/client-apigatewayv2";
import { DescribeServicesCommand, type DescribeServicesCommandOutput } from "@aws-sdk/client-ecs";

import type {
    ApiGwInfo, CloudCategory, CloudEdge, CloudGraph, CloudHealth, CloudNode, EcsServiceState, LogEvent, S3Listing, Target
} from "../shared/types";
import { apigwClient, awsErr, cfnClient, ecsClient, getTarget, logsClient, s3Client } from "./aws";

//
// LocalStack monitor — derives the architecture graph from the DEPLOYED CloudFormation stacks:
// each stack resource becomes a node, and template references (Ref / Fn::GetAtt / DependsOn) become
// edges. Noisy plumbing (IAM, SG rules, route tables, custom resources, metadata) is filtered out so
// the graph reads as an architecture, not a wiring dump. Layout happens in the renderer (dagre).
//

// ── type → {friendly label, category} for the resources we surface ─────────────────────────────
const TYPE_MAP : Record<string, { label : string; category : CloudCategory }> =
{
    "AWS::CloudFront::Distribution"          : { label: "CloudFront",        category: "edge" },
    "AWS::ApiGatewayV2::Api"                 : { label: "API Gateway",       category: "edge" },
    "AWS::ApiGateway::RestApi"               : { label: "API Gateway",       category: "edge" },
    "AWS::WAFv2::WebACL"                      : { label: "WAF",               category: "edge" },
    "AWS::Route53::RecordSet"                : { label: "Route53 Record",    category: "edge" },
    "AWS::ElasticLoadBalancingV2::LoadBalancer" : { label: "ALB",            category: "network" },
    "AWS::EC2::VPC"                          : { label: "VPC",               category: "network" },
    "AWS::ECS::Cluster"                      : { label: "ECS Cluster",       category: "compute" },
    "AWS::ECS::Service"                      : { label: "ECS Service",       category: "compute" },
    "AWS::Lambda::Function"                  : { label: "Lambda",            category: "compute" },
    "AWS::Batch::JobDefinition"              : { label: "Batch Job",         category: "compute" },
    "AWS::Batch::ComputeEnvironment"         : { label: "Batch Compute",     category: "compute" },
    "AWS::SQS::Queue"                        : { label: "SQS Queue",         category: "messaging" },
    "AWS::SNS::Topic"                        : { label: "SNS Topic",         category: "messaging" },
    "AWS::Events::EventBus"                  : { label: "EventBridge",       category: "messaging" },
    "AWS::MSK::Cluster"                      : { label: "MSK (Kafka)",       category: "messaging" },
    "AWS::MSK::ServerlessCluster"            : { label: "MSK Serverless",    category: "messaging" },
    "AWS::Kinesis::Stream"                   : { label: "Kinesis",           category: "messaging" },
    "AWS::DynamoDB::Table"                   : { label: "DynamoDB Table",    category: "data" },
    "AWS::S3::Bucket"                        : { label: "S3 Bucket",         category: "data" },
    "AWS::OpenSearchService::Domain"         : { label: "OpenSearch",        category: "data" },
    "AWS::Elasticsearch::Domain"             : { label: "OpenSearch",        category: "data" },
    "AWS::RDS::DBCluster"                    : { label: "Aurora Cluster",    category: "data" },
    "AWS::RDS::DBInstance"                   : { label: "RDS Instance",      category: "data" },
    "AWS::ElastiCache::CacheCluster"         : { label: "ElastiCache",       category: "data" },
    "AWS::ElastiCache::ReplicationGroup"     : { label: "ElastiCache",       category: "data" },
    "AWS::Cognito::UserPool"                 : { label: "Cognito Pool",      category: "identity" },
    "AWS::SecretsManager::Secret"            : { label: "Secret",            category: "identity" },
    "AWS::AppConfig::Application"            : { label: "AppConfig",         category: "identity" },
    "AWS::AppConfig::Environment"            : { label: "AppConfig Env",     category: "identity" }
};

// noisy/low-level types we drop so the graph stays architectural
const DENY = [
    /^AWS::IAM::/, /^AWS::CDK::/, /^Custom::/, /^AWS::CloudFormation::/,
    /^AWS::Lambda::(Permission|EventSourceMapping|Version|Alias|LayerVersion)$/,
    /^AWS::EC2::(SecurityGroup|SecurityGroupIngress|SecurityGroupEgress|Route$|RouteTable|Subnet|SubnetRouteTableAssociation|InternetGateway|VPCGatewayAttachment|EIP|NatGateway|VPCEndpoint|NetworkAcl|SubnetNetworkAclAssociation|FlowLog|DHCPOptions|VPCDHCPOptionsAssociation)/,
    /^AWS::ElasticLoadBalancingV2::(Listener|ListenerRule|TargetGroup)$/,
    /^AWS::ApiGatewayV2::(Stage|Route|Integration|Authorizer|Deployment|ApiMapping)$/,
    /^AWS::ApiGateway::(Stage|Resource|Method|Deployment|Authorizer)$/,
    /^AWS::ECS::TaskDefinition$/, /^AWS::Logs::/, /^AWS::CloudWatch::/,
    /^AWS::SNS::Subscription$/, /^AWS::Events::Rule$/, /^AWS::Cognito::UserPoolClient$/,
    /^AWS::AppConfig::(ConfigurationProfile|HostedConfigurationVersion|Deployment|DeploymentStrategy)$/,
    /^AWS::ApplicationAutoScaling::/, /^AWS::SSM::Parameter$/, /^AWS::Route53::HostedZone$/
];

function dropped( type : string ) : boolean { return DENY.some( ( re ) => re.test( type ) ); }

function classify( type : string ) : { label : string; category : CloudCategory }
{
    const known : { label : string; category : CloudCategory } | undefined = TYPE_MAP[ type ];
    if ( known ) return known;
    // unknown but kept: derive a label from the last segment, category "other"
    const seg : string = type.split( "::" ).pop() ?? type;
    return { label: seg, category: "other" };
}

// ── CFN shapes (only the fields we read) ────────────────────────────────────────────────────────
interface TemplateResource { Type : string; Properties? : unknown; DependsOn? : string | string[]; }
interface Template { Resources? : Record<string, TemplateResource>; }

/** Build the full cloud graph from the deployed stacks. */
export async function cloudGraph() : Promise<CloudGraph>
{
    const ts : number = Date.now();
    const cfn : ReturnType<typeof cfnClient> = cfnClient();

    let stackNames : string[];
    try
    {
        const out : DescribeStacksCommandOutput = await cfn.send( new DescribeStacksCommand( {} ) );
        // de-dupe — DescribeStacks can list the same stack name more than once (nested/versioned)
        stackNames = [ ...new Set( ( out.Stacks ?? [] ).map( ( s ) => s.StackName ).filter( ( n ) : n is string => Boolean( n ) ) ) ];
    }
    catch ( err )
    {
        return { stacks: [], nodes: [], edges: [], error: awsErr( err ), ts };
    }

    if ( stackNames.length === 0 )
        return { stacks: [], nodes: [], edges: [], error: "no deployed stacks found — deploy a service to LocalStack first (cdklocal).", ts };

    const nodes : CloudNode[] = [];
    const edges : CloudEdge[] = [];

    for ( const stack of stackNames )
        await collectStack( stack, nodes, edges );

    return { stacks: stackNames, nodes, edges, ts };
}

async function collectStack( stack : string, nodes : CloudNode[], edges : CloudEdge[] ) : Promise<void>
{
    const cfn : ReturnType<typeof cfnClient> = cfnClient();

    let resources : { LogicalResourceId? : string; PhysicalResourceId? : string; ResourceType? : string; ResourceStatus? : string }[];
    try { resources = ( await cfn.send( new DescribeStackResourcesCommand( { StackName: stack } ) ) ).StackResources ?? []; }
    catch { return; }

    const kept = resources.filter( ( r ) => r.ResourceType && r.LogicalResourceId && !dropped( r.ResourceType ) );
    if ( kept.length === 0 ) return;

    const keptIds = new Set( kept.map( ( r ) => r.LogicalResourceId! ) );
    const nodeId = ( logicalId : string ) : string => `${stack}/${logicalId}`;

    for ( const r of kept )
    {
        const { label, category } = classify( r.ResourceType! );
        nodes.push( {
            id         : nodeId( r.LogicalResourceId! ),
            stack,
            logicalId  : r.LogicalResourceId!,
            type       : r.ResourceType!,
            typeLabel  : label,
            category,
            physicalId : r.PhysicalResourceId,
            status     : r.ResourceStatus,
            logGroup   : r.ResourceType === "AWS::Lambda::Function" && r.PhysicalResourceId
                ? `/aws/lambda/${r.PhysicalResourceId}`
                : undefined
        } );
    }

    // edges from the template's references (only between kept nodes in this stack)
    let body : string | undefined;
    try { body = ( await cfn.send( new GetTemplateCommand( { StackName: stack } ) ) ).TemplateBody; }
    catch { return; }

    const template : Template | undefined = parseTemplate( body );
    if ( !template?.Resources ) return;

    for ( const [ logicalId, def ] of globalThis.Object.entries( template.Resources ) )
    {
        if ( !keptIds.has( logicalId ) ) continue;
        const refs : Set<string> = new Set<string>();
        collectRefs( def.Properties, refs );
        for ( const d of toArray( def.DependsOn ) ) refs.add( d );

        for ( const ref of refs )
            if ( ref !== logicalId && keptIds.has( ref ) )
                edges.push( { from: nodeId( logicalId ), to: nodeId( ref ) } );
    }
}

function parseTemplate( body : Template | string | undefined ) : Template | undefined
{
    if ( !body ) return undefined;
    if ( typeof body === "string" )
    {
        try { return JSON.parse( body ) as Template; } catch { return undefined; }
    }
    return body;
}

function toArray( v : string | string[] | undefined ) : string[]
{
    return v === undefined ? [] : Array.isArray( v ) ? v : [ v ];
}

/** Recursively collect logical ids referenced via Ref / Fn::GetAtt anywhere in a Properties tree. */
function collectRefs( value : unknown, into : Set<string> ) : void
{
    if ( !value || typeof value !== "object" ) return;

    if ( Array.isArray( value ) ) { for ( const v of value ) collectRefs( v, into ); return; }

    const obj : Record<string, unknown> = value as Record<string, unknown>;
    for ( const [ key, v ] of globalThis.Object.entries( obj ) )
    {
        if ( key === "Ref" && typeof v === "string" ) into.add( v );
        else if ( key === "Fn::GetAtt" )
        {
            if ( Array.isArray( v ) && typeof v[ 0 ] === "string" ) into.add( v[ 0 ] );
            else if ( typeof v === "string" ) into.add( v.split( "." )[ 0 ] );
        }
        else collectRefs( v, into );
    }
}

// ── reachability / health (target-aware) ────────────────────────────────────────────────────────
export async function cloudHealth() : Promise<CloudHealth>
{
    // real AWS has no /_localstack/health — probe with a cheap CloudFormation call instead
    if ( getTarget().kind === "aws" )
    {
        const ts : number = Date.now();
        const t : Target = getTarget();
        try
        {
            await cfnClient().send( new DescribeStacksCommand( {} ) );
            return { reachable: true, services: {}, edition: `${t.profile ?? "default"} · ${t.region ?? ""}`, ts };
        }
        catch ( err )
        {
            return { reachable: false, services: {}, edition: `${t.profile ?? "default"} · ${t.region ?? ""}`, error: awsErr( err ), ts };
        }
    }
    return localstackHealth();
}

function localstackHealth() : Promise<CloudHealth>
{
    const ts : number = Date.now();
    return new Promise<CloudHealth>( ( resolve ) =>
    {
        const req : ClientRequest = request( "http://localhost:4566/_localstack/health", { method: "GET", timeout: 2500 }, ( res ) =>
        {
            const chunks : Buffer[] = [];
            res.on( "data", ( c : Buffer ) => chunks.push( c ) );
            res.on( "end", () =>
            {
                try
                {
                    const json : { services? : Record<string, string>; edition? : string } = JSON.parse( Buffer.concat( chunks ).toString( "utf8" ) ) as { services? : Record<string, string>; edition? : string };
                    resolve( { reachable: true, services: json.services ?? {}, edition: json.edition, ts } );
                }
                catch ( err ) { resolve( { reachable: false, services: {}, error: ( err as Error ).message, ts } ); }
            } );
        } );
        req.on( "timeout", () => { req.destroy(); resolve( { reachable: false, services: {}, error: "timeout", ts } ); } );
        req.on( "error", ( err ) => resolve( { reachable: false, services: {}, error: err.message, ts } ) );
        req.end();
    } );
}

// ── S3 bucket browse (folder-style, delimiter "/") ──────────────────────────────────────────────
export async function s3List( bucket : string, prefix = "" ) : Promise<S3Listing>
{
    try
    {
        const out : ListObjectsV2CommandOutput = await s3Client().send( new ListObjectsV2Command( {
            Bucket    : bucket,
            Prefix    : prefix,
            Delimiter : "/",
            MaxKeys   : 1000
        } ) );

        const folders = ( out.CommonPrefixes ?? [] )
            .map( ( p ) => p.Prefix ?? "" )
            .filter( ( p ) => p.length > 0 );

        const objects = ( out.Contents ?? [] )
            .filter( ( o ) => ( o.Key ?? "" ) !== prefix ) // drop the folder placeholder key itself
            .map( ( o ) => ( { key: o.Key ?? "", size: o.Size ?? 0, lastModified: o.LastModified?.toISOString() } ) );

        return { bucket, prefix, folders, objects, truncated: Boolean( out.IsTruncated ) };
    }
    catch ( err )
    {
        return { bucket, prefix, folders: [], objects: [], truncated: false, error: awsErr( err ) };
    }
}

// ── API Gateway (HTTP API v2) — registered routes ───────────────────────────────────────────────
export async function apigwRoutes( apiId : string ) : Promise<ApiGwInfo>
{
    try
    {
        const apigw : ReturnType<typeof apigwClient> = apigwClient();
        const [ api, routes ] = await Promise.all( [
            apigw.send( new GetApiCommand( { ApiId: apiId } ) ),
            apigw.send( new GetRoutesCommand( { ApiId: apiId, MaxResults: "500" } ) )
        ] );

        return {
            apiId,
            name     : api.Name,
            protocol : api.ProtocolType,
            endpoint : api.ApiEndpoint,
            routes   : ( routes.Items ?? [] ).map( ( r ) => ( { routeKey: r.RouteKey ?? "", target: r.Target } ) )
                .sort( ( a, b ) => a.routeKey.localeCompare( b.routeKey ) )
        };
    }
    catch ( err )
    {
        return { apiId, routes: [], error: awsErr( err ) };
    }
}

// ── ECS service live state (DescribeServices) ───────────────────────────────────────────────────
export async function ecsService( serviceArn : string ) : Promise<EcsServiceState>
{
    // arn:aws:ecs:<region>:<acct>:service/<cluster>/<service> — DescribeServices needs the cluster
    const parts : string[] = serviceArn.split( "/" );
    const cluster : string | undefined = parts.length >= 3 ? parts[ parts.length - 2 ] : undefined;

    try
    {
        const out : DescribeServicesCommandOutput = await ecsClient().send( new DescribeServicesCommand( { cluster, services: [ serviceArn ] } ) );
        const sv : NonNullable<DescribeServicesCommandOutput[ "services" ]>[ number ] | undefined = out.services?.[ 0 ];
        if ( !sv ) return { error: "service not found" };
        return { status: sv.status, desiredCount: sv.desiredCount, runningCount: sv.runningCount, pendingCount: sv.pendingCount };
    }
    catch ( err )
    {
        return { error: awsErr( err ) };
    }
}

// ── CloudWatch log tail ───────────────────────────────────────────────────────────────────────
export async function cloudTail( logGroup : string, limit = 200 ) : Promise<{ events : LogEvent[]; error? : string }>
{
    try
    {
        const out : FilterLogEventsCommandOutput = await logsClient().send( new FilterLogEventsCommand( { logGroupName: logGroup, limit } ) );
        const events = ( out.events ?? [] )
            .map( ( e ) => ( { ts: e.timestamp ?? 0, message: ( e.message ?? "" ).slice( 0, 4000 ) } ) )
            .sort( ( a, b ) => a.ts - b.ts );
        return { events };
    }
    catch ( err )
    {
        return { events: [], error: awsErr( err ) };
    }
}
