import { request, type ClientRequest } from "node:http";
import {
    DescribeStackResourcesCommand, DescribeStacksCommand, GetTemplateCommand, type DescribeStacksCommandOutput
} from "@aws-sdk/client-cloudformation";
import { FilterLogEventsCommand, type FilterLogEventsCommandOutput } from "@aws-sdk/client-cloudwatch-logs";
import { ListObjectsV2Command, type ListObjectsV2CommandOutput, ListBucketsCommand, HeadObjectCommand, type HeadObjectCommandOutput, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { GetApiCommand, GetRoutesCommand } from "@aws-sdk/client-apigatewayv2";
import { DescribeServicesCommand, type DescribeServicesCommandOutput } from "@aws-sdk/client-ecs";

import type {
    ApiGwInfo, CloudCategory, CloudEdge, CloudGraph, CloudHealth, CloudNode, EcsServiceState, LogEvent, S3Listing, S3ObjectHead, Target
} from "../shared/types";
import { TargetKind } from "../shared/types";
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

/** True if a resource type matches one of the noisy/low-level DENY patterns and should be hidden. */
function dropped( type : string ) : boolean { return DENY.some( ( pattern ) => pattern.test( type ) ); }

/** Map a CFN resource type to its friendly label + category, falling back for unknown types. */
function classify( type : string ) : { label : string; category : CloudCategory }
{
    const known : { label : string; category : CloudCategory } | undefined = TYPE_MAP[ type ];
    if ( known ) return known;
    // unknown but kept: derive a label from the last segment, category "other"
    const lastSegment : string = type.split( "::" ).pop() ?? type;
    return { label: lastSegment, category: "other" };
}

// ── CFN shapes (only the fields we read) ────────────────────────────────────────────────────────
interface TemplateResource { Type : string; Properties? : unknown; DependsOn? : string | Array<string>; }
interface Template { Resources? : Record<string, TemplateResource>; }

/** Build the full cloud graph from the deployed stacks. */
export async function cloudGraph() : Promise<CloudGraph>
{
    const ts : number = Date.now();
    const cfn : ReturnType<typeof cfnClient> = cfnClient();

    let stackNames : Array<string>;
    try
    {
        const out : DescribeStacksCommandOutput = await cfn.send( new DescribeStacksCommand( {} ) );
        // de-dupe — DescribeStacks can list the same stack name more than once (nested/versioned)
        stackNames = [ ...new Set( ( out.Stacks ?? [] ).map( ( stack ) => stack.StackName ).filter( ( name ) : name is string => Boolean( name ) ) ) ];
    }
    catch ( err )
    {
        return { stacks: [], nodes: [], edges: [], error: awsErr( err ), ts };
    }

    if ( stackNames.length === 0 )
        return { stacks: [], nodes: [], edges: [], error: "no deployed stacks found — deploy a service to LocalStack first (cdklocal).", ts };

    const nodes : Array<CloudNode> = [];
    const edges : Array<CloudEdge> = [];

    for ( const stack of stackNames )
        await collectStack( stack, nodes, edges );

    return { stacks: stackNames, nodes, edges, ts };
}

/** Append one stack's kept resources (as nodes) and its template references (as edges). */
async function collectStack( stack : string, nodes : Array<CloudNode>, edges : Array<CloudEdge> ) : Promise<void>
{
    const cfn : ReturnType<typeof cfnClient> = cfnClient();

    let resources : { LogicalResourceId? : string; PhysicalResourceId? : string; ResourceType? : string; ResourceStatus? : string }[];
    try { resources = ( await cfn.send( new DescribeStackResourcesCommand( { StackName: stack } ) ) ).StackResources ?? []; }
    catch { return; }

    // keep only typed, named resources that aren't on the DENY list
    const kept : typeof resources = resources.filter( ( resource ) => resource.ResourceType && resource.LogicalResourceId && !dropped( resource.ResourceType ) );
    if ( kept.length === 0 ) return;

    const keptIds : Set<string> = new Set( kept.map( ( resource ) => resource.LogicalResourceId! ) );
    const nodeId = ( logicalId : string ) : string => `${stack}/${logicalId}`;

    for ( const resource of kept )
    {
        const { label, category } = classify( resource.ResourceType! );
        nodes.push( {
            id         : nodeId( resource.LogicalResourceId! ),
            stack,
            logicalId  : resource.LogicalResourceId!,
            type       : resource.ResourceType!,
            typeLabel  : label,
            category,
            physicalId : resource.PhysicalResourceId,
            status     : resource.ResourceStatus,
            logGroup   : resource.ResourceType === "AWS::Lambda::Function" && resource.PhysicalResourceId
                ? `/aws/lambda/${resource.PhysicalResourceId}`
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
        // explicit DependsOn entries are references too
        for ( const dependency of toArray( def.DependsOn ) ) refs.add( dependency );

        for ( const ref of refs )
            if ( ref !== logicalId && keptIds.has( ref ) )
                edges.push( { from: nodeId( logicalId ), to: nodeId( ref ) } );
    }
}

/** Coerce a TemplateBody (string JSON or already-parsed object) into a Template, or undefined. */
function parseTemplate( body : Template | string | undefined ) : Template | undefined
{
    if ( !body ) return undefined;
    if ( typeof body === "string" )
    {
        try { return JSON.parse( body ) as Template; } catch { return undefined; }
    }
    return body;
}

/** Normalize an optional scalar-or-array DependsOn value into an array. */
function toArray( value : string | Array<string> | undefined ) : Array<string>
{
    return value === undefined ? [] : Array.isArray( value ) ? value : [ value ];
}

/** Recursively collect logical ids referenced via Ref / Fn::GetAtt anywhere in a Properties tree. */
function collectRefs( value : unknown, into : Set<string> ) : void
{
    if ( !value || typeof value !== "object" ) return;

    if ( Array.isArray( value ) ) { for ( const item of value ) collectRefs( item, into ); return; }

    const obj : Record<string, unknown> = value as Record<string, unknown>;
    for ( const [ key, child ] of globalThis.Object.entries( obj ) )
    {
        // { "Ref": "LogicalId" } — direct reference to another resource
        if ( key === "Ref" && typeof child === "string" ) into.add( child );
        else if ( key === "Fn::GetAtt" )
        {
            // Fn::GetAtt is either [ "LogicalId", "Attribute" ] or the "LogicalId.Attribute" string form
            if ( Array.isArray( child ) && typeof child[ 0 ] === "string" ) into.add( child[ 0 ] );
            else if ( typeof child === "string" ) into.add( child.split( "." )[ 0 ] );
        }
        else collectRefs( child, into );
    }
}

// ── reachability / health (target-aware) ────────────────────────────────────────────────────────
/** Probe whether the active target is reachable; AWS via a cheap CFN call, LocalStack via its health endpoint. */
export async function cloudHealth() : Promise<CloudHealth>
{
    // real AWS has no /_localstack/health — probe with a cheap CloudFormation call instead
    if ( getTarget().kind === TargetKind.AWS )
    {
        const ts : number = Date.now();
        const awsTarget : Target = getTarget();
        try
        {
            await cfnClient().send( new DescribeStacksCommand( {} ) );
            return { reachable: true, services: {}, edition: `${awsTarget.profile ?? "default"} · ${awsTarget.region ?? ""}`, ts };
        }
        catch ( err )
        {
            return { reachable: false, services: {}, edition: `${awsTarget.profile ?? "default"} · ${awsTarget.region ?? ""}`, error: awsErr( err ), ts };
        }
    }
    return localstackHealth();
}

/** GET LocalStack's /_localstack/health (with a short timeout) and parse the services map + edition. */
function localstackHealth() : Promise<CloudHealth>
{
    const ts : number = Date.now();
    return new Promise<CloudHealth>( ( resolve ) =>
    {
        const req : ClientRequest = request( "http://localhost:4566/_localstack/health", { method: "GET", timeout: 2500 }, ( res ) =>
        {
            const chunks : Array<Buffer> = [];
            res.on( "data", ( chunk : Buffer ) => chunks.push( chunk ) );
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
/** List one "folder" of a bucket: immediate sub-prefixes as folders, plus the objects at this prefix. */
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

        // CommonPrefixes are the immediate "sub-folders" under the current prefix
        const folders : Array<string> = ( out.CommonPrefixes ?? [] )
            .map( ( commonPrefix ) => commonPrefix.Prefix ?? "" )
            .filter( ( folderPrefix ) => folderPrefix.length > 0 );

        const objects = ( out.Contents ?? [] )
            .filter( ( object ) => ( object.Key ?? "" ) !== prefix ) // drop the folder placeholder key itself
            .map( ( object ) => ( { key: object.Key ?? "", size: object.Size ?? 0, lastModified: object.LastModified?.toISOString() } ) );

        return { bucket, prefix, folders, objects, truncated: Boolean( out.IsTruncated ) };
    }
    catch ( err )
    {
        return { bucket, prefix, folders: [], objects: [], truncated: false, error: awsErr( err ) };
    }
}

// ── bucket list (optionally filtered to a service) ──────────────────────────────────────────────
/** Every bucket name, newest-looking first. When `match` is given, buckets whose name contains it
 *  (case-insensitive, e.g. the service id "media") sort to the front — the rest still follow so a
 *  differently-named bucket is still reachable. */
export async function s3Buckets( match = "" ) : Promise<Array<string>>
{
    try
    {
        const out = await s3Client().send( new ListBucketsCommand( {} ) );
        const names : Array<string> = ( out.Buckets ?? [] ).map( ( bucket ) => bucket.Name ?? "" ).filter( ( name ) => name.length > 0 );
        const needle : string = match.toLowerCase();
        if ( !needle ) return names.sort();
        return names.sort( ( a, b ) =>
        {
            const aMatch : number = a.toLowerCase().includes( needle ) ? 0 : 1;
            const bMatch : number = b.toLowerCase().includes( needle ) ? 0 : 1;
            return aMatch !== bMatch ? aMatch - bMatch : a.localeCompare( b );
        } );
    }
    catch { return []; }
}

// ── one object's metadata (HeadObject) ──────────────────────────────────────────────────────────
/** HeadObject for a single key — size, content type, timestamps, storage class, and user metadata. */
export async function s3Head( bucket : string, key : string ) : Promise<S3ObjectHead>
{
    try
    {
        const out : HeadObjectCommandOutput = await s3Client().send( new HeadObjectCommand( { Bucket: bucket, Key: key } ) );
        return {
            key,
            size         : out.ContentLength ?? 0,
            lastModified : out.LastModified?.toISOString(),
            contentType  : out.ContentType,
            etag         : out.ETag,
            storageClass : out.StorageClass,
            versionId    : out.VersionId,
            metadata     : out.Metadata ?? {}
        };
    }
    catch ( err )
    {
        return { key, size: 0, error: awsErr( err ) };
    }
}

// ── presigned GET url (preview / download; read-only, safe on real AWS) ───────────────────────────
/** A short-lived pre-signed GET URL so the renderer can preview (img/video) or download an object
 *  directly — bytes never transit the console process. */
export async function s3PresignGet( bucket : string, key : string, ttlSec = 300 ) : Promise<string>
{
    try
    {
        return await getSignedUrl( s3Client(), new GetObjectCommand( { Bucket: bucket, Key: key } ), { expiresIn: ttlSec } );
    }
    catch { return ""; }
}

// ── API Gateway (HTTP API v2) — registered routes ───────────────────────────────────────────────
/** Fetch an HTTP API's metadata plus its routes (sorted by route key) for the API view. */
export async function apigwRoutes( apiId : string ) : Promise<ApiGwInfo>
{
    try
    {
        const apigw : ReturnType<typeof apigwClient> = apigwClient();
        // metadata + routes are independent calls, so issue them together
        const [ api, routes ] = await Promise.all( [
            apigw.send( new GetApiCommand( { ApiId: apiId } ) ),
            apigw.send( new GetRoutesCommand( { ApiId: apiId, MaxResults: "500" } ) )
        ] );

        return {
            apiId,
            name     : api.Name,
            protocol : api.ProtocolType,
            endpoint : api.ApiEndpoint,
            routes   : ( routes.Items ?? [] ).map( ( route ) => ( { routeKey: route.RouteKey ?? "", target: route.Target } ) )
                .sort( ( left, right ) => left.routeKey.localeCompare( right.routeKey ) )
        };
    }
    catch ( err )
    {
        return { apiId, routes: [], error: awsErr( err ) };
    }
}

// ── ECS service live state (DescribeServices) ───────────────────────────────────────────────────
/** Read one ECS service's live desired/running/pending counts (cluster is derived from the ARN). */
export async function ecsService( serviceArn : string ) : Promise<EcsServiceState>
{
    // arn:aws:ecs:<region>:<acct>:service/<cluster>/<service> — DescribeServices needs the cluster
    const parts : Array<string> = serviceArn.split( "/" );
    const cluster : string | undefined = parts.length >= 3 ? parts[ parts.length - 2 ] : undefined;

    try
    {
        const out : DescribeServicesCommandOutput = await ecsClient().send( new DescribeServicesCommand( { cluster, services: [ serviceArn ] } ) );
        const service : NonNullable<DescribeServicesCommandOutput[ "services" ]>[ number ] | undefined = out.services?.[ 0 ];
        if ( !service ) return { error: "service not found" };
        return { status: service.status, desiredCount: service.desiredCount, runningCount: service.runningCount, pendingCount: service.pendingCount };
    }
    catch ( err )
    {
        return { error: awsErr( err ) };
    }
}

// ── CloudWatch log tail ───────────────────────────────────────────────────────────────────────
/** Tail a CloudWatch log group: most recent `limit` events, message-clamped and sorted oldest-first. */
export async function cloudTail( logGroup : string, limit = 200 ) : Promise<{ events : Array<LogEvent>; error? : string }>
{
    try
    {
        const out : FilterLogEventsCommandOutput = await logsClient().send( new FilterLogEventsCommand( { logGroupName: logGroup, limit } ) );
        const events = ( out.events ?? [] )
            // clamp very long messages so the renderer stays responsive
            .map( ( event ) => ( { ts: event.timestamp ?? 0, message: ( event.message ?? "" ).slice( 0, 4000 ) } ) )
            .sort( ( left, right ) => left.ts - right.ts );
        return { events };
    }
    catch ( err )
    {
        return { events: [], error: awsErr( err ) };
    }
}
