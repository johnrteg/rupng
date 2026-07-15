//
// auth — CloudManifest: the service's AWS footprint (a resource manifest, no CDK/AWS coupling).
//
// Exported SEPARATELY from runtime code (this file imports only @repo/cloud-manifest data) so the
// /cloud CDK app can pull just the manifest at synth. /cloud turns `owns` into constructs and derives
// least-privilege IAM. See cloud/SPECS.md.
//
// Two ECS roles (Reader + Writer, the read/write split — same image, root Dockerfile, APP_NAME=auth;
// SERVICE_ROLE selects the role and PORT is its slot in the AUTH port block). Behind an API Gateway.
//
import {
    ResourceManifest,
    ApiAuthorizer, LaunchType,
    AttrType, MfaMode,
    Ports,
} from "@repo/cloud-manifest";
import { Events } from "@repo/system";   // Kafka topics = Events.Object (per-entity state change)

export const manifest : ResourceManifest =
{
    service     : "auth",
    description : "Authentication service — login · passkeys · verification · sessions. Two roles: Reader + Writer.",
    tracing     : true,

    owns:
    {
        // The two ECS Fargate ROLES — the SAME image (root Dockerfile, APP_NAME=auth); SERVICE_ROLE
        // selects the role and PORT is its slot in the AUTH port block (@repo/services Ports: reader
        // 8110 / writer 8111). Internal ALBs fronted by the API Gateway; reader scales independently
        // from writer so a read flood can't starve writes.
        services:
        [
            {
                key             : "reader",
                launchType      : LaunchType.FARGATE,
                containerPort   : Ports.AUTH.READER,          // same constant AuthService.PORT[reader] uses — can't drift
                healthCheckPath : "/health",
                environment     : { SERVICE_ROLE: "reader" },
                sizing          : { default: { cpu: 1, memory: 2 },
                                    production: { cpu: 2, memory: 4 } },
                autoscaling     : { default: { min: 1, max: 2, start: 1, targetCpuPercent: 60 },
                                    production: { min: 2, max: 8, start: 2, targetCpuPercent: 60 } },
                loadBalancer    : { public: false },
            },
            {
                key             : "writer",
                launchType      : LaunchType.FARGATE,
                containerPort   : Ports.AUTH.WRITER,          // same constant AuthService.PORT[writer] uses — can't drift
                healthCheckPath : "/health",
                environment     : { SERVICE_ROLE: "writer" },
                sizing          : { default: { cpu: 1, memory: 2 },
                                    production: { cpu: 2, memory: 4 } },
                autoscaling     : { default: { min: 1, max: 2, start: 1, targetCpuPercent: 60 },
                                    production: { min: 1, max: 4, start: 1, targetCpuPercent: 60 } },
                loadBalancer    : { public: false },
            },
        ],

        // The auth API gateway (the front door). The service enforces auth itself, so the gateway
        // passes through (authorizer NONE). /version + /health are inherited by every service from
        // the shared framework; declaring them here gives them a gateway route so the deploy console
        // can read the live version per environment. (The login/passkey/verify routes will be
        // generated from auth's public RestfulEndpoint defs once that wiring lands — see cloud/src/app.ts
        // where app does this via apiEndpoints(...).)
        api:
        {
            key        : "api",
            authorizer : ApiAuthorizer.NONE,
            cors       : true,
            throttle   : {  default: { rateLimit: 100, burstLimit: 200 },
                            production: { rateLimit: 1000, burstLimit: 2000 } },
            endpoints  :
            [
                { method: "GET", path: "/version", public: true, authRequired: false },
                { method: "GET", path: "/health",  public: true, authRequired: false },
            ],
        },

        // Runtime config (AppConfig) — the auth service's non-secret operational policy (AuthConfig:
        // lockout/MFA/tokens/verification/WebAuthn/abuse/SSO), tunable without a redeploy. Seeded on boot.
        appConfig:
        [
            { key: "config", application: "auth", profiles: [ { key: "settings" }, { key: "flags", type: "feature_flags" } ] },
        ],

        // Cognito — the credential authority (password hashes, social/SAML/OIDC federation, TOTP/SMS MFA).
        // Our DynamoDB `users` table is platform METADATA over this identity (keyed by the Cognito sub).
        userPools:
        [
            {
                key               : "users",
                selfSignUp        : true,
                mfa               : MfaMode.OPTIONAL,
                signInAliases     : { email: true, phone: true },
                passwordMinLength : 8,
                clients           : [ { key: "web" } ],
            },
        ],

        // The auth DynamoDB tables (the persisted side of the Auth model — see
        // apps/core/auth/src/models/AuthModel.ts; each note there gives the PK/SK/GSI/TTL).
        tables:
        [
            // users — platform metadata over the Cognito identity; PK userId(=sub), + email / verified-phone lookups
            { key: "users", partitionKey: { name: "userId", type: AttrType.STRING },
              globalSecondaryIndexes: [
                  { name: "email", partitionKey: { name: "email", type: AttrType.STRING }, projection: "ALL" },
                  { name: "phone", partitionKey: { name: "phone", type: AttrType.STRING }, projection: "ALL" },
              ] },

            // user_identities — sign-in methods / SSO links; SK = METHOD#<method>#<providerSubject>
            { key: "user_identities", partitionKey: { name: "userId", type: AttrType.STRING }, sortKey: { name: "sk", type: AttrType.STRING },
              globalSecondaryIndexes: [
                  { name: "providerSubject", partitionKey: { name: "method", type: AttrType.STRING }, sortKey: { name: "providerSubject", type: AttrType.STRING }, projection: "ALL" },
              ] },

            // user_meta — per-user UI metadata; SK = <type>#<id>
            { key: "user_meta", partitionKey: { name: "userId", type: AttrType.STRING }, sortKey: { name: "sk", type: AttrType.STRING } },

            // role_grants — auth's read cache of account-owned roles; SK accountId, GSI to list members
            { key: "role_grants", partitionKey: { name: "userId", type: AttrType.STRING }, sortKey: { name: "accountId", type: AttrType.STRING },
              globalSecondaryIndexes: [
                  { name: "accountId", partitionKey: { name: "accountId", type: AttrType.STRING }, projection: "ALL" },
              ] },

            // api_keys — machine callers; GSIs by account / user; TTL expiry
            { key: "api_keys", partitionKey: { name: "keyId", type: AttrType.STRING }, ttlAttribute: "expiresAt",
              globalSecondaryIndexes: [
                  { name: "accountId", partitionKey: { name: "accountId", type: AttrType.STRING }, projection: "ALL" },
                  { name: "userId",    partitionKey: { name: "userId",    type: AttrType.STRING }, projection: "ALL" },
              ] },

            // sessions — active sessions/devices; GSI to list a user's sessions; TTL expiry
            { key: "sessions", partitionKey: { name: "sessionId", type: AttrType.STRING }, ttlAttribute: "expiresAt",
              globalSecondaryIndexes: [
                  { name: "userId", partitionKey: { name: "userId", type: AttrType.STRING }, projection: "ALL" },
              ] },

            // sso_connections — per-account enterprise IdP federation (SAML/OIDC) + SCIM
            { key: "sso_connections", partitionKey: { name: "accountId", type: AttrType.STRING }, sortKey: { name: "connectionId", type: AttrType.STRING } },

            // impersonations — support/staff access windows; GSIs by staff / target account; TTL expiry
            { key: "impersonations", partitionKey: { name: "id", type: AttrType.STRING }, ttlAttribute: "expiresAt",
              globalSecondaryIndexes: [
                  { name: "staffUserId",     partitionKey: { name: "staffUserId",     type: AttrType.STRING }, projection: "ALL" },
                  { name: "targetAccountId", partitionKey: { name: "targetAccountId", type: AttrType.STRING }, projection: "ALL" },
              ] },

            // ip_rules — allow/deny rules; PK = <scope>#<subjectId>, SK ruleId; TTL on time-boxed exceptions
            { key: "ip_rules", partitionKey: { name: "pk", type: AttrType.STRING }, sortKey: { name: "ruleId", type: AttrType.STRING }, ttlAttribute: "expiresAt" },

            // login_context — last-known device/geo per user (adaptive risk)
            { key: "login_context", partitionKey: { name: "userId", type: AttrType.STRING } },

            // audit — immutable security events; PK = accountId | "global", SK = <at>#<id>
            { key: "audit", partitionKey: { name: "pk", type: AttrType.STRING }, sortKey: { name: "sk", type: AttrType.STRING } },

            // password_reset_tokens — single-use reset tokens; GSI by user; TTL = reset window
            { key: "password_reset_tokens", partitionKey: { name: "tokenId", type: AttrType.STRING }, ttlAttribute: "expiresAt",
              globalSecondaryIndexes: [
                  { name: "userId", partitionKey: { name: "userId", type: AttrType.STRING }, projection: "ALL" },
              ] },

            // passkeys — WebAuthn/FIDO2 credentials; PK credentialId (returned by the authenticator),
            // GSI userId to list/exclude a user's credentials
            { key: "passkeys", partitionKey: { name: "credentialId", type: AttrType.STRING },
              globalSecondaryIndexes: [
                  { name: "userId", partitionKey: { name: "userId", type: AttrType.STRING }, projection: "ALL" },
              ] },

            // webauthn_challenges — short-lived WebAuthn ceremony challenges; PK ceremonyId; TTL expiry
            { key: "webauthn_challenges", partitionKey: { name: "ceremonyId", type: AttrType.STRING }, ttlAttribute: "expiresAt" },

            // auth_actions — no-auth landing-action queue (verify/reset/mfa/invite/unsubscribe); PK actionId (=URL
            // token); TTL expiresAt auto-expires the row; GSIs to list by status (Console) + look up by target
            { key: "auth_actions", partitionKey: { name: "actionId", type: AttrType.STRING }, ttlAttribute: "expiresAt",
              globalSecondaryIndexes: [
                  { name: "status", partitionKey: { name: "status", type: AttrType.STRING }, projection: "ALL" },
                  { name: "target", partitionKey: { name: "target", type: AttrType.STRING }, projection: "ALL" },
              ] },
        ],
    },

    // Kafka — auth publishes identity lifecycle; the account service consumes auth.user to provision the account.
    publishes: [ { topic: Events.Object.AUTH_USER } ],

    tags: { domain: "core", tier: "service" },
};

export default manifest;
// eof
