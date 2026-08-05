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
import { Providers } from "@repo/system";
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
import { manifest as contactManifest } from "contact/manifest";   // apps/core/contact/src/CloudManifest.ts (contacts + segments DDB)
import { manifest as campaignManifest } from "campaign/manifest"; // apps/core/campaign/src/CloudManifest.ts (campaigns DDB)
import { manifest as emailManifest } from "email/manifest";   // apps/core/email/src/CloudManifest.ts (templates + send-log + suppression + blasts DDB, S3, send/feedback/batch SQS)

// Generate the API Gateway routes from the service's public RestfulEndpoint defs (same defs the web
// client + server share), so the gateway can't drift from the contract — the endpoints carry their own
// versioned /api/{service}/v{N}/... paths (see @repo/endpoint apiPath). Appended to whatever the
// manifest already declares (e.g. the root /version + /health probes), never replacing it.
import { apiEndpoints } from "./lib/endpoints";
import {
    GetBootstrap, GetOpenApi, GetArticle, GetAccount,
    PostUpload, PostUploadComplete, PostAssetReplace, GetAssets, GetAsset, GetAssetStatus, PatchAsset, PostAvatar, PostAssetVariants, PostAssetRescan, PostAssetScan, PostAssetDuplicate, PostAssetPoster, DeleteAsset, GetMediaUrl, GetItemVersions, PostItemRevert, PostItemText, GetDensities, PostAssetDensity, GetVariantSpecs,
    GetBrowseProviders, PostBrowseSearch, PostBrowseImport, PostAiGenerate, GetGenerateBatch, PostGeneratePromote, DeleteGenerateBatch, PostAssetTranscribe, PostAssetExtractAudio,
    PostAssetArchive, GetArchives, GetArchiveUrl, DeleteArchive, PostAssetCompress,
    PostVoiceClone, GetVoices, DeleteVoice,
    GetStudioProjects, PostStudioProject, PatchStudioProject, DeleteStudioProject, GetStudioCanvas, PutStudioCanvas, PostStudioRender,
    GetSvgCanvas, PutSvgCanvas, PostSvgRender, GetSvgRenderJob, GetSvgTemplates, PostSvgFromTemplate, PostSvgTemplate,
    PostLogin, PostLoginIdentify, PostLoginChallenge, PostLoginChallengeResend,
    PostRegister, PostRegisterVerify, PostVerifyResend, PostVerifyPhone,
    GetUsers, GetUserExists, GetUserMeta, PostUserMeta, PostUser, DeleteUserMeta,
    GetSession, DeleteSession, PostPasswordForgot, PostPasswordReset,
    GetAuthAction, PostAuthAction, PostAuthActionConsume, GetAuthActions, PostAuthActionCancel,
    PostSessionRefresh, PostSessionSwitch, GetSessions, DeleteSessionById, PostSessionsRevokeAll, GetAccounts,
    PostPasskeyRegisterOptions, PostPasskeyRegisterVerify, PostLoginPasskeyOptions, PostLoginPasskeyVerify,
    GetPasskeys, DeletePasskey,
    GetApiKeys, PostApiKey, DeleteApiKey,
    GetContacts, GetContact, PostContact, PatchContact, DeleteContact,
    GetSegments, PostSegment, PostSegmentPreview, PostSegmentRefresh, PostSegmentReset, PostSegmentCopy, GetSegmentRuns, PatchSegment, DeleteSegment,
    GetSegmentMembers, PostSegmentMembers, DeleteSegmentMember, GetContactSegments,
    GetContactFields, PostContactField, PatchContactField, DeleteContactField,
    GetImportMaps, GetImportMap, PostImportMap, PatchImportMap, DeleteImportMap, PostImportMapCopy,
    GetCampaigns, GetCampaign, PostCampaign, PatchCampaign, DeleteCampaign,
    PostEmailSend, GetEmailTemplates, GetEmailTemplate, PostEmailTemplate, PatchEmailTemplate, DeleteEmailTemplate, PostEmailTemplatePublish, PostEmailTemplatePreview, GetEmailTemplateVersion, PostEmailTemplateRevert, PostEmailPreview, GetEmailConfig, PutEmailConfig,
    PostEmailBatch, GetEmailBlasts, PatchEmailBlast, DeleteEmailBlast, GetEmailLog
} from "@repo/api";
if( appManifest.owns.api )
    appManifest.owns.api.endpoints = [ ...( appManifest.owns.api.endpoints ?? [] ), ...apiEndpoints( [ new GetBootstrap(), new GetOpenApi(), new GetArticle() ] ) ];
if( authManifest.owns.api )
    authManifest.owns.api.endpoints = [ ...( authManifest.owns.api.endpoints ?? [] ), ...apiEndpoints( [
        new PostLogin(),
        // stepped sign-in
        new PostLoginIdentify(), new PostLoginChallenge(), new PostLoginChallengeResend(),
        // sign-up + verification
        new PostRegister(), new PostRegisterVerify(), new PostVerifyResend(), new PostVerifyPhone(),
        // user lookup + metadata
        new GetUsers(), new GetUserExists(), new GetUserMeta(), new PostUserMeta(), new PostUser(), new DeleteUserMeta(),
        // sessions + password reset
        new GetSession(), new DeleteSession(), new PostPasswordForgot(), new PostPasswordReset(),
        // no-auth landing actions (verify/reset/mfa/invite/unsubscribe) — TTL queue
        new GetAuthAction(), new PostAuthAction(), new PostAuthActionConsume(), new GetAuthActions(), new PostAuthActionCancel(),
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
        new PostUpload(), new PostUploadComplete(), new PostAssetReplace(), new GetAssets(), new GetAsset(), new GetAssetStatus(), new PatchAsset(), new PostAvatar(), new PostAssetVariants(), new PostAssetRescan(), new PostAssetScan(), new PostAssetDuplicate(), new PostAssetPoster(), new DeleteAsset(), new GetMediaUrl(), new GetItemVersions(), new PostItemRevert(), new PostItemText(), new GetDensities(), new PostAssetDensity(), new GetVariantSpecs(),
        // Browse (media-12..17) — served by the media BROWSE role
        new GetBrowseProviders(), new PostBrowseSearch(), new PostBrowseImport(),
        // AI Gen (media-18) — generate candidates to a STAGING bucket; poll the batch, then promote / discard
        new PostAiGenerate(), new GetGenerateBatch(), new PostGeneratePromote(), new DeleteGenerateBatch(),
        // Transcribe (media-18) — audio/video → text + timed segments (async media-transcribe Job)
        new PostAssetTranscribe(),
        new PostAssetExtractAudio(),
        // Downloads (media-20) — zip original+variants as a TTL'd archive; list / download / delete
        new PostAssetArchive(), new GetArchives(), new GetArchiveUrl(), new DeleteArchive(),
        // Video compression (media-10.10) — compress a video to a distribution target
        new PostAssetCompress(),
        // Voice cloning (media-21) — clone from an audio asset; list / delete account voices
        new PostVoiceClone(), new GetVoices(), new DeleteVoice(),
        // Studio projects (media-21) — the project tree (DDB) + canvas snapshot (S3): list / create / update / delete / canvas get+put
        new GetStudioProjects(), new PostStudioProject(), new PatchStudioProject(), new DeleteStudioProject(), new GetStudioCanvas(), new PutStudioCanvas(), new PostStudioRender(),
        // SVG design editor (SVG_EDITOR_SPEC) — canvas load/save (S3-backed doc), async export render + poll, template gallery + create-from / save-as
        new GetSvgCanvas(), new PutSvgCanvas(), new PostSvgRender(), new GetSvgRenderJob(), new GetSvgTemplates(), new PostSvgFromTemplate(), new PostSvgTemplate()
    ] ) ];
if( contactManifest.owns.api )
    contactManifest.owns.api.endpoints = [ ...( contactManifest.owns.api.endpoints ?? [] ), ...apiEndpoints( [
        // contact + segment CRUD (initial cut)
        new GetContacts(), new GetContact(), new PostContact(), new PatchContact(), new DeleteContact(),
        new GetSegments(), new PostSegment(), new PostSegmentPreview(), new PostSegmentRefresh(), new PostSegmentReset(), new PostSegmentCopy(), new GetSegmentRuns(), new PatchSegment(), new DeleteSegment(),
        // segment ↔ contact membership (the join)
        new GetSegmentMembers(), new PostSegmentMembers(), new DeleteSegmentMember(), new GetContactSegments(),
        // custom-field definitions (account schema)
        new GetContactFields(), new PostContactField(), new PatchContactField(), new DeleteContactField(),
        // import maps (reusable column→field maps: system catalog + account maps, copyable)
        new GetImportMaps(), new GetImportMap(), new PostImportMap(), new PatchImportMap(), new DeleteImportMap(), new PostImportMapCopy()
    ] ) ];
if( campaignManifest.owns.api )
    campaignManifest.owns.api.endpoints = [ ...( campaignManifest.owns.api.endpoints ?? [] ), ...apiEndpoints( [
        // campaign CRUD + archive (initial cut)
        new GetCampaigns(), new GetCampaign(), new PostCampaign(), new PatchCampaign(), new DeleteCampaign()
    ] ) ];
if( emailManifest.owns.api )
    emailManifest.owns.api.endpoints = [ ...( emailManifest.owns.api.endpoints ?? [] ), ...apiEndpoints( [
        // send (single + batch/blast) + blast controls + template CRUD/publish/preview + config
        new PostEmailSend(), new PostEmailBatch(), new GetEmailBlasts(), new PatchEmailBlast(), new DeleteEmailBlast(),
        new GetEmailTemplates(), new GetEmailTemplate(), new PostEmailTemplate(), new PatchEmailTemplate(), new DeleteEmailTemplate(),
        new PostEmailTemplatePublish(), new PostEmailTemplatePreview(), new GetEmailTemplateVersion(), new PostEmailTemplateRevert(), new PostEmailPreview(),
        new GetEmailConfig(), new PutEmailConfig(), new GetEmailLog()
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
    // Platform-shared provider keys — granted read + ARN-injected into every service. DERIVED from the single
    // provider registry (@repo/system Providers): every platform-scoped provider's secret is provisioned here.
    // Created empty; values set via the Console. Service-specific provider keys live in that service's
    // owns.secrets (also derived from the registry — see each CloudManifest).
    secrets       : Providers.platform().map( ( provider ) => ( { key: provider.secretKey, description: `${ provider.label } (${ provider.category })` } ) ),
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
    contactManifest,
    campaignManifest,
    emailManifest,
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
