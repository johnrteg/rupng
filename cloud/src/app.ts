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
import { ServiceStack, type GatewayRegistry } from "./lib/ServiceStack";
import { PlatformStack } from "./lib/PlatformStack";
import { isLocal, DestroyAll } from "./lib/local";

// ╔══════════════════════════════════════════════════════════════════════════════════╗
// ║  ADD A NEW SERVICE — STEP 1 of 2: import its manifest from the `<svc>/manifest`     ║
// ║  subpath. (Also add the service to cloud/package.json deps, then `npm install`.)    ║
// ╚══════════════════════════════════════════════════════════════════════════════════╝
import { manifest as appManifest } from "app/manifest";       // apps/core/app/src/CloudManifest.ts
import { manifest as authManifest } from "auth/manifest";     // apps/core/auth/src/CloudManifest.ts
import { manifest as accountManifest } from "account/manifest"; // apps/core/account/src/CloudManifest.ts
import { manifest as mediaManifest } from "media/manifest";   // apps/core/media/src/CloudManifest.ts (S3 + DDB + scan/process SQS)
import { manifest as webManifest } from "web/manifest";       // apps/core/web/src/CloudManifest.ts (S3+CloudFront / Amplify)
// import { manifest as contactManifest } from "contact/manifest";

// Generate the API Gateway routes from the service's public RestfulEndpoint defs (same defs the web
// client + server share), so the gateway can't drift from the contract — the endpoints carry their own
// versioned /api/{service}/v{N}/... paths (see @repo/endpoint apiPath). Appended to whatever the
// manifest already declares (e.g. the root /version + /health probes), never replacing it.
import { apiEndpoints } from "./lib/endpoints";
import {
    GetBootstrap, GetAccount,
    PostUpload, PostUploadComplete, GetAssets, GetAsset, GetAssetStatus, PatchAsset, PostAssetVariants, PostAssetRescan, PostAssetDuplicate, PostAssetPoster, DeleteAsset, GetMediaUrl, GetItemVersions, PostItemRevert, PostItemText, GetDensities, PostAssetDensity, GetVariantSpecs,
    GetBrowseProviders, PostBrowseSearch, PostBrowseImport, PostAiGenerate, PostAssetTranscribe,
    PostAssetArchive, GetArchives, GetArchiveUrl, DeleteArchive, PostAssetCompress,
    PostVoiceClone, GetVoices, DeleteVoice,
    PostLogin, PostLoginIdentify, PostLoginChallenge, PostLoginChallengeResend,
    PostRegister, PostRegisterVerify, PostVerifyResend, PostVerifyPhone,
    GetUsers, GetUserExists, GetUserMeta, PostUserMeta, DeleteUserMeta,
    GetSession, DeleteSession, PostPasswordForgot, PostPasswordReset,
    PostSessionRefresh, PostSessionSwitch, GetSessions, DeleteSessionById, PostSessionsRevokeAll, GetAccounts,
    PostPasskeyRegisterOptions, PostPasskeyRegisterVerify, PostLoginPasskeyOptions, PostLoginPasskeyVerify,
    GetPasskeys, DeletePasskey,
    GetApiKeys, PostApiKey, DeleteApiKey
} from "@repo/api";
if( appManifest.owns.api )
    appManifest.owns.api.endpoints = [ ...( appManifest.owns.api.endpoints ?? [] ), ...apiEndpoints( [ new GetBootstrap() ] ) ];
if( authManifest.owns.api )
    authManifest.owns.api.endpoints = [ ...( authManifest.owns.api.endpoints ?? [] ), ...apiEndpoints( [
        new PostLogin(),
        // stepped sign-in
        new PostLoginIdentify(), new PostLoginChallenge(), new PostLoginChallengeResend(),
        // sign-up + verification
        new PostRegister(), new PostRegisterVerify(), new PostVerifyResend(), new PostVerifyPhone(),
        // user lookup + metadata
        new GetUsers(), new GetUserExists(), new GetUserMeta(), new PostUserMeta(), new DeleteUserMeta(),
        // sessions + password reset
        new GetSession(), new DeleteSession(), new PostPasswordForgot(), new PostPasswordReset(),
        // session management + acting context
        new PostSessionRefresh(), new PostSessionSwitch(), new GetSessions(), new DeleteSessionById(), new PostSessionsRevokeAll(), new GetAccounts(),
        // passkeys (WebAuthn)
        new PostPasskeyRegisterOptions(), new PostPasskeyRegisterVerify(), new PostLoginPasskeyOptions(), new PostLoginPasskeyVerify(),
        new GetPasskeys(), new DeletePasskey(),
        // developer API keys (list / mint / revoke)
        new GetApiKeys(), new PostApiKey(), new DeleteApiKey()
    ] ) ];
if( accountManifest.owns.api )
    accountManifest.owns.api.endpoints = [ ...( accountManifest.owns.api.endpoints ?? [] ), ...apiEndpoints( [ new GetAccount() ] ) ];
if( mediaManifest.owns.api )
    mediaManifest.owns.api.endpoints = [ ...( mediaManifest.owns.api.endpoints ?? [] ), ...apiEndpoints( [
        new PostUpload(), new PostUploadComplete(), new GetAssets(), new GetAsset(), new GetAssetStatus(), new PatchAsset(), new PostAssetVariants(), new PostAssetRescan(), new PostAssetDuplicate(), new PostAssetPoster(), new DeleteAsset(), new GetMediaUrl(), new GetItemVersions(), new PostItemRevert(), new PostItemText(), new GetDensities(), new PostAssetDensity(), new GetVariantSpecs(),
        // Browse (media-12..17) — served by the media BROWSE role
        new GetBrowseProviders(), new PostBrowseSearch(), new PostBrowseImport(),
        // AI Gen (media-18) — generate a new asset from a prompt; served by the MAIN role
        new PostAiGenerate(),
        // Transcribe (media-18) — audio/video → text + timed segments (async media-transcribe Job)
        new PostAssetTranscribe(),
        // Downloads (media-20) — zip original+variants as a TTL'd archive; list / download / delete
        new PostAssetArchive(), new GetArchives(), new GetArchiveUrl(), new DeleteArchive(),
        // Video compression (media-10.10) — compress a video to a distribution target
        new PostAssetCompress(),
        // Voice cloning (media-21) — clone from an audio asset; list / delete account voices
        new PostVoiceClone(), new GetVoices(), new DeleteVoice()
    ] ) ];

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
    // Platform-shared AI provider keys — granted read + ARN-injected into every service (all run the
    // AiFactory). Created empty; values set by a root op. Service-specific keys stay in owns.secrets.
    secrets       : [
        { key: "ai-openai",     description: "OpenAI API key (platform AI)" },
        { key: "ai-anthropic",  description: "Anthropic API key (platform AI)" },
        { key: "ai-fish",       description: "fish.audio API key (platform AI — TTS / voice cloning)" },
        { key: "ai-elevenlabs", description: "ElevenLabs API key (platform AI — TTS / voice cloning / SFX)" },
        { key: "ai-magnific",   description: "Magnific / Freepik API key (platform AI — image generation)" },
    ],
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
    authManifest,
    accountManifest,
    mediaManifest,
    webManifest,
    // contactManifest,
];

// Shared gateway registry: each ServiceStack publishes its API Gateway(s) here and a CDN (web) reads
// them to route API prefixes cross-stack. Producers must precede consumers in `manifests` (app → web).
const gateways : GatewayRegistry = new Map();

for( const manifest of manifests )
{
    new ServiceStack( app, `${manifest.service}-${deployEnv}`, {
        manifest,
        deployEnv,                                   // our deployment environment
        vpc       : platform.vpc,                    // shared VPC for RDS / ECS / ElastiCache
        gateways,                                    // cross-stack gateway routing (web CDN → app gateway)
        platformSecrets : platform.secrets,          // shared AI provider keys (read-granted + ARN-injected)
        stackName : `${manifest.service}-${deployEnv}`,
        env       : { account, region },             // the AWS account/region (cdk.StackProps)
    } );
}

// Local: force every resource to RemovalPolicy.DESTROY so the LocalStack container tears
// down cleanly (no retained state, no deletion protection).
if( local ) cdk.Aspects.of( app ).add( new DestroyAll() );

app.synth();
