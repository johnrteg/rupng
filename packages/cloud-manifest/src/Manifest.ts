//
// The manifest a service exports to declare its cloud footprint, and the
// platform-level manifest for shared/foundational infrastructure.
//

import { PerEnv } from "./Environment";
import { ResourceRef, Tags } from "./Common";
import {
    QueueSpec, BucketSpec, TableSpec, DatabaseSpec, SecretSpec,
    EventBusSpec, JobSpec, ApiSpec, KafkaTopicSpec, KafkaBindingSpec,
    ServiceSpec, BatchJobSpec, LogGroupSpec, AlarmSpec, SnsTopicSpec, DnsRecordSpec,
    KmsKeySpec, AppConfigSpec, CacheSpec, SesSpec,
    UserPoolSpec, MediaConvertSpec, RumSpec, AmplifySpec, WebSocketApiSpec, SchedulerSpec,
} from "./Resources";
import { Sizing } from "./Sizing";

// ────────────────────────────────────────────────────────────────────────────
// Per-service manifest
// ────────────────────────────────────────────────────────────────────────────

/** Resources a service OWNS (creates). One service owns each resource. */
export interface OwnedResources
{
    queues?     : Array<QueueSpec>;
    buckets?    : Array<BucketSpec>;
    tables?     : Array<TableSpec>;
    databases?  : Array<DatabaseSpec>;
    secrets?    : Array<SecretSpec>;
    eventBuses? : Array<EventBusSpec>;
    jobs?       : Array<JobSpec>;         // Lambda workers (the platform `Job` base — queue/event/schedule driven)
    services?   : Array<ServiceSpec>;        // ECS long-running services
    batchJobs?  : Array<BatchJobSpec>;
    topics?     : Array<KafkaTopicSpec>;
    snsTopics?  : Array<SnsTopicSpec>;
    api?        : ApiSpec;                   // a service exposes at most one API
    alarms?     : Array<AlarmSpec>;
    logGroups?  : Array<LogGroupSpec>;
    dnsRecords? : Array<DnsRecordSpec>;
    keys?       : Array<KmsKeySpec>;         // KMS CMKs referenced by other resources
    appConfig?  : Array<AppConfigSpec>;      // AWS AppConfig applications/profiles
    caches?     : Array<CacheSpec>;          // ElastiCache Serverless (Redis / Valkey)
    ses?        : Array<SesSpec>;            // SES sending identities
    userPools?  : Array<UserPoolSpec>;       // Cognito user pools (auth)
    mediaConvert? : Array<MediaConvertSpec>; // Elemental MediaConvert queues
    rum?        : Array<RumSpec>;            // CloudWatch RUM app monitors
    amplify?    : Array<AmplifySpec>;        // Amplify Hosting apps (web)
    webSocketApi? : WebSocketApiSpec;        // a service exposes at most one WebSocket API
    scheduler?  : SchedulerSpec;             // EventBridge Scheduler — dynamic runtime schedules
}

/**
 * A service's complete cloud declaration. Exported from `<service>/src/CloudManifest.ts`
 * (separate from runtime code) and consumed by the /cloud CDK app, which turns it
 * into constructs, least-privilege IAM (from `uses` + access intent), and the
 * runtime env vars / SSM params the service reads back via the CloudResolver.
 */
export interface ResourceManifest
{
    service      : string;
    description? : string;

    // Enable AWS X-Ray active tracing across this service's compute (Lambda + ECS task role).
    // (HTTP APIs don't support gateway-level X-Ray — tracing happens at the compute layer.)
    tracing?     : boolean;

    owns         : OwnedResources;
    uses?        : Array<ResourceRef>;       // resources owned by OTHER services + access intent

    // Kafka pub/sub against the shared cluster (topics may be owned here or external)
    publishes?   : Array<KafkaBindingSpec>;
    subscribes?  : Array<KafkaBindingSpec>;

    tags?        : Tags;
}

// ────────────────────────────────────────────────────────────────────────────
// Platform / shared manifest — foundational infra referenced by service stacks
// ────────────────────────────────────────────────────────────────────────────

export interface VpcSpec
{
    cidr?           : string;
    maxAzs?         : number;
    natGateways?    : PerEnv<number>;        // cost lever: fewer NATs in dev
    privateSubnets? : boolean;
}

export interface KafkaClusterSpec
{
    brokers?   : PerEnv<number>;
    sizing?    : PerEnv<Sizing>;             // 1..10 -> broker instance type
    version?   : string;
    storageGB? : PerEnv<number>;
}

export interface SearchClusterSpec                  // OpenSearch (search + analytics + log search)
{
    serverless? : boolean;                   // OpenSearch Serverless (OCUs) vs a node-based domain
    sizing?     : PerEnv<Sizing>;            // 1..10 -> node instance type (node-based) or OCU caps (serverless)
    nodes?      : PerEnv<number>;            // node-based only
    storageGB?  : PerEnv<number>;            // node-based only
    dataAccessPrincipals? : Array<string>;   // IAM role/user ARNs granted data access (serverless)
}

export interface CloudTrailSpec
{
    enabled           : boolean;
    s3BucketKey?      : string;
    multiRegion?      : boolean;
    managementEvents? : boolean;
    dataEvents?       : boolean;
}

/** Shared infrastructure that service stacks depend on, defined once. */
export interface PlatformManifest
{
    vpc?            : VpcSpec;
    kafkaCluster?   : KafkaClusterSpec;
    searchCluster?  : SearchClusterSpec;
    sharedEventBus? : EventBusSpec;          // the platform-wide event bus
    cloudTrail?     : CloudTrailSpec;
    hostedZones?    : Array<string>;         // Route 53 zones managed by the platform
    // Platform-shared secrets granted to EVERY service (not owned by any one service) — the AI provider
    // API keys (OpenAI, Anthropic, …). Each ServiceStack is granted read + gets the ARN injected as
    // `SECRET_<KEY>`, so any service's AiFactory can resolve them. Service-specific keys stay in that
    // service's `owns.secrets`.
    secrets?        : Array<SecretSpec>;
    tags?           : Tags;
}
