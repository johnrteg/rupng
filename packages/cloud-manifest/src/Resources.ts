//
// Declarative specs for each AWS resource a service can own.
// These are service-agnostic DATA — the /cloud CDK app translates them into constructs,
// IAM grants, and runtime env injection.
//

import { PerEnv } from "./Environment";
import { Sizing } from "./Sizing";
import { ResourceKey, ResourceRef, Tags } from "./Common";
import type { Events } from "@repo/events";   // Kafka topic identity = Events.Object / Events.Stream

// ────────────────────────────────────────────────────────────────────────────
// EventBridge Scheduler — provisions a per-service schedule group + execution role so the
// service can create/manage DYNAMIC schedules (cron/rate/one-time) at RUNTIME via the
// Scheduler facade. (For static, deploy-time schedules, use an EventBusSpec rule instead.)
// ────────────────────────────────────────────────────────────────────────────

export interface SchedulerSpec
{
    group? : ResourceKey;       // schedule-group name (default: "<env>-<service>")
    tags?  : Tags;
}

// ────────────────────────────────────────────────────────────────────────────
// SQS — queues
// ────────────────────────────────────────────────────────────────────────────

export interface QueueSpec
{
    key                  : ResourceKey;
    fifo?                : boolean;
    visibilityTimeoutSec? : number;
    messageRetentionDays? : number;          // 1-14
    deliveryDelaySeconds? : number;
    maxReceiveCount?     : number;           // receives before -> DLQ
    dlq?                 : boolean | { key : ResourceKey };   // true = auto-create a DLQ
    contentBasedDedup?   : boolean;          // FIFO only
    kmsKey?              : ResourceKey;       // -> a KmsKeySpec for CMK encryption (else AWS-managed)
    tags?                : Tags;
}

// ────────────────────────────────────────────────────────────────────────────
// S3 — buckets
// ────────────────────────────────────────────────────────────────────────────

export enum BucketAccess
{
    PRIVATE    = "private",       // no public access; served via signed URLs
    PUBLIC_CDN = "public_cdn",    // behind CloudFront + OAC; no direct public access
}

export interface BucketSpec
{
    key                : ResourceKey;
    access?            : BucketAccess;       // default PRIVATE
    versioned?         : boolean;
    encryption?        : boolean;            // default true (AWS-managed)
    kmsKey?            : ResourceKey;         // -> a KmsKeySpec for CMK encryption
    cors?              : boolean;
    lifecycle?         : Array<BucketLifecycleRule>;
    eventNotifications? : Array<BucketEventNotification>;
    cdn?               : CdnSpec;            // when access = PUBLIC_CDN
    presignedUpload?   : boolean;            // provision a presigner Lambda (S3 PUT/POST) + API route
    tags?              : Tags;
}

export interface BucketLifecycleRule
{
    prefix?                  : string;
    expireDays?              : number;
    transitionToInfrequentDays? : number;
    transitionToGlacierDays? : number;
}

export interface BucketEventNotification
{
    event   : "created" | "removed";
    target  : ResourceRef | { eventbridge : true };   // fan to a queue/lambda or onto EventBridge
    prefix? : string;
    suffix? : string;
}

export interface CdnSpec
{
    domain?           : PerEnv<string>;      // custom domain (Route 53 + ACM)
    originAccessControl? : boolean;          // OAC so only CloudFront reads the bucket (default true)
    defaultTtlSec?    : number;
}

// ────────────────────────────────────────────────────────────────────────────
// DynamoDB — tables
// ────────────────────────────────────────────────────────────────────────────

export enum AttrType { STRING = "S", NUMBER = "N", BINARY = "B" }

export enum BillingMode { ON_DEMAND = "on_demand", PROVISIONED = "provisioned" }

export enum StreamViewType
{
    KEYS_ONLY          = "KEYS_ONLY",
    NEW_IMAGE          = "NEW_IMAGE",
    OLD_IMAGE          = "OLD_IMAGE",
    NEW_AND_OLD_IMAGES = "NEW_AND_OLD_IMAGES",
}

export interface KeyAttr { name : string; type : AttrType; }

export interface GsiSpec
{
    name         : string;
    partitionKey : KeyAttr;
    sortKey?     : KeyAttr;
    projection?  : "ALL" | "KEYS_ONLY" | "INCLUDE";
    projected?   : Array<string>;            // when projection = INCLUDE
}

export interface TableSpec
{
    key                  : ResourceKey;
    partitionKey         : KeyAttr;
    sortKey?             : KeyAttr;
    billingMode?         : BillingMode;      // default ON_DEMAND
    capacity?            : PerEnv<{ readUnits : number; writeUnits : number }>;   // PROVISIONED only
    ttlAttribute?        : string;
    stream?              : StreamViewType | false;
    globalSecondaryIndexes? : Array<GsiSpec>;
    pointInTimeRecovery? : boolean;
    kmsKey?              : ResourceKey;       // -> a KmsKeySpec for CMK encryption
    tags?                : Tags;
}

// ────────────────────────────────────────────────────────────────────────────
// RDS / Aurora / Postgres — relational databases
// ────────────────────────────────────────────────────────────────────────────

export enum DatabaseEngine
{
    POSTGRES        = "postgres",
    AURORA_POSTGRES = "aurora_postgres",
    MYSQL           = "mysql",
    AURORA_MYSQL    = "aurora_mysql",
}

export interface DatabaseSpec
{
    key                : ResourceKey;
    engine             : DatabaseEngine;
    version?           : string;
    databaseName?      : string;
    credentialsSecret? : ResourceKey;        // -> a SecretSpec holding username/password
    serverless?        : boolean;            // Aurora Serverless v2 (scales by sizing) vs a provisioned instance
    sizing?            : PerEnv<Sizing>;      // 1..10 -> instance class (provisioned) or ACU range (serverless)
    storageGB?         : PerEnv<number>;     // provisioned storage
    multiAz?           : boolean;
    backupRetentionDays? : number;
    deletionProtection? : boolean;
    tags?              : Tags;
}

// ────────────────────────────────────────────────────────────────────────────
// Secrets Manager / SSM SecureString
// ────────────────────────────────────────────────────────────────────────────

export enum SecretStore { SECRETS_MANAGER = "secrets_manager", SSM_PARAMETER = "ssm_parameter" }

export interface SecretSpec
{
    key          : ResourceKey;
    store?       : SecretStore;              // default SECRETS_MANAGER
    description? : string;
    rotationDays? : number;
    generate?    : boolean;                  // auto-generate a value on create
}

// ────────────────────────────────────────────────────────────────────────────
// EventBridge — buses, rules, schedules
// ────────────────────────────────────────────────────────────────────────────

export interface EventBusSpec
{
    key      : ResourceKey;
    archive? : boolean;
    rules?   : Array<EventRuleSpec>;
}

export interface EventRuleSpec
{
    key           : ResourceKey;
    description?  : string;
    eventPattern? : Record<string, unknown>; // content-based routing
    schedule?     : string;                  // cron(...) / rate(...) — EventBridge Scheduler
    targets       : Array<ResourceRef>;       // queue / lambda / etc.
}

// ────────────────────────────────────────────────────────────────────────────
// Jobs — Lambda workers (the platform `Job` base; queue / event / schedule driven)
// ────────────────────────────────────────────────────────────────────────────

export enum JobRuntime { NODE_20 = "nodejs20.x", NODE_22 = "nodejs22.x" }

export interface JobSpec
{
    key                  : ResourceKey;
    handler              : string;           // "file.export"
    runtime?             : JobRuntime;    // default NODE_22
    memoryMB?            : PerEnv<number>;
    timeoutSec?          : number;
    reservedConcurrency? : PerEnv<number>;
    environment?         : Record<string, string>;
    layers?              : Array<string>;
    vpc?                 : boolean;
    triggers?            : Array<JobTrigger>;
    tags?                : Tags;
}

export interface JobTrigger
{
    source     : "queue" | "eventbus" | "bucket" | "schedule" | "api";
    ref?       : ResourceRef;                // the source resource (queue/bus/bucket/api)
    schedule?  : string;                     // when source = schedule
    batchSize? : number;                     // when source = queue
}

// ────────────────────────────────────────────────────────────────────────────
// API Gateway — built primarily from public RestfulEndpoint definitions
// ────────────────────────────────────────────────────────────────────────────

export enum ApiAuthorizer { NONE = "none", COGNITO = "cognito", LAMBDA = "lambda" }

export interface ThrottleSpec
{
    rateLimit    : number;                   // steady-state requests/sec
    burstLimit   : number;                   // burst capacity
    quotaPerDay? : number;
}

export interface ApiSpec
{
    key         : ResourceKey;
    authorizer? : ApiAuthorizer;             // default COGNITO
    cognito?    : CognitoJwtConfig;          // required when authorizer = COGNITO
    domain?     : PerEnv<string>;            // custom domain per env (Route 53 + ACM)
    cors?       : boolean;
    throttle?   : PerEnv<ThrottleSpec>;      // default / account throttle per env
    endpoints?  : Array<ApiEndpointSpec>;    // typically GENERATED from public RestfulEndpoints
}

/** Cognito user pool details for the API Gateway JWT authorizer. */
export interface CognitoJwtConfig
{
    userPoolId : string;                     // issuer is derived: https://cognito-idp.<region>.amazonaws.com/<userPoolId>
    clientIds  : Array<string>;              // allowed audiences (app client ids)
    region?    : string;                     // defaults to the stack region
}

/**
 * One route at the gateway. The /cloud build generates these from RestfulEndpoint
 * definitions flagged public (RestfulEndpoint needs a `public`/exposure designation),
 * carrying the method, uri, and access role through to gateway config.
 */
export interface ApiEndpointSpec
{
    method        : string;                  // GET / POST / ...
    path          : string;                  // /sample/:id
    public        : boolean;                 // exposed at the gateway vs internal-only (VPC)
    authRequired? : boolean;
    minRole?      : string;                  // from RestfulEndpoint.access
    throttle?     : ThrottleSpec;            // per-endpoint override
}

// ────────────────────────────────────────────────────────────────────────────
// Kafka / MSK — topics and pub/sub bindings (cluster lives in PlatformManifest)
// ────────────────────────────────────────────────────────────────────────────

export interface KafkaTopicSpec
{
    key               : ResourceKey;
    topic             : string;
    partitions?       : PerEnv<number>;
    replicationFactor? : number;
    retentionMs?      : number;
}

// A Kafka binding. The DIRECTION is implied by which array it sits in on the manifest
// (`publishes` vs `subscribes`) — no redundant `mode` field. `consumerGroup` is only meaningful
// under `subscribes`.
//
// The `topic` IS the event identity, from @repo/events — never a literal:
//   • `Events.Object` (`<service>.<noun>`) — a per-entity state-change topic (the usual case), or
//   • `Events.Stream` — a broad analytics ingestion stream (behavior / engagement), or
//   • `{ external }` — an escape hatch for a topic outside the vocabulary.
export interface KafkaBindingSpec
{
    topic          : Events.Object | Events.Stream | { external : string };
    consumerGroup? : string;                 // subscribe only
}

// ────────────────────────────────────────────────────────────────────────────
// ECS — long-running services (Fastify Service), with load balancer + autoscaling
// ────────────────────────────────────────────────────────────────────────────

export enum LaunchType { FARGATE = "fargate", EC2 = "ec2" }

export interface LoadBalancerSpec
{
    public?  : boolean;
    domain?  : PerEnv<string>;
    // "LB limits per environment"
    limits?  : PerEnv<{ maxConnections? : number; idleTimeoutSec? : number; requestsPerSec? : number }>;
}

// Task-count autoscaling for an ECS service. `start` is the INITIAL desired count at deploy; once
// attached, Application Auto Scaling keeps the count within [min, max] on the target-tracking metric.
// Invariant (validated at synth): min <= start <= max. `start` defaults to `min`.
export interface AutoScalingSpec
{
    min                       : number;      // floor — never scale below this, even at idle (always-on capacity)
    max                       : number;      // ceiling under load
    start?                    : number;      // initial desired count at deploy (default: min); must be in [min, max]
    targetCpuPercent?         : number;      // target-tracking on CPU utilization
    targetRequestsPerTarget?  : number;      // target-tracking on ALB requests per target
}

export interface ServiceSpec
{
    key             : ResourceKey;
    launchType?     : LaunchType;            // default FARGATE
    sizing?         : PerEnv<Sizing>;        // 1..10 cpu/memory -> a valid Fargate task size
    desiredCount?   : PerEnv<number>;        // FIXED task count when NOT autoscaling (default 1). Ignored if
                                             // `autoscaling` is set — the initial count is `autoscaling.start`.
    autoscaling?    : PerEnv<AutoScalingSpec>;
    containerPort?  : number;                // e.g. 8000 (Fastify)
    healthCheckPath? : string;               // e.g. /health
    loadBalancer?   : LoadBalancerSpec;
    environment?    : Record<string, string>;
    vpc?            : boolean;               // default true for services
    tags?           : Tags;
}

// ────────────────────────────────────────────────────────────────────────────
// AWS Batch — batch compute jobs
// ────────────────────────────────────────────────────────────────────────────

export interface BatchJobSpec
{
    key               : ResourceKey;
    image             : string;              // container image
    sizing?           : PerEnv<Sizing>;      // 1..10 -> vCPU + memory
    arrayParallelism? : PerEnv<number>;      // array job fan-out
    retryAttempts?    : number;
    timeoutSec?       : number;
    environment?      : Record<string, string>;
}

// ────────────────────────────────────────────────────────────────────────────
// CloudWatch — log groups, metric alarms
// ────────────────────────────────────────────────────────────────────────────

export interface LogGroupSpec
{
    key           : ResourceKey;
    retentionDays? : PerEnv<number>;
}

export enum AlarmComparison { GT = "gt", GTE = "gte", LT = "lt", LTE = "lte" }

export interface AlarmSpec
{
    key                : ResourceKey;
    namespace?         : string;             // e.g. "AWS/SQS"
    metric             : string;             // e.g. "ApproximateNumberOfMessagesVisible"
    dimensions?        : Record<string, string>;
    statistic?         : "Average" | "Sum" | "Minimum" | "Maximum" | "p99" | "p95";
    threshold          : number;
    comparison         : AlarmComparison;
    periodSec?         : number;
    evaluationPeriods? : number;
    treatMissingData?  : "breaching" | "notBreaching" | "ignore" | "missing";
    perEnv?            : PerEnv<{ threshold? : number; evaluationPeriods? : number }>;
    alarmActions?      : Array<ResourceRef>; // e.g. an SNS topic
}

// ────────────────────────────────────────────────────────────────────────────
// SNS — notification fan-out (alarm actions, internal notifications)
// ────────────────────────────────────────────────────────────────────────────

export interface SnsTopicSpec
{
    key   : ResourceKey;
    fifo? : boolean;
    tags? : Tags;
}

// ────────────────────────────────────────────────────────────────────────────
// Route 53 — DNS records
// ────────────────────────────────────────────────────────────────────────────

export interface DnsRecordSpec
{
    key        : ResourceKey;
    hostedZone : string;                     // e.g. "rumbleup.com"
    recordName : string;                     // e.g. "api.rumbleup.com"
    type       : "A" | "AAAA" | "CNAME" | "TXT" | "MX";
    ttl?       : number;
    target?    : string;                     // value, when not an alias
    aliasTo?   : ResourceRef;                // alias to an ALB / CloudFront / API
}

// ────────────────────────────────────────────────────────────────────────────
// SES — email sending identity (domain) + configuration set
// ────────────────────────────────────────────────────────────────────────────

export interface SesSpec
{
    key              : ResourceKey;
    domain           : string;               // sending domain, e.g. "mail.rumbleup.com"
    mailFromDomain?  : string;               // custom MAIL FROM
    dkim?            : boolean;               // enable Easy DKIM (default true)
    configurationSet? : boolean;             // create a configuration set for event tracking
}

// ────────────────────────────────────────────────────────────────────────────
// Cognito — user pool (auth service owns it; the API JWT authorizer references it)
// ────────────────────────────────────────────────────────────────────────────

export enum MfaMode { OFF = "off", OPTIONAL = "optional", REQUIRED = "required" }

export interface UserPoolClientSpec
{
    key            : ResourceKey;
    generateSecret? : boolean;
    callbackUrls?  : Array<string>;
}

export interface UserPoolSpec
{
    key              : ResourceKey;
    selfSignUp?      : boolean;
    mfa?             : MfaMode;
    signInAliases?   : { email? : boolean; username? : boolean; phone? : boolean };
    passwordMinLength? : number;
    clients?         : Array<UserPoolClientSpec>;
    // Cognito Lambda triggers -> owned function keys (e.g. pre-token-generation stamps roles/session).
    triggers?        : { preTokenGeneration? : ResourceKey; postAuthentication? : ResourceKey; preSignUp? : ResourceKey };
}

// ────────────────────────────────────────────────────────────────────────────
// MediaConvert — video transcoding queue (transcode jobs are submitted at runtime)
// ────────────────────────────────────────────────────────────────────────────

export interface MediaConvertSpec
{
    key       : ResourceKey;
    reserved? : boolean;                     // RESERVED vs ON_DEMAND pricing
}

// ────────────────────────────────────────────────────────────────────────────
// CloudWatch RUM — real-user monitoring for the web app
// ────────────────────────────────────────────────────────────────────────────

export interface RumSpec
{
    key                : ResourceKey;
    domain             : string;             // the app domain to monitor
    sessionSampleRate? : number;             // 0..1
}

// ────────────────────────────────────────────────────────────────────────────
// Amplify Hosting — web app (custom domain + auto SSL + password-protected previews)
// ────────────────────────────────────────────────────────────────────────────

export interface AmplifyBranchSpec
{
    name   : string;                         // git branch
    stage? : "PRODUCTION" | "BETA" | "DEVELOPMENT" | "EXPERIMENTAL" | "PULL_REQUEST";
}

export interface AmplifySpec
{
    key                  : ResourceKey;
    repository?          : string;           // git repo URL
    branches?            : Array<AmplifyBranchSpec>;
    domain?              : string;           // custom domain — Amplify manages the SSL cert automatically
    passwordProtect?     : boolean;          // basic-auth protected previews
    environmentVariables? : Record<string, string>;
}

// ────────────────────────────────────────────────────────────────────────────
// API Gateway WebSocket — real-time (inbox / live updates)
// ────────────────────────────────────────────────────────────────────────────

export interface WebSocketRouteSpec
{
    routeKey : string;                       // "$connect" | "$disconnect" | "$default" | custom
    function : ResourceKey;                  // -> an owned Lambda
}

export interface WebSocketApiSpec
{
    key        : ResourceKey;
    routes     : Array<WebSocketRouteSpec>;
    stageName? : string;                     // default "ws"
}

// ────────────────────────────────────────────────────────────────────────────
// KMS — customer-managed encryption keys (referenced by buckets/tables/queues/etc.)
// ────────────────────────────────────────────────────────────────────────────

export interface KmsKeySpec
{
    key            : ResourceKey;
    alias?         : string;                 // human alias, e.g. "contact-data"
    description?   : string;
    enableRotation? : boolean;               // annual key rotation (default true)
}

// ────────────────────────────────────────────────────────────────────────────
// ElastiCache Serverless — Redis / Valkey
// ────────────────────────────────────────────────────────────────────────────

export enum CacheEngine { REDIS = "redis", VALKEY = "valkey" }

export interface CacheSpec
{
    key          : ResourceKey;
    engine?      : CacheEngine;              // default REDIS
    sizing?      : PerEnv<Sizing>;           // 1..10 -> serverless data (GB) + ECPU/sec caps
    description? : string;
}

// ────────────────────────────────────────────────────────────────────────────
// AWS AppConfig — runtime configuration & feature flags
// ────────────────────────────────────────────────────────────────────────────

export interface AppConfigSpec
{
    key           : ResourceKey;
    application?  : string;                  // AppConfig application name (defaults to the service)
    profiles      : Array<AppConfigProfile>; // one or more configuration profiles
    environments? : Array<string>;           // in-account deploy targets — default ["default"].
                                             // NOT dev/staging/prod (that's the AWS account boundary);
                                             // use for rings (canary/production), regions, or cells.
}

export interface AppConfigProfile
{
    key   : ResourceKey;                     // logical profile key, e.g. "settings", "flags"
    type? : "freeform" | "feature_flags";    // default "freeform"
}
