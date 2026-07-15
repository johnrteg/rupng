
// model support — shared ajv validation (SCHEMA + validate co-located on each model)
export { Validation } from './model/Validation';
export { Paging } from './model/Paging';   // platform-wide list paging envelope + helper
export { ConfigSchema } from './model/ConfigSchema';

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
export { PasswordPolicy } from './app/model/PasswordPolicy';

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

// media — model (shared: index record + variants) then endpoints
export { Media } from './media/model/Media';
export { MediaConfig } from './media/model/MediaConfig';   // service runtime config (AppConfig settings)
export { Browse } from './media/model/Browse';             // Browse marketplace normalized vocabulary
export { BrowseConfig } from './media/model/BrowseConfig'; // Browse runtime policy (AppConfig settings)
export { default as PostUpload } from './media/PostUpload';
export { default as PostUploadComplete } from './media/PostUploadComplete';
export { default as PostAssetReplace } from './media/PostAssetReplace';
export { StudioProject } from './media/model/StudioProject';
export { default as GetStudioProjects } from './media/GetStudioProjects';
export { default as PostStudioProject } from './media/PostStudioProject';
export { default as PatchStudioProject } from './media/PatchStudioProject';
export { default as DeleteStudioProject } from './media/DeleteStudioProject';
export { default as GetStudioCanvas } from './media/GetStudioCanvas';
export { default as PutStudioCanvas } from './media/PutStudioCanvas';
export { default as PostStudioRender } from './media/PostStudioRender';
export { SvgDocument } from './media/model/SvgDocument';       // SVG editor — the editable design model (S3-backed)
export { SvgPlugin } from './media/model/SvgPlugin';           // SVG editor — plugin contract (QR/barcode/generated)
export { SvgTemplate } from './media/model/SvgTemplate';       // SVG editor — template library (system + account scopes)
export { default as GetSvgCanvas } from './media/GetSvgCanvas';
export { default as PutSvgCanvas } from './media/PutSvgCanvas';
export { default as PostSvgRender } from './media/PostSvgRender';
export { default as GetSvgRenderJob } from './media/GetSvgRenderJob';
export { default as GetSvgTemplates } from './media/GetSvgTemplates';
export { default as PostSvgFromTemplate } from './media/PostSvgFromTemplate';
export { default as PostSvgTemplate } from './media/PostSvgTemplate';
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
export { default as PostAssetExtractAudio } from './media/PostAssetExtractAudio';
export { default as PostAssetCompress } from './media/PostAssetCompress';
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

// campaign — model (shared: campaign → channel → strategy → plan) then endpoints
export { Campaign } from './campaign/model/Campaign';
export { default as GetCampaigns } from './campaign/GetCampaigns';
export { default as GetCampaign } from './campaign/GetCampaign';
export { default as PostCampaign } from './campaign/PostCampaign';
export { default as PatchCampaign } from './campaign/PatchCampaign';
export { default as DeleteCampaign } from './campaign/DeleteCampaign';
