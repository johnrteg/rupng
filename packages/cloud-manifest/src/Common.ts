//
// Shared primitives used across all resource specs.
//

/** Logical key for a resource, unique within a (service, kind). e.g. "events", "contacts". */
export type ResourceKey = string;

export type Tags = Record<string, string>;

/** The kinds of resource the spec understands. */
export enum ResourceKind
{
    QUEUE     = "queue",        // SQS
    BUCKET    = "bucket",       // S3
    TABLE     = "table",        // DynamoDB
    DATABASE  = "database",     // RDS / Aurora / Postgres
    SECRET    = "secret",       // Secrets Manager / SSM SecureString
    EVENT_BUS = "eventbus",     // EventBridge
    TOPIC     = "topic",        // Kafka / MSK topic
    FUNCTION  = "function",     // Lambda
    SERVICE   = "service",      // ECS service (long-running)
    BATCH_JOB = "batchjob",     // AWS Batch
    API       = "api",          // API Gateway
    LOG_GROUP = "loggroup",     // CloudWatch Logs
    SNS_TOPIC = "snstopic",     // SNS (alarm/notification fan-out)
    KMS_KEY   = "kms",          // KMS customer-managed key
    APP_CONFIG = "appconfig",   // AWS AppConfig (runtime config / feature flags)
    CACHE     = "cache",        // ElastiCache Serverless (Redis / Valkey)
    SES       = "ses",          // SES sending identity
    SEARCH    = "search",       // OpenSearch (serverless or node-based)
    CDN       = "cdn",          // CloudFront distribution
    USER_POOL = "userpool",     // Cognito user pool
    MEDIACONVERT = "mediaconvert", // Elemental MediaConvert (video transcoding)
    RUM       = "rum",          // CloudWatch RUM (real-user monitoring)
    AMPLIFY   = "amplify",      // Amplify Hosting (web app)
    WEBSOCKET = "websocket",    // API Gateway WebSocket API
    SCHEDULER = "scheduler",    // EventBridge Scheduler (dynamic cron/rate schedules)
}

/** How a consumer intends to use a resource — drives least-privilege IAM. */
export enum AccessIntent
{
    READ       = "read",
    WRITE      = "write",
    READ_WRITE = "readwrite",
    SEND       = "send",        // queue producer
    CONSUME    = "consume",     // queue consumer
    PUBLISH    = "publish",     // topic / event bus producer
    SUBSCRIBE  = "subscribe",   // topic / event bus consumer
    INVOKE     = "invoke",      // lambda
    ADMIN      = "admin",
}

/**
 * A reference to a resource owned by some service (possibly another), plus the
 * access intent. Used in a manifest's `Array<uses>` and as event/notification targets.
 */
export interface ResourceRef
{
    service : string;           // the owning service
    kind    : ResourceKind;
    key     : ResourceKey;
    access  : AccessIntent;
}
