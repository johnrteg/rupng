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

// Shared contract vocabulary lives in @repo/api (one definition, spoken by client + server):
//   • AuthMethod / MfaMethod   — login methods + second factors
//   • Login.*                  — the staged-login challenge vocabulary (ChallengeType, Challenge, …)
// This model references them; it does not redefine them.
import type { AuthMethod, MfaMethod, Login } from "@repo/api";

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
    // registration uses to detect an existing account by verified number (ACCESS-FLOWS.md
    // "Existing-account detection"). Index/match only when `phoneVerified` is true (an unverified
    // number proves nothing); store the number normalized to E.164 so the lookup is exact.
    // ────────────────────────────────────────────────────────────────────────

    export enum UserStatus
    {
        PENDING        = "pending",          // registered, not yet verified
        ACTIVE         = "active",
        LOCKED         = "locked",           // failed-login lockout (temporary)
        RESET_REQUIRED = "reset_required",   // password must be reset before a full session (admin/staff-forced, forced-rotation, or seed)
        DISABLED       = "disabled",         // admin-revoked access (hard) — login prevented
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

        // Forced password reset (status === RESET_REQUIRED) — see ACCESS-FLOWS.md → Password reset.
        resetRequiredAt?  : Type.ISODateTime;
        resetRequiredBy?  : Type.ID;        // the staff/admin (or "system" for forced-rotation/seed) who set it
        resetReason?      : string;         // audit: incident / compromise / forced-rotation / seed

        createdAt      : Type.ISODateTime;
        updatedAt      : Type.ISODateTime;
        lastLoginAt?   : Type.ISODateTime;
        passwordChangedAt? : Type.ISODateTime;   // basis for forced-rotation max-age (PasswordResetPolicy)
    }

    // ────────────────────────────────────────────────────────────────────────
    // AuthMethod / UserIdentity — HOW a user signs in (a login method), distinct from
    // CredentialType below (what's PRESENTED per request: a JWT or an API key).
    //
    // One user may have SEVERAL methods (password + Google + a passkey) — which is exactly what
    // enables identity LINKING (ACCESS-FLOWS.md): an SSO sign-in whose email matches an existing
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

    // `AuthMethod` (the login-method enum) is shared contract vocabulary → defined in @repo/api and
    // imported above. UserIdentity references it.

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
    // IpRule — network allow/deny lists IN FRONT of the credential flow, at three scopes
    // (application / account / user). See RISK.md → "IP allow / deny lists".
    //   DynamoDB: ip_rules   PK: `${scope}#${subjectId}`   SK: ruleId
    //   TTL: expiresAt (auto-expire a time-boxed exception)
    //
    // Evaluation (RISK.md): active user-ALLOW  >  any DENY  >  strict-mode default-deny  >  permit.
    // An ALLOW exception only overrides a DENY at the SAME-OR-LOWER authority (a user can't allowlist
    // past an account/app block) — enforced where the rule is WRITTEN (who may create it), not at match time.
    // ────────────────────────────────────────────────────────────────────────

    export enum IpRuleScope { APP = "app", ACCOUNT = "account", USER = "user" }
    /** COUNTRY = ISO-3166 alpha-2, resolved from the IP via GeoIP. */
    export enum IpMatchType { IP = "ip", CIDR = "cidr", COUNTRY = "country" }

    export interface IpRule
    {
        ruleId     : Type.ID;           // SK
        scope      : IpRuleScope;       // part of PK
        subjectId  : Type.ID;           // userId | accountId | "platform" (app scope) — part of PK
        match      : IpMatchType;
        value      : string;            // an IP, a CIDR block, or an ISO country code (per `match`)
        effect     : Effect;            // ALLOW (permit / exception) | DENY (block)
        window?    : { start : Type.ISODateTime; end : Type.ISODateTime };  // time-boxed (UTC); absent = standing
        reason     : string;
        createdBy  : Type.ID;           // who set it (audit; for an exception, the granting admin/staff)
        createdAt  : Type.ISODateTime;
        expiresAt? : Type.EpochSeconds; // = window.end → DynamoDB TTL auto-expiry of the exception
    }

    /**
     * Per-scope allowlist MODE. **EXCEPTION** (default) — allow entries are carve-outs to a deny.
     * **STRICT** — allowlist-only / IP pinning: only allowlisted sources may sign in. (RISK.md.)
     * Stored with the owner (app config / account / user); modeled here so the authorizer resolves it
     * alongside the rules.
     */
    export enum IpListMode { EXCEPTION = "exception", STRICT = "strict" }

    // ────────────────────────────────────────────────────────────────────────
    // UserLoginContext — the per-user BASELINE the risk engine compares against
    // (new-IP / new-country / dormancy / impossible-travel). One rolling item per user.
    //   DynamoDB: login_context   PK: userId
    // Privacy: coarse, security-purpose telemetry — retained on a legitimate-interest basis,
    // capped + rolling; never exposed cross-tenant. Cleared/anonymized on erasure (see SPECS → Erasure).
    // ────────────────────────────────────────────────────────────────────────

    export interface UserLoginContext
    {
        userId             : Type.ID;           // PK
        recentIps          : Array<string>;     // capped, most-recent-first
        recentCountries    : Array<string>;     // ISO alpha-2, capped
        recentFingerprints : Array<string>;     // known device fingerprints, capped
        lastLoginAt        : Type.ISODateTime;
        lastLoginIp?       : string;
        lastLoginCountry?  : string;            // for impossible-travel (geo + elapsed time)
        updatedAt          : Type.ISODateTime;
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

    // ────────────────────────────────────────────────────────────────────────
    // Staged sign-in — the server-driven CHALLENGE PIPELINE (ACCESS-FLOWS.md → "The sign-in flow").
    // The client renders one step at a time; the server returns the next Challenge or a
    // terminal outcome. Built on Cognito CUSTOM_AUTH + the *AuthChallenge Lambda triggers.
    // ────────────────────────────────────────────────────────────────────────

    // The challenge VOCABULARY — ChallengeType, OtpChannel, Challenge, ChallengeOutcome, the
    // client-facing ChallengeState — is shared contract, so it lives in @repo/api as `Login.*`
    // (imported above) and is what PostLoginIdentify / PostLoginChallenge speak. Here we only add the
    // INTERNAL augmentation the authorizer needs but never sends: why an adaptive step was inserted
    // (risk signals) and the Context minted on success.
    export interface ChallengeStateInternal extends Login.ChallengeState
    {
        triggeredBy? : Array<RiskSignal>;       // why an adaptive challenge was inserted (audit / telemetry) — never wire-exposed
        context?     : Context;                 // present when AUTHENTICATED — the authorizer Context (internal)
    }

    /** Inputs the risk engine evaluates at login / step-up (vs the UserLoginContext baseline). */
    export interface RiskContext
    {
        userId        : Type.ID;
        ip            : string;
        country?      : string;                 // GeoIP
        asn?          : string;                 // GeoIP / ASN
        fingerprint?  : string;
        anonymizer?   : boolean;                // VPN / Tor / datacenter (reputation feed)
        reputationBad? : boolean;               // threat-intel listed
        factor        : FactorStrength;         // strength of the primary factor just satisfied
        at            : Type.ISODateTime;
    }

    /** The engine's verdict under a tier's RiskPolicy. */
    export interface RiskAssessment
    {
        signals    : Array<RiskSignal>;         // which signals fired
        action     : RiskAction;                // worst-case action across fired signals for the tier
        challenges : Array<Login.ChallengeType>;  // the extra factor(s) to demand when action = CHALLENGE
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

    // Password COMPOSITION policy (min length, character classes, breached-check) is a web-config /
    // bootstrap concern — it's the public PasswordPolicy in @repo/api GetBootstrap (the web client renders
    // + pre-validates against it). The auth service does not redefine it here; the reset *windows* below
    // (PasswordResetPolicy) are the operational half auth owns.

    // ────────────────────────────────────────────────────────────────────────
    // Password-reset policy — scoped GLOBAL → ACCOUNT → ROLE (both ladders), most-specific /
    // most-privileged wins (same resolution as idle-timeout + remember-device). See ACCESS-FLOWS.md → Password reset.
    // ────────────────────────────────────────────────────────────────────────

    export interface PasswordResetRule
    {
        tokenTtlMin       : number;         // the reset WINDOW — link/token time-to-live (minutes)
        forcedRotationDays? : number;       // optional password expiry → auto-RESET_REQUIRED past this age
        emailResetAllowed : boolean;        // false = this tier may only be reset by an admin/staff, not self-service email
        breachedForcesReset : boolean;      // a breached-password hit forces RESET_REQUIRED
    }

    /** Global default + per-account override + per-role overrides on BOTH ladders. Stricter wins. */
    export interface PasswordResetPolicy
    {
        global           : PasswordResetRule;
        accountOverride?  : Record<Type.ID, PasswordResetRule>;          // by accountId
        byRole?           : Partial<Record<Access.Role, PasswordResetRule>>;  // AccountRole or AppRole — higher role = stricter
    }

    // ────────────────────────────────────────────────────────────────────────
    // PasswordResetToken — single-use, hashed-at-rest, time-boxed; the link's source-of-truth.
    //   DynamoDB: password_reset_tokens   PK: tokenId   GSI: userId   TTL: expiresAt
    // The email carries the raw token; we store only its hash. The reset endpoint validates: exists,
    // not expired, not used, bound to userId — consumed atomically (no replay).
    // ────────────────────────────────────────────────────────────────────────

    export interface PasswordResetToken
    {
        tokenId      : Type.ID;             // PK — the lookup half
        hashedToken  : string;              // hash of the secret half (constant-time compared)
        userId       : Type.ID;
        purpose      : "forgot" | "forced" | "seed-activation";   // why issued (audit + flow)
        issuedBy?    : Type.ID;             // staff/admin who forced it, or "system"
        createdAt    : Type.ISODateTime;
        expiresAt    : Type.EpochSeconds;   // DynamoDB TTL — the reset window (from PasswordResetPolicy.tokenTtlMin)
        usedAt?      : Type.ISODateTime;    // set on consume → single-use
    }

    // `MfaMethod` is shared contract vocabulary → @repo/api (imported above). MfaConfig references it.
    export interface MfaConfig
    {
        enabled            : boolean;
        methods            : Array<MfaMethod>;
        requiredOnElevation : boolean;  // step-up when logging in at / switching up to a higher role
        adaptive           : boolean;   // master toggle for adaptive challenges; the trigger set + actions live in RiskPolicy
    }

    // ────────────────────────────────────────────────────────────────────────
    // Risk policy — WHEN the server adaptively challenges, configurable BY ACCESS LEVEL.
    // See RISK.md → "Risk-based challenges". Rule-based (deterministic, auditable) FIRST;
    // a weighted score / Cognito advanced-security adaptive auth can layer on later (with a
    // rule override so a model can never SOFTEN staff posture). The challenge pipeline that
    // consumes a CHALLENGE verdict is ChallengeState/Challenge (RUNTIME, above).
    // ────────────────────────────────────────────────────────────────────────

    /** Strength of an authentication factor — gates `RiskPolicy.minFactor` + weak-factor escalation. */
    export enum FactorStrength
    {
        WEAK   = "weak",     // email / SMS OTP — possession of an inbox / number
        MEDIUM = "medium",   // password, TOTP
        STRONG = "strong",   // passkey / WebAuthn — phishing-resistant
    }

    /** A risk signal the engine can detect at sign-in / step-up. */
    export enum RiskSignal
    {
        NEW_IP            = "new_ip",
        NEW_DEVICE        = "new_device",
        NEW_COUNTRY       = "new_country",
        IMPOSSIBLE_TRAVEL = "impossible_travel",
        NEW_ASN           = "new_asn",
        ANONYMIZER_IP     = "anonymizer_ip",    // VPN / Tor / datacenter
        BAD_REPUTATION    = "bad_reputation",   // threat-intel listed
        DORMANCY          = "dormancy",         // long time since last login
        UNUSUAL_TIME      = "unusual_time",
        RECENT_FAILURES   = "recent_failures",
        WEAK_FACTOR       = "weak_factor",      // privileged context reached with a weak primary factor
        PRIVILEGED_ROLE   = "privileged_role",  // acting as staff / admin — challenge regardless
    }

    /** What firing a signal does under a tier's policy. */
    export enum RiskAction { IGNORE = "ignore", CHALLENGE = "challenge", BLOCK = "block" }

    /**
     * Per-access-tier risk policy. `signals` maps each signal to its action for this tier (absent =
     * IGNORE); higher tiers carry stricter maps. `minFactor` is the weakest factor allowed at this tier
     * (e.g. staff never WEAK). `freshnessSec` is how long a passed challenge satisfies the tier before a
     * re-challenge. `challengeWith` is the preferred extra factor(s) when the action is CHALLENGE, in order.
     */
    export interface RiskPolicy
    {
        tier          : Access.Role;            // the access level this governs (the highest the user can act as)
        signals       : Partial<Record<RiskSignal, RiskAction>>;
        minFactor     : FactorStrength;
        freshnessSec  : number;
        challengeWith : Array<Login.ChallengeType>;
    }

    /**
     * The full set + env/account overrides. The **most-privileged matching tier wins** (shortest leash),
     * mirroring the remember-device window rule.
     */
    export interface RiskPolicySet
    {
        defaults          : Array<RiskPolicy>;  // one per tier
        envOverrides?     : Record<string, Array<RiskPolicy>>;
        accountOverrides? : Record<Type.ID, Array<RiskPolicy>>;
    }

    /**
     * Access-recertification + inactivity policy (SPECS → "Access recertification"). Drives the scheduled
     * quarterly review email (name / last-login / role per member) and the optional inactivity auto-disable.
     */
    export enum RecertCadence { MONTHLY = "monthly", QUARTERLY = "quarterly" }

    export interface RecertificationConfig
    {
        cadence           : RecertCadence;       // review-email frequency (default QUARTERLY)
        reviewers         : Array<Access.Role>;  // who receives + signs off — account admin; root/application for staff
        inactivityDisable : boolean;             // auto-disable users inactive beyond the threshold
        inactivityDays    : number;              // "no login for N days" → flagged, and disabled when inactivityDisable
        staffInactivityDays? : number;           // tighter threshold for the staff (AppRole) ladder
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
