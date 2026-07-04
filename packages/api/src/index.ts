
// model support — shared ajv validation (SCHEMA + validate co-located on each model)
export { Validation } from './model/Validation';
export { ConfigSchema } from './model/ConfigSchema';

// AI — platform-shared routing policy (modality → provider); keys are platform Secrets, not here
export { AiRouting } from './ai/model/AiRouting';
export { AiGen } from './ai/model/AiGen';

// common
export { default as GetHealth } from './common/GetHealth';
export { default as GetVersion } from './common/GetVersion';

// app
export { default as GetBootstrap } from './app/GetBootstrap';
export { PasswordPolicy } from './app/model/PasswordPolicy';

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

// media — model (shared: index record + variants) then endpoints
export { Media } from './media/model/Media';
export { MediaConfig } from './media/model/MediaConfig';   // service runtime config (AppConfig settings)
export { Browse } from './media/model/Browse';             // Browse marketplace normalized vocabulary
export { BrowseConfig } from './media/model/BrowseConfig'; // Browse runtime policy (AppConfig settings)
export { default as PostUpload } from './media/PostUpload';
export { default as PostUploadComplete } from './media/PostUploadComplete';
export { default as GetAssets } from './media/GetAssets';
export { default as GetAsset } from './media/GetAsset';
export { default as GetAssetStatus } from './media/GetAssetStatus';
export { default as PatchAsset } from './media/PatchAsset';
export { default as PostAssetVariants } from './media/PostAssetVariants';
export { default as PostAssetRescan } from './media/PostAssetRescan';
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
export { default as PostAssetTranscribe } from './media/PostAssetTranscribe';
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
export { AuthMethod, MfaMethod, ContactMethod } from './auth/model/AuthMethod';   // shared credential + contact-channel vocabulary (client + server)
export { Login } from './auth/model/Login';                        // staged-login challenge vocabulary
export { AuthConfig } from './auth/model/AuthConfig';              // service runtime config (AppConfig settings)
export type { UserMeta } from './auth/model/UserMeta';   // type-only namespace (no runtime value)
export { default as GetUsers } from './auth/GetUsers';
export { default as GetUserExists } from './auth/GetUserExists';
export { default as GetUserMeta } from './auth/GetUserMeta';
export { default as PostUserMeta } from './auth/PostUserMeta';
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
