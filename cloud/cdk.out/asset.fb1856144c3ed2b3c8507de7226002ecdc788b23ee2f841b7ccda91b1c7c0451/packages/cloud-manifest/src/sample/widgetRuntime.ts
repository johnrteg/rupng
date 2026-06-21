//
// SAMPLE runtime usage — how the service reads back the resources it declared.
//
// The /cloud CDK app injected each resource's identifier as an env var named by
// envVarName(kind, key) (e.g. BUCKET_FILES, TABLE_WIDGETS, QUEUE_PROCESS,
// KMS_DATA, APP_CONFIG_CONFIG). CloudResolver turns logical keys back into those
// physical identifiers — the service never hardcodes a physical name.
//

import { Environment, CloudResolver } from "../index";

// Resolve which environment we're running in (injected by the CDK app, here defaulted).
const env : Environment = ( process.env.ENVIRONMENT as Environment ) ?? Environment.DEV;

// One resolver per service.
const cloud : CloudResolver = new CloudResolver( env, "widget" );

//
// Logical-key lookups -> physical identifiers (all from injected env vars):
//
export const Resources =
{
    filesBucket : cloud.bucketName( "files" ),     // <- BUCKET_FILES
    widgetTable : cloud.tableName( "widgets" ),    // <- TABLE_WIDGETS
    workQueue   : cloud.queueUrl( "process" ),     // <- QUEUE_PROCESS
    dataKey     : cloud.kmsKeyArn( "data" ),       // <- KMS_DATA
    appConfig   : cloud.appConfigId( "config" ),   // <- APP_CONFIG_CONFIG
};

// Optional resources resolve to undefined instead of throwing:
//   const maybe = cloud.lookup( ResourceKind.BUCKET, "thumbnails" );
