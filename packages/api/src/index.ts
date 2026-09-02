
// model support — shared ajv validation (SCHEMA + validate co-located on each model)
export { Validation } from './model/Validation';
export { Paging } from './model/Paging';   // platform-wide list paging envelope + helper
export { ConfigSchema } from './model/ConfigSchema';
export { LogLevel } from './model/LogLevel';   // dynamic (no-redeploy) log-level closed set for a `config/settings` profile

// AI — platform-shared routing policy (modality → provider); keys are platform Secrets, not here
export { AiRouting } from './ai/model/AiRouting';
export { AiGen } from './ai/model/AiGen';

// common
export { default as GetHealth } from './common/GetHealth';
export { default as GetVersion } from './common/GetVersion';

// app
export { default as GetBootstrap } from './app/GetBootstrap';
export { default as GetOpenApi } from './app/GetOpenApi';
export { default as GetArticle } from './app/GetArticle';
export { default as PostAppEvent } from './app/PostAppEvent';
export { PasswordPolicy } from './app/model/PasswordPolicy';
export { AppServiceConfig } from './app/model/AppServiceConfig';

// docs — the published-API OpenAPI 3.1 registry + generator (single source; in-app docs + readme.io sync)
export { PublicApi } from './docs/PublicApi';

// account — model (shared across endpoints + messaging) then endpoints
export { Account } from './account/model/Account';
export { Billing } from './account/model/Billing';
export { AccountConfig } from './account/model/AccountConfig';   // service runtime config (AppConfig settings)
export { default as GetAccount } from './account/GetAccount';
export { default as PutAccount } from './account/PutAccount';
export { default as GetBilling } from './account/GetBilling';
export { default as PostBalanceTopup } from './account/PostBalanceTopup';
export { default as GetPaymentMethods } from './account/GetPaymentMethods';
export { default as PostPaymentMethodSetup } from './account/PostPaymentMethodSetup';
export { default as DeletePaymentMethod } from './account/DeletePaymentMethod';
export { default as GetPayments } from './account/GetPayments';
export { default as GetInvoices } from './account/GetInvoices';
export { default as PutBillingSettings } from './account/PutBillingSettings';
export { default as GetSubAccounts } from './account/GetSubAccounts';
export { default as GetInternalSubAccounts } from './account/GetInternalSubAccounts';
export { default as PostSubAccount } from './account/PostSubAccount';
export { default as PostSubAccountStatus } from './account/PostSubAccountStatus';
export { default as PostOwnerTransfer } from './account/PostOwnerTransfer';
export { default as GetMembers } from './account/GetMembers';
export { default as PatchMember } from './account/PatchMember';
export { default as DeleteMember } from './account/DeleteMember';
export { default as GetInvites } from './account/GetInvites';
export { default as PostInvite } from './account/PostInvite';
export { default as PostInviteResend } from './account/PostInviteResend';
export { default as DeleteInvite } from './account/DeleteInvite';
export { default as GetMemberships } from './account/GetMemberships';

// email — send channel contracts + versioned templates + service config (apps/core/email)
export { Email } from './email/model/Email';
export { EmailTemplate } from './email/model/EmailTemplate';
export { EmailConfig } from './email/model/EmailConfig';
export { Notification } from './email/model/Notification';   // shared per-type catalog (fallback + action metadata)
export { default as PostEmailSend } from './email/PostEmailSend';
export { default as PostInternalSend } from './email/PostInternalSend';
export { default as GetEmailTemplates } from './email/GetEmailTemplates';
export { default as PostEmailTemplate } from './email/PostEmailTemplate';
export { default as GetEmailTemplate } from './email/GetEmailTemplate';
export { default as PatchEmailTemplate } from './email/PatchEmailTemplate';
export { default as DeleteEmailTemplate } from './email/DeleteEmailTemplate';
export { default as PostEmailTemplatePublish } from './email/PostEmailTemplatePublish';
export { default as PostEmailTemplatePreview } from './email/PostEmailTemplatePreview';
export { default as GetEmailTemplateVersion } from './email/GetEmailTemplateVersion';
export { default as PostEmailTemplateRevert } from './email/PostEmailTemplateRevert';
export { default as PostEmailPreview } from './email/PostEmailPreview';
export { default as GetEmailConfig } from './email/GetEmailConfig';
export { default as PutEmailConfig } from './email/PutEmailConfig';
export { default as PostEmailBatch } from './email/PostEmailBatch';
export { default as GetEmailBlasts } from './email/GetEmailBlasts';
export { default as PatchEmailBlast } from './email/PatchEmailBlast';
export { default as DeleteEmailBlast } from './email/DeleteEmailBlast';
export { default as GetEmailLog } from './email/GetEmailLog';

// dispatch — the shared WIRE shape any `WorkQueue`-adopting service's admin endpoint serializes (see
// packages/services/src/WorkQueue.ts + DISPATCH.md); no endpoint contracts of its own — each adopter (voice
// today) defines its OWN endpoint returning this shape, so Console can render one generic panel across adopters.
export type { Dispatch } from './dispatch/model/Dispatch';   // type-only namespace (no runtime value — all interfaces)

// voice — send channel contracts + service config (apps/core/voice); scaffold + fake/twilio providers only —
// see apps/core/voice/SPECS.md for the full (not-yet-built) IVR/AMD/STIR-SHAKEN surface
export { Voice } from './voice/model/Voice';
export { VoiceConfig } from './voice/model/VoiceConfig';
export { default as PostVoiceCalls } from './voice/PostVoiceCalls';
export { default as PostVoiceCallsBulk } from './voice/PostVoiceCallsBulk';
export { default as PostVoiceCallsTest } from './voice/PostVoiceCallsTest';
export { default as GetVoiceCallsLog } from './voice/GetVoiceCallsLog';
export { default as GetVoiceCall } from './voice/GetVoiceCall';
export { default as GetVoiceNumbers } from './voice/GetVoiceNumbers';
export { default as GetVoiceConfig } from './voice/GetVoiceConfig';
export { default as PutVoiceConfig } from './voice/PutVoiceConfig';
export { default as GetVoiceProviders } from './voice/GetVoiceProviders';
export { default as PutVoiceProvider } from './voice/PutVoiceProvider';
export { default as PostVoiceWebhookControl } from './voice/PostVoiceWebhookControl';
export { default as PostVoiceWebhookStatus } from './voice/PostVoiceWebhookStatus';
export { default as GetVoiceFlows } from './voice/GetVoiceFlows';
export { default as PostVoiceFlow } from './voice/PostVoiceFlow';
export { default as PostVoiceInternalFlow } from './voice/PostVoiceInternalFlow';
export { default as GetVoiceFlow } from './voice/GetVoiceFlow';
export { default as PatchVoiceFlow } from './voice/PatchVoiceFlow';
export { default as DeleteVoiceFlow } from './voice/DeleteVoiceFlow';
export { default as PostVoiceFlowPreview } from './voice/PostVoiceFlowPreview';
export { default as GetVoiceCallRecording } from './voice/GetVoiceCallRecording';
export { default as GetVoiceCallTranscript } from './voice/GetVoiceCallTranscript';
export { default as PostVoiceInternalErase } from './voice/PostVoiceInternalErase';
export { default as PostVoiceWebhookRecording } from './voice/PostVoiceWebhookRecording';
export { default as GetVoiceDlq } from './voice/GetVoiceDlq';
export { default as PostVoiceDlqRequeue } from './voice/PostVoiceDlqRequeue';
export { default as GetVoiceDispatchState } from './voice/GetVoiceDispatchState';
export { default as PostVoiceDispatchSuspend } from './voice/PostVoiceDispatchSuspend';
export { default as PostVoiceDispatchResume } from './voice/PostVoiceDispatchResume';

// print — the physical direct-mail SEND channel (apps/core/print). TWO independent provider factories: mail
// fulfillment (Print.Provider — PostGrid/Lob) and address verification (Print.AddressVerifierId — USPS/
// PostGrid/Lob/Melissa/SmartyStreets); fake adapters only until real credentials land — see
// apps/core/print/SPECS.md.
export { Print } from './print/model/Print';
export { Texting } from './texting/model/Texting';
export { Links } from './links/model/Links';
export { default as PostLinksMint } from './links/PostLinksMint';
export { default as PostLinksMintBatch } from './links/PostLinksMintBatch';
export { default as GetLinksCodeQr } from './links/GetLinksCodeQr';
export { default as GetLinksCode } from './links/GetLinksCode';
export { default as GetLinksResolve } from './links/GetLinksResolve';
export { default as GetLinksDomains } from './links/GetLinksDomains';
export { default as PostLinksDomain } from './links/PostLinksDomain';
export { default as PostLinksDomainVerify } from './links/PostLinksDomainVerify';
export { default as DeleteLinksDomain } from './links/DeleteLinksDomain';
export { default as GetLinksAccountDomains } from './links/GetLinksAccountDomains';
export { default as PostLinksAccountDomain } from './links/PostLinksAccountDomain';
export { default as DeleteLinksAccountDomain } from './links/DeleteLinksAccountDomain';
export { default as PutLinksAccountDomainDefault } from './links/PutLinksAccountDomainDefault';
export { default as PostLinksInternalErase } from './links/PostLinksInternalErase';
export { default as PostTextingSend } from './texting/PostTextingSend';
export { default as GetTextingLog } from './texting/GetTextingLog';
export { default as PostTextingWebhook } from './texting/PostTextingWebhook';
export { TextingConfig } from './texting/model/TextingConfig';
export { PrintConfig } from './print/model/PrintConfig';
export { default as PostPrintMailpieces } from './print/PostPrintMailpieces';
export { default as PostPrintMailpiecesBatch } from './print/PostPrintMailpiecesBatch';
export { default as GetPrintMailpieces } from './print/GetPrintMailpieces';
export { default as GetPrintMailpiece } from './print/GetPrintMailpiece';
export { default as GetPrintMailpieceTracking } from './print/GetPrintMailpieceTracking';
export { default as PostPrintProof } from './print/PostPrintProof';
export { default as PostPrintMailpieceApprove } from './print/PostPrintMailpieceApprove';
export { default as PostPrintCostPreview } from './print/PostPrintCostPreview';
export { default as GetPrintTemplates } from './print/GetPrintTemplates';
export { default as PostPrintTemplates } from './print/PostPrintTemplates';
export { default as PatchPrintTemplate } from './print/PatchPrintTemplate';
export { default as DeletePrintTemplate } from './print/DeletePrintTemplate';
export { default as PostPrintAddressVerify } from './print/PostPrintAddressVerify';
export { default as PostPrintAddressVerifyBatch } from './print/PostPrintAddressVerifyBatch';
export { default as GetPrintProviders } from './print/GetPrintProviders';
export { default as PutPrintProvider } from './print/PutPrintProvider';
export { default as PostPrintWebhook } from './print/PostPrintWebhook';
export { default as GetPrintInternalAddressVerify } from './print/GetPrintInternalAddressVerify';
export { default as PostPrintInternalErase } from './print/PostPrintInternalErase';
export { default as GetPrintConfig } from './print/GetPrintConfig';
export { default as PutPrintConfig } from './print/PutPrintConfig';
export { default as GetPrintDlq } from './print/GetPrintDlq';
export { default as PostPrintDlqRequeue } from './print/PostPrintDlqRequeue';
export { default as GetPrintDispatchState } from './print/GetPrintDispatchState';
export { default as PostPrintDispatchSuspend } from './print/PostPrintDispatchSuspend';
export { default as PostPrintDispatchResume } from './print/PostPrintDispatchResume';

// collab — Slack-like rooms/DMs/chat/presence (apps/core/collab); v1 SCOPE IS CHAT ONLY — no Y.js/Hocuspocus
// CRDT document co-editing or whiteboard yet (a deferred gap, see apps/core/collab/SPECS.md)
export { Collab } from './collab/model/Collab';
export { CollabConfig } from './collab/model/CollabConfig';
export { default as PostCollabRooms } from './collab/PostCollabRooms';
export { default as GetCollabRooms } from './collab/GetCollabRooms';
export { default as GetCollabRoom } from './collab/GetCollabRoom';
export { default as PatchCollabRoom } from './collab/PatchCollabRoom';
export { default as DeleteCollabRoom } from './collab/DeleteCollabRoom';
export { default as PostCollabDms } from './collab/PostCollabDms';
export { default as GetCollabRoomMembers } from './collab/GetCollabRoomMembers';
export { default as PostCollabRoomMembers } from './collab/PostCollabRoomMembers';
export { default as DeleteCollabRoomMember } from './collab/DeleteCollabRoomMember';
export { default as GetCollabMessages } from './collab/GetCollabMessages';
export { default as GetCollabConfig } from './collab/GetCollabConfig';
export { default as PutCollabConfig } from './collab/PutCollabConfig';

// media — model (shared: index record + variants) then endpoints
export { Analytics } from './analytics/model/Analytics';
export { default as GetAnalyticsMetrics } from './analytics/GetAnalyticsMetrics';
export { default as GetAnalyticsFunnels } from './analytics/GetAnalyticsFunnels';
export { default as GetAnalyticsEngagement } from './analytics/GetAnalyticsEngagement';
export { default as GetAnalyticsDeliverability } from './analytics/GetAnalyticsDeliverability';
export { default as PostAnalyticsReprocess } from './analytics/PostAnalyticsReprocess';

// search — global content-search plane (see apps/core/search/SPECS.md); index-then-query, RBAC-filtered
export { Search } from './search/model/Search';
export { SearchConfig } from './search/model/SearchConfig';
export { default as GetSearch } from './search/GetSearch';
export { default as GetSearchSuggest } from './search/GetSearchSuggest';
export { default as PostSearchInternalReindex } from './search/PostSearchInternalReindex';
export { default as GetSearchConfig } from './search/GetSearchConfig';
export { default as PutSearchConfig } from './search/PutSearchConfig';
export { Media } from './media/model/Media';
export { Captions } from './media/model/Captions';         // shared .srt/.vtt parse + serialize (editor + caption burn-in)
export { MediaConfig } from './media/model/MediaConfig';   // service runtime config (AppConfig settings)
export { Browse } from './media/model/Browse';             // Browse marketplace normalized vocabulary
export { BrowseConfig } from './media/model/BrowseConfig'; // Browse runtime policy (AppConfig settings)
export { default as PostUpload } from './media/PostUpload';
export { default as PostUploadComplete } from './media/PostUploadComplete';
export { default as PostAssetReplace } from './media/PostAssetReplace';
export { StudioProject } from './media/model/StudioProject';
export { default as GetStudioProjects } from './media/GetStudioProjects';
export { default as PostStudioProject } from './media/PostStudioProject';
export { default as PostStudioProjectCopy } from './media/PostStudioProjectCopy';
export { default as PatchStudioProject } from './media/PatchStudioProject';
export { default as DeleteStudioProject } from './media/DeleteStudioProject';
export { default as GetStudioCanvas } from './media/GetStudioCanvas';
export { default as PutStudioCanvas } from './media/PutStudioCanvas';
export { default as PostStudioRender } from './media/PostStudioRender';
export { SvgDocument } from './media/model/SvgDocument';               // SVG editor — the editable design model (S3-backed)
export { compilePage, compilePageForEditor, compilePageArtwork, collectFontFamilies } from './media/model/SvgCompiler';   // SVG editor — Doc+Page → SVG string (shared by the web canvas AND the media service's export-render consumer)
export type { SvgPlugin } from './media/model/SvgPlugin';             // SVG editor — plugin contract (QR/barcode/generated, type-only: all interfaces)
export { SvgTemplate } from './media/model/SvgTemplate';               // SVG editor — template library (system + account scopes)
export { SvgAsset } from './media/model/SvgAsset';                     // SVG editor — reusable graphic library (system + account scopes), separate from SvgTemplate (whole documents)
export { default as GetSvgCanvas } from './media/GetSvgCanvas';
export { default as PutSvgCanvas } from './media/PutSvgCanvas';
export { default as PostSvgRender } from './media/PostSvgRender';
export { default as GetSvgRenderJob } from './media/GetSvgRenderJob';
export { default as GetSvgTemplates } from './media/GetSvgTemplates';
export { default as PostSvgFromTemplate } from './media/PostSvgFromTemplate';
export { default as PostSvgTemplate } from './media/PostSvgTemplate';
export { default as GetSvgAssets } from './media/GetSvgAssets';
export { default as GetSvgAsset } from './media/GetSvgAsset';
export { default as PostSvgAsset } from './media/PostSvgAsset';
export { default as PostSystemSvgAsset } from './media/PostSystemSvgAsset';
export { default as DeleteSvgAsset } from './media/DeleteSvgAsset';
export { default as GetAssets } from './media/GetAssets';
export { default as GetAsset } from './media/GetAsset';
export { default as GetAssetStatus } from './media/GetAssetStatus';
export { default as PatchAsset } from './media/PatchAsset';
export { default as PostAvatar } from './media/PostAvatar';
export { default as PostAssetVariants } from './media/PostAssetVariants';
export { default as PostAssetRescan } from './media/PostAssetRescan';
export { default as PostAssetScan } from './media/PostAssetScan';
export { default as PostAssetDuplicate } from './media/PostAssetDuplicate';
export { default as PostAssetPoster } from './media/PostAssetPoster';
export { default as DeleteAsset } from './media/DeleteAsset';
export { default as GetMediaUrl } from './media/GetMediaUrl';
export { default as GetItemVersions } from './media/GetItemVersions';
export { default as PostItemRevert } from './media/PostItemRevert';
export { default as PostItemText } from './media/PostItemText';
export { default as GetDensities } from './media/GetDensities';
export { default as PostAssetDensity } from './media/PostAssetDensity';
export { default as GetVariantSpecs } from './media/GetVariantSpecs';
export { default as GetBrowseProviders } from './media/GetBrowseProviders';
export { default as PostBrowseSearch } from './media/PostBrowseSearch';
export { default as PostBrowseImport } from './media/PostBrowseImport';
export { default as PostAiGenerate } from './media/PostAiGenerate';
export { default as GetGenerateBatch } from './media/GetGenerateBatch';
export { default as PostGeneratePromote } from './media/PostGeneratePromote';
export { default as DeleteGenerateBatch } from './media/DeleteGenerateBatch';
export { default as PostAssetTranscribe } from './media/PostAssetTranscribe';
export { default as PostAssetBurnCaptions } from './media/PostAssetBurnCaptions';
export { default as PostAssetExtractAudio } from './media/PostAssetExtractAudio';
export { default as PostAssetCompress } from './media/PostAssetCompress';
export { default as PostInternalAsset } from './media/PostInternalAsset';
export { default as PostVoiceClone } from './media/PostVoiceClone';
export { default as GetVoices } from './media/GetVoices';
export { default as DeleteVoice } from './media/DeleteVoice';
export { default as PostAssetArchive } from './media/PostAssetArchive';
export { default as GetArchives } from './media/GetArchives';
export { default as GetArchiveUrl } from './media/GetArchiveUrl';
export { default as DeleteArchive } from './media/DeleteArchive';

// auth — model (shared across endpoints + messaging) then endpoints
export { User } from './auth/model/User';
export { AuthAction } from './auth/model/AuthAction';               // no-auth landing-page action tokens (TTL queue)
export { default as GetAuthAction } from './auth/GetAuthAction';
export { default as PostAuthAction } from './auth/PostAuthAction';
export { default as PostAuthActionConsume } from './auth/PostAuthActionConsume';
export { default as GetAuthActions } from './auth/GetAuthActions';
export { default as PostAuthActionCancel } from './auth/PostAuthActionCancel';
export { AuthMethod, MfaMethod, ContactMethod } from './auth/model/AuthMethod';   // shared credential + contact-channel vocabulary (client + server)
export { Login } from './auth/model/Login';                        // staged-login challenge vocabulary
export { AuthConfig } from './auth/model/AuthConfig';              // service runtime config (AppConfig settings)
export type { UserMeta } from './auth/model/UserMeta';   // type-only namespace (no runtime value)
export { default as GetUsers } from './auth/GetUsers';
export { default as GetUserExists } from './auth/GetUserExists';
export { default as GetUserMeta } from './auth/GetUserMeta';
export { default as PostUserMeta } from './auth/PostUserMeta';
export { default as PostUser } from './auth/PostUser';
export { default as DeleteUserMeta } from './auth/DeleteUserMeta';
export { default as PostLogin } from './auth/PostLogin';
export { default as PostLoginIdentify } from './auth/PostLoginIdentify';
export { default as PostLoginChallenge } from './auth/PostLoginChallenge';
export { default as PostLoginChallengeResend } from './auth/PostLoginChallengeResend';
export { default as PostRegister } from './auth/PostRegister';
export { default as PostRegisterVerify } from './auth/PostRegisterVerify';
export { default as PostVerifyResend } from './auth/PostVerifyResend';
export { default as PostVerifyPhone } from './auth/PostVerifyPhone';
export { default as GetSession } from './auth/GetSession';
export { default as DeleteSession } from './auth/DeleteSession';
export { default as PostPasswordForgot } from './auth/PostPasswordForgot';
export { default as PostPasswordReset } from './auth/PostPasswordReset';
export { default as PostSessionRefresh } from './auth/PostSessionRefresh';
export { default as PostSessionSwitch } from './auth/PostSessionSwitch';
export { default as GetSessions } from './auth/GetSessions';
export { default as DeleteSessionById } from './auth/DeleteSessionById';
export { default as PostSessionsRevokeAll } from './auth/PostSessionsRevokeAll';
export { default as GetAccounts } from './auth/GetAccounts';
export { default as PostPasskeyRegisterOptions } from './auth/PostPasskeyRegisterOptions';
export { default as PostPasskeyRegisterVerify } from './auth/PostPasskeyRegisterVerify';
export { default as PostLoginPasskeyOptions } from './auth/PostLoginPasskeyOptions';
export { default as PostLoginPasskeyVerify } from './auth/PostLoginPasskeyVerify';
export { default as GetPasskeys } from './auth/GetPasskeys';
export { default as DeletePasskey } from './auth/DeletePasskey';
export { ApiKey } from './auth/model/ApiKey';
export { default as GetApiKeys } from './auth/GetApiKeys';
export { default as PostApiKey } from './auth/PostApiKey';
export { default as DeleteApiKey } from './auth/DeleteApiKey';
export { default as PostMfaTotpBegin } from './auth/PostMfaTotpBegin';
export { default as PostMfaTotpVerify } from './auth/PostMfaTotpVerify';
export { default as DeleteMfaTotp } from './auth/DeleteMfaTotp';

// contact — model (shared: contact + consent) + segment model, then endpoints
export { Contact } from './contact/model/Contact';
export { Segment } from './contact/model/Segment';
export { ImportMap } from './contact/model/ImportMap';
export { default as GetContacts } from './contact/GetContacts';
export { default as GetContact } from './contact/GetContact';
export { default as PostContact } from './contact/PostContact';
export { default as PatchContact } from './contact/PatchContact';
export { default as DeleteContact } from './contact/DeleteContact';
export { default as GetSegments } from './contact/GetSegments';
export { default as PostSegment } from './contact/PostSegment';
export { default as PostSegmentPreview } from './contact/PostSegmentPreview';
export { default as PostSegmentRefresh } from './contact/PostSegmentRefresh';
export { default as PostSegmentReset } from './contact/PostSegmentReset';
export { default as PostSegmentCopy } from './contact/PostSegmentCopy';
export { default as GetSegmentRuns } from './contact/GetSegmentRuns';
export { default as PatchSegment } from './contact/PatchSegment';
export { default as DeleteSegment } from './contact/DeleteSegment';
export { default as GetSegmentMembers } from './contact/GetSegmentMembers';
export { default as PostSegmentMembers } from './contact/PostSegmentMembers';
export { default as DeleteSegmentMember } from './contact/DeleteSegmentMember';
export { default as GetContactSegments } from './contact/GetContactSegments';
export { default as GetContactFields } from './contact/GetContactFields';
export { default as PostContactField } from './contact/PostContactField';
export { default as PatchContactField } from './contact/PatchContactField';
export { default as DeleteContactField } from './contact/DeleteContactField';
export { default as GetImportMaps } from './contact/GetImportMaps';
export { default as GetImportMap } from './contact/GetImportMap';
export { default as PostImportMap } from './contact/PostImportMap';
export { default as PatchImportMap } from './contact/PatchImportMap';
export { default as DeleteImportMap } from './contact/DeleteImportMap';
export { default as PostImportMapCopy } from './contact/PostImportMapCopy';
export { default as GetInternalContacts } from './contact/GetInternalContacts';
export { default as GetInternalContactByIdentifier } from './contact/GetInternalContactByIdentifier';
export { default as PostInternalContactUpdate } from './contact/PostInternalContactUpdate';
export { default as PostContactForget } from './contact/PostContactForget';

// campaign — model (shared: campaign → channel → strategy → plan) then endpoints
export { Campaign } from './campaign/model/Campaign';
export { default as GetCampaigns } from './campaign/GetCampaigns';
export { default as GetInternalCampaigns } from './campaign/GetInternalCampaigns';
export { default as GetCampaign } from './campaign/GetCampaign';
export { default as PostCampaign } from './campaign/PostCampaign';
export { default as PatchCampaign } from './campaign/PatchCampaign';
export { default as DeleteCampaign } from './campaign/DeleteCampaign';

// workflow — model (definition graph + instance) then endpoints
export { Workflow } from './workflow/model/Workflow';
export { WorkflowInstance } from './workflow/model/WorkflowInstance';
export { default as GetWorkflows } from './workflow/GetWorkflows';
export { default as GetWorkflow } from './workflow/GetWorkflow';
export { default as PostWorkflow } from './workflow/PostWorkflow';
export { default as PatchWorkflow } from './workflow/PatchWorkflow';
export { default as DeleteWorkflow } from './workflow/DeleteWorkflow';
export { default as PostWorkflowPublish } from './workflow/PostWorkflowPublish';
export { default as GetWorkflowVersions } from './workflow/GetWorkflowVersions';
export { default as PostWorkflowPause } from './workflow/PostWorkflowPause';
export { default as PostWorkflowResume } from './workflow/PostWorkflowResume';
export { default as GetWorkflowInstances } from './workflow/GetWorkflowInstances';
export { default as GetWorkflowInstance } from './workflow/GetWorkflowInstance';
export { default as PostWorkflowInstance } from './workflow/PostWorkflowInstance';

// marketplace — model (catalog / installation / credential vault) then S2S internal endpoints
export { Marketplace } from './marketplace/model/Marketplace';
export { default as PostInstallation } from './marketplace/PostInstallation';
export { default as GetInstallationToken } from './marketplace/GetInstallationToken';
export { default as DeleteInstallation } from './marketplace/DeleteInstallation';
export { default as GetCatalog } from './marketplace/GetCatalog';
export { default as GetCatalogItem } from './marketplace/GetCatalogItem';
export { default as PostCatalog } from './marketplace/PostCatalog';
export { default as PatchCatalog } from './marketplace/PatchCatalog';
export { default as GetInstallations } from './marketplace/GetInstallations';
export { default as GetInstallation } from './marketplace/GetInstallation';
export { default as PostInstallationEnable } from './marketplace/PostInstallationEnable';
export { default as PatchInstallation } from './marketplace/PatchInstallation';
export { default as PostInstallationPause } from './marketplace/PostInstallationPause';
export { default as PostInstallationResume } from './marketplace/PostInstallationResume';
export { default as PostInstallationConnect } from './marketplace/PostInstallationConnect';
export { default as PostInstallationReauth } from './marketplace/PostInstallationReauth';
export { default as UninstallInstallation } from './marketplace/UninstallInstallation';
export { default as GetInstallationHealth } from './marketplace/GetInstallationHealth';
export { default as PostInstallationHealthCheck } from './marketplace/PostInstallationHealthCheck';
export { default as PostInternalUsage } from './marketplace/PostInternalUsage';
export { default as GetUsage } from './marketplace/GetUsage';
export { default as GetInstallationUsage } from './marketplace/GetInstallationUsage';
export { default as PostInternalAction } from './marketplace/PostInternalAction';
export { default as PostMarketplaceWebhook } from './marketplace/PostMarketplaceWebhook';

// social — model (connected destinations, posts, service config) then endpoints
export { SocialAccount } from './social/model/SocialAccount';
export { SocialPost } from './social/model/SocialPost';
export { SocialInbound } from './social/model/SocialInbound';
export { SocialConfig } from './social/model/SocialConfig';
export { default as GetConnections } from './social/GetConnections';
export { default as PostConnection } from './social/PostConnection';
export { default as DeleteConnection } from './social/DeleteConnection';
export { default as GetPosts } from './social/GetPosts';
export { default as PostPost } from './social/PostPost';
export { default as GetPost } from './social/GetPost';
export { default as DeletePost } from './social/DeletePost';
export { default as GetPostRenditions } from './social/GetPostRenditions';
export { default as PostPostPublish } from './social/PostPostPublish';
export { default as GetSocialConfig } from './social/GetSocialConfig';
export { default as PutSocialConfig } from './social/PutSocialConfig';
export { default as GetInbox } from './social/GetInbox';
export { default as PatchInboxItem } from './social/PatchInboxItem';
export { default as PostInboxRefresh } from './social/PostInboxRefresh';
export { default as PostPostSubmit } from './social/PostPostSubmit';
export { default as PostPostApproval } from './social/PostPostApproval';
export { default as GetPostComments } from './social/GetPostComments';
export { default as PostPostComment } from './social/PostPostComment';
export { default as PatchPostComment } from './social/PatchPostComment';
export { default as GetPostAudit } from './social/GetPostAudit';
export { default as PostSocialWebhook } from './social/PostSocialWebhook';
export { default as PostSocialDataDeletion } from './social/PostSocialDataDeletion';

// monitor — model (dashboard widget config, live widget status) then endpoints
export { MonitorConfig } from './monitor/model/MonitorConfig';
export { MonitorWidgetStatus } from './monitor/model/MonitorWidgetStatus';
export { default as GetMonitorWidgets } from './monitor/GetMonitorWidgets';
export { default as GetMonitorWidgetData } from './monitor/GetMonitorWidgetData';
export { default as GetMonitorConfig } from './monitor/GetMonitorConfig';
export { default as PutMonitorConfig } from './monitor/PutMonitorConfig';

// report — config (Console smart editor) + the wire model/catalog/endpoints (web reports dashboard)
export { ReportConfig } from './report/model/ReportConfig';
export { Report } from './report/model/Report';
export { REPORT_CATALOG, findReport } from './report/catalog/ReportCatalog';
export { default as PostReportRuns } from './report/PostReportRuns';
export { default as GetReportSubmissions } from './report/GetReportSubmissions';
export { default as GetReportSubmission } from './report/GetReportSubmission';
export { default as GetReportSubmissionDownload } from './report/GetReportSubmissionDownload';
export { default as DeleteReportSubmission } from './report/DeleteReportSubmission';
export { default as GetReportSchedules } from './report/GetReportSchedules';
export { default as GetReportSchedule } from './report/GetReportSchedule';
export { default as PatchReportSchedule } from './report/PatchReportSchedule';
export { default as PostReportSchedulePause } from './report/PostReportSchedulePause';
export { default as PostReportScheduleResume } from './report/PostReportScheduleResume';
export { default as DeleteReportSchedule } from './report/DeleteReportSchedule';
export { default as GetReportSchedulesStale } from './report/GetReportSchedulesStale';
export { default as PostReportInternalErase } from './report/PostReportInternalErase';
export { default as GetReportConfig } from './report/GetReportConfig';
export { default as PutReportConfig } from './report/PutReportConfig';

// registration — TCR/10DLC A2P messaging registration (apps/core/registration). Registration is a DynamoDB
// PROJECTION of TCR's state — TCR/the CSP is the source of truth, reconciled via webhooks + a poll sweep, never
// treated as locally authoritative. Brand-per-account (an account has at most one brand); we act as a DIRECT
// CSP with TCR (no reseller layer). Namespace is `Registration`, not `Tcr`, so toll-free/short-code/international
// registries fit later without a new namespace. See apps/core/registration/SPECS.md.
export { Registration } from './registration/model/Registration';
export { RegistrationConfig } from './registration/model/RegistrationConfig';
export { PhoneNumber } from './registration/model/PhoneNumber';
export { default as PostRegistrationNumberSearch } from './registration/PostRegistrationNumberSearch';
export { default as PostRegistrationNumberOrder } from './registration/PostRegistrationNumberOrder';
export { default as GetRegistrationNumbers } from './registration/GetRegistrationNumbers';
export { default as PostRegistrationNumberRelease } from './registration/PostRegistrationNumberRelease';
export { default as PostRegistrationTollFreeVerification } from './registration/PostRegistrationTollFreeVerification';
export { default as PostRegistrationShortCodeApplication } from './registration/PostRegistrationShortCodeApplication';
export { default as GetRegistrationShortCodeApplications } from './registration/GetRegistrationShortCodeApplications';
export { default as PatchRegistrationShortCodeApplication } from './registration/PatchRegistrationShortCodeApplication';
export { default as PostRegistrationBrand } from './registration/PostRegistrationBrand';
export { default as GetRegistrationBrand } from './registration/GetRegistrationBrand';
export { default as GetRegistrationMyBrand } from './registration/GetRegistrationMyBrand';
export { default as GetRegistrationBrands } from './registration/GetRegistrationBrands';
export { default as PatchRegistrationBrand } from './registration/PatchRegistrationBrand';
export { default as PostRegistrationCampaign } from './registration/PostRegistrationCampaign';
export { default as GetRegistrationCampaign } from './registration/GetRegistrationCampaign';
export { default as GetRegistrationCampaigns } from './registration/GetRegistrationCampaigns';
export { default as PatchRegistrationCampaign } from './registration/PatchRegistrationCampaign';
export { default as GetRegistrationVettingStatus } from './registration/GetRegistrationVettingStatus';
export { default as PostRegistrationVettingRefresh } from './registration/PostRegistrationVettingRefresh';
export { default as PostRegistrationResubmit } from './registration/PostRegistrationResubmit';
export { default as PostRegistrationReprovision } from './registration/PostRegistrationReprovision';
export { default as PostRegistrationOverride } from './registration/PostRegistrationOverride';
export { default as PostRegistrationNudge } from './registration/PostRegistrationNudge';
export { default as PostRegistrationCheckSync } from './registration/PostRegistrationCheckSync';
export { default as GetRegistrationConfig } from './registration/GetRegistrationConfig';
export { default as PutRegistrationConfig } from './registration/PutRegistrationConfig';
export { default as PostRegistrationWebhookTcr } from './registration/PostRegistrationWebhookTcr';
export { default as PostRegistrationWebhookCv } from './registration/PostRegistrationWebhookCv';
export { default as GetInternalRegistrationBrands } from './registration/GetInternalRegistrationBrands';
export { default as GetInternalRegistrationCampaigns } from './registration/GetInternalRegistrationCampaigns';
export { default as GetInternalRegistrationCostEstimates } from './registration/GetInternalRegistrationCostEstimates';

// audit — model (the wire-facing audit-event/retention/legal-hold/export shapes + service config) then endpoints
export { Audit } from './audit/model/Audit';
export { AuditConfig } from './audit/model/AuditConfig';
export { default as GetAuditEvents } from './audit/GetAuditEvents';
export { default as GetAuditEvent } from './audit/GetAuditEvent';
export { default as GetStaffAuditEvents } from './audit/GetStaffAuditEvents';
export { default as PostAuditExport } from './audit/PostAuditExport';
export { default as PostAuditLegalHold } from './audit/PostAuditLegalHold';
export { default as GetAuditConfig } from './audit/GetAuditConfig';
export { default as PutAuditConfig } from './audit/PutAuditConfig';

// survey — model (definition/question/distribution/response/config) then endpoints
export { Survey } from './survey/model/Survey';
export { Question } from './survey/model/Question';
export { Distribution } from './survey/model/Distribution';
export { Response as SurveyResponse } from './survey/model/Response';
export { SurveyConfig } from './survey/model/SurveyConfig';
export { default as GetSurveys } from './survey/GetSurveys';
export { default as PostSurvey } from './survey/PostSurvey';
export { default as GetSurvey } from './survey/GetSurvey';
export { default as PutSurvey } from './survey/PutSurvey';
export { default as PostSurveyPublish } from './survey/PostSurveyPublish';
export { default as PostDistribution } from './survey/PostDistribution';
export { default as GetDistribution } from './survey/GetDistribution';
export { default as GetResponses } from './survey/GetResponses';
export { default as GetResults } from './survey/GetResults';
export { default as GetSurveyForm } from './survey/GetSurveyForm';
export { default as PostSurveyForm } from './survey/PostSurveyForm';
export { default as PostInternalResponse } from './survey/PostInternalResponse';
export { default as PostSurveyWebhook } from './survey/PostSurveyWebhook';
export { default as GetSurveyConfig } from './survey/GetSurveyConfig';
export { default as PutSurveyConfig } from './survey/PutSurveyConfig';
