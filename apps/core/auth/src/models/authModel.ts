//
// Auth domain model — identity, RBAC, sessions, API keys, rate limiting.
//
// Everything is scoped under the `Auth` namespace, so call sites read clearly:
//   Auth.UserProfile, Auth.ApiKey, Auth.Context, ...
//
// Sourced from elsewhere (single source of truth):
//   * scalar primitives (ID, ISODateTime, Email, ...)  -> `Type` in @repo/common
//   * the role model (RoleScope, AccountRole, AppRole,  -> `Access` in @repo/endpoint
//     Role, ACCOUNT_LADDER, APP_LADDER, isAllowed)
//
// Organized by WHERE each model lives (see SPECS.md):
//   1. PERSISTED  — DynamoDB tables (each block notes its PK/SK/GSI/TTL)
//   2. EPHEMERAL  — Redis (revocation epoch, blacklist, rate counters)
//   3. RUNTIME    — produced/consumed by the Lambda Authorizer, never stored
//   4. ARTIFACT   — the build-generated endpoint→min-role map
//   5. CONFIG     — password / MFA / rate-limit policy
//
// Boundary reminder: Cognito owns credentials + password hashing + MFA challenge;
// these tables hold platform metadata, the RBAC grants, and the things Cognito can't
// (per-account roles, app-managed keys, revocation). Account membership/role
// ASSIGNMENT is owned by the account service; auth READS the resolved grant.
//

import type { Type } from "@repo/common";
import type { Access } from "@repo/endpoint";

export namespace Auth
{
    // ────────────────────────────────────────────────────────────────────────
    // Tiers — the role model lives in @repo/endpoint's Access (Access.AccountRole,
    // Access.AppRole, Access.RoleScope, Access.Role, Access.ACCOUNT_LADDER, ...).
    // ────────────────────────────────────────────────────────────────────────

    /** Throttle tier carried by a credential (replaces API Gateway usage plans). */
    export enum ApiKeyTier
    {
        PUBLIC  = "public",
        PARTNER = "partner",
        ADMIN   = "admin",
    }

    // ══════════════════════════════════════════════════════════════════════════
    // 1. PERSISTED — DynamoDB
    // ══════════════════════════════════════════════════════════════════════════

    // ────────────────────────────────────────────────────────────────────────
    // UserProfile — platform metadata for a Cognito identity (credentials stay in Cognito)
    //   DynamoDB: users   PK: userId   GSI: email (login/lookup)   GSI: phone (verified-phone uniqueness)
    //
    // Cognito enforces EMAIL uniqueness; PHONE uniqueness is ours — the `phone` GSI is the lookup
    // registration uses to detect an existing account by verified number (REGISTRATION.md
    // "Existing-account detection"). Index/match only when `phoneVerified` is true (an unverified
    // number proves nothing); store the number normalized to E.164 so the lookup is exact.
    // ────────────────────────────────────────────────────────────────────────

    export enum UserStatus
    {
        PENDING  = "pending",           // registered, not yet verified
        ACTIVE   = "active",
        LOCKED   = "locked",            // failed-login lockout (temporary)
        DISABLED = "disabled",          // admin-revoked access (hard) — login prevented
    }

    export interface UserProfile
    {
        userId         : Type.ID;       // Cognito sub
        email          : Type.Email;
        emailVerified  : boolean;
        phone?         : Type.PhoneE164;   // E.164; indexed (phone GSI) for uniqueness once verified
        phoneVerified? : boolean;           // only a verified phone counts for the uniqueness check

        status         : UserStatus;
        appRole?       : Access.AppRole;    // global staff role (Cognito group is the authoritative edge ceiling)

        failedLogins   : number;
        lockedUntil?   : Type.ISODateTime;

        createdAt      : Type.ISODateTime;
        updatedAt      : Type.ISODateTime;
        lastLoginAt?   : Type.ISODateTime;
    }

    // ────────────────────────────────────────────────────────────────────────
    // AuthMethod / UserIdentity — HOW a user signs in (a login method), distinct from
    // CredentialType below (what's PRESENTED per request: a JWT or an API key).
    //
    // One user may have SEVERAL methods (password + Google + a passkey) — which is exactly what
    // enables identity LINKING (REGISTRATION.md): an SSO sign-in whose email matches an existing
    // password user attaches a new UserIdentity instead of forking an account. The enum is the
    // extension point — add WebAuthn/magic-link/etc. without touching call sites.
    //
    // Boundary: **Cognito is the credential authority** (it federates social/SAML/OIDC IdPs, stores
    // password hashes, runs MFA). This table is the platform-level **mapping + audit** — fast lookup
    // of "IdP subject → our userId" and "which methods can this user use" (UI, and "don't remove the
    // last method") — kept in sync with Cognito's linked identities, not a second credential store.
    //   DynamoDB: user_identities  PK: userId  SK: METHOD#<method>#<providerSubject>
    //   GSI: (method, providerSubject) -> userId   (resolve a federated login to our user)
    // ────────────────────────────────────────────────────────────────────────

    /** A login method. Extensible — new methods are added here without changing callers. */
    export enum AuthMethod
    {
        PASSWORD   = "password",    // Cognito-native email + password (+ MFA) — baseline
        GOOGLE     = "google",      // social IdP, federated through Cognito
        MICROSOFT  = "microsoft",
        SAML       = "saml",        // enterprise IdP (per the account's SsoConnection)
        OIDC       = "oidc",        // enterprise IdP (OIDC)
        PASSKEY    = "passkey",     // WebAuthn / FIDO2 — strategic primary passwordless; phishing-resistant
        EMAIL_OTP  = "email_otp",   // emailed one-time code — convenience for low-privilege roles + recovery; never sole factor for privileged roles
        MAGIC_LINK = "magic_link",  // emailed one-time sign-in link — DEPRIORITIZED in favor of EMAIL_OTP (link-scanner consumption, cross-device); reserved, not planned
    }

    /** One login method linked to a user; a user may have many (enables linking + "sign in with …"). */
    export interface UserIdentity
    {
        userId           : Type.ID;
        method           : AuthMethod;
        providerSubject  : string;          // the IdP's user id (Google sub, SAML NameID, …); Cognito sub for PASSWORD
        label?           : string;          // shown in the UI, e.g. the SSO email or "Work Google"
        ssoConnectionId? : Type.ID;         // ties a SAML/OIDC identity to the account's SsoConnection
        addedAt          : Type.ISODateTime;
        lastUsedAt?      : Type.ISODateTime;
    }

    // ────────────────────────────────────────────────────────────────────────
    // RoleGrant — the per-account role set: (userId, accountId) -> [roles] + max
    //   DynamoDB: role_grants   PK: userId   SK: accountId   GSI: accountId (list members)
    // ────────────────────────────────────────────────────────────────────────

    export interface RoleGrant
    {
        userId     : Type.ID;           // PK
        accountId  : Type.ID;           // SK
        roles      : Array<Access.AccountRole>;  // granted set (multi-role)
        maxRole    : Access.AccountRole;// ceiling — caller may operate at/below, never above ("scale down, not up")
        status     : "active" | "suspended";

        grantedBy? : Type.ID;           // who assigned (audit)
        grantedAt  : Type.ISODateTime;
        updatedAt  : Type.ISODateTime;
    }

    // ────────────────────────────────────────────────────────────────────────
    // ApiKey — app-managed credential, format rup_<keyId>.<secret>; only the hash is stored
    //   DynamoDB: api_keys   PK: keyId   GSI: accountId   GSI: userId   TTL: expiresAt
    // ────────────────────────────────────────────────────────────────────────

    export enum ApiKeyStatus { ACTIVE = "active", REVOKED = "revoked" }

    export interface ApiKey
    {
        keyId        : Type.ID;         // PK — the lookup half of the presented key
        hashedSecret : string;          // hash of the secret half (constant-time compared)

        accountId    : Type.ID;
        userId       : Type.ID;         // creator
        role         : Access.AccountRole;  // <= creator's max in this account (enforced at mint)
        tier         : ApiKeyTier;      // throttle tier the Redis limiter applies
        scopes?      : Array<string>;   // optional endpoint allow-list narrowing below the role

        name         : string;          // human label, shown in the "manage keys" UI
        status       : ApiKeyStatus;

        createdAt    : Type.ISODateTime;
        expiresAt?   : Type.EpochSeconds;   // DynamoDB TTL — auto-expire
        lastUsedAt?  : Type.ISODateTime;
    }

    // ────────────────────────────────────────────────────────────────────────
    // Session — issued login; exists primarily so a stateless JWT can be REVOKED
    //   DynamoDB: sessions   PK: sessionId   GSI: userId (list a user's sessions)   TTL: expiresAt
    // ────────────────────────────────────────────────────────────────────────

    export enum SessionStatus { ACTIVE = "active", REVOKED = "revoked", EXPIRED = "expired" }

    export interface DeviceInfo
    {
        fingerprint? : string;
        userAgent?   : string;
        ip?          : string;
        trusted?     : boolean;         // "remember this device" -> may skip MFA
    }

    export interface Session
    {
        sessionId          : Type.ID;   // PK
        userId             : Type.ID;

        currentAccountId   : Type.ID;   // the account the user is acting in
        currentRole        : Access.AccountRole;    // the (<= max) role they switched to

        device?            : DeviceInfo;
        refreshFamilyId    : Type.ID;   // rotation lineage; reuse of a retired token revokes the family (theft signal)
        refreshGeneration  : number;

        status             : SessionStatus;
        createdAt          : Type.ISODateTime;
        lastAccessAt       : Type.ISODateTime;
        lastLoginAt        : Type.ISODateTime;
        expiresAt          : Type.EpochSeconds;  // DynamoDB TTL
    }

    // ────────────────────────────────────────────────────────────────────────
    // SsoConnection — per-account enterprise IdP federation (SAML/OIDC) + SCIM
    //   DynamoDB: sso_connections   PK: accountId   SK: connectionId
    // ────────────────────────────────────────────────────────────────────────

    export enum SsoProtocol { SAML = "saml", OIDC = "oidc" }

    export interface SsoConnection
    {
        accountId      : Type.ID;       // PK
        connectionId   : Type.ID;       // SK
        protocol       : SsoProtocol;

        // Minimal config surface; provider-specifics carried opaquely.
        config         : Record<string, string>;   // e.g. entityId/metadataUrl (SAML) | issuer/clientId (OIDC)
        jitProvisioning : boolean;      // create users on first SSO login

        scimEnabled    : boolean;
        scimTokenHash? : string;        // bearer token (hashed) for SCIM provisioning

        // SSO-only enforcement: when true, account members may sign in ONLY via this IdP —
        // password + email-OTP paths are refused for them (staff break-glass exempt). Opt-in, off by default.
        ssoOnly        : boolean;

        status         : "active" | "disabled";
        createdAt      : Type.ISODateTime;
    }

    // ────────────────────────────────────────────────────────────────────────
    // ImpersonationGrant — audited, time-boxed staff "act on behalf of" access
    //   DynamoDB: impersonations   PK: id   GSI: staffUserId   GSI: targetAccountId   TTL: expiresAt
    // ────────────────────────────────────────────────────────────────────────

    export enum ImpersonationStatus { ACTIVE = "active", ENDED = "ended", EXPIRED = "expired" }

    export interface ImpersonationGrant
    {
        id              : Type.ID;      // PK
        staffUserId     : Type.ID;      // the real (staff) identity
        targetAccountId : Type.ID;
        targetUserId?   : Type.ID;      // optional specific user

        reason          : string;       // captured justification
        status          : ImpersonationStatus;

        startedAt       : Type.ISODateTime;
        expiresAt       : Type.EpochSeconds; // DynamoDB TTL — auto-expire the window
        endedAt?        : Type.ISODateTime;
    }

    // ────────────────────────────────────────────────────────────────────────
    // AuditEvent — immutable security-event trail (mirrors the platform AuditEvent shape)
    //   DynamoDB: audit   PK: accountId | "global"   SK: `${at}#${id}`
    // ────────────────────────────────────────────────────────────────────────

    export interface AuditEvent
    {
        id        : Type.ID;
        at        : Type.ISODateTime;
        actor     : { type : "user" | "staff" | "system" | "key"; id? : Type.ID };
        accountId? : Type.ID;
        action    : string;             // e.g. "login", "role.switch", "key.minted", "impersonation.start"
        target    : { entity : string; id : Type.ID };
        before?   : unknown;
        after?    : unknown;

        ip?        : string;
        userAgent? : string;
        traceId?   : string;            // X-Ray correlation
    }

    // ══════════════════════════════════════════════════════════════════════════
    // 2. EPHEMERAL — Redis (transient; not a system of record)
    // ══════════════════════════════════════════════════════════════════════════

    /**
     * Revocation epoch per subject. The authorizer caches decisions but checks this cheap
     * counter; bumping it invalidates ALL cached allows for the subject immediately —
     * resolving the JWT-caching-vs-prompt-revocation tension without a long TTL.
     */
    export interface RevocationEpoch
    {
        subjectType : "user" | "account" | "key" | "session";
        subjectId   : Type.ID;
        epoch       : number;           // monotonically increasing; bump = revoke
    }

    /** Explicit deny entry (e.g. a logged-out JWT) held until its natural expiry. */
    export interface BlacklistEntry
    {
        jti        : Type.ID;           // JWT id / sessionId
        reason     : string;
        expiresAt  : Type.EpochSeconds;
    }

    // Rate-limit counters are pure Redis (INCR + window TTL) keyed by scope+subject+endpoint;
    // not modeled as a stored record. See RateLimitRule / RateLimitPolicy in CONFIG.

    // ══════════════════════════════════════════════════════════════════════════
    // 3. RUNTIME — produced/consumed by the Lambda Authorizer (never persisted)
    // ══════════════════════════════════════════════════════════════════════════

    /** The light JWT — identity ONLY. Roles/permissions are resolved per-request from DDB. */
    export interface JwtClaims
    {
        sub  : Type.ID;                 // userId
        iss  : string;
        aud  : string;
        iat  : Type.EpochSeconds;
        exp  : Type.EpochSeconds;
        jti  : Type.ID;
    }

    export enum CredentialType { JWT = "jwt", API_KEY = "api_key" }

    /** What the caller presented; both converge to one Auth.Context. */
    export type PresentedCredential =
        | { type : CredentialType.JWT;     token : string; actAsAccountId? : Type.ID; actAsRole? : Access.AccountRole }
        | { type : CredentialType.API_KEY; keyId : Type.ID; secret : string };

    /**
     * The resolved identity the authorizer hands downstream — the single converged context
     * for both JWT and API-key callers. This is what services see as "who is calling".
     */
    export interface Context
    {
        userId         : Type.ID;
        accountId      : Type.ID;       // the account being acted in
        role           : Access.AccountRole;        // the acting (<= max) role
        roleSet        : Array<Access.AccountRole>;  // full granted set (for exception checks)
        scope          : Access.RoleScope;
        appRole?       : Access.AppRole;// global staff role, if any
        tier?          : ApiKeyTier;

        viaKeyId?      : Type.ID;       // set when authenticated by an API key
        sessionId?     : Type.ID;       // set when authenticated by a JWT/session
        impersonatorId? : Type.ID;      // set when this is an impersonation session (staff acting as)
        traceId?       : string;
    }

    export enum Effect { ALLOW = "allow", DENY = "deny" }

    /** The authorizer's verdict. */
    export interface Decision
    {
        effect    : Effect;
        status    : 200 | 401 | 403 | 429;
        reason?   : string;             // why denied (audit / debugging)
        context?  : Context;            // present on allow
    }

    // ══════════════════════════════════════════════════════════════════════════
    // 4. ARTIFACT — endpoint -> min-role map, GENERATED from RestfulEndpoint at build time
    // ══════════════════════════════════════════════════════════════════════════

    /**
     * Mirrors RestfulEndpoint.Audience — the ascending ladder that decides **which credentials the
     * authorizer accepts** (the rule below). PUBLIC ⊇ APP, so a public endpoint accepts a JWT too.
     */
    export enum EndpointAudience
    {
        INTERNAL = "internal",   // VPC-only — never reaches the edge authorizer
        APP      = "app",        // edge — accepts a **JWT only** (reject a presented dev-key)
        PUBLIC   = "public",     // edge — accepts a **JWT or a dev-key** (API key); the published API
    }

    /**
     * Which {@link CredentialType}s an endpoint accepts, derived from its audience — the authorizer
     * uses this to reject a dev-key on an APP endpoint (a dev-key is only valid on PUBLIC). The "JWT
     * OR dev-key" union lives here, at the credential layer — not as overlapping audiences.
     */
    export function acceptedCredentials( audience : EndpointAudience ) : Array<CredentialType>
    {
        switch( audience )
        {
            case EndpointAudience.PUBLIC: return [ CredentialType.JWT, CredentialType.API_KEY ];
            case EndpointAudience.APP:    return [ CredentialType.JWT ];
            default:                      return [];   // INTERNAL: not edge-authorized at all
        }
    }

    export interface RoleRequirement
    {
        scope   : Access.RoleScope;
        minRole : Access.Role;          // AccountRole or AppRole depending on scope
    }

    export interface EndpointMinRole
    {
        method       : string;          // GET, POST, ...
        uri          : string;          // route template, e.g. "/contacts/{id}"
        audience     : EndpointAudience; // drives accepted credentials (see acceptedCredentials) + publication
        authRequired : boolean;
        requirement? : RoleRequirement; // undefined => authenticated but no minimum role
    }

    /** The cached map the authorizer loads (built from the service endpoint definitions). */
    export type MinRoleMap = Array<EndpointMinRole>;

    // ══════════════════════════════════════════════════════════════════════════
    // 5. CONFIG — password / MFA / rate-limit policy
    // ══════════════════════════════════════════════════════════════════════════

    export interface PasswordPolicy
    {
        minLength          : number;
        requireUppercase   : boolean;
        requireNumber      : boolean;
        requireSymbol      : boolean;
        preventReuseCount? : number;
        maxAgeDays?        : number;
        breachedCheck      : boolean;   // reject known-breached passwords
    }

    export enum MfaMethod { TOTP = "totp", SMS = "sms" }

    export interface MfaConfig
    {
        enabled            : boolean;
        methods            : Array<MfaMethod>;
        requiredOnElevation : boolean;  // step-up when logging in at / switching up to a higher role
        adaptive           : boolean;   // challenge on anomalous login (new device/geo)
    }

    /** What a rate-limit counter is keyed by. */
    export enum RateLimitScope { USER = "user", IP = "ip", ENDPOINT = "endpoint", ACCOUNT = "account" }

    export interface RateLimitRule
    {
        match     : { method? : string; uriPattern? : string };  // wildcards, e.g. "* /contacts/*"
        scope     : RateLimitScope;
        windowSec : number;
        max       : number;
    }

    /** Global defaults + per-account overrides (above/below default) to allow bursting. */
    export interface RateLimitPolicy
    {
        tier             : ApiKeyTier | "session";
        defaults         : Array<RateLimitRule>;
        accountOverrides? : Record<Type.ID, Array<RateLimitRule>>;
    }
}

export default Auth;
