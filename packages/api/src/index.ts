
// model support — shared ajv validation (SCHEMA + validate co-located on each model)
export { Validation } from './model/Validation';
export { ConfigSchema } from './model/ConfigSchema';

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

// auth — model (shared across endpoints + messaging) then endpoints
export { User } from './auth/model/User';
export { AuthMethod, MfaMethod } from './auth/model/AuthMethod';   // shared credential vocabulary (client + server)
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
