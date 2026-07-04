//
// SAMPLE service manifest — a learning reference, not a real service.
//
// Shows the common building blocks a developer will reach for:
//   * a KMS key used to encrypt data at rest
//   * an S3 bucket + a DynamoDB table (both encrypted with that key)
//   * an SQS queue (with an auto DLQ) the service consumes
//   * an AppConfig application for runtime config / feature flags
//   * a Lambda worker, triggered by the queue, with those resources injected
//   * a `Array<uses>` reference to ANOTHER service's resource (cross-service access)
//
// A real service exports its manifest from `<service>/src/CloudManifest.ts`. The /cloud
// CDK app imports it, creates these resources, grants least-privilege IAM from the
// access intents, and injects the identifiers as env vars the service reads back
// via CloudResolver (see widgetRuntime.ts).
//

import {
    ResourceManifest,
    AccessIntent, ResourceKind,
    BucketAccess, BillingMode, AttrType,
    JobRuntime,
} from "../index";

export const widgetManifest : ResourceManifest =
{
    service     : "widget",
    description : "Sample service demonstrating S3, SQS, DynamoDB, KMS and AppConfig.",

    owns:
    {
        // 1. A customer-managed KMS key, referenced by the bucket and table below.
        keys:
        [
            { key: "data", alias: "widget-data", enableRotation: true, description: "Encrypts widget data at rest" },
        ],

        // 2. An encrypted S3 bucket for widget files (private; served via signed URLs).
        buckets:
        [
            {
                key       : "files",
                access    : BucketAccess.PRIVATE,
                versioned : true,
                kmsKey    : "data",                       // -> Array<keys>.key above
                lifecycle : [ { expireDays: 90 } ],
            },
        ],

        // 3. An encrypted DynamoDB table keyed by account + widget id.
        tables:
        [
            {
                key          : "widgets",
                partitionKey : { name: "accountId", type: AttrType.STRING },
                sortKey      : { name: "widgetId",  type: AttrType.STRING },
                billingMode  : BillingMode.ON_DEMAND,
                kmsKey       : "data",
                ttlAttribute : "expiresAt",
            },
        ],

        // 4. A work queue with an automatic dead-letter queue after 5 failed receives.
        queues:
        [
            { key: "process", maxReceiveCount: 5, dlq: true, visibilityTimeoutSec: 60 },
        ],

        // 5. Runtime config + feature flags via AppConfig.
        appConfig:
        [
            {
                key         : "config",
                application : "widget",
                profiles    : [ { key: "settings", type: "freeform" }, { key: "flags", type: "feature_flags" } ],
            },
        ],

        // 6. A Lambda worker (a "job") triggered by the queue. The CDK app injects the bucket
        //    name, table name, key ARN and AppConfig id as env vars on this function.
        jobs:
        [
            {
                key        : "processor",
                handler    : "processor.handler",
                runtime    : JobRuntime.NODE_22,
                memoryMB   : { default: 256, production: 512 },     // per-env sizing
                timeoutSec : 30,
                triggers   :
                [
                    { source: "queue", ref: { service: "widget", kind: ResourceKind.QUEUE, key: "process", access: AccessIntent.CONSUME }, batchSize: 10 },
                ],
            },
        ],
    },

    // 7. This service also READS the media service's bucket (cross-service access).
    //    The CDK app grants the worker's role read on media's bucket — least privilege
    //    derived purely from this declared intent.
    uses:
    [
        { service: "media", kind: ResourceKind.BUCKET, key: "media", access: AccessIntent.READ },
    ],
};

export default widgetManifest;
