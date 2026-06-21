//
// ServiceStack — turns one service's ResourceManifest into AWS resources, wires
// least-privilege IAM (from `uses` access intent), and injects each resource's
// identifier into the service's compute as an env var the CloudResolver reads back.
//
import * as cdk from "aws-cdk-lib";
import * as path from "path";
import * as fs from "fs";
import { Construct } from "constructs";
import * as iam from "aws-cdk-lib/aws-iam";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as kms from "aws-cdk-lib/aws-kms";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as sqs from "aws-cdk-lib/aws-sqs";
import * as sns from "aws-cdk-lib/aws-sns";
import * as logs from "aws-cdk-lib/aws-logs";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as appconfig from "aws-cdk-lib/aws-appconfig";
import * as rds from "aws-cdk-lib/aws-rds";
import * as elasticache from "aws-cdk-lib/aws-elasticache";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as ecsPatterns from "aws-cdk-lib/aws-ecs-patterns";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import * as batch from "aws-cdk-lib/aws-batch";
import * as ses from "aws-cdk-lib/aws-ses";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as cwactions from "aws-cdk-lib/aws-cloudwatch-actions";
import * as route53 from "aws-cdk-lib/aws-route53";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as mediaconvert from "aws-cdk-lib/aws-mediaconvert";
import * as rum from "aws-cdk-lib/aws-rum";
import * as amplify from "aws-cdk-lib/aws-amplify";
import { WebSocketLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { SqsEventSource } from "aws-cdk-lib/aws-lambda-event-sources";
import * as apigwv2 from "aws-cdk-lib/aws-apigatewayv2";
import * as scheduler from "aws-cdk-lib/aws-scheduler";
import { HttpLambdaIntegration, HttpAlbIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import { HttpJwtAuthorizer } from "aws-cdk-lib/aws-apigatewayv2-authorizers";

import {
    Environment, PerEnv, forEnv,
    ResourceManifest, ResourceRef, ResourceKind, AccessIntent,
    QueueSpec, BucketSpec, TableSpec, KmsKeySpec, SecretSpec, SnsTopicSpec, LogGroupSpec,
    AppConfigSpec, JobSpec, ApiSpec, ApiEndpointSpec, ApiAuthorizer, ThrottleSpec,
    DatabaseSpec, CacheSpec, ServiceSpec, AutoScalingSpec, KafkaTopicSpec, SesSpec, BatchJobSpec,
    EventBusSpec, AlarmSpec, DnsRecordSpec, AlarmComparison,
    UserPoolSpec, MediaConvertSpec, RumSpec, AmplifySpec, WebSocketApiSpec, WebSocketRouteSpec, MfaMode, SchedulerSpec,
    AttrType, StreamViewType, BillingMode, JobRuntime, BucketAccess, CacheEngine,
    physicalName, envVarName,
} from "@repo/cloud-manifest";
import { fargateSize, rdsInstanceClass, auroraAcu, cacheLimits, batchSize, FargateSize, AcuRange, CacheLimits, BatchSize } from "./sizing";
import { isLocal, supportedLocally } from "./local";

export interface ServiceStackProps extends cdk.StackProps
{
    manifest  : ResourceManifest;
    deployEnv : Environment;         // deployment environment (dev/staging/production)
    vpc?      : ec2.IVpc;            // shared VPC from PlatformStack (created lazily if absent)
    // note: cdk.StackProps.env carries the AWS { account, region } — separate concept.
}

/**
 * Turns one service's `ResourceManifest` into AWS resources for a single environment: creates
 * each owned resource, wires least-privilege IAM (including cross-service `uses` by access
 * intent), and injects every resource's identifier into the service's compute as an env var the
 * `CloudResolver` reads back. Build the API Gateway from the service's endpoint definitions.
 */
export class ServiceStack extends cdk.Stack
{
    private readonly deployEnv : Environment;
    private readonly service   : string;
    private readonly tracing   : boolean;       // X-Ray active tracing across this service's compute

    // Owned resources keyed by logical key, for trigger wiring + env injection + grants.
    private readonly keys    : Map<string, kms.IKey>          = new Map();
    private readonly buckets : Map<string, s3.IBucket>        = new Map();
    private readonly tables  : Map<string, dynamodb.ITable>   = new Map();
    private readonly queues  : Map<string, sqs.IQueue>        = new Map();
    private readonly secrets : Map<string, secretsmanager.ISecret> = new Map();
    private readonly topics  : Map<string, sns.ITopic>        = new Map();

    private readonly lambdas  : Array<lambda.Function> = [];   // API-integration targets
    private readonly grantees : Array<iam.IGrantable>  = [];   // everything that gets `uses` grants
    private readonly dbProxies : Array<{ proxy : rds.DatabaseProxy; user : string }> = [];   // for IAM rds-db:connect grants (after compute exists)
    private _schedulerRole?  : iam.Role;     // EventBridge Scheduler execution role (delivers to targets)
    private _schedulerGroup? : string;       // schedule-group name (IAM scope for compute)

    // Identifiers to inject into every compute target (logical -> physical).
    private readonly envVars : Record<string, string> = {};

    // Lazily-created shared networking (for RDS / ECS / ElastiCache).
    private _vpc?        : ec2.IVpc;
    private _computeSg?  : ec2.SecurityGroup;
    private _ecsCluster? : ecs.Cluster;

    // When an ECS service exists, the API integrates to its ALB (via VpcLink) instead of a Lambda.
    private _albListener? : elbv2.IApplicationListener;
    private _alb?         : elbv2.IApplicationLoadBalancer;   // for Route 53 alias targets
    private readonly cdns : Map<string, cloudfront.IDistribution> = new Map();   // for Route 53 alias targets

    // A provisioned user pool the API's JWT authorizer can reference directly.
    private _userPool?       : cognito.UserPool;
    private _userPoolClient? : cognito.UserPoolClient;
    // Presigned-upload routes to add when the API is built: { path -> presigner Lambda }.
    private readonly presignRoutes : Array<{ path : string; fn : lambda.Function }> = [];

    /**
     * @param scope CDK construct scope
     * @param id    stack id
     * @param props the service manifest, target environment, and optional shared VPC
     */
    constructor( scope : Construct, id : string, props : ServiceStackProps )
    {
        super( scope, id, props );

        this.deployEnv = props.deployEnv;
        this.service   = props.manifest.service;
        this._vpc      = props.vpc;
        this.tracing   = props.manifest.tracing ?? false;

        const owns = props.manifest.owns;

        // 1. Keys first (referenced by buckets/tables/queues), then data resources.
        ( owns.keys      ?? [] ).forEach( s => this.makeKey( s ) );
        ( owns.buckets   ?? [] ).forEach( s => this.makeBucket( s ) );
        ( owns.tables    ?? [] ).forEach( s => this.makeTable( s ) );
        ( owns.queues    ?? [] ).forEach( s => this.makeQueue( s ) );
        ( owns.secrets   ?? [] ).forEach( s => this.makeSecret( s ) );
        ( owns.snsTopics ?? [] ).forEach( s => this.makeSnsTopic( s ) );
        ( owns.logGroups ?? [] ).forEach( s => this.makeLogGroup( s ) );
        ( owns.appConfig ?? [] ).forEach( s => this.makeAppConfig( s ) );

        // 2. Networked data stores (add their endpoints to envVars before compute).
        ( owns.databases ?? [] ).forEach( s => this.makeDatabase( s ) );
        ( owns.caches    ?? [] ).forEach( s => this.makeCache( s ) );
        ( owns.topics    ?? [] ).forEach( s => this.makeTopic( s ) );
        ( owns.ses          ?? [] ).forEach( s => this.makeSes( s ) );
        ( owns.mediaConvert ?? [] ).forEach( s => { if( !this.skipLocal( ResourceKind.MEDIACONVERT ) ) this.makeMediaConvert( s ); } );
        ( owns.rum          ?? [] ).forEach( s => { if( !this.skipLocal( ResourceKind.RUM ) )          this.makeRum( s ); } );
        ( owns.amplify      ?? [] ).forEach( s => { if( !this.skipLocal( ResourceKind.AMPLIFY ) )      this.makeAmplify( s ); } );

        this.envVars[ "ENVIRONMENT" ] = this.deployEnv;

        // Scheduler role/group must exist before compute so SCHEDULER_* env injects into it.
        if( owns.scheduler ) this.makeScheduler( owns.scheduler );

        // 3. Compute (env is complete by now), then user pools (triggers reference jobs), then API.
        ( owns.jobs     ?? [] ).forEach( s => this.makeJob( s ) );
        ( owns.services ?? [] ).forEach( s => this.makeEcsService( s ) );
        ( owns.batchJobs ?? [] ).forEach( s => this.makeBatchJob( s ) );
        ( owns.userPools ?? [] ).forEach( s => this.makeUserPool( s ) );

        if( owns.api ) this.makeApi( owns.api );
        if( owns.webSocketApi ) this.makeWebSocketApi( owns.webSocketApi );

        // 4. Observability / routing / events.
        ( owns.eventBuses ?? [] ).forEach( s => this.makeEventBus( s ) );
        ( owns.alarms     ?? [] ).forEach( s => this.makeAlarm( s ) );
        ( owns.dnsRecords ?? [] ).forEach( s => this.makeDnsRecord( s ) );

        ( props.manifest.uses ?? [] ).forEach( ref => this.grantUses( ref ) );

        // Compute now exists — grant it IAM connect on each database's RDS Proxy, and grant the
        // Scheduler role delivery to owned targets + compute the right to manage schedules.
        this.grantDatabaseConnect();
        this.grantSchedulerAccess();

        this.warnUnsupported( props.manifest );
    }

    //////////////////////////////////////////////////////////////////////////////
    // Helpers

    /** The conventional physical name for an owned resource of the given kind/key. */
    private name( kind : ResourceKind, key : string ) : string
    {
        return physicalName( this.deployEnv, this.service, kind, key );
    }

    /** Resolve a possibly per-environment value for this stack's environment, or `fallback`. */
    private per<T>( v : PerEnv<T> | T | undefined, fallback : T ) : T
    {
        const r : T | undefined = forEnv( v, this.deployEnv );
        return ( r === undefined ) ? fallback : r;
    }

    /** The shared VPC (from PlatformStack), lazily creating a per-stack VPC if none was provided. */
    private vpc() : ec2.IVpc
    {
        if( !this._vpc ) this._vpc = new ec2.Vpc( this, "Vpc", { maxAzs: 2, natGateways: 1 } );
        return this._vpc;
    }

    /** Shared SG for compute that connects to RDS / ElastiCache. */
    private computeSg() : ec2.SecurityGroup
    {
        if( !this._computeSg ) this._computeSg = new ec2.SecurityGroup( this, "ComputeSg", { vpc: this.vpc(), description: "service compute" } );
        return this._computeSg;
    }

    /** Grant a compute role least-privilege on this service's own resources. */
    private grantOwned( g : iam.IGrantable ) : void
    {
        this.tables.forEach(  t => t.grantReadWriteData( g ) );
        this.buckets.forEach( b => b.grantReadWrite( g ) );
        this.queues.forEach(  q => { q.grantConsumeMessages( g ); q.grantSendMessages( g ); } );
        this.keys.forEach(    k => k.grantEncryptDecrypt( g ) );
        this.secrets.forEach( s => s.grantRead( g ) );
        this.topics.forEach(  t => t.grantPublish( g ) );
    }

    //////////////////////////////////////////////////////////////////////////////
    /** Create a KMS customer-managed key (referenced by buckets/tables/queues for encryption). */
    private makeKey( spec : KmsKeySpec ) : void
    {
        const key : kms.Key = new kms.Key( this, `Key-${spec.key}`, {
            alias            : spec.alias ?? this.name( ResourceKind.KMS_KEY, spec.key ),
            description      : spec.description,
            enableKeyRotation : spec.enableRotation ?? true,
        } );
        this.keys.set( spec.key, key );
        this.envVars[ envVarName( ResourceKind.KMS_KEY, spec.key ) ] = key.keyArn;
    }

    //////////////////////////////////////////////////////////////////////////////
    /** Create an S3 bucket (private; optional CloudFront/OAC CDN and presigned-upload Lambda). */
    private makeBucket( spec : BucketSpec ) : void
    {
        const cmk : kms.IKey | undefined = spec.kmsKey ? this.keys.get( spec.kmsKey ) : undefined;
        const bucket : s3.Bucket = new s3.Bucket( this, `Bucket-${spec.key}`, {
            bucketName        : this.name( ResourceKind.BUCKET, spec.key ),
            versioned         : spec.versioned ?? false,
            encryption        : cmk ? s3.BucketEncryption.KMS : s3.BucketEncryption.S3_MANAGED,
            encryptionKey     : cmk,
            blockPublicAccess : s3.BlockPublicAccess.BLOCK_ALL,   // never public; served via CloudFront/OAC or signed URLs
            enforceSSL        : true,
            cors              : spec.cors ? [ { allowedMethods: [ s3.HttpMethods.GET, s3.HttpMethods.PUT, s3.HttpMethods.POST ], allowedOrigins: [ "*" ], allowedHeaders: [ "*" ] } ] : undefined,
            lifecycleRules    : ( spec.lifecycle ?? [] ).map( r => ( {
                prefix     : r.prefix,
                expiration : r.expireDays ? cdk.Duration.days( r.expireDays ) : undefined,
            } ) ),
        } );
        this.buckets.set( spec.key, bucket );
        this.envVars[ envVarName( ResourceKind.BUCKET, spec.key ) ] = bucket.bucketName;

        // CloudFront + Origin Access Control for public-CDN delivery (no public bucket access).
        if( spec.access === BucketAccess.PUBLIC_CDN )
        {
            const dist : cloudfront.Distribution = new cloudfront.Distribution( this, `Cdn-${spec.key}`, {
                defaultBehavior : {
                    origin               : origins.S3BucketOrigin.withOriginAccessControl( bucket ),
                    viewerProtocolPolicy : cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                    cachePolicy          : cloudfront.CachePolicy.CACHING_OPTIMIZED,
                },
            } );
            this.cdns.set( spec.key, dist );
            this.envVars[ envVarName( ResourceKind.CDN, spec.key ) ] = dist.distributionDomainName;
        }

        // Presigned upload: a small Lambda that issues S3 PUT/POST URLs (route added in makeApi).
        if( spec.presignedUpload )
        {
            const presigner : lambda.Function = new lambda.Function( this, `Presign-${spec.key}`, {
                functionName : this.name( ResourceKind.FUNCTION, `${spec.key}-presign` ),
                runtime      : lambda.Runtime.NODEJS_22_X,
                handler      : "presign.handler",
                code         : this.functionCode(),
                timeout      : cdk.Duration.seconds( 10 ),
                environment  : { [ envVarName( ResourceKind.BUCKET, spec.key ) ]: bucket.bucketName, ENVIRONMENT: this.deployEnv },
            } );
            bucket.grantPut( presigner );
            this.presignRoutes.push( { path: `/uploads/${spec.key}`, fn: presigner } );
        }
    }

    //////////////////////////////////////////////////////////////////////////////
    /** Create a DynamoDB table (+ GSIs, TTL, stream, optional CMK encryption). */
    private makeTable( spec : TableSpec ) : void
    {
        const cmk : kms.IKey | undefined = spec.kmsKey ? this.keys.get( spec.kmsKey ) : undefined;
        const table : dynamodb.Table = new dynamodb.Table( this, `Table-${spec.key}`, {
            tableName          : this.name( ResourceKind.TABLE, spec.key ),
            partitionKey       : { name: spec.partitionKey.name, type: this.attr( spec.partitionKey.type ) },
            sortKey            : spec.sortKey ? { name: spec.sortKey.name, type: this.attr( spec.sortKey.type ) } : undefined,
            billingMode        : ( spec.billingMode === BillingMode.PROVISIONED ) ? dynamodb.BillingMode.PROVISIONED : dynamodb.BillingMode.PAY_PER_REQUEST,
            encryption         : cmk ? dynamodb.TableEncryption.CUSTOMER_MANAGED : dynamodb.TableEncryption.AWS_MANAGED,
            encryptionKey      : cmk,
            timeToLiveAttribute : spec.ttlAttribute,
            stream             : spec.stream ? this.streamView( spec.stream ) : undefined,
            pointInTimeRecoverySpecification : spec.pointInTimeRecovery !== undefined
                ? { pointInTimeRecoveryEnabled: spec.pointInTimeRecovery }
                : undefined,
        } );
        ( spec.globalSecondaryIndexes ?? [] ).forEach( gsi => table.addGlobalSecondaryIndex( {
            indexName    : gsi.name,
            partitionKey : { name: gsi.partitionKey.name, type: this.attr( gsi.partitionKey.type ) },
            sortKey      : gsi.sortKey ? { name: gsi.sortKey.name, type: this.attr( gsi.sortKey.type ) } : undefined,
        } ) );
        this.tables.set( spec.key, table );
        this.envVars[ envVarName( ResourceKind.TABLE, spec.key ) ] = table.tableName;
    }

    //////////////////////////////////////////////////////////////////////////////
    /** Create an SQS queue, optionally with an auto-created dead-letter queue. */
    private makeQueue( spec : QueueSpec ) : void
    {
        let deadLetter : sqs.DeadLetterQueue | undefined;
        if( spec.dlq )
        {
            const dlq : sqs.Queue = new sqs.Queue( this, `Queue-${spec.key}-dlq`, {
                queueName : this.name( ResourceKind.QUEUE, `${spec.key}-dlq` ),
                fifo      : spec.fifo,
            } );
            deadLetter = { queue: dlq, maxReceiveCount: spec.maxReceiveCount ?? 5 };
        }
        const queue : sqs.Queue = new sqs.Queue( this, `Queue-${spec.key}`, {
            queueName         : this.name( ResourceKind.QUEUE, spec.key ),
            fifo              : spec.fifo,
            contentBasedDeduplication : spec.contentBasedDedup,
            visibilityTimeout : spec.visibilityTimeoutSec ? cdk.Duration.seconds( spec.visibilityTimeoutSec ) : undefined,
            retentionPeriod   : spec.messageRetentionDays ? cdk.Duration.days( spec.messageRetentionDays ) : undefined,
            deliveryDelay     : spec.deliveryDelaySeconds ? cdk.Duration.seconds( spec.deliveryDelaySeconds ) : undefined,
            encryptionMasterKey : spec.kmsKey ? this.keys.get( spec.kmsKey ) : undefined,
            deadLetterQueue   : deadLetter,
        } );
        this.queues.set( spec.key, queue );
        this.envVars[ envVarName( ResourceKind.QUEUE, spec.key ) ] = queue.queueUrl;
    }

    //////////////////////////////////////////////////////////////////////////////
    /** Create a Secrets Manager secret. */
    private makeSecret( spec : SecretSpec ) : void
    {
        const secret : secretsmanager.Secret = new secretsmanager.Secret( this, `Secret-${spec.key}`, {
            secretName  : this.name( ResourceKind.SECRET, spec.key ),
            description : spec.description,
        } );
        this.secrets.set( spec.key, secret );
        this.envVars[ envVarName( ResourceKind.SECRET, spec.key ) ] = secret.secretArn;
    }

    //////////////////////////////////////////////////////////////////////////////
    /** Create an SNS topic (e.g. for alarm/notification fan-out). */
    private makeSnsTopic( spec : SnsTopicSpec ) : void
    {
        const topic : sns.Topic = new sns.Topic( this, `Sns-${spec.key}`, {
            topicName : this.name( ResourceKind.SNS_TOPIC, spec.key ),
            fifo      : spec.fifo,
        } );
        this.topics.set( spec.key, topic );
        this.envVars[ envVarName( ResourceKind.SNS_TOPIC, spec.key ) ] = topic.topicArn;
    }

    //////////////////////////////////////////////////////////////////////////////
    /** Create a CloudWatch log group with the configured retention. */
    private makeLogGroup( spec : LogGroupSpec ) : void
    {
        new logs.LogGroup( this, `Log-${spec.key}`, {
            logGroupName : `/${this.deployEnv}/${this.service}/${spec.key}`,
            retention    : this.retention( this.per( spec.retentionDays, 14 ) ),
        } );
    }

    //////////////////////////////////////////////////////////////////////////////
    /** Create an AppConfig application, its environment(s), and its configuration profiles. */
    private makeAppConfig( spec : AppConfigSpec ) : void
    {
        const app : appconfig.CfnApplication = new appconfig.CfnApplication( this, `AppConfig-${spec.key}`, { name: spec.application ?? this.service } );

        // AppConfig environments are in-account deploy targets (rings/regions/cells), NOT dev/staging/prod
        // — that's the AWS account boundary. Default to a single "default" target (matches the facade's
        // APPCONFIG_ENV ?? "default"). See packages/services/src/aws/SPECS.md → AppConfig configuration layout.
        ( spec.environments ?? [ "default" ] ).forEach( envName =>
            new appconfig.CfnEnvironment( this, `AppConfigEnv-${spec.key}-${envName}`, { applicationId: app.ref, name: envName } ) );
        spec.profiles.forEach( p => new appconfig.CfnConfigurationProfile( this, `AppConfigProfile-${spec.key}-${p.key}`, {
            applicationId : app.ref,
            name          : p.key,
            locationUri   : "hosted",
            type          : p.type === "feature_flags" ? "AWS.AppConfig.FeatureFlags" : "AWS.Freeform",
        } ) );
        this.envVars[ envVarName( ResourceKind.APP_CONFIG, spec.key ) ] = app.ref;
    }

    //////////////////////////////////////////////////////////////////////////////
    /** Create an RDS database — Aurora Serverless v2 or a provisioned Postgres instance, sized 1..10. */
    private makeDatabase( spec : DatabaseSpec ) : void
    {
        const vpc : ec2.IVpc = this.vpc();
        // One SG shared by proxy + db: compute -> proxy, and proxy -> db (self-ingress).
        const sg : ec2.SecurityGroup = new ec2.SecurityGroup( this, `DbSg-${spec.key}`, { vpc, description: `db ${spec.key}` } );
        sg.addIngressRule( this.computeSg(), ec2.Port.tcp( 5432 ), "compute -> proxy" );
        sg.addIngressRule( sg, ec2.Port.tcp( 5432 ), "proxy -> db (self)" );

        const dbUser : string = "dbadmin";
        const providedSecret : secretsmanager.ISecret | undefined = spec.credentialsSecret ? this.secrets.get( spec.credentialsSecret ) : undefined;
        const credentials : rds.Credentials = providedSecret
            ? rds.Credentials.fromSecret( providedSecret )
            : rds.Credentials.fromGeneratedSecret( dbUser );

        let proxyTarget : rds.ProxyTarget;
        let secret : secretsmanager.ISecret;
        let isCluster : boolean = false;

        if( spec.serverless )
        {
            const acu : AcuRange = auroraAcu( forEnv( spec.sizing, this.deployEnv ) );   // 1..10 -> ACU range
            const cluster : rds.DatabaseCluster = new rds.DatabaseCluster( this, `Db-${spec.key}`, {
                engine                  : rds.DatabaseClusterEngine.auroraPostgres( { version: rds.AuroraPostgresEngineVersion.VER_16_8 } ),
                vpc, securityGroups      : [ sg ],
                serverlessV2MinCapacity : acu.min,
                serverlessV2MaxCapacity : acu.max,
                writer                  : rds.ClusterInstance.serverlessV2( "writer" ),
                credentials,
                defaultDatabaseName     : spec.databaseName,
            } );
            proxyTarget = rds.ProxyTarget.fromCluster( cluster );
            secret      = providedSecret ?? cluster.secret!;
            isCluster   = true;
        }
        else
        {
            const instance : rds.DatabaseInstance = new rds.DatabaseInstance( this, `Db-${spec.key}`, {
                engine          : rds.DatabaseInstanceEngine.postgres( { version: rds.PostgresEngineVersion.VER_16_8 } ),
                vpc, securityGroups : [ sg ],
                instanceType    : new ec2.InstanceType( rdsInstanceClass( forEnv( spec.sizing, this.deployEnv ) ) ),   // 1..10 -> class
                allocatedStorage : forEnv( spec.storageGB, this.deployEnv ) ?? 20,
                multiAz         : spec.multiAz,
                credentials,
                databaseName    : spec.databaseName,
            } );
            proxyTarget = rds.ProxyTarget.fromInstance( instance );
            secret      = providedSecret ?? instance.secret!;
        }

        // RDS Proxy — pools/multiplexes connections (essential for Lambda) and enables IAM auth
        // so compute connects with a short-lived token instead of a static password.
        const proxy : rds.DatabaseProxy = new rds.DatabaseProxy( this, `DbProxy-${spec.key}`, {
            proxyTarget,
            secrets        : [ secret ],
            vpc,
            securityGroups : [ sg ],
            iamAuth        : true,
        } );
        this.dbProxies.push( { proxy, user: dbUser } );

        // Inject the PROXY read/write endpoint (not the raw db endpoint) + connection defaults.
        const base : string = envVarName( ResourceKind.DATABASE, spec.key );
        this.envVars[ base ] = `${proxy.endpoint}:5432`;
        this.envVars[ "DB_USER" ] = dbUser;
        if( spec.databaseName ) this.envVars[ "DB_NAME" ] = spec.databaseName;

        // Aurora: a READ_ONLY proxy endpoint (routes to readers) -> the facade's reader lookup.
        if( isCluster )
        {
            const ro : rds.CfnDBProxyEndpoint = new rds.CfnDBProxyEndpoint( this, `DbProxyRo-${spec.key}`, {
                dbProxyEndpointName : `${this.deployEnv}-${this.service}-${spec.key}-ro`.slice( 0, 63 ).replace( /[^A-Za-z0-9-]+/g, "-" ),
                dbProxyName         : proxy.dbProxyName,
                targetRole          : "READ_ONLY",
                vpcSubnetIds        : vpc.selectSubnets( { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS } ).subnetIds,
                vpcSecurityGroupIds : [ sg.securityGroupId ],
            } );
            this.envVars[ `${base}_READER` ] = `${ro.attrEndpoint}:5432`;
        }
    }

    //////////////////////////////////////////////////////////////////////////////
    /**
     * Grant every compute grantee `rds-db:connect` on each database's RDS Proxy (IAM auth).
     * Deferred to after compute is built. NOTE: IAM DB auth also requires the DB user to be
     * IAM-enabled in Postgres (`GRANT rds_iam TO dbadmin;`) — a one-time migration step.
     */
    private grantDatabaseConnect() : void
    {
        for( const { proxy, user } of this.dbProxies )
        {
            for( const grantee of this.grantees ) proxy.grantConnect( grantee, user );
        }
    }

    //////////////////////////////////////////////////////////////////////////////
    /**
     * Provision EventBridge Scheduler for this service: a per-service **schedule group** and an
     * **execution role** Scheduler assumes to deliver to targets. Targets/compute permissions are
     * granted later (grantSchedulerAccess), once owned queues/functions + compute exist. Injects
     * `SCHEDULER_ROLE_ARN` + `SCHEDULER_GROUP` for the runtime Scheduler facade.
     */
    private makeScheduler( spec : SchedulerSpec ) : void
    {
        const group : string = spec.group ?? `${this.deployEnv}-${this.service}`;
        new scheduler.CfnScheduleGroup( this, "ScheduleGroup", { name: group } );

        this._schedulerRole  = new iam.Role( this, "SchedulerRole", {
            assumedBy   : new iam.ServicePrincipal( "scheduler.amazonaws.com" ),
            description : `EventBridge Scheduler delivery role for ${this.service}`,
        } );
        this._schedulerGroup = group;

        this.envVars[ "SCHEDULER_ROLE_ARN" ] = this._schedulerRole.roleArn;
        this.envVars[ "SCHEDULER_GROUP" ]    = group;
    }

    //////////////////////////////////////////////////////////////////////////////
    /**
     * Wire Scheduler permissions once compute + targets exist: the execution role may deliver to
     * the service's owned queues (SendMessage) and functions (Invoke); compute may create/manage
     * schedules in this service's group and pass the execution role to Scheduler.
     */
    private grantSchedulerAccess() : void
    {
        if( this._schedulerRole === undefined || this._schedulerGroup === undefined ) return;

        // Scheduler delivers to the service's own targets.
        for( const queue of this.queues.values() ) queue.grantSendMessages( this._schedulerRole );
        for( const fn of this.lambdas )            fn.grantInvoke( this._schedulerRole );

        const stack : cdk.Stack = cdk.Stack.of( this );
        const scheduleArn : string = `arn:${stack.partition}:scheduler:${stack.region}:${stack.account}:schedule/${this._schedulerGroup}/*`;

        for( const grantee of this.grantees )
        {
            iam.Grant.addToPrincipal( {
                grantee,
                actions      : [ "scheduler:CreateSchedule", "scheduler:UpdateSchedule", "scheduler:DeleteSchedule", "scheduler:GetSchedule", "scheduler:ListSchedules" ],
                resourceArns : [ scheduleArn ],
            } );
            iam.Grant.addToPrincipal( {
                grantee,
                actions      : [ "iam:PassRole" ],
                resourceArns : [ this._schedulerRole.roleArn ],
            } );
        }
    }

    //////////////////////////////////////////////////////////////////////////////
    /** Create an ElastiCache Serverless cache (Redis/Valkey), sized 1..10, reachable from compute. */
    private makeCache( spec : CacheSpec ) : void
    {
        const vpc : ec2.IVpc = this.vpc();
        const sg : ec2.SecurityGroup = new ec2.SecurityGroup( this, `CacheSg-${spec.key}`, { vpc, description: `cache ${spec.key}` } );
        sg.addIngressRule( this.computeSg(), ec2.Port.tcp( 6379 ), "compute -> redis" );

        const limits : CacheLimits = cacheLimits( forEnv( spec.sizing, this.deployEnv ) );   // 1..10 -> caps

        const cache : elasticache.CfnServerlessCache = new elasticache.CfnServerlessCache( this, `Cache-${spec.key}`, {
            serverlessCacheName : this.name( ResourceKind.CACHE, spec.key ),
            engine              : spec.engine ?? CacheEngine.REDIS,
            securityGroupIds    : [ sg.securityGroupId ],
            subnetIds           : vpc.selectSubnets( { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS } ).subnetIds,
            cacheUsageLimits    : {
                dataStorage   : { maximum: limits.storageGB, unit: "GB" },
                ecpuPerSecond : { maximum: limits.ecpu },
            },
        } );
        this.envVars[ envVarName( ResourceKind.CACHE, spec.key ) ] = cache.attrEndpointAddress;
    }

    //////////////////////////////////////////////////////////////////////////////
    /**
     * Surface a Kafka/MSK topic to the service. Topics aren't CloudFormation resources, so
     * this injects the topic name plus a JSON config the service uses to create it idempotently
     * at startup via the Kafka admin API.
     */
    private makeTopic( spec : KafkaTopicSpec ) : void
    {
        // Topics aren't CloudFormation resources. Surface the topic NAME (for producers/consumers)
        // and the full CONFIG so the service can create the topic idempotently at startup via the
        // Kafka admin API (partitions/replication/retention).
        const name : string = envVarName( ResourceKind.TOPIC, spec.key );
        this.envVars[ name ] = spec.topic;
        this.envVars[ `${name}_CONFIG` ] = JSON.stringify( {
            topic             : spec.topic,
            partitions        : forEnv( spec.partitions, this.deployEnv ) ?? 3,
            replicationFactor : spec.replicationFactor ?? 3,
            retentionMs       : spec.retentionMs,
        } );
    }

    //////////////////////////////////////////////////////////////////////////////
    /** Create an SES sending domain identity (Easy DKIM) and an optional configuration set. */
    private makeSes( spec : SesSpec ) : void
    {
        new ses.EmailIdentity( this, `Ses-${spec.key}`, {
            identity       : ses.Identity.domain( spec.domain ),
            mailFromDomain : spec.mailFromDomain,
            // Easy DKIM is on by default; SES manages the signing keys.
        } );
        if( spec.configurationSet )
        {
            new ses.ConfigurationSet( this, `SesCfg-${spec.key}`, {
                configurationSetName : this.name( ResourceKind.SES, spec.key ),
            } );
        }
        this.envVars[ envVarName( ResourceKind.SES, spec.key ) ] = spec.domain;
    }

    //////////////////////////////////////////////////////////////////////////////
    /** Create an AWS Batch (Fargate) compute environment, job queue, and job definition, sized 1..10. */
    private makeBatchJob( spec : BatchJobSpec ) : void
    {
        const vpc  = this.vpc();
        const ce : batch.FargateComputeEnvironment = new batch.FargateComputeEnvironment( this, `BatchCe-${spec.key}`, { vpc, securityGroups: [ this.computeSg() ] } );
        const queue : batch.JobQueue = new batch.JobQueue( this, `BatchQ-${spec.key}`, { computeEnvironments: [ { computeEnvironment: ce, order: 1 } ] } );

        const size : BatchSize = batchSize( forEnv( spec.sizing, this.deployEnv ) );   // 1..10 -> vcpu/memory
        new batch.EcsJobDefinition( this, `BatchJob-${spec.key}`, {
            container : new batch.EcsFargateContainerDefinition( this, `BatchC-${spec.key}`, {
                image       : ecs.ContainerImage.fromRegistry( spec.image ),
                cpu         : size.vcpu,
                memory      : cdk.Size.mebibytes( size.memoryMiB ),
                environment : spec.environment,
            } ),
            retryAttempts : spec.retryAttempts,
            timeout       : spec.timeoutSec ? cdk.Duration.seconds( spec.timeoutSec ) : undefined,
        } );

        this.envVars[ envVarName( ResourceKind.BATCH_JOB, spec.key ) ] = queue.jobQueueArn;
    }

    //////////////////////////////////////////////////////////////////////////////
    /** Create a Lambda function (env injection, owned-resource grants, queue triggers, X-Ray). */
    private makeJob( spec : JobSpec ) : void
    {
        const fn : lambda.Function = new lambda.Function( this, `Fn-${spec.key}`, {
            functionName : this.name( ResourceKind.FUNCTION, spec.key ),
            runtime      : this.runtime( spec.runtime ),
            handler      : spec.handler,
            code         : this.functionCode(),
            memorySize   : this.per( spec.memoryMB, 256 ),
            timeout      : cdk.Duration.seconds( spec.timeoutSec ?? 30 ),
            reservedConcurrentExecutions : forEnv( spec.reservedConcurrency, this.deployEnv ),
            environment  : { ...this.envVars, ...( spec.environment ?? {} ) },
            vpc          : spec.vpc ? this.vpc() : undefined,
            securityGroups : spec.vpc ? [ this.computeSg() ] : undefined,
            tracing      : this.tracing ? lambda.Tracing.ACTIVE : undefined,   // X-Ray
        } );

        this.grantOwned( fn );

        ( spec.triggers ?? [] ).forEach( trig => {
            if( trig.source === "queue" && trig.ref )
            {
                const q : sqs.IQueue | undefined = this.queues.get( trig.ref.key );
                if( q ) fn.addEventSource( new SqsEventSource( q, { batchSize: trig.batchSize } ) );
            }
            // TODO: eventbus / bucket / schedule triggers
        } );

        this.lambdas.push( fn );
        this.grantees.push( fn );
    }

    //////////////////////////////////////////////////////////////////////////////
    /**
     * The container image for a service. Default: build the repo-root Dockerfile as a CDK asset —
     * `cdk deploy` builds it, pushes it to the (CDK-managed) ECR repo, and points the task def at it,
     * with a rolling ECS deployment. `spec.image` is an escape hatch for a prebuilt registry/ECR URI
     * (CI pipelines). APP_NAME/APP_PATH match the Dockerfile's workspace-prune build args.
     */
    private containerImage( spec : ServiceSpec ) : ecs.ContainerImage
    {
        if( spec.image ) return ecs.ContainerImage.fromRegistry( spec.image );

        const repoRoot : string = path.join( __dirname, "..", "..", ".." );   // cloud/src/lib → repo root (Dockerfile)
        return ecs.ContainerImage.fromAsset( repoRoot, {
            file      : "Dockerfile",
            buildArgs : { APP_NAME: this.service, APP_PATH: spec.build ?? `core/${this.service}` },
        } );
    }

    //////////////////////////////////////////////////////////////////////////////
    /** Create an ECS Fargate service behind an internal ALB (fronted by the API Gateway via VpcLink). */
    private makeEcsService( spec : ServiceSpec ) : void
    {
        const vpc : ec2.IVpc = this.vpc();
        if( !this._ecsCluster ) this._ecsCluster = new ecs.Cluster( this, "EcsCluster", { vpc } );

        const size : FargateSize = fargateSize( forEnv( spec.sizing, this.deployEnv ) );   // 1..10 -> valid Fargate cpu/mem

        // Initial task count: when autoscaling, it's `start` (validated min <= start <= max), defaulting to
        // `min`; otherwise the fixed `desiredCount` (default 1). The autoscaler then owns the count in [min,max].
        const auto : AutoScalingSpec | undefined = forEnv( spec.autoscaling, this.deployEnv );
        let desired : number;
        if( auto )
        {
            if( auto.min > auto.max )
                throw new RangeError( `service '${spec.key}': autoscaling.min (${auto.min}) > max (${auto.max})` );
            const start : number = auto.start ?? auto.min;
            if( start < auto.min || start > auto.max )
                throw new RangeError( `service '${spec.key}': autoscaling.start (${start}) outside [${auto.min}, ${auto.max}]` );
            desired = start;
        }
        else desired = this.per( spec.desiredCount, 1 );

        const svc : ecsPatterns.ApplicationLoadBalancedFargateService = new ecsPatterns.ApplicationLoadBalancedFargateService( this, `Svc-${spec.key}`, {
            cluster              : this._ecsCluster,
            cpu                  : size.cpu,
            memoryLimitMiB       : size.memoryMiB,
            desiredCount         : desired,
            // Sit behind the API Gateway: internal ALB reached via a VpcLink (see makeApi).
            publicLoadBalancer   : false,
            securityGroups       : [ this.computeSg() ],
            circuitBreaker       : { rollback: true },              // fail deployments fast
            minHealthyPercent    : 100,                             // no capacity dip during deploys
            taskImageOptions     : {
                image          : this.containerImage( spec ),
                containerPort  : spec.containerPort ?? 8000,
                environment    : { ...this.envVars, ...( spec.environment ?? {} ) },
            },
        } );

        if( spec.healthCheckPath ) svc.targetGroup.configureHealthCheck( { path: spec.healthCheckPath } );
        this._albListener = svc.listener;
        this._alb         = svc.loadBalancer;

        // `auto` + initial count resolved above (with min<=start<=max validation). Attach the scaler.
        if( auto )
        {
            const scaling : ecs.ScalableTaskCount = svc.service.autoScaleTaskCount( { minCapacity: auto.min, maxCapacity: auto.max } );
            if( auto.targetCpuPercent ) scaling.scaleOnCpuUtilization( "Cpu", { targetUtilizationPercent: auto.targetCpuPercent } );
        }

        this.grantOwned( svc.taskDefinition.taskRole );
        this.grantees.push( svc.taskDefinition.taskRole );

        // X-Ray: grant the task role to write traces. The app emits spans via the X-Ray/ADOT
        // SDK to the daemon sidecar (add the sidecar to the task when you build the real image).
        if( this.tracing )
        {
            svc.taskDefinition.taskRole.addManagedPolicy( iam.ManagedPolicy.fromAwsManagedPolicyName( "AWSXRayDaemonWriteAccess" ) );
            cdk.Annotations.of( this ).addInfo( `ECS service '${spec.key}': add an X-Ray/ADOT sidecar to the task definition to ship traces` );
        }
    }

    //////////////////////////////////////////////////////////////////////////////
    /**
     * Create the HTTP API. Routes are generated from the endpoint definitions; integrations go
     * to the ECS ALB (via VpcLink) when present, else to a Lambda; a Cognito JWT authorizer is
     * attached to authenticated routes; per-env throttle is applied to the default stage.
     */
    private makeApi( spec : ApiSpec ) : void
    {
        const httpApi : apigwv2.HttpApi = new apigwv2.HttpApi( this, `Api-${spec.key}`, {
            apiName       : this.name( ResourceKind.API, spec.key ),
            corsPreflight : spec.cors ? { allowOrigins: [ "*" ], allowMethods: [ apigwv2.CorsHttpMethod.ANY ] } : undefined,
        } );

        // Cognito JWT authorizer. Prefer a pool PROVISIONED in this stack (no hardcoded id);
        // otherwise fall back to the issuer/audience configured on the spec.
        let authorizer : HttpJwtAuthorizer | undefined;
        if( this._userPool )
        {
            const audience : Array<string> = this._userPoolClient ? [ this._userPoolClient.userPoolClientId ] : [];
            authorizer = new HttpJwtAuthorizer( `Auth-${spec.key}`, this._userPool.userPoolProviderUrl, { jwtAudience: audience } );
        }
        else if( spec.authorizer === ApiAuthorizer.COGNITO && spec.cognito )
        {
            const region : string = spec.cognito.region ?? cdk.Stack.of( this ).region;
            const issuer : string = `https://cognito-idp.${region}.amazonaws.com/${spec.cognito.userPoolId}`;
            authorizer = new HttpJwtAuthorizer( `Auth-${spec.key}`, issuer, { jwtAudience: spec.cognito.clientIds } );
        }

        // Prefer the ECS service's ALB (private, via a VpcLink) as the integration; otherwise a Lambda.
        const vpcLink : apigwv2.VpcLink | undefined = this._albListener ? new apigwv2.VpcLink( this, `VpcLink-${spec.key}`, { vpc: this.vpc() } ) : undefined;
        const lambdaTarget : lambda.Function | undefined = this.lambdas[0];

        const integrationFor = ( ep : { method : string; path : string } ) : apigwv2.HttpRouteIntegration | undefined => {
            if( this._albListener && vpcLink ) return new HttpAlbIntegration( `Int-${spec.key}-${ep.method}-${ep.path}`, this._albListener, { vpcLink } );
            if( lambdaTarget )                 return new HttpLambdaIntegration( `Int-${spec.key}-${ep.method}-${ep.path}`, lambdaTarget );
            return undefined;
        };

        const publicEndpoints : Array<ApiEndpointSpec> = ( spec.endpoints ?? [] ).filter( e => e.public );
        for( const ep of publicEndpoints )
        {
            const integration : apigwv2.HttpRouteIntegration | undefined = integrationFor( ep );
            if( !integration )
            {
                cdk.Annotations.of( this ).addInfo( `api route ${ep.method} ${ep.path} has no integration target (no ECS service or Lambda)` );
                continue;
            }
            httpApi.addRoutes( {
                path        : this.toGatewayPath( ep.path ),
                methods     : [ this.httpMethod( ep.method ) ],
                integration,
                authorizer  : ep.authRequired ? authorizer : undefined,
            } );
        }

        // Presigned-upload routes (each backed by its presigner Lambda).
        for( const pr of this.presignRoutes )
        {
            httpApi.addRoutes( {
                path        : pr.path,
                methods     : [ apigwv2.HttpMethod.POST ],
                integration : new HttpLambdaIntegration( `Int-${spec.key}-presign-${pr.path}`, pr.fn ),
                authorizer,
            } );
        }

        const throttle : ThrottleSpec | undefined = forEnv( spec.throttle, this.deployEnv );
        if( throttle && httpApi.defaultStage )
        {
            const stage : apigwv2.CfnStage = httpApi.defaultStage.node.defaultChild as apigwv2.CfnStage;
            stage.defaultRouteSettings = { throttlingRateLimit: throttle.rateLimit, throttlingBurstLimit: throttle.burstLimit };
        }

        this.envVars[ envVarName( ResourceKind.API, spec.key ) ] = httpApi.apiEndpoint;
    }

    /** Convert a RestfulEndpoint uri (":id") to API Gateway path syntax ("{id}"). */
    private toGatewayPath( uri : string ) : string
    {
        return uri.replace( /:([A-Za-z0-9_]+)\??/g, "{$1}" );
    }

    /** Map an HTTP method string to the API Gateway v2 `HttpMethod` enum (ANY as fallback). */
    private httpMethod( method : string ) : apigwv2.HttpMethod
    {
        return ( apigwv2.HttpMethod as Record<string, apigwv2.HttpMethod> )[ method.toUpperCase() ] ?? apigwv2.HttpMethod.ANY;
    }

    //////////////////////////////////////////////////////////////////////////////
    /** Grant this service's compute least-privilege access to a resource owned by another service. */
    private grantUses( ref : ResourceRef ) : void
    {
        const foreignName : string = physicalName( this.deployEnv, ref.service, ref.kind, ref.key );

        const id : string = `Use-${ref.service}-${ref.kind}-${ref.key}`;
        switch( ref.kind )
        {
            case ResourceKind.BUCKET:
            {
                const b : s3.IBucket = s3.Bucket.fromBucketName( this, id, foreignName );
                this.grantees.forEach( g => this.applyBucketGrant( b, g, ref.access ) );
                break;
            }
            case ResourceKind.TABLE:
            {
                const t : dynamodb.ITable = dynamodb.Table.fromTableName( this, id, foreignName );
                this.grantees.forEach( g => this.applyTableGrant( t, g, ref.access ) );
                break;
            }
            case ResourceKind.QUEUE:
            {
                const q : sqs.IQueue = sqs.Queue.fromQueueArn( this, id, this.formatArn( { service: "sqs", resource: foreignName } ) );
                this.grantees.forEach( g => {
                    if( ref.access === AccessIntent.SEND )    q.grantSendMessages( g );
                    else if( ref.access === AccessIntent.CONSUME ) q.grantConsumeMessages( g );
                    else { q.grantSendMessages( g ); q.grantConsumeMessages( g ); }
                } );
                break;
            }
            case ResourceKind.SNS_TOPIC:
            {
                const t : sns.ITopic = sns.Topic.fromTopicArn( this, id, this.formatArn( { service: "sns", resource: foreignName } ) );
                this.grantees.forEach( g => { if( ref.access !== AccessIntent.SUBSCRIBE ) t.grantPublish( g ); } );
                break;
            }
            case ResourceKind.SECRET:
            {
                const s : secretsmanager.ISecret = secretsmanager.Secret.fromSecretNameV2( this, id, foreignName );
                this.grantees.forEach( g => s.grantRead( g ) );
                break;
            }
            default:
                cdk.Annotations.of( this ).addInfo( `uses: ${ref.kind}:${ref.service}/${ref.key} grant not yet implemented` );
        }
    }

    /** Apply a bucket grant (read/write/read-write) to a grantee per the access intent. */
    private applyBucketGrant( b : s3.IBucket, g : iam.IGrantable, access : AccessIntent ) : void
    {
        if( access === AccessIntent.READ )            b.grantRead( g );
        else if( access === AccessIntent.WRITE )      b.grantWrite( g );
        else if( access === AccessIntent.READ_WRITE ) b.grantReadWrite( g );
    }

    /** Apply a table grant (read/write/read-write) to a grantee per the access intent. */
    private applyTableGrant( t : dynamodb.ITable, g : iam.IGrantable, access : AccessIntent ) : void
    {
        if( access === AccessIntent.READ )            t.grantReadData( g );
        else if( access === AccessIntent.WRITE )      t.grantWriteData( g );
        else if( access === AccessIntent.READ_WRITE ) t.grantReadWriteData( g );
    }

    //////////////////////////////////////////////////////////////////////////////
    // Mappers

    /** Map a spec `AttrType` to a DynamoDB `AttributeType`. */
    private attr( t : AttrType ) : dynamodb.AttributeType
    {
        switch( t )
        {
            case AttrType.NUMBER : return dynamodb.AttributeType.NUMBER;
            case AttrType.BINARY : return dynamodb.AttributeType.BINARY;
            default              : return dynamodb.AttributeType.STRING;
        }
    }

    /** Map a spec `StreamViewType` to a DynamoDB `StreamViewType`. */
    private streamView( s : StreamViewType ) : dynamodb.StreamViewType
    {
        switch( s )
        {
            case StreamViewType.KEYS_ONLY : return dynamodb.StreamViewType.KEYS_ONLY;
            case StreamViewType.NEW_IMAGE : return dynamodb.StreamViewType.NEW_IMAGE;
            case StreamViewType.OLD_IMAGE : return dynamodb.StreamViewType.OLD_IMAGE;
            default                       : return dynamodb.StreamViewType.NEW_AND_OLD_IMAGES;
        }
    }

    /** Map a spec `JobRuntime` to a CDK Lambda `Runtime` (defaults to Node 22). */
    private runtime( r : JobRuntime | undefined ) : lambda.Runtime
    {
        return ( r === JobRuntime.NODE_20 ) ? lambda.Runtime.NODEJS_20_X : lambda.Runtime.NODEJS_22_X;
    }

    /**
     * Resolve the Lambda deployment asset — the service's built `apps/<domain>/<service>/bin`
     * (apps are grouped by domain, e.g. `apps/core/auth`), or an inline placeholder if absent.
     */
    private functionCode() : lambda.Code
    {
        const assetPath : string | undefined = this.serviceBinPath();
        return ( assetPath !== undefined )
            ? lambda.Code.fromAsset( assetPath )
            : lambda.Code.fromInline( "exports.handler = async () => ({});" );   // scaffold placeholder
    }

    /**
     * Find the service's built `bin` directory under any `apps/<domain>/<service>` group,
     * returning its absolute path, or `undefined` if the service hasn't been built yet.
     */
    private serviceBinPath() : string | undefined
    {
        const appsRoot : string = path.join( __dirname, "..", "..", "apps" );
        if( !fs.existsSync( appsRoot ) ) return undefined;

        const domains : Array<string> = fs.readdirSync( appsRoot )
            .filter( ( d : string ) : boolean => fs.statSync( path.join( appsRoot, d ) ).isDirectory() );

        for( const domain of domains )
        {
            const candidate : string = path.join( appsRoot, domain, this.service, "bin" );
            if( fs.existsSync( candidate ) ) return candidate;
        }
        return undefined;
    }

    /** Map a retention in days to the nearest CloudWatch `RetentionDays` enum value. */
    private retention( days : number ) : logs.RetentionDays
    {
        if( days <= 1 )   return logs.RetentionDays.ONE_DAY;
        if( days <= 3 )   return logs.RetentionDays.THREE_DAYS;
        if( days <= 7 )   return logs.RetentionDays.ONE_WEEK;
        if( days <= 14 )  return logs.RetentionDays.TWO_WEEKS;
        if( days <= 30 )  return logs.RetentionDays.ONE_MONTH;
        if( days <= 90 )  return logs.RetentionDays.THREE_MONTHS;
        if( days <= 365 ) return logs.RetentionDays.ONE_YEAR;
        return logs.RetentionDays.TWO_YEARS;
    }

    //////////////////////////////////////////////////////////////////////////////
    /**
     * Create a Cognito user pool (+ app clients + Lambda triggers). The API's JWT authorizer
     * references this provisioned pool directly rather than a hardcoded user-pool id.
     */
    private makeUserPool( spec : UserPoolSpec ) : void
    {
        const pool : cognito.UserPool = new cognito.UserPool( this, `Pool-${spec.key}`, {
            userPoolName      : this.name( ResourceKind.USER_POOL, spec.key ),
            selfSignUpEnabled : spec.selfSignUp ?? false,
            signInAliases     : spec.signInAliases ? { email: spec.signInAliases.email, username: spec.signInAliases.username, phone: spec.signInAliases.phone } : undefined,
            mfa               : spec.mfa === MfaMode.REQUIRED ? cognito.Mfa.REQUIRED : spec.mfa === MfaMode.OPTIONAL ? cognito.Mfa.OPTIONAL : cognito.Mfa.OFF,
            passwordPolicy    : spec.passwordMinLength ? { minLength: spec.passwordMinLength } : undefined,
        } );

        const trig : UserPoolSpec[ "triggers" ] = spec.triggers;
        if( trig?.preTokenGeneration ) this.attachTrigger( pool, cognito.UserPoolOperation.PRE_TOKEN_GENERATION, trig.preTokenGeneration );
        if( trig?.postAuthentication ) this.attachTrigger( pool, cognito.UserPoolOperation.POST_AUTHENTICATION, trig.postAuthentication );
        if( trig?.preSignUp )          this.attachTrigger( pool, cognito.UserPoolOperation.PRE_SIGN_UP, trig.preSignUp );

        ( spec.clients ?? [] ).forEach( c => {
            const client : cognito.UserPoolClient = pool.addClient( `Client-${c.key}`, {
                generateSecret : c.generateSecret,
                oAuth          : c.callbackUrls ? { callbackUrls: c.callbackUrls } : undefined,
            } );
            if( !this._userPoolClient ) this._userPoolClient = client;
        } );

        if( !this._userPool ) this._userPool = pool;
        this.envVars[ envVarName( ResourceKind.USER_POOL, spec.key ) ] = pool.userPoolId;
    }

    /** Attach an owned Lambda (by logical key) as a Cognito user-pool trigger. */
    private attachTrigger( pool : cognito.UserPool, op : cognito.UserPoolOperation, fnKey : string ) : void
    {
        const fn : lambda.Function | undefined = this.lambdas.find( l => l.functionName === this.name( ResourceKind.FUNCTION, fnKey ) );
        if( fn ) pool.addTrigger( op, fn );
    }

    //////////////////////////////////////////////////////////////////////////////
    /** Create a MediaConvert transcoding queue (transcode jobs are submitted at runtime via the SDK). */
    private makeMediaConvert( spec : MediaConvertSpec ) : void
    {
        const q : mediaconvert.CfnQueue = new mediaconvert.CfnQueue( this, `Mc-${spec.key}`, {
            name        : this.name( ResourceKind.MEDIACONVERT, spec.key ),
            pricingPlan : spec.reserved ? "RESERVED" : "ON_DEMAND",
        } );
        this.envVars[ envVarName( ResourceKind.MEDIACONVERT, spec.key ) ] = q.ref;
    }

    //////////////////////////////////////////////////////////////////////////////
    /** Create a CloudWatch RUM app monitor for real-user monitoring of the web app. */
    private makeRum( spec : RumSpec ) : void
    {
        const monitor : rum.CfnAppMonitor = new rum.CfnAppMonitor( this, `Rum-${spec.key}`, {
            name   : this.name( ResourceKind.RUM, spec.key ),
            domain : spec.domain,
            appMonitorConfiguration : { sessionSampleRate: spec.sessionSampleRate ?? 1 },
        } );
        this.envVars[ envVarName( ResourceKind.RUM, spec.key ) ] = monitor.ref;
    }

    //////////////////////////////////////////////////////////////////////////////
    /**
     * Create an Amplify Hosting app: branches (per env), a custom domain (Amplify auto-manages
     * the SSL cert), and optional basic-auth protected previews.
     */
    private makeAmplify( spec : AmplifySpec ) : void
    {
        const app : amplify.CfnApp = new amplify.CfnApp( this, `Amplify-${spec.key}`, {
            name           : this.name( ResourceKind.AMPLIFY, spec.key ),
            repository     : spec.repository,
            environmentVariables : spec.environmentVariables
                ? Object.entries( spec.environmentVariables ).map( ( [ name, value ] ) => ( { name, value } ) )
                : undefined,
            // Basic-auth protected previews. Replace the placeholder password with a Secret value.
            basicAuthConfig : spec.passwordProtect
                ? { enableBasicAuth: true, username: "preview", password: "CHANGE-ME-via-secret" }
                : undefined,
        } );
        if( spec.passwordProtect ) cdk.Annotations.of( this ).addInfo( `Amplify ${spec.key}: replace the placeholder basic-auth password with a Secrets Manager value` );

        ( spec.branches ?? [] ).forEach( b => new amplify.CfnBranch( this, `AmplifyBranch-${spec.key}-${b.name}`, {
            appId      : app.attrAppId,
            branchName : b.name,
            stage      : b.stage,
        } ) );

        // Custom domain — Amplify provisions and renews the SSL certificate automatically.
        if( spec.domain )
        {
            new amplify.CfnDomain( this, `AmplifyDomain-${spec.key}`, {
                appId         : app.attrAppId,
                domainName    : spec.domain,
                subDomainSettings : ( spec.branches ?? [] ).map( b => ( { branchName: b.name, prefix: b.stage === "PRODUCTION" ? "" : b.name } ) ),
            } );
        }
        this.envVars[ envVarName( ResourceKind.AMPLIFY, spec.key ) ] = app.attrAppId;
    }

    //////////////////////////////////////////////////////////////////////////////
    /** Create an API Gateway WebSocket API (real-time), routes integrated to owned Lambdas. */
    private makeWebSocketApi( spec : WebSocketApiSpec ) : void
    {
        const lambdaFor = ( fnKey : string ) : lambda.Function | undefined =>
            this.lambdas.find( l => l.functionName === this.name( ResourceKind.FUNCTION, fnKey ) );

        const route = ( key : string ) : apigwv2.WebSocketRouteOptions | undefined => {
            const spec_ : WebSocketRouteSpec | undefined = spec.routes.find( r => r.routeKey === key );
            const fn : lambda.Function | undefined = spec_ ? lambdaFor( spec_.function ) : undefined;
            return fn ? { integration: new WebSocketLambdaIntegration( `WsInt-${key}`, fn ) } : undefined;
        };

        const wsApi : apigwv2.WebSocketApi = new apigwv2.WebSocketApi( this, `Ws-${spec.key}`, {
            apiName               : this.name( ResourceKind.WEBSOCKET, spec.key ),
            connectRouteOptions   : route( "$connect" ),
            disconnectRouteOptions : route( "$disconnect" ),
            defaultRouteOptions   : route( "$default" ),
        } );

        // Custom (non-$) routes.
        spec.routes.filter( r => !r.routeKey.startsWith( "$" ) ).forEach( r => {
            const fn : lambda.Function | undefined = lambdaFor( r.function );
            if( fn ) wsApi.addRoute( r.routeKey, { integration: new WebSocketLambdaIntegration( `WsInt-${r.routeKey}`, fn ) } );
        } );

        const stage : apigwv2.WebSocketStage = new apigwv2.WebSocketStage( this, `WsStage-${spec.key}`, {
            webSocketApi : wsApi,
            stageName    : spec.stageName ?? "ws",
            autoDeploy   : true,
        } );
        this.envVars[ envVarName( ResourceKind.WEBSOCKET, spec.key ) ] = stage.url;
    }

    //////////////////////////////////////////////////////////////////////////////
    /** Create an EventBridge bus and its rules (schedule or event-pattern) with queue/Lambda targets. */
    private makeEventBus( spec : EventBusSpec ) : void
    {
        const bus : events.EventBus = new events.EventBus( this, `Bus-${spec.key}`, { eventBusName: this.name( ResourceKind.EVENT_BUS, spec.key ) } );

        ( spec.rules ?? [] ).forEach( r => {
            const rule : events.Rule = new events.Rule( this, `Rule-${spec.key}-${r.key}`, {
                ruleName     : this.name( ResourceKind.EVENT_BUS, `${spec.key}-${r.key}` ),
                description  : r.description,
                eventBus     : r.schedule ? undefined : bus,                 // scheduled rules run on the default bus
                schedule     : r.schedule ? events.Schedule.expression( r.schedule ) : undefined,
                eventPattern : r.eventPattern as events.EventPattern | undefined,
            } );
            r.targets.forEach( t => {
                if( t.kind === ResourceKind.QUEUE )
                {
                    const q : sqs.IQueue | undefined = this.queues.get( t.key );
                    if( q ) rule.addTarget( new targets.SqsQueue( q ) );
                }
                else if( t.kind === ResourceKind.FUNCTION )
                {
                    const fn : lambda.Function | undefined = this.lambdas.find( l => l.functionName === this.name( ResourceKind.FUNCTION, t.key ) );
                    if( fn ) rule.addTarget( new targets.LambdaFunction( fn ) );
                }
            } );
        } );

        this.envVars[ envVarName( ResourceKind.EVENT_BUS, spec.key ) ] = bus.eventBusName;
    }

    //////////////////////////////////////////////////////////////////////////////
    /** Create a CloudWatch metric alarm (per-env threshold) with optional SNS alarm actions. */
    private makeAlarm( spec : AlarmSpec ) : void
    {
        const metric : cloudwatch.Metric = new cloudwatch.Metric( {
            namespace  : spec.namespace ?? "AWS/Lambda",
            metricName : spec.metric,
            dimensionsMap : spec.dimensions,
            statistic  : spec.statistic,
            period     : spec.periodSec ? cdk.Duration.seconds( spec.periodSec ) : undefined,
        } );

        const perEnv : { threshold? : number; evaluationPeriods? : number } | undefined = forEnv( spec.perEnv, this.deployEnv );
        const alarm : cloudwatch.Alarm = new cloudwatch.Alarm( this, `Alarm-${spec.key}`, {
            alarmName          : this.name( ResourceKind.LOG_GROUP, spec.key ),
            metric,
            threshold          : perEnv?.threshold ?? spec.threshold,
            evaluationPeriods  : perEnv?.evaluationPeriods ?? spec.evaluationPeriods ?? 1,
            comparisonOperator : this.comparison( spec.comparison ),
            treatMissingData   : this.treatMissing( spec.treatMissingData ),
        } );

        ( spec.alarmActions ?? [] ).forEach( a => {
            if( a.kind === ResourceKind.SNS_TOPIC )
            {
                const topic : sns.ITopic | undefined = this.topics.get( a.key );
                if( topic ) alarm.addAlarmAction( new cwactions.SnsAction( topic ) );
            }
        } );
    }

    //////////////////////////////////////////////////////////////////////////////
    /** Create a Route 53 record — a value record, or an alias to an in-stack CloudFront/ALB target. */
    private makeDnsRecord( spec : DnsRecordSpec ) : void
    {
        const alias : route53.CfnRecordSet.AliasTargetProperty | undefined = spec.aliasTo ? this.aliasTarget( spec.aliasTo ) : undefined;
        new route53.CfnRecordSet( this, `Dns-${spec.key}`, {
            hostedZoneName  : `${spec.hostedZone}.`,
            name            : spec.recordName,
            type            : spec.type,
            ttl             : alias ? undefined : String( spec.ttl ?? 300 ),
            resourceRecords : ( !alias && spec.target ) ? [ spec.target ] : undefined,
            aliasTarget     : alias,
        } );
    }

    /** Resolve an aliasTo ResourceRef to a Route 53 alias target (CloudFront / ALB). */
    private aliasTarget( ref : ResourceRef ) : route53.CfnRecordSet.AliasTargetProperty | undefined
    {
        if( ref.kind === ResourceKind.CDN )
        {
            const dist : cloudfront.IDistribution | undefined = this.cdns.get( ref.key );
            // CloudFront's fixed hosted-zone id.
            if( dist ) return { dnsName: dist.distributionDomainName, hostedZoneId: "Z2FDTNDATAQYW2" };
        }
        else if( ( ref.kind === ResourceKind.SERVICE || ref.kind === ResourceKind.API ) && this._alb )
        {
            return { dnsName: this._alb.loadBalancerDnsName, hostedZoneId: this._alb.loadBalancerCanonicalHostedZoneId };
        }
        cdk.Annotations.of( this ).addInfo( `dns alias to ${ref.kind}:${ref.key} could not be resolved in this stack` );
        return undefined;
    }

    /** Map a spec `AlarmComparison` to a CloudWatch `ComparisonOperator`. */
    private comparison( c : AlarmComparison ) : cloudwatch.ComparisonOperator
    {
        switch( c )
        {
            case AlarmComparison.GTE : return cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD;
            case AlarmComparison.LT  : return cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD;
            case AlarmComparison.LTE : return cloudwatch.ComparisonOperator.LESS_THAN_OR_EQUAL_TO_THRESHOLD;
            default                  : return cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD;
        }
    }

    /** Map a spec `treatMissingData` value to a CloudWatch `TreatMissingData` (defaults to MISSING). */
    private treatMissing( t : AlarmSpec[ "treatMissingData" ] ) : cloudwatch.TreatMissingData
    {
        switch( t )
        {
            case "breaching"    : return cloudwatch.TreatMissingData.BREACHING;
            case "notBreaching" : return cloudwatch.TreatMissingData.NOT_BREACHING;
            case "ignore"       : return cloudwatch.TreatMissingData.IGNORE;
            default             : return cloudwatch.TreatMissingData.MISSING;
        }
    }

    //////////////////////////////////////////////////////////////////////////////
    /** True (and emits a synth notice) when a kind isn't emulated by LocalStack and we're deploying local. */
    private skipLocal( kind : ResourceKind ) : boolean
    {
        if( isLocal( this.deployEnv ) && !supportedLocally( kind ) )
        {
            cdk.Annotations.of( this ).addInfo( `[local] skipping ${kind} — not emulated by LocalStack` );
            return true;
        }
        return false;
    }

    //////////////////////////////////////////////////////////////////////////////
    /** Warn (at synth time) about any manifest resource kinds this scaffold does not yet translate. */
    private warnUnsupported( m : ResourceManifest ) : void
    {
        void m;   // all manifest resource kinds are now translated by this scaffold
    }
}
