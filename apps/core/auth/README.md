#
# Auth Service
#

# Objective

Own **identity, authentication, and the authorization decision** for the whole
platform: who a caller is, which account + role they are acting as, and whether that
meets an endpoint's requirement — for both human sessions (JWT) and machine callers
(API keys). It also owns **session revocation** and **per-caller rate limiting**.

# Role & boundaries

Auth **owns**:
* User identity, credentials, MFA, login/lockout, verification, password policy.
* Tokens & sessions (issue, refresh, switch account/role, revoke, logout).
* The **authorization decision** (Hierarchical RBAC: granted role vs endpoint min-role).
* The Lambda Authorizer that gates **every** API Gateway request.
* **App-managed API keys** (mint, store, validate, revoke).
* **Rate limiting** (edge tier + fine-grained Redis).

Auth **delegates / does not own**:

| Concern | Owner |
|---|---|
| Feature **entitlements** (what a plan unlocks) | **account** (`ResolvedEntitlements`) — auth answers *RBAC*, not *entitlement* |
| Role **assignment** to users (who is `account` admin of acct X) | **account** (membership); auth *reads* the resolved grant |
| Session **observability/UX** beyond revocation | **session** sub-domain (tied to auth) |
| Outbound notifications / email + SMS delivery | **email / texting** (auth triggers, doesn't send) |

> **RBAC vs entitlements:** auth decides "is this caller *allowed* to call this
> endpoint at their role?" Whether the caller's *plan* includes the feature is a
> separate `ResolvedEntitlements` check the target service performs. Keep them distinct.

# Architecture

* **AWS Cognito** — a **single user pool** with MFA set to `OPTIONAL`; we enforce the MFA
  *requirement* ourselves (see *MFA* below). Password hashing, social + enterprise SSO,
  TOTP MFA, advanced-security (breached-password / anomaly). A post-auth Lambda trigger
  notifies the session sub-domain on login.
* **HTTP API (API Gateway v2)** — JWT-native, cheaper than REST API. **We stay on HTTP
  API**: the only reason to move to REST was native usage-plans/API-keys, which we
  reject (see *API keys*).
* **Lambda REQUEST Authorizer** — single gate on every route. Accepts a JWT *or* an API
  key, converges both to one `(accountId, role, scopes)` context, runs the RBAC check
  and Redis rate limit, returns allow/deny. Caches aggressively in warm memory.
* **DynamoDB** — role grants, API keys, user metadata, audit/security events.
* **Redis (ElastiCache)** — rate-limit counters, the JWT/key **revocation set**, and
  the revocation **epoch** (below).
* **Kafka** — the authorizer emits auth/usage events (identity, request, last-access)
  to session + analytics.
* **SNS/SES** — password-reset, verification codes, security notifications.
* **X-Ray** — a trace id per request, end-to-end latency breakdown.

# Request flow (happy path)

```
client ──Authorization: Bearer <jwt>  (or  X-Api-Key: rup_<keyId>.<secret>)
       │  + X-Act-As-Role: <role>  + X-Act-As-Account: <accountId>
       ▼
API Gateway (HTTP API) ── default-deny ──► Lambda REQUEST Authorizer
       │   1. authenticate (verify JWT sig / look up + hash-compare key)
       │   2. resolve (accountId, role[]) from DDB (userId+accountId → roles)
       │   3. check revocation epoch + blacklist (Redis)
       │   4. RBAC: highest granted role ≥ endpoint.min_role ?
       │   5. rate limit (Redis: user/IP/endpoint + account burst override)
       ▼
   allow → route to service        deny → 401/403/429
```

# Identity & accounts

* A **user** has one global identity and may belong to **many accounts**, each with a
  **maximum role** for that account.
* **Multi-account membership** is stored in DynamoDB: `(userId, accountId) → [roles]`
  (**not** Cognito groups — those are global, not per-account).
* **Account hierarchy** (parent/child, per the account spec): define whether a
  parent-account role **cascades** to sub-accounts (e.g. a parent `account` admin may
  act on children). *Open decision below — default: explicit grant, no implicit cascade.*
* **Switching accounts/role**: the caller asserts the target account + role via headers;
  the authorizer validates it against the stored **max role for that account** and never
  lets them exceed it. Switching accounts keeps the role unless it exceeds the new
  account's ceiling, in which case it clamps down.

# Authentication

* **Register**: account + password, or **social SSO** (Google/etc.).
* **Enterprise SSO**: per-account **SAML/OIDC** IdP federation with **JIT
  provisioning**, and **SCIM** for directory-driven user provisioning/deprovisioning.
* **Login / logout** (logout = revoke refresh + blacklist access until exp; support
  **global logout** of all sessions).
* **MFA**: TOTP via authenticator apps + **adaptive MFA** on anomalous login (new
  device/geo). Enforcement (by scope / account / level) + re-auth-on-elevation: see *MFA* below.
* **Lockout** after N failed attempts; **password policy** + breached-password check.
* **Verification**: email / phone / identity; re-verify on change.
* **Admin disable**: hard-delete a user's *access* (distinct from a password reset) —
  prevent login entirely.

# MFA

The MFA factor is **TOTP** — RFC-6238 time-based one-time passwords from any authenticator
app (Google Authenticator, Authy, 1Password, Microsoft Authenticator). Cognito implements
this as **software-token MFA**: `AssociateSoftwareToken` returns a secret rendered as a QR
code, `VerifySoftwareToken` confirms the first code, `SetUserMFAPreference` makes TOTP the
preferred factor; login then issues the `SOFTWARE_TOKEN_MFA` challenge. SMS is a
**discouraged fallback** (SIM-swap / phishing risk); WebAuthn/passkeys are a future stronger
factor for staff.

**One pool, MFA `OPTIONAL` — we enforce the *requirement* ourselves.** Cognito's MFA setting
is pool-wide (`OFF`/`OPTIONAL`/`REQUIRED`) and can't express "required for some, optional for
others", so the single pool stays `OPTIONAL` (TOTP always available to enroll) and the
requirement is enforced in the auth service + a Cognito pre-/post-auth Lambda trigger, driven
by three levers:

* **Application / staff scope** (`support`/`application`/`root`) — **always required**
  (platform-mandated; if not enrolled, the user is forced through TOTP setup before access).
* **Account config** — an account can require MFA for all of its users.
* **Access level** — operating at a higher level (e.g. `account`/`billing`) can require TOTP
  even when the account default is off.

**Re-authenticate when moving up a level.** Crossing into a higher-trust level forces a fresh
authentication with the MFA challenge — escalating to an access level whose policy requires
MFA, or elevating into application/staff scope. (This is the step-up; the light JWT +
per-request role resolution make the elevation point explicit.)

> Single pool + self-enforcement (vs. separate required/optional pools) keeps **one identity
> per user** and **one issuer** for the authorizer — no cross-pool identity linking. The
> trade-off is that "elevated access has MFA" is an *enforced policy* (auth service + trigger)
> rather than a structural property of the token; keep that enforcement on the server, never
> the client.

# Tokens & sessions

* **Keep the JWT light — identity only.** No roles/permissions in the token (they live
  in DDB and are resolved per request, so revocation/role-change is near-immediate).
* **Short access-token TTL** + **refresh token with rotation** and **reuse detection**
  (a replayed refresh token revokes the whole session — token-theft signal).
* **Session sub-domain's real reason to exist is revocation**: JWTs are stateless and
  self-validating, so without it you cannot log someone out before expiry. Last-access
  and session listing are secondary observability/UX. Session is **tied to auth**.
* Revoke a session → add to the Redis **blacklist**; the authorizer rejects on next call.
* Store session records in DynamoDB with **TTL** to auto-expire.

# Authorization — Hierarchical RBAC (NIST RBAC1)

* Roles are granted as an **ordered set (multi-role)**; a senior role **inherits**
  everything junior. The decision is: **does my highest granted role meet the
  endpoint's minimum** — while the full role set remains available for exception cases.
* **Two role scopes** (deliberately separate):
  * **Account scope** (per-account, in DDB): `user` → `billing` → `account`. The
    operating role within a specific account.
  * **Application/staff scope** (global, identity-level): `support` → `application` →
    `root`. Tied to *who the user is in the system*, not to any account's resources.
* **Scale down, not up**: a user may operate *below* their max role in an account but
  never above it.
* **Endpoint min-role map** (`method+uri → min_role`) is **generated from the
  `RestfulEndpoint` definitions at build time**, shipped as a JSON artifact the
  authorizer loads and caches. (Single source of truth: the same definitions drive the
  web client, the server, and the gateway.)
* **Ladder-order risk** (noted): reordering the ladder silently changes every
  endpoint's effective min-role (e.g. swapping `account`/`billing` could leak access).
  Order is a governed, version-controlled decision, not an ad-hoc edit.
* **Cognito groups — used for exactly one thing**: a **tamper-resistant global ceiling
  at the edge** for the *staff/application* scope only (`support`/`application`/`root`).
  It is a deny-filter, **not** a recomputed max over account grants, and it does **not**
  change with per-account role switching.

# API keys (machine callers)

**App-managed keys, validated in the Lambda Authorizer.** We explicitly **reject API
Gateway API keys / usage plans**: they carry no identity ("act as account X at role Y"),
force REST API, and would still need our own store + limiter — pure overhead.

* **Format**: `rup_<keyId>.<secret>` — `keyId` is the cheap lookup; `secret` is hashed
  and constant-time compared; the `rup_` prefix lets secret-scanners detect leaks.
* **Generation (self-service)**: an authenticated user calls `POST /keys`; the raw key
  is returned **exactly once** and never retrievable again — only its hash is stored.
* **Role ≤ creator's max** in that account (same scale-down-not-up rule). Enforced at
  mint time.
* **Storage** (DynamoDB `api_keys`, a `TableSpec` in auth's manifest):
  ```
  api_keys
    PK: keyId
    hashedSecret, accountId, userId(creator), role, name, tier,
    scopes?, status (active|revoked), createdAt, expiresAt (TTL), lastUsedAt
    GSI: accountId   (list an account's keys)
    GSI: userId      (list a user's keys)
  ```
* **Tiers** (`public | partner | admin`) = a field the Redis limiter reads (replaces
  usage plans). **Scopes** optionally narrow a key below its role (endpoint allow-list).
* **Validation** converges with JWTs: resolve `(account, role)` from the record, then hit
  the **identical RBAC + rate-limit path**. An API key is just a long-lived, scoped
  credential resolving to `(account, role)` like a session.
* **Revocation/rotation**: `status=revoked` (rejected next call, subject to the
  revocation epoch); rotate = mint new + revoke old. **Max keys per account** is
  plan-gated.

# Rate limiting

* **Edge / coarse**: per-key throttle tier at the gateway/authorizer.
* **Fine-grained (Redis)**: per-user / per-IP / per-endpoint, with **account burst
  overrides above and below the global default**.
* **Matching**: by method, service, and **endpoint wildcards** (`* /contacts/*`,
  `GET /contacts/*`). Global defaults; account overrides.
* **On exceed → `429` (fail)**.
* **Availability decision (open):** the **auth decision** fails **closed** (Redis/DDB
  down → deny). Whether the **rate limiter** should fail *open* (allow + log) to avoid a
  Redis outage taking down the whole API is an explicit decision — leaning fail-open for
  the limiter, fail-closed for authz.

# Service-to-service & internal auth

* **Default-deny gateway, explicit-allow.** Endpoints not registered (no
  `RestfulEndpoint` exposure) are **VPC-internal only** — never reachable from the edge.
* Internal service-to-service calls authenticate with a **workload/service identity**
  (IAM / signed internal token), resolving to a service principal — not a human role.

# Impersonation / support access

* Staff (`support`+) acting **on behalf of** an account for troubleshooting is a
  first-class, **audited, time-boxed** mode (not a backdoor): explicit start/stop,
  reason captured, every action tagged with both the real staff identity and the
  impersonated account. Optionally requires account consent / step-up MFA.

# Revocation & caching (the core tension)

JWT statelessness + authorizer result caching fight against prompt revocation. Resolve
with a **revocation epoch**, not just a long TTL:

* Maintain a per-(user|account|key) **epoch/version** in Redis. The authorizer caches
  decisions but checks the epoch cheaply; **bumping the epoch invalidates all cached
  allows** for that subject immediately.
* Authorizer **REQUEST** type; `identitySource` includes the **role header** so the
  cache key reflects the acting role. Keep result-cache TTL short (≤ a few minutes)
  *and* gate on the epoch so revokes/role-changes take effect promptly.

# Audit & security events

Emit an immutable `AuditEvent` (same shape used across the platform) for every
security-relevant action: login/logout, role/account switch, MFA enroll/change,
lockout, **key mint/use/revoke**, impersonation start/stop, admin disable, password
reset. Feeds analytics + compliance.

# Privacy & compliance

* User **data export / deletion** (GDPR/CCPA) coordinated with account.
* Credentials never leave Cognito in plaintext; API-key secrets stored hashed only.
* PII minimization in tokens and logs (light JWT supports this).

# Observability & performance

* **Target:** the authorizer adds a bounded p99 overhead per request — met via warm-
  Lambda caching of the role map + recent decisions, the epoch check (O(1) Redis), and
  keyId-indexed key lookup (no hash scans).
* X-Ray trace id per request, propagated across services for latency breakdown.

# Outbound webhooks (naming clarification)

* **Inbound** external callers → authenticated by an **API key** (above). ✓
* **Outbound** (we notify a customer) → **not** an API key: **HMAC-sign** the payload
  with a per-endpoint signing secret the receiver verifies. Different mechanism.

# Infra footprint (auth's `ResourceManifest`)

* Cognito user pool (MFA `OPTIONAL`; requirement enforced by trigger) + post-auth Lambda trigger.
* DynamoDB: `api_keys` (2 GSIs + TTL), role-grants, sessions (TTL), audit.
* Redis (ElastiCache) for counters + revocation set/epoch.
* Kafka topics (publish auth/usage events).
* SNS/SES for reset/verification.
* The Lambda Authorizer + the build-generated `min_role` map artifact.

# Open decisions

1. **Account-hierarchy cascade**: do parent-account roles implicitly grant access to
   sub-accounts, or is every grant explicit? *(Default: explicit, no cascade.)*
2. **Rate-limiter failure mode**: fail-open (log) vs fail-closed on Redis outage.
   *(Leaning fail-open for the limiter, fail-closed for the authz decision.)*
3. **Maker-checker for role grants**: can a user self-assign within their max, or does
   elevating another user require a second approver?
4. **Ladder ordering** of the account scope (`user`/`billing`/`account`) — confirm and
   freeze, given the blast-radius risk.
