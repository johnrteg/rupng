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
import { ServiceStack, type GatewayRegistry, type AlbRegistry, type UserPoolRegistry } from "./lib/ServiceStack";
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
import { manifest as voiceManifest } from "voice/manifest";   // apps/core/voice/src/CloudManifest.ts (call-log + suppression + numbers DDB, send/status SQS) — scaffold + fake/Twilio only
import { manifest as marketplaceManifest } from "marketplace/manifest"; // apps/core/marketplace/src/CloudManifest.ts (installations DDB + OAuth broker)
import { manifest as socialManifest } from "social/manifest"; // apps/core/social/src/CloudManifest.ts (connections DDB)
import { manifest as monitorManifest } from "monitor/manifest"; // apps/core/monitor/src/CloudManifest.ts (no owned tables — reads other services' resources live)
import { manifest as collabManifest } from "collab/manifest"; // apps/core/collab/src/CloudManifest.ts (rooms/members/messages DDB + Redis) — chat v1 only, no Y.js/Hocuspocus yet
import { manifest as reportManifest } from "report/manifest"; // apps/core/report/src/CloudManifest.ts (submissions/schedules DDB, generate SQS+Lambda, iCal sweep) — contacts/accounts/campaigns generators only

// Generate the API Gateway routes from the service's public RestfulEndpoint defs (same defs the web
// client + server share), so the gateway can't drift from the contract — the endpoints carry their own
// versioned /api/{service}/v{N}/... paths (see @repo/endpoint apiPath). Appended to whatever the
// manifest already declares (e.g. the root /version + /health probes), never replacing it.
import { apiEndpoints } from "./lib/endpoints";
import {
    GetBootstrap, GetOpenApi, GetArticle, GetAccount,
    PostUpload, PostUploadComplete, PostAssetReplace, GetAssets, GetAsset, GetAssetStatus, PatchAsset, PostAvatar, PostAssetVariants, PostAssetRescan, PostAssetScan, PostAssetDuplicate, PostAssetPoster, DeleteAsset, GetMediaUrl, GetItemVersions, PostItemRevert, PostItemText, GetDensities, PostAssetDensity, GetVariantSpecs,
    GetBrowseProviders, PostBrowseSearch, PostBrowseImport, PostAiGenerate, GetGenerateBatch, PostGeneratePromote, DeleteGenerateBatch, PostAssetTranscribe, PostAssetExtractAudio,
    PostAssetArchive, GetArchives, GetArchiveUrl, DeleteArchive, PostAssetCompress, PostInternalAsset,
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
    PostEmailBatch, GetEmailBlasts, PatchEmailBlast, DeleteEmailBlast, GetEmailLog,
    PostVoiceCalls, PostVoiceCallsBulk, PostVoiceCallsTest, GetVoiceCallsLog, GetVoiceCall, GetVoiceNumbers, GetVoiceConfig, PutVoiceConfig, GetVoiceProviders, PutVoiceProvider, PostVoiceWebhookControl, PostVoiceWebhookStatus,
    GetVoiceFlows, PostVoiceFlow, GetVoiceFlow, PatchVoiceFlow, DeleteVoiceFlow, PostVoiceFlowPreview,
    GetVoiceCallRecording, GetVoiceCallTranscript, PostVoiceInternalErase, PostVoiceWebhookRecording,
    GetVoiceDlq, PostVoiceDlqRequeue,
    GetVoiceDispatchState, PostVoiceDispatchSuspend, PostVoiceDispatchResume,
    PostInstallation, GetInstallationToken, DeleteInstallation,
    GetCatalog, GetCatalogItem, PostCatalog, PatchCatalog,
    GetInstallations, GetInstallation, PostInstallationEnable, PatchInstallation,
    PostInstallationPause, PostInstallationResume, PostInstallationConnect, PostInstallationReauth, UninstallInstallation,
    GetInstallationHealth, PostInstallationHealthCheck,
    PostInternalUsage, GetUsage, GetInstallationUsage, PostInternalAction,
    GetConnections, PostConnection, DeleteConnection,
    GetPosts, PostPost, GetPost, DeletePost, GetPostRenditions, PostPostPublish,
    GetSocialConfig, PutSocialConfig,
    GetInbox, PatchInboxItem, PostInboxRefresh,
    PostPostSubmit, PostPostApproval, GetPostComments, PostPostComment, PatchPostComment, GetPostAudit,
    PostSocialWebhook, PostSocialDataDeletion,
    GetMonitorWidgets, GetMonitorWidgetData, GetMonitorConfig, PutMonitorConfig,
    PostCollabRooms, GetCollabRooms, GetCollabRoom, PatchCollabRoom, DeleteCollabRoom,
    PostCollabDms, GetCollabRoomMembers, PostCollabRoomMembers, DeleteCollabRoomMember,
    GetCollabMessages, GetCollabConfig, PutCollabConfig,
    GetInternalContacts, GetInternalSubAccounts, GetInternalCampaigns, PostInternalSend,
    PostReportSubmissions, GetReportSubmissions, GetReportSubmission, GetReportSubmissionDownload, DeleteReportSubmission,
    GetReportSchedules, PostReportSchedules, GetReportSchedule, PatchReportSchedule, PostReportSchedulePause, PostReportScheduleResume, DeleteReportSchedule,
    GetReportSchedulesStale, PostReportInternalErase, GetReportConfig, PutReportConfig,
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
    accountManifest.owns.api.endpoints = [ ...( accountManifest.owns.api.endpoints ?? [] ), ...apiEndpoints( [
        new GetAccount(),
        // S2S: report's accounts generator reads sub-accounts via this INTERNAL endpoint
        new GetInternalSubAccounts()
    ] ) ];
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
        // S2S: store bytes as a new asset directly (voice's TTS cache is the first consumer)
        new PostInternalAsset(),
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
        new GetImportMaps(), new GetImportMap(), new PostImportMap(), new PatchImportMap(), new DeleteImportMap(), new PostImportMapCopy(),
        // S2S: report's contacts generator reads via this INTERNAL list endpoint (no cross-service DB reads)
        new GetInternalContacts()
    ] ) ];
if( campaignManifest.owns.api )
    campaignManifest.owns.api.endpoints = [ ...( campaignManifest.owns.api.endpoints ?? [] ), ...apiEndpoints( [
        // campaign CRUD + archive (initial cut)
        new GetCampaigns(), new GetCampaign(), new PostCampaign(), new PatchCampaign(), new DeleteCampaign(),
        // S2S: report's campaigns generator reads via this INTERNAL list endpoint
        new GetInternalCampaigns()
    ] ) ];
if( emailManifest.owns.api )
    emailManifest.owns.api.endpoints = [ ...( emailManifest.owns.api.endpoints ?? [] ), ...apiEndpoints( [
        // send (single + batch/blast) + blast controls + template CRUD/publish/preview + config
        new PostEmailSend(), new PostEmailBatch(), new GetEmailBlasts(), new PatchEmailBlast(), new DeleteEmailBlast(),
        new GetEmailTemplates(), new GetEmailTemplate(), new PostEmailTemplate(), new PatchEmailTemplate(), new DeleteEmailTemplate(),
        new PostEmailTemplatePublish(), new PostEmailTemplatePreview(), new GetEmailTemplateVersion(), new PostEmailTemplateRevert(), new PostEmailPreview(),
        new GetEmailConfig(), new PutEmailConfig(), new GetEmailLog(),
        // S2S: report's EmailDestination sends a completion notification via this INTERNAL endpoint
        new PostInternalSend()
    ] ) ];
if( voiceManifest.owns.api )
    voiceManifest.owns.api.endpoints = [ ...( voiceManifest.owns.api.endpoints ?? [] ), ...apiEndpoints( [
        // call enqueue (S2S single/bulk + user-facing test) + call-log reads + numbers + config + provider admin
        new PostVoiceCalls(), new PostVoiceCallsBulk(), new PostVoiceCallsTest(), new GetVoiceCallsLog(), new GetVoiceCall(), new GetVoiceNumbers(),
        new GetVoiceConfig(), new PutVoiceConfig(), new GetVoiceProviders(), new PutVoiceProvider(),
        // provider webhooks — synchronous call-control + async status + async recording
        new PostVoiceWebhookControl(), new PostVoiceWebhookStatus(), new PostVoiceWebhookRecording(),
        // IVR flow CRUD + preview
        new GetVoiceFlows(), new PostVoiceFlow(), new GetVoiceFlow(), new PatchVoiceFlow(), new DeleteVoiceFlow(), new PostVoiceFlowPreview(),
        // recording/transcript reads + the S2S forget hook
        new GetVoiceCallRecording(), new GetVoiceCallTranscript(), new PostVoiceInternalErase(),
        // DLQ list + requeue (ops)
        new GetVoiceDlq(), new PostVoiceDlqRequeue(),
        // WorkQueue dispatch state (ops) + per-account suspend/resume
        new GetVoiceDispatchState(), new PostVoiceDispatchSuspend(), new PostVoiceDispatchResume()
    ] ) ];
if( marketplaceManifest.owns.api )
    marketplaceManifest.owns.api.endpoints = [ ...( marketplaceManifest.owns.api.endpoints ?? [] ), ...apiEndpoints( [
        // internal (S2S) installations API — a consuming service (e.g. social) creates a connection and
        // resolves a fresh token; the account-facing browse/enable API is a later addition
        new PostInstallation(), new GetInstallationToken(), new DeleteInstallation(),
        new GetCatalog(), new GetCatalogItem(), new PostCatalog(), new PatchCatalog(),
        new GetInstallations(), new GetInstallation(), new PostInstallationEnable(), new PatchInstallation(),
        new PostInstallationPause(), new PostInstallationResume(), new PostInstallationConnect(), new PostInstallationReauth(), new UninstallInstallation(),
        new GetInstallationHealth(), new PostInstallationHealthCheck(),
        new PostInternalUsage(), new GetUsage(), new GetInstallationUsage(), new PostInternalAction()
    ] ) ];
if( socialManifest.owns.api )
    socialManifest.owns.api.endpoints = [ ...( socialManifest.owns.api.endpoints ?? [] ), ...apiEndpoints( [
        // connections CRUD + posts CRUD/publish/approval-workflow + inbox + webhook intake
        new GetConnections(), new PostConnection(), new DeleteConnection(),
        new GetPosts(), new PostPost(), new GetPost(), new DeletePost(), new GetPostRenditions(), new PostPostPublish(),
        new PostPostSubmit(), new PostPostApproval(), new GetPostComments(), new PostPostComment(), new PatchPostComment(), new GetPostAudit(),
        new GetInbox(), new PatchInboxItem(), new PostInboxRefresh(),
        new PostSocialWebhook(), new PostSocialDataDeletion(),
        new GetSocialConfig(), new PutSocialConfig()
    ] ) ];
if( monitorManifest.owns.api )
    monitorManifest.owns.api.endpoints = [ ...( monitorManifest.owns.api.endpoints ?? [] ), ...apiEndpoints( [
        new GetMonitorWidgets(), new GetMonitorWidgetData(), new GetMonitorConfig(), new PutMonitorConfig(),
    ] ) ];
// collab's REST surface is served ONLY by its "control" role (the stateless control plane) — the "room" role
// (the stateful WebSocket server) is NOT behind this gateway at all; it's reached directly via its own public,
// sticky-session ALB (see apps/core/collab/src/CloudManifest.ts).
if( collabManifest.owns.api )
    collabManifest.owns.api.endpoints = [ ...( collabManifest.owns.api.endpoints ?? [] ), ...apiEndpoints( [
        new PostCollabRooms(), new GetCollabRooms(), new GetCollabRoom(), new PatchCollabRoom(), new DeleteCollabRoom(),
        new PostCollabDms(), new GetCollabRoomMembers(), new PostCollabRoomMembers(), new DeleteCollabRoomMember(),
        new GetCollabMessages(), new GetCollabConfig(), new PutCollabConfig(),
    ] ) ];
if( reportManifest.owns.api )
    reportManifest.owns.api.endpoints = [ ...( reportManifest.owns.api.endpoints ?? [] ), ...apiEndpoints( [
        // ad-hoc submissions: submit + list + status + presigned download + delete
        new PostReportSubmissions(), new GetReportSubmissions(), new GetReportSubmission(), new GetReportSubmissionDownload(), new DeleteReportSubmission(),
        // recurring (iCal) schedules: CRUD + pause/resume
        new GetReportSchedules(), new PostReportSchedules(), new GetReportSchedule(), new PatchReportSchedule(), new PostReportSchedulePause(), new PostReportScheduleResume(), new DeleteReportSchedule(),
        // ops: stale-specVersion sweep (APPLICATION) + config
        new GetReportSchedulesStale(), new GetReportConfig(), new PutReportConfig(),
        // S2S: contact-forget fan-out purges any artifact carrying the forgotten subject's PII
        new PostReportInternalErase()
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
    voiceManifest,
    marketplaceManifest,
    socialManifest,
    monitorManifest,
    collabManifest,
    reportManifest,
];

// Shared gateway registry: each ServiceStack publishes its API Gateway(s) here and a CDN (web) reads
// them to route API prefixes cross-stack. Producers must precede consumers in `manifests` (app → web).
const gateways : GatewayRegistry = new Map();

// Shared ALB registry: each ServiceStack that builds an ECS service publishes its internal ALB DNS
// here; a sibling stack's `uses: [{ kind: SERVICE }]` reference reads it back into a `<SERVICE>_INTERNAL_URL`
// env var (the only wired path for direct S2S HTTP calls — bypasses the API Gateway entirely). Same
// producer-before-consumer ordering requirement as `gateways` (e.g. marketplace → social).
const albs : AlbRegistry = new Map();

// Shared user-pool registry: each ServiceStack that provisions a Cognito user pool (today, just auth)
// publishes its id here; a sibling stack's `uses: [{ kind: USER_POOL }]` reference reads it back into a
// `USERPOOL_<KEY>` env var — for a service with no API Gateway JWT authorizer in front (e.g. collab's room
// server, reached directly) to verify Cognito tokens itself. Same producer-before-consumer ordering
// requirement as `gateways`/`albs` (auth precedes collab in `manifests[]` above).
const userPools : UserPoolRegistry = new Map();

for( const manifest of manifests )
{
    new ServiceStack( app, `${manifest.service}-${deployEnv}`, {
        manifest,
        deployEnv,                                   // our deployment environment
        vpc       : platform.vpc,                    // shared VPC for RDS / ECS / ElastiCache
        gateways,                                    // cross-stack gateway routing (web CDN → app gateway)
        albs,                                        // cross-stack internal ALB routing (S2S)
        userPools,                                   // cross-stack user-pool id routing (self-service JWT verify)
        platformSecrets : platform.secrets,          // shared AI provider keys (read-granted + ARN-injected)
        stackName : `${manifest.service}-${deployEnv}`,
        env       : { account, region },             // the AWS account/region (cdk.StackProps)
    } );
}

// Local: force every resource to RemovalPolicy.DESTROY so the LocalStack container tears
// down cleanly (no retained state, no deletion protection).
if( local ) cdk.Aspects.of( app ).add( new DestroyAll() );

app.synth();
