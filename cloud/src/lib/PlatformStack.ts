//
// PlatformStack — shared, foundational infrastructure that service stacks depend on:
// the VPC (handed to ServiceStacks for RDS / ECS / ElastiCache) and the MSK (Kafka)
// cluster. Built once per environment from the PlatformManifest.
//
import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as msk from "aws-cdk-lib/aws-msk";
import * as opensearch from "aws-cdk-lib/aws-opensearchservice";
import * as oss from "aws-cdk-lib/aws-opensearchserverless";
import * as cloudtrail from "aws-cdk-lib/aws-cloudtrail";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as sqs from "aws-cdk-lib/aws-sqs";
import { Environment, PlatformManifest, KafkaClusterSpec, SearchClusterSpec, CloudTrailSpec, SecretSpec, forEnv, physicalName, ResourceKind } from "@repo/cloud-manifest";
import { mskInstanceType, searchInstanceType } from "./sizing";
import { isLocal } from "./local";

export interface PlatformStackProps extends cdk.StackProps
{
    manifest  : PlatformManifest;
    deployEnv : Environment;
}

/**
 * Shared, foundational infrastructure built once per environment: the VPC (handed to each
 * ServiceStack for RDS / ECS / ElastiCache), the MSK (Kafka) cluster, the OpenSearch
 * cluster, and the CloudTrail audit trail.
 */
export class PlatformStack extends cdk.Stack
{
    /** The shared VPC, passed to ServiceStacks for their networked resources. */
    public readonly vpc : ec2.IVpc;

    /** Platform-shared secrets (logical key → secret), passed to every ServiceStack for read-grant +
     *  ARN injection. The AI provider keys (OpenAI, Anthropic, …) live here — see PlatformManifest.secrets. */
    public readonly secrets : Map<string, secretsmanager.ISecret> = new Map();

    /** The platform-shared AUDIT ingestion queue (+ its DLQ) — the SOLE path every service's
     *  `Application.audit()` enqueues to. Fixed platform infra (like the VPC), not manifest-driven: EVERY
     *  ServiceStack is granted send + gets its URL injected (see `ServiceStack.usePlatformQueue`), and the
     *  `audit` service's own `AuditSinkJob` binds its SQS trigger to this SAME construct (imported back via
     *  `ServiceStackProps.platformAuditQueue`) rather than owning a second, colliding queue of its own. */
    public readonly auditQueue : sqs.IQueue;
    public readonly auditDlq   : sqs.IQueue;

    /** The shared OpenSearch endpoint + collection/domain ARN, set by `makeSearch` when
     *  `manifest.searchCluster` is configured. Passed to every ServiceStack (ambient, like `secrets`/
     *  `auditQueue` above) so a service that declares `uses: [{ kind: SEARCH }]` can inject
     *  `SEARCH_<KEY>` + be IAM-granted `aoss:APIAccessAll` on it — see `ServiceStack.grantUses`. */
    public searchEndpoint?      : string;
    public searchCollectionArn? : string;

    /**
     * @param scope CDK construct scope
     * @param id    stack id
     * @param props the PlatformManifest + target environment
     */
    constructor( scope : Construct, id : string, props : PlatformStackProps )
    {
        super( scope, id, props );
        const m : PlatformManifest = props.manifest;
        const local : boolean = isLocal( props.deployEnv );

        // Platform-shared secrets (AI provider keys, …) — provisioned once here; every ServiceStack is
        // granted read + gets the ARN injected. Created empty; the value is set by a root op (root API /
        // `awslocal secretsmanager put-secret-value`), never committed.
        ( m.secrets ?? [] ).forEach( ( spec : SecretSpec ) => this.makeSecret( props.deployEnv, spec ) );

        // The platform-shared audit ingestion queue (+ DLQ) — provisioned ONCE here (not per-service, not
        // manifest-driven) because it must be writable by EVERY service's compute with zero per-service
        // manifest edits (see `Application.audit()` / apps/core/audit/SPECS.md). Ordering doesn't matter
        // (no ACCESS.md-verb dependency), so build it alongside the shared secrets.
        [ this.auditQueue, this.auditDlq ] = this.makeAuditQueue( props.deployEnv );

        // Local: minimal network — a single AZ, no NAT gateways (nothing to reach the real internet).
        this.vpc = new ec2.Vpc( this, "Vpc", {
            maxAzs      : m.vpc?.maxAzs ?? ( local ? 1 : 2 ),
            natGateways : forEnv( m.vpc?.natGateways, props.deployEnv ) ?? ( local ? 0 : 1 ),
            ipAddresses : m.vpc?.cidr ? ec2.IpAddresses.cidr( m.vpc.cidr ) : undefined,
        } );

        // Locally, skip managed MSK (LocalStack's emulation is unreliable) — services point at a
        // Kafka side-container instead (see cloud/local/). Everything else is emulated by LocalStack Pro.
        if( m.kafkaCluster && !local )  this.makeMsk( props.deployEnv, m );
        else if( m.kafkaCluster )       cdk.Annotations.of( this ).addInfo( "[local] skipping MSK — use the Kafka side-container (cloud/local/)" );

        if( m.searchCluster ) this.makeSearch( props.deployEnv, m.searchCluster );
        if( m.cloudTrail?.enabled && !local ) this.makeCloudTrail( props.deployEnv, m.cloudTrail );
    }

    /** Create a platform-shared Secrets Manager secret (physical name `<env>-platform-secret-<key>`) and
     *  record it so every ServiceStack can be granted read + inject its ARN. */
    private makeSecret( env : Environment, spec : SecretSpec ) : void
    {
        const secret : secretsmanager.Secret = new secretsmanager.Secret( this, `Secret-${spec.key}`, {
            secretName  : physicalName( env, "platform", ResourceKind.SECRET, spec.key ),
            description : spec.description,
        } );
        this.secrets.set( spec.key, secret );
    }

    /** Create the platform-shared audit ingestion queue (+ DLQ; physical name `<env>-platform-queue-audit-events`).
     *  Standard (not FIFO) — per-tenant ORDERING is enforced by `AuditSinkJob`'s seq/hash-chain stamp at write
     *  time, not queue delivery order, so FIFO's added latency/throughput cost buys nothing here. A generous
     *  visibility timeout gives the sink job margin over its own Lambda timeout before a message is redelivered. */
    private makeAuditQueue( env : Environment ) : [ sqs.IQueue, sqs.IQueue ]
    {
        const dlq : sqs.Queue = new sqs.Queue( this, "AuditQueueDlq", {
            queueName : physicalName( env, "platform", ResourceKind.QUEUE, "audit-events-dlq" ),
        } );
        const queue : sqs.Queue = new sqs.Queue( this, "AuditQueue", {
            queueName         : physicalName( env, "platform", ResourceKind.QUEUE, "audit-events" ),
            visibilityTimeout : cdk.Duration.seconds( 90 ),   // margin over AuditSinkJob's 30s timeout
            deadLetterQueue   : { queue: dlq, maxReceiveCount: 5 },
        } );
        return [ queue, dlq ];
    }

    /** Create a multi-region CloudTrail trail (with its own encrypted log bucket). */
    private makeCloudTrail( env : Environment, spec : CloudTrailSpec ) : void
    {
        new cloudtrail.Trail( this, "Trail", {
            trailName              : `${env}-trail`,
            isMultiRegionTrail     : spec.multiRegion ?? true,
            includeGlobalServiceEvents : true,
            managementEvents       : ( spec.managementEvents ?? true ) ? cloudtrail.ReadWriteType.ALL : undefined,
            // The Trail provisions its own encrypted S3 bucket for the logs by default.
        } );
    }

    /** Create the MSK (Kafka) cluster in the shared VPC, sized from the 1..10 scale. */
    private makeMsk( env : Environment, m : PlatformManifest ) : void
    {
        const spec : KafkaClusterSpec = m.kafkaCluster!;
        const sg : ec2.SecurityGroup = new ec2.SecurityGroup( this, "MskSg", { vpc: this.vpc, description: "MSK brokers" } );
        const subnets : Array<string> = this.vpc.selectSubnets( { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS } ).subnetIds;

        new msk.CfnCluster( this, "Msk", {
            clusterName         : `${env}-msk`,
            kafkaVersion        : spec.version ?? "3.6.0",
            numberOfBrokerNodes : forEnv( spec.brokers, env ) ?? subnets.length,
            brokerNodeGroupInfo : {
                instanceType   : mskInstanceType( forEnv( spec.sizing, env ) ),   // 1..10 -> broker type
                clientSubnets  : subnets,
                securityGroups : [ sg.securityGroupId ],
                storageInfo    : { ebsStorageInfo: { volumeSize: forEnv( spec.storageGB, env ) ?? 100 } },
            },
        } );
    }

    /** Create OpenSearch — a Serverless collection (with encryption/network/data policies) or a node-based domain. */
    private makeSearch( env : Environment, spec : SearchClusterSpec ) : void
    {
        if( spec.serverless )
        {
            // OpenSearch Serverless (OCUs auto-scale). A collection requires at minimum an
            // encryption policy and a network policy; data-access policies are added per consumer.
            const name : string = `${env}-search`;
            const enc : oss.CfnSecurityPolicy = new oss.CfnSecurityPolicy( this, "SearchEnc", {
                name   : `${name}-enc`.slice( 0, 32 ),
                type   : "encryption",
                policy : JSON.stringify( { Rules: [ { ResourceType: "collection", Resource: [ `collection/${name}` ] } ], AWSOwnedKey: true } ),
            } );
            const net : oss.CfnSecurityPolicy = new oss.CfnSecurityPolicy( this, "SearchNet", {
                name   : `${name}-net`.slice( 0, 32 ),
                type   : "network",
                policy : JSON.stringify( [ { Rules: [ { ResourceType: "collection", Resource: [ `collection/${name}` ] }, { ResourceType: "dashboard", Resource: [ `collection/${name}` ] } ], AllowFromPublic: true } ] ),
            } );
            const collection : oss.CfnCollection = new oss.CfnCollection( this, "Search", { name, type: "SEARCH" } );
            collection.addDependency( enc );
            collection.addDependency( net );
            this.searchEndpoint      = collection.attrCollectionEndpoint;
            this.searchCollectionArn = collection.attrArn;

            // Data-access policy granting the configured principals (default: the account root).
            const principals : Array<string> = ( spec.dataAccessPrincipals && spec.dataAccessPrincipals.length )
                ? spec.dataAccessPrincipals
                : [ `arn:aws:iam::${cdk.Stack.of( this ).account}:root` ];
            new oss.CfnAccessPolicy( this, "SearchAccess", {
                name   : `${name}-access`.slice( 0, 32 ),
                type   : "data",
                policy : JSON.stringify( [ {
                    Rules: [
                        { ResourceType: "collection", Resource: [ `collection/${name}` ], Permission: [ "aoss:*" ] },
                        { ResourceType: "index",      Resource: [ `index/${name}/*` ],    Permission: [ "aoss:*" ] },
                    ],
                    Principal: principals,
                } ] ),
            } );
        }
        else
        {
            const domain : opensearch.Domain = new opensearch.Domain( this, "Search", {
                version  : opensearch.EngineVersion.OPENSEARCH_2_11,
                vpc      : this.vpc,
                capacity : {
                    dataNodes            : forEnv( spec.nodes, env ) ?? 2,
                    dataNodeInstanceType : searchInstanceType( forEnv( spec.sizing, env ) ),   // 1..10 -> node type
                },
                ebs      : { volumeSize: forEnv( spec.storageGB, env ) ?? 20 },
            } );
            this.searchEndpoint      = `https://${domain.domainEndpoint}`;
            this.searchCollectionArn = domain.domainArn;
        }
    }
}
