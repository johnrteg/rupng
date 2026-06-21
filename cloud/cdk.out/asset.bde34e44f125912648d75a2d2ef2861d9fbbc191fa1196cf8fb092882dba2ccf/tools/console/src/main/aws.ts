import { CloudFormationClient } from "@aws-sdk/client-cloudformation";
import { CloudWatchLogsClient } from "@aws-sdk/client-cloudwatch-logs";
import { CloudWatchClient } from "@aws-sdk/client-cloudwatch";
import { LambdaClient } from "@aws-sdk/client-lambda";
import { S3Client } from "@aws-sdk/client-s3";
import { ApiGatewayV2Client } from "@aws-sdk/client-apigatewayv2";
import { ECSClient } from "@aws-sdk/client-ecs";
import { fromIni } from "@aws-sdk/credential-providers";
import { loadSharedConfigFiles } from "@aws-sdk/shared-ini-file-loader";

import type { Target, TargetInfo } from "../shared/types";

//
// AWS access for the Monitor/Jobs surfaces. The SDK clients point at EITHER LocalStack (local,
// throwaway creds) OR a real AWS account (a named ~/.aws profile + region). Switching the target
// rebuilds the clients. A real account is READ-ONLY (see ipc/jobs) — we never invoke functions on
// AWS just to read stats.
//

const REGIONS = [
    "us-east-1", "us-east-2", "us-west-1", "us-west-2",
    "eu-west-1", "eu-west-2", "eu-central-1",
    "ap-southeast-1", "ap-southeast-2", "ap-northeast-1", "ca-central-1"
];

let target : Target = { kind: "localstack" };

// cached clients — cleared whenever the target changes
let _cfn : CloudFormationClient | undefined;
let _logs : CloudWatchLogsClient | undefined;
let _cw : CloudWatchClient | undefined;
let _lambda : LambdaClient | undefined;
let _s3 : S3Client | undefined;
let _apigw : ApiGatewayV2Client | undefined;
let _ecs : ECSClient | undefined;

function resetClients() : void
{
    _cfn = _logs = _cw = _lambda = _s3 = _apigw = _ecs = undefined;
}

/** SDK config for the active target. LocalStack: edge endpoint + test creds. AWS: profile + region. */
function config() : object
{
    if ( target.kind === "aws" )
    {
        return {
            region      : target.region ?? "us-east-1",
            credentials : fromIni( { profile: target.profile } ),
            maxAttempts : 3
        };
    }
    return {
        endpoint    : process.env.AWS_ENDPOINT_URL ?? "http://localhost:4566",
        region      : process.env.AWS_REGION ?? "us-east-1",
        credentials : { accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? "test", secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? "test" },
        maxAttempts : 2
    };
}

export function getTarget() : Target { return target; }

export function isReadOnly() : boolean { return target.kind === "aws"; }

export function setTarget( t : Target ) : void
{
    target = t.kind === "aws"
        ? { kind: "aws", profile: t.profile, region: t.region ?? "us-east-1" }
        : { kind: "localstack" };
    resetClients();
}

/** Profiles found in ~/.aws (config + credentials), for the selector. */
export async function listProfiles() : Promise<string[]>
{
    try
    {
        const { configFile, credentialsFile } = await loadSharedConfigFiles();
        const names : Set<string> = new Set<string>( [ ...Object.keys( configFile ?? {} ), ...Object.keys( credentialsFile ?? {} ) ] );
        return [ ...names ].sort();
    }
    catch { return []; }
}

export async function targetInfo() : Promise<TargetInfo>
{
    return { target, readOnly: isReadOnly(), profiles: await listProfiles(), regions: REGIONS };
}

// path-style addressing — LocalStack serves buckets at .../<bucket>; harmless on real AWS
export function cfnClient() : CloudFormationClient { return _cfn ??= new CloudFormationClient( config() ); }
export function logsClient() : CloudWatchLogsClient { return _logs ??= new CloudWatchLogsClient( config() ); }
export function cwClient() : CloudWatchClient { return _cw ??= new CloudWatchClient( config() ); }
export function lambdaClient() : LambdaClient { return _lambda ??= new LambdaClient( config() ); }
export function s3Client() : S3Client { return _s3 ??= new S3Client( { ...config(), forcePathStyle: target.kind === "localstack" } ); }
export function apigwClient() : ApiGatewayV2Client { return _apigw ??= new ApiGatewayV2Client( config() ); }
export function ecsClient() : ECSClient { return _ecs ??= new ECSClient( config() ); }

/** Turn an SDK error into a short, friendly message (LocalStack-down / creds are the common ones). */
export function awsErr( err : unknown ) : string
{
    const e : { name? : string; message? : string } = err as { name? : string; message? : string };
    const msg : string = e?.message ?? String( err );
    if ( /ECONNREFUSED|fetch failed|ENOTFOUND|EHOSTUNREACH|socket hang up/i.test( msg ) )
        return target.kind === "localstack"
            ? "LocalStack unreachable on http://localhost:4566 — is it up? (start it from the header)"
            : "AWS endpoint unreachable — check your network / region.";
    if ( /credential|token|expired|AccessDenied|UnrecognizedClient|InvalidClientTokenId/i.test( msg ) )
        return `AWS credentials problem for this profile: ${msg}`;
    return e?.name ? `${e.name}: ${msg}` : msg;
}
