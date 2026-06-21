//
// CDK app entry. Resolves the target environment, then builds one ServiceStack per
// service manifest.
//
// Each real service exports its manifest from `<service>/src/CloudManifest.ts` and is
// registered below — add the import + an entry in `manifests`:
//     import { manifest as contact } from "contact/manifest";
//     const manifests = [ appManifest, contact, ... ];
// (See packages/cloud-manifest/src/sample for an annotated reference manifest.)
//
import * as cdk from "aws-cdk-lib";
import { Environment, ResourceManifest, PlatformManifest } from "@repo/cloud-manifest";
import { ServiceStack } from "./lib/ServiceStack";
import { PlatformStack } from "./lib/PlatformStack";
import { isLocal, DestroyAll } from "./lib/local";

// ╔══════════════════════════════════════════════════════════════════════════════════╗
// ║  ADD A NEW SERVICE — STEP 1 of 2: import its manifest from the `<svc>/manifest`     ║
// ║  subpath. (Also add the service to cloud/package.json deps, then `npm install`.)    ║
// ╚══════════════════════════════════════════════════════════════════════════════════╝
import { manifest as appManifest } from "app/manifest";   // apps/core/app/src/CloudManifest.ts
// import { manifest as contactManifest } from "contact/manifest";

// Generate the API Gateway routes from the service's public RestfulEndpoint defs (same defs the web
// client + server share), so the gateway can't drift from the contract. See cloud/src/lib/endpoints.
import { apiEndpoints } from "./lib/endpoints";
import { GetBootstrap } from "@repo/api";
if( appManifest.owns.api )
    appManifest.owns.api.endpoints = apiEndpoints( [ new GetBootstrap() ] );

// ── Resolve environment from CDK context: `cdk synth -c env=staging` (default dev) ──
//    Local cloud dev: `cdklocal deploy -c env=local` (deploys to LocalStack). See cloud/local/.
const app : cdk.App = new cdk.App();
const envName : string = ( app.node.tryGetContext( "env" ) as string ) ?? Environment.DEV;
const deployEnv : Environment = ( Object.values( Environment ) as Array<string> ).includes( envName )
    ? ( envName as Environment )
    : Environment.DEV;

const local : boolean = isLocal( deployEnv );

// Local stays env-agnostic (no account) so `synth` needs no credentials and avoids AZ/context
// lookups; `cdklocal` deploys it to LocalStack's dummy account regardless. Real AWS reads the
// account from the environment/credentials.
const account : string | undefined = local ? undefined : process.env.CDK_DEFAULT_ACCOUNT;
const region  : string = process.env.CDK_DEFAULT_REGION ?? "us-east-1";

// ── Shared platform infra: VPC + MSK + OpenSearch (one per environment) ──────
const platformManifest : PlatformManifest = {
    vpc           : { maxAzs: 2, natGateways: { default: 1, production: 2 } },
    kafkaCluster  : { brokers: { default: 2 }, sizing: { default: { size: 3 }, production: { size: 6 } }, version: "3.6.0" },
    searchCluster : { serverless: true, sizing: { default: { size: 2 }, production: { size: 6 } } },
    cloudTrail    : { enabled: true, multiRegion: true, managementEvents: true },
};
const platform : PlatformStack = new PlatformStack( app, `platform-${deployEnv}`, {
    manifest  : platformManifest,
    deployEnv,
    stackName : `platform-${deployEnv}`,
    env       : { account, region },
} );

// ╔══════════════════════════════════════════════════════════════════════════════════╗
// ║  ADD A NEW SERVICE — STEP 2 of 2: add the imported manifest to this array. The loop ║
// ║  below builds one ServiceStack per entry → a stack named `<service>-<env>`.          ║
// ╚══════════════════════════════════════════════════════════════════════════════════╝
const manifests : Array<ResourceManifest> = [
    appManifest,
    // contactManifest,
];

for( const manifest of manifests )
{
    new ServiceStack( app, `${manifest.service}-${deployEnv}`, {
        manifest,
        deployEnv,                                   // our deployment environment
        vpc       : platform.vpc,                    // shared VPC for RDS / ECS / ElastiCache
        stackName : `${manifest.service}-${deployEnv}`,
        env       : { account, region },             // the AWS account/region (cdk.StackProps)
    } );
}

// Local: force every resource to RemovalPolicy.DESTROY so the LocalStack container tears
// down cleanly (no retained state, no deletion protection).
if( local ) cdk.Aspects.of( app ).add( new DestroyAll() );

app.synth();
