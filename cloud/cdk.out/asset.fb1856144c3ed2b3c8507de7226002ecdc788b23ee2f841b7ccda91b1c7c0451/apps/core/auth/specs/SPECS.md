#
# Auth Service
#

# Objective

The platform's **security gatekeeper** — it owns **identity, authentication, and the authorization decision**
for the whole system: *who* a caller is, *which account + role* they're acting as, and whether that meets an
endpoint's requirement — for both **human sessions (JWT)** and **machine callers (API keys)**. It is the
**single front door**: a **Lambda Authorizer gates *every* API Gateway request**, converging a JWT *or* an API
key into one `(accountId, role, scopes)` context and running the RBAC check + rate limit **before anything
reaches a service**. Nothing is trusted that auth hasn't vouched for.

What that spans:
* **Identity & credentials** — Cognito-backed users, **MFA + adaptive step-up**, login / lockout, verification,
  password policy, passwordless / SSO.
* **Tokens & sessions** — issue / refresh / **switch account + role** / revoke / logout, with a **revocation
  epoch** for instant kill.
* **Authorization (Hierarchical RBAC)** — granted role vs endpoint `minAccess`, enforced at the authorizer on
  every route; **fails closed**.
* **Cross-account delegation grants** — time-boxed, owner-issued access *into* an account (agency / support).
* **Risk-based challenges** — adaptive friction on new geo / device / impossible-travel / bad-reputation IP.
* **API keys** (machine callers) + **rate limiting** (edge tier + fine-grained Redis; **fails open**, so a
  limiter outage never blocks traffic — while authz fails closed).

**Boundaries:** auth answers **RBAC** (*"is this caller allowed at this role?"*), **not entitlements**
(*"does the plan include it?"* → [account](../../account/specs/SPECS.md) `ResolvedEntitlements`). And it **reads**
the **account↔user relationship** — **[account](../../account/specs/SPECS.md) owns** it (membership, role
ceilings, switch-eligibility); auth is **identity + the session / authz runtime**. *Identity is auth's;
who-belongs-where is account's.*

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
* **DynamoDB** — **cross-account grants** (auth-owned) + **cached membership** (read from account), API keys, user metadata, audit/security events.
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

* A **user** has one global identity (auth-owned) and may belong to **many accounts**, each with a
  **maximum role** for that account — but the **account↔user relationship is owned by
  [account](../../account/specs/SPECS.md)** (its SoT; see *Account ↔ user relationship*).
* **Auth *reads* membership, does not own it.** The authorizer resolves `(userId, accountId) → [roles]`
  **from account** (cached for the hot path), **not** from Cognito groups (those are global, not per-account).
  Account is authoritative for who-belongs-where + the role ceiling; auth consumes the resolved grant.
* **Account hierarchy** (parent/child, per the account spec): define whether a
  parent-account access to sub-accounts is governed by each sub-account's **`parentAccess`**
  setting — **`open`** (implicit standing access, capped by the child's ceiling) or **`granted`**
  (an explicit grant from a sub-account user). Default **`granted`**. See the grant model.
* **Switching accounts/role** *(auth runs the mechanics; account owns the eligibility)*: the caller asserts the
  target account + role via headers; the authorizer validates it against the **account-owned max role for that
  account** (read from account membership) and never lets them exceed it. Switching keeps the role **unless it exceeds the target account's
  ceiling — then it auto-clamps to that account's max role** (no manual step), and the
  **client is told so the UI notifies** the user of the change (e.g. *"now operating as
  USER in Acme"*). "Scale down, not up" **across accounts**: a higher role in one account
  never carries into another. The clamped role re-applies downstream — **endpoint access
  and the role-keyed idle-timeout window** (see Idle timeout) recompute for the new role.

# Authentication

* **Register**: account + password, or **social SSO** (Google/etc.).
* **Enterprise SSO**: per-account **SAML/OIDC** IdP federation with **JIT
  provisioning**, and **SCIM** for directory-driven user provisioning/deprovisioning.
* **Login / logout** (logout = revoke refresh + blacklist access until exp; support
  **global logout** of all sessions).
* **MFA**: TOTP via authenticator apps + **adaptive MFA** on anomalous login (new
  device/geo). Enforcement (by scope / account / level) + re-auth-on-elevation: see *MFA* below.
* **Lockout** — escalating: **N** fails → **paused** with exponential backoff (5/10/20 min…, auto-recovers);
  after **Y** lockouts → **disabled** + notify the account's config admins. **password policy** +
  breached-password check. See [risk → Failed login & lockout](RISK.md).
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

# Idle timeout & session heartbeat

The web client **polls auth (~5 min)** to validate its session, and auth enforces an **inactivity timeout**
keyed to the client's **last *real* request** — so an abandoned session is force-logged-out and a revoked
one is detected promptly, instead of the UI sitting on stale authenticated content.

* **Heartbeat poll** — `GET /auth/session` (authed, lightweight). **Valid** → `200` (+ a remaining-idle
  hint); **invalid** → `401`/`403` + a **reason** (`idle_timeout` · `revoked` · `account_suspended` ·
  `reauth_required`). On any non-200 the client **clears its session and redirects to login**. The interval
  (~5 min) means an idle user (no clicks) and server-side revocations/idle-outs are caught **proactively**,
  not only on their next action.
* **Track `lastActivityAt` per session** — the authorizer stamps it on every **user-initiated** authenticated
  request.
* **The heartbeat does NOT count as activity** *(the crux)* — `GET /auth/session` (and other passive /
  background pings) are **excluded** from `lastActivityAt`; they're flagged **no-touch**. Otherwise the poll
  would keep the session alive forever and idle-timeout could never fire.
* **Idle timeout** — when `now − lastActivityAt > idleTimeout`, the session is **idle-expired**: the next
  request *or* the next heartbeat returns `401 idle_timeout`, the session is **revoked** (Redis blacklist),
  and the client logs out. A **sliding window on real activity** — distinct from the **absolute** session
  lifetime (refresh-token max) and the short access-token TTL.
* **Role-keyed — higher elevation ⇒ shorter timeout.** `idleTimeout` **decreases monotonically with `Access`
  ladder rank**: `SENDER`/`USER` get the longest window, `BILLING`/`ACCOUNT` admin shorter, **staff
  (`AppRole`) shortest**. It tracks the user's **current** role, so **escalating mid-session** (a step-up to a
  higher role) **tightens the window immediately** (and dropping back relaxes it) — the elevated session is
  the one you least want left unattended. System-/account-configurable per role, within platform bounds.
  (A SOC 2-style inactivity-logout control.)
* **Stale-connection guard + revocation surfacing** — the same check forces logout when "the server thinks
  the connection is stale" (no real request within the window), and is where the client promptly learns of
  **revocation / role or grant change / forced logout** (it re-checks the blacklist + current state).

> The poll is the *active* floor; **[realtime](../../realtime/SPECS.md)** could later *push* a `revoked` / logout
> signal to cut the detection latency to near-zero, but the heartbeat stays as the reliable backstop.

# Presence (who's online)

**Account-wide presence is owned by [realtime](../../realtime/SPECS.md)** — it owns the WebSocket **connection
registry** (the source of truth for "online"), so presence is a read over that, **not** an auth-held copy.
Auth contributes only the **access gate**: presence is account-scoped + role-gated via the `Access` check (an
account's users see each other per role; never cross-account). **Room-scoped awareness** (who's in *this*
doc/conversation) is [collab](../../collab/SPECS.md).

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

## Maker-checker — two-person approval for sensitive grants *(decided — configurable)*

**Separation of duties / four-eyes:** a sensitive privilege change needs **two distinct people** — a **maker**
who proposes it and a **checker** (a *different* admin, holding **≥ the granted level**) who approves before
it takes effect. **Self-approval is forbidden.** Flow: request → `pending` → approver acts → applied or denied,
all **audited**. Applied **selectively** to high-blast-radius ops (elevating a user to `billing`/`account`,
**account-wide** cross-account grants, SSO config) — **not** routine ones (`sender`/`user`), where it's just
friction.

* **Configurable per account** — an account turns maker-checker **on** for its account-scope role grants /
  sensitive ops. **Off by default**; regulated / enterprise accounts opt in. (Same pattern as
  `requireApprovalForSupportAccess`; the toggle + op-set live in account config.)
* **App / staff scope — configured by `root`.** Maker-checker over the **application ladder**
  (`support` / `application` / `root` grants + platform-wide sensitive ops) is set by **`AppRole.ROOT`** —
  not by any tenant account, since staff elevation is a platform-governance decision.

# Cross-account delegation grants

The RBAC ladder answers *"what's your role **in this account**?"* — it can't express *"a user/account from
**elsewhere** may do **X** in my account."* That cross-account, scoped capability is a **separate primitive
layered on the ladder** (it does **not** change `Access`'s ladders). **Default-deny**; access only via an
**explicit grant issued by the resource's owner**.

## The grant

```
Grant {
  grantor:   accountId                       // the account being accessed — only it can issue
  grantee:   { account } | { account, userId }   // a whole account, OR one specific user in it
  level:     Access.Role                     // capped role the grantee may operate at (e.g. sender / billing)
  scope:     account-wide | resource         // "billing in my account"  vs  "send on campaign #123"
  resource?: { type, id }                    // when scope = resource (e.g. campaign:B/123)
  window:    { start, end }                  // REQUIRED, bounded — UTC + IANA tz (same discipline as notice windows)
  status:    active | revoked | expired
  createdBy, createdAt, audit
}
```

## Rules (non-negotiable)

* **Owner-issued only** — only the **grantor account** (a user there with sufficient role) issues access
  *into* it. You can't grant yourself into someone else's account.
* **No self-grant / no self-escalation** — **`grantor account ≠ grantee account`**: you cannot grant *into
  your own account*. Within your own account your **role already *is* your access**, so a self-grant could
  only be an escalation attempt — disallowed outright. (And it's redundant with the ceilings anyway: a user
  can neither **issue** above their role — conferral ceiling — nor **exercise** above their home role —
  acting-user ceiling — so no grant, self-referential or not, escalates a user within their own account.
  `grantable`/`grantableAs` are `AppRole`-set, so a user can't configure the prerequisites either.)
* **Issuance gated by account policy (who may delegate out — *if anyone*).** Independent of *how much* (the
  ceiling), the **grantor account sets `grantIssuanceMinRole`** — the **minimum role required to issue any
  cross-account grant** — or **disables outbound granting entirely** (*"if any"*). Checked **before** the
  ceiling: a user below the bar can't issue even a within-ceiling grant. **Default conservative**
  (`account`-admin only); **consent / support grants always require `account` regardless**. So an account
  controls **whether and by whom** its access leaves the account, separately from the level cap.
* **Conferral ceiling — never confer more than you hold.** For a **conferral** grant (handing out your *own*
  account power — peer / account-ladder delegation), `level` must be **≤ the issuing user's current role**
  (`Access.rank(level) ≤ Access.rank(issuerRole)`). A `user` may grant **`sender`**, **never**
  `billing`/`account`. **No escalation by proxy.**
* **Consent grants — admitting a staff-vested grantee *can* exceed the issuer's role.** When the grantee's
  **`grantableAs` is an elevated / staff role set by an `AppRole`** (the CS team at `support`), the grant is
  **consent**, not conferral: the account is opting in to a capability the **platform already vested in the
  grantee**, not minting its own. So an **`account` admin in A may admit the support team at `support`** even
  though no A user holds `support`. Guards make this safe:
  * the elevation is authorized on the **grantee side** (`grantableAs`, **only an `AppRole` sets it** — an
    account can't self-declare `grantableAs: support` to escalate);
  * the **issuer's role gates the right to *consent*** (must be `account` admin in A), **not the level**;
  * it's **step-up**, **windowed**, **revocable**, **admin-notified**, **audited** (the support-access path).

  **Account-ladder** elevation above your own role stays **forbidden** — only a **staff-set `grantableAs`**
  unlocks a supra-issuer (consent) grant. (A `user` still can't admit anyone at `billing`.)
* **Ceilings, enforced at *use* time** — for the **acting** grantee user U:
  * **Conferral grant:** `effective = min( grant.level, issuer's CURRENT role, grantee's grantableAs, U's role at home )` — the issuer's role caps it.
  * **Consent grant** (staff-vested grantee): `effective = min( grant.level, grantee's staff-set grantableAs, U's own capability )` — the **issuer's account role does *not* cap the level** (it only gated the right to consent); the cap is the **staff-set `grantableAs`** + the acting staff user's own vested capability.
  In both, the **acting user's own standing** is the per-user cap →
* **A grantee user never exceeds, abroad, the role they hold at home ("scale down, not up", cross-account).**
  When the grantee is a **whole account** B, the grant is the *ceiling B can confer* — but only B users who
  themselves hold that role in B can exercise it at that level. Grant "B → `account` in A", yet a `sender` in
  B switches into A **only at `sender`**; a B user who is `account` in B gets `account` in A. A junior user
  can't escalate by borrowing the account's grant.
* **Downgrade caps live grants** — if the issuer (or an acting user) is later downgraded, the effective level
  re-clamps on the next use; an issuer demotion can **auto-revoke** grants that now exceed their role.
* **Direction-agnostic** — **sub-account → parent**, parent → sub, or **lateral A ↔ B**. This is the **one**
  primitive behind *all* cross-account access, **including the agency / sub-account model** (an agency simply
  holds grants into the clients it manages) — not a second bespoke mechanism.
* **Acts as self, not impersonation** — the grantee uses **their own identity**; actions are **audited under
  their real user** with the grant id attached ("did X — acct A — via grant G"). Distinct from impersonation /
  support access (that section).
* **No re-delegation** — a grantee **cannot re-grant** what they hold (prevents grant chains / escalation
  laundering). Only the true owner grants.
* **Least privilege** — prefer `resource`-scoped + a minimal action set over account-wide; account-wide is the
  broader, more-scrutinized case.
* **Grantee eligibility — private by default, staff-curated.** An account is **not a valid grantee** unless
  flagged **`grantable`** — and that flag is **set only by an `AppRole` (staff)**. So accounts are
  **invisible as delegation targets by default** (no enumeration of who exists via the grant picker); only
  vetted accounts — a **sending team**, the **CS team**, an **agency** — become grantable. The grant picker
  lists **only `grantable` accounts**.
* **Grantee-declared role ceiling (`grantableAs`)** — a grantable account declares the **role(s) it may be
  granted as**: a sending-team account is `grantable, grantableAs: sender`; the **CS-team** account is
  `grantable, grantableAs: support`. Staff sets the ceiling when enabling; the account **may narrow within
  it**. The picker only **offers roles ≤ the grantee's `grantableAs`** (∩ the issuer's own ceiling), so a
  `sender`-only partner can never be picked at `billing`.
* **Grants are independent per `(grantee, scope/resource)` — granting another resource is NOT an extension.**
  "B may send on campaign 1" and "B may send on campaign 2" are **two separate, separately-windowed grants**;
  campaign 1's grant still expires on its own schedule when campaign 2's is issued. (Only an **account-wide**
  grant has a single window that re-granting would *refresh* → another reason account-wide is the
  scrutinized case.) **Re-issuing the *same* `(grantee, resource)` supersedes** the prior grant (replaces its
  window) rather than stacking duplicates.
* **Recurring grants → formalize the relationship.** Repeatedly re-granting the same party (campaign after
  campaign) is a signal to set them up as a **managed agency / sub-account relationship** (same primitive, an
  explicit standing grant the owner manages + revokes in one place), not a stream of ad-hoc grants.
* **Notify + audit on every grant** — **create / change / revoke** fires a notification to the **grantor
  account's admin** (owners always know who has access in), plus a full **audit** entry. (Likely notify the
  grantee too.)
* **Always time-limited — no open-ended grants.** Every grant **must** carry an expiry; there is no
  perpetual grant. **Max window length is account-configurable** within a **platform hard ceiling**, default
  **30 days (~1 month)** (support-access grants default tighter — hours/days "while the ticket is open").
  Expiry **auto-revokes**.
* **The grantor manages the grant — extend / shorten / revoke.** At any time the grantor can **revoke**
  (immediate → Redis blacklist, like session revocation), **shorten** the window, or **extend** it (re-bounded
  by the max — a deliberate action, **not** an auto-renew). Every change is **re-notified + audited**.
* **Expiry warning → extend or lapse (no auto-renew).** A grant simply **runs in its window** (which may be a
  **long window**); before it ends, **both the grantor and the grantee are emailed** that the grant is
  **about to expire**. The **grantor may extend** it (re-bounded by the max — a deliberate click), **or do
  nothing and let it expire** at `window.end` (auto-revoke). The warning lead time is reasonable-default /
  configurable (e.g. a few days out, tighter for short support grants). This keeps access **explicitly
  renewed** rather than quietly perpetual, while avoiding surprise lapses.
* **Both sides see active grants — transparency.** The **grantee** sees **what** access, **from whom**,
  **when granted**, and **until when** — surfaced when they **switch into that account**, and on a dedicated
  **"granted access" page**. The **grantor** gets the mirror view — **every grant it issued** (who's in, at
  what level, scope, until when) — and manages them (extend / shorten / revoke) from there. Grants are
  first-class, **listable + auditable** on both sides.
* **Step-up** — issuing a cross-account grant is a **step-up-auth** trigger (per the escalation policy).

## Authorizer — role **OR** grant

```
allowed =  isAllowed( callerRoleInResourceAccount, endpoint.minAccess )        // own-account path (unchanged)
        OR ( grant matches caller + resource + action
             AND now ∈ grant.window
             AND Access.rank(grant.level) ≥ rank(endpoint.minAccess)
             AND grant.level still ≤ issuer's CURRENT role )                   // delegated path
```
`Access`'s ladders + `isAllowed` are **unchanged** — grants are an **additional allow path** the authorizer
evaluates and caches (revocation invalidates the cache).

## Support access (CS team) — account-consented, optional

The **same grant primitive** gates **staff/support** access: `grantee` becomes a **third kind** — the
**CS/staff team** (or a specific agent) rather than another account. This makes support access
**account-consented, time-boxed, and audited** — the *access-approval / JIT* pattern (strong for SOC 2 / GDPR
/ enterprise: the customer controls *when* support can see their data).

* **Option, not blanket-enforce (recommended)** — a **per-account / per-plan setting**: *"require approval for
  support access."* **Default:** support holds standing access (audited via impersonation / support access).
  **Stricter mode** (enterprise / regulated accounts): support can enter **only with an active account-issued
  grant** — scoped (read vs a support action set), **windowed** ("24 h while this ticket is open"), revocable,
  every entry **notified to the account admin + audited**.
* **Break-glass (always)** — even in stricter mode, keep an emergency path (account lockout, security
  incident) that **doesn't depend on the customer granting access**: **root-only**, heavily **audited**, with
  **mandatory post-hoc admin notification + review**. Incident response must never be blocked by a missing
  grant.
* **Still acts as self + audited** — a support grant doesn't bypass the impersonation/audit rules; it gates
  *whether* support may enter, the impersonation section governs *how* (every action logged under the agent).

## Open items
* **Acceptance flow** — unilateral (owner issues → effective immediately + notify) vs the grantee account must
  **accept**. *(Lean: effective immediately + notify; acceptance optional, for the grantee's own audit.)*
* **Downgrade cascade granularity** — exact behavior on issuer downgrade vs offboarding (cap vs auto-revoke).

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
* **Availability decision (decided):** the **auth decision** fails **closed** (Redis/DDB down → deny); the
  **rate limiter** fails **open** — on a Redis outage it **continues (allow + log + alert), never blocks**, so a
  limiter outage can't take down the API. Limiter = availability-biased, authz = security-biased.

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

## Immutable + tamper-evident (content hashing)

Every change to **auth, roles, access, grants, keys** (etc.) is written as an
**append-only, immutable** `AuditEvent` — never updated or deleted in place; a correction
is a **new** event, not an edit.

* **Each record is hashed over its own stored content.** On write, auth computes a
  cryptographic digest (e.g. SHA-256) **over the event's canonical fields** (actor, action,
  target, before/after, timestamp, etc.) and stores that **`hash` alongside the record**.
* **Reading re-verifies the hash.** When the audit is read/exported, the digest is
  **recomputed from the stored content and compared** to the stored `hash`. **A mismatch is
  surfaced** — the record is **flagged as tampered / does not match its hash** rather than
  shown as trustworthy, so any out-of-band mutation of the row is **visibly detectable**.
* **Chained for sequence integrity (recommended).** Each event's hash also folds in the
  **prior event's hash** (a hash chain), so it's tamper-evident against **deletion or
  reordering**, not just single-field edits — verifying the chain detects a missing/altered
  link. Pairs with a write-once / append-only store.
* This is the **integrity guarantee** behind the "immutable audit" claim in the compliance
  mapping (SOC 2 CC7 · ISO A.8.15). **Retention** is configurable per environment (**dev 1 week / prod 1 year**;
  `auth-19.5`); long-term archival rides the central [audit](../../audit/SPECS.md) service.

# Access recertification (periodic review)

Standing access drifts — people change teams, projects end, admins linger. Time-limited *grants* expire on
their own, but **standing roles** (`RoleGrant`) and **staff** (`AppRole`) need **periodic review** to stay
least-privilege (SOC 2 CC6.3 · ISO A.5.18).

* **Quarterly recertification email.** Every quarter, auth generates a per-account **access-review report**
  and emails the account's **config admin(s)** (and **root / application** for the staff ladder). The report
  lists each member: **name, last login, current role(s)** — who has access, at what level, and whether
  they're still active.
* **The reviewer acts on it** — per user: **confirm** the role is still appropriate, **change / remove** a
  role, or **disable** the account. One action per row (deep-link into the admin surface); the whole review is
  **audited** (who recertified, what changed, when) as a hashed `AuditEvent`.
* **Inactivity auto-disable (option).** An account-configurable policy: users **inactive for `N` days** (no
  login) are **flagged** in the report and — when the option is on — **auto-disabled** (`status → DISABLED`,
  login prevented, reversible by an admin), so a dormant account can't be a quiet attack surface. Staff
  inactivity defaults tighter. `N` and on/off are configurable (system / account level) — see
  `Auth.RecertificationConfig`.
* **Mechanism** — a scheduled `Job` (run recorded in the [monitor](../../monitor/SPECS.md) job-run ledger)
  reads `UserProfile` (`lastLoginAt`, name, status) + `RoleGrant` (roles / maxRole), renders the report (the
  report-service CSV pattern), and emails it. Same data shape as the access export, scoped per account.
* **Cadence configurable** (default quarterly); high-privilege / regulated accounts may review monthly.

# Privacy & compliance

* User **data export / deletion** (GDPR/CCPA) coordinated with account. See **Erasure** below.
* Credentials never leave Cognito in plaintext; API-key secrets stored hashed only.
* PII minimization in tokens and logs (light JWT supports this).
* **No sale / sharing of data without opt-in.** Auth data (and platform data generally) is
  **never sold or shared** with third parties **unless the user has explicitly agreed / opted
  in** to that sharing or sale. Default is **off** — affirmative **opt-in**, not opt-out (this
  is stricter than CCPA's opt-out baseline and aligns with GDPR consent). See **Data sale /
  sharing** below.

## Erasure (right to be forgotten — GDPR Art 17 / CCPA §1798.105)

We erase **by anonymizing in place, not deleting the row** — the user **UUID is the only
identifier that maps to resources across services** (campaigns, audit, billing, messages),
so the record must survive for referential integrity; only the **PII attached to it** is destroyed.

* **What is scrubbed:** the **email** and **phone** are overwritten with a **random,
  system-unique alphanumeric tombstone** (e.g. `erased-<rand>@invalid` / a non-routable
  E.164-shaped placeholder) — unique so any uniqueness/index constraint still holds, and
  irreversible (no mapping back to the original value is retained). Any other auth-held PII
  (name, avatar, social/SSO identifiers) is cleared the same way; Cognito credentials are
  deleted/disabled.
* **What is kept:** the **`userUuid`** (opaque, not PII) and the **security audit trail**,
  which references the user only by `userUuid` — so login/grant/admin history remains intact
  and reconstructable while no longer pointing at a real person. Retained on a
  **legal-obligation / legitimate-interest** basis (fraud, opt-out proof, audit).
* **Authorization:** an erasure is a **privileged, irreversible operation** — issuable
  **only by an `application` or `root` `AppRole`** (never an account-level role). It is itself
  an audited security event: an immutable `AuditEvent` records **who authorized it, when, the
  target `userUuid`, and the request/ticket reference** — i.e. proof the erasure was authorized
  and lawful.
* **Effect:** the user can no longer authenticate (no credentials, no routable
  email/phone); the account membership is removed/closed per the account service. The
  tombstoned identity is inert.

## Data export (right of access / portability — GDPR Art 15/20 · CCPA §1798.100/.110)

A data-subject's auth data is exposed as a **report**, not an ad-hoc dump.

* **Format:** **CSV** (portable, plain). Contents = the auth-held data for one `userUuid`:
  identity/profile fields, linked SSO/social identities, account memberships + roles,
  active grants (issued and received), sessions/devices, and the security-audit events for
  that user.
* **Who may run / read it:** **only the subject themselves, an `account` admin (of the
  subject's account), or `root`.** No other account user, and no `support`-level staff,
  can pull another person's export.
* ⚠️ **Reporting gap to close:** today the reporting capability is scoped to **account/staff**
  roles; this report must **also be runnable by the subject *about themselves***. The reports
  service needs an access pattern of **"requester ∈ {self, account-admin-of-target,
  root}"** (a self-scope, not just a role-min) — flagged for the reports owner.
* **Audited:** running an export is a security event (`AuditEvent`: who, when, target
  `userUuid`) — same as any PII access.

## Data sale / sharing (opt-in required — CCPA §1798.120/.121 · GDPR Art 6/7)

The platform **does not sell or share user data with third parties** as a default.
**Any** sale or sharing — at minimum of **auth data** — requires the **user's explicit
agreement (opt-in)**.

* **Affirmative opt-in, default off.** Sharing/sale is **disabled** unless the user has
  **actively consented**; we do **not** rely on CCPA's opt-out model — silence/inaction is a
  **no**. (Stricter than CCPA, consent-aligned with GDPR.)
* **Consent is recorded + auditable.** Each opt-in captures **who, what scope (which data /
  which purpose / which third party), when, and the consent version** — stored as an
  immutable, hashed `AuditEvent` like any other security event.
* **Revocable.** The user can **withdraw** consent at any time; withdrawal stops future
  sharing/sale and is itself audited. (CCPA "do not sell/share" + GDPR right to withdraw.)
* **Scoped, not blanket.** Consent is per purpose/recipient, never an open-ended grant; a new
  purpose or recipient needs a **new** opt-in.
* **No opt-in ⇒ no flow.** Absent recorded consent, downstream services must treat the data
  as **not shareable** — the consent state is the gate, checked at the point of any export to
  a third party.

* **Target:** the authorizer adds a bounded p99 overhead per request — met via warm-
  Lambda caching of the role map + recent decisions, the epoch check (O(1) Redis), and
  keyId-indexed key lookup (no hash scans).
* X-Ray trace id per request, propagated across services for latency breakdown.

# Outbound webhooks (naming clarification)

* **Inbound** external callers → authenticated by an **API key** (above). ✓
* **Outbound** (we notify a customer) → **not** an API key: **HMAC-sign** the payload
  with a per-endpoint signing secret the receiver verifies. Different mechanism.

# SQS listeners

> **Placeholder — platform convention.** Every service documents the **SQS queues it consumes** here: the
> **queue name**, the **message body** it expects, and the **handler/action** + requirement it satisfies.
> Message-body shapes will be pinned as shared **`Type` contracts in `@repo/common`** (so producer and consumer
> agree on the envelope); for now this table is the source of truth. Consumed via a `Job`/worker on the shared
> [`Application`](../../../../packages/services/src/Application.ts) base (fair-share `WorkQueue` where applicable).

| Queue | Message body (TBD `Type`) | Handler / action | Req |
|---|---|---|---|
| `auth-forget` | `{ subjectType: "user", userUuid, pii: { emails[], phones[], names[], … } }` | **Forget responder** — anonymize the user's identity + presence, then fan the **known-PII match-set** out to content services ([collab](../../collab/SPECS.md) `/internal/erase`, [campaign](../../campaign/SPECS.md), …) for exact-match obfuscation | auth-21.5 |
| *(future)* | *…* | *…* | *…* |

# Bootstrapping & root seeding (new install)

A fresh install has no users, yet someone must perform the first `ROOT` action — a chicken-and-egg the seed
solves **without shipping a default credential** (default/known credentials are a classic breach — OWASP A07).

**The approach — no default password:**

* On first deploy, seed a single **`ROOT`** account in **`UserStatus.RESET_REQUIRED`** with **no usable
  password** (a random, immediately-invalidated secret — never a known default).
* The **sysadmin email** that receives the activation link comes from **deploy-time config** — a Secrets
  Manager / SSM parameter (or CDK context), **per environment**, **never hardcoded or committed**.
* Auth emails that address a **single-use, short-TTL activation link** (`PasswordResetToken.purpose =
  seed-activation`, the [reset mechanism](ACCESS-FLOWS.md#password-reset--forgot)); first login then **forces
  MFA / passkey enrollment** (step-up) before a full session issues.

**Recommended hardening (a more secure seed):**

* **Bootstrap-token gate** — generate a random **bootstrap secret at deploy time**, store it in Secrets
  Manager, and surface it to the operator **out-of-band** (deploy output / console). Activating root requires
  **both** the emailed link **and** this token — so controlling the inbox alone isn't enough.
* **Break-glass once** — the seed/activation path **auto-disables after the first successful root
  activation**; re-enabling it is itself an audited `ROOT`/deploy action. Root thereafter is **break-glass**,
  not a daily driver.
* **Force MFA + a second `ROOT`** — require a strong factor on first login and prompt to create a second
  `ROOT` / break-glass identity, so there's no single point of lockout.
* **Per-market / per-environment** — each install (incl. each EU-region account) seeds its **own** root; no
  shared/global root across markets.
* **Move to SSO** — once enterprise SSO is configured, pin staff/root to the IdP; the seeded local root stays
  as audited break-glass only.

# Infra footprint (auth's `ResourceManifest`)

* Cognito user pool (MFA `OPTIONAL`; requirement enforced by trigger) + post-auth Lambda trigger.
* DynamoDB: `api_keys` (2 GSIs + TTL), role-grants, sessions (TTL), audit, **`password_reset_tokens` (GSI +
  TTL)**.
* Redis (ElastiCache) for counters + revocation set/epoch.
* Kafka topics (publish auth/usage events).
* SNS/SES for reset/verification.
* Secrets Manager / SSM — the **seed sysadmin email + bootstrap token** (deploy-time config).
* The Lambda Authorizer + the build-generated `min_role` map artifact.

# Compliance & standards mapping

How the auth controls above map to **OWASP Top 10 (2021)**, **ISO/IEC 27001:2022** (Annex A), **SOC 2 Type 2**
(Trust Services Criteria), **HIPAA** (Security Rule, 45 CFR §164.308/.312), **GDPR**, and **CCPA/CPRA**. Clause
references are **indicative**, and this is a **design-intent** self-assessment — *SOC 2 Type 2 and ISO 27001
certify **operating effectiveness over time** (audited evidence + an ISMS), which is an org/operations exercise
beyond this spec.*

> **HIPAA applies *only if the platform handles PHI*** (a healthcare customer sending protected health info).
> The technical safeguards below are **satisfied by these controls**, but HIPAA compliance also requires a
> signed **Business Associate Agreement (BAA)** and the administrative/physical safeguards — **whether we
> support PHI at all is a business decision** (many marketing platforms explicitly exclude it). The HIPAA
> column shows the safeguard each control maps to; if we don't position for PHI, treat the column as ➖. See Gaps.

**Legend:** ✅ meets/exceeds · ⚠️ partial — see Gaps · ➖ n/a

| Auth control | OWASP T10 | ISO 27001:2022 | SOC 2 (TSC) | HIPAA (if PHI) | GDPR | CCPA/CPRA | |
|---|---|---|---|---|---|---|---|
| MFA + adaptive MFA | A07 | A.8.5 | CC6.1 | §164.312(d) | Art 32 | §1798.81.5 | ✅ |
| Passkeys/WebAuthn + email-OTP (no magic links) | A07 | A.8.5 | CC6.1 | §164.312(d) | Art 32 | §1798.81.5 | ✅ exceeds |
| Password policy + breached-password check | A07 | A.5.17 / A.8.5 | CC6.1 | §164.308(a)(5) | Art 32 | §1798.81.5 | ✅ |
| Escalating lockout + bot challenge | A07 | A.8.5 | CC6.1 | §164.308(a)(5) | Art 32 | ➖ | ✅ |
| Enumeration-neutral (login/reset/registration) | A04 / A07 | A.8.5 | CC6.1 | ➖ | Art 5(1)(c)/32 | ➖ | ✅ exceeds |
| Session: short TTL, refresh rotation + reuse-detect, revocation epoch | A07 | A.8.5 | CC6.1 | §164.312(a)(2)(iii) | Art 32 | §1798.81.5 | ✅ |
| Idle timeout (role-keyed) + heartbeat | A07 | A.8.5 | CC6.1 | §164.312(a)(2)(iii) | Art 32 | ➖ | ✅ exceeds |
| RBAC ladders + per-endpoint `minAccess` + default-deny | A01 | A.5.15 / A.8.3 | CC6.3 | §164.312(a)(1) | Art 32 | ➖ | ✅ |
| Least privilege / scale-down-not-up / scoped grants | A01 | A.5.15 / A.8.2 | CC6.3 | §164.308(a)(4) | Art 25 / 32 | ➖ | ✅ |
| Cross-account grants — capped, time-limited, revocable, audited, notify | A01 | A.5.18 | CC6.2 / CC6.3 | §164.308(a)(4) | Art 32 | ➖ | ✅ exceeds |
| Maker-checker (sensitive grants) | A01 | A.5.3 (SoD) | CC6.3 / CC1.x | §164.308(a)(3) | Art 32 | ➖ | ✅ exceeds |
| Step-up auth on elevation | A01 / A07 | A.8.5 | CC6.1 | §164.312(d) | Art 32 | ➖ | ✅ |
| SSO (SAML/OIDC) + SSO-only + JIT/SCIM deprovisioning | A07 | A.5.16 / A.5.18 | CC6.1 / CC6.2 | §164.308(a)(3)(ii)(C) | Art 32 | ➖ | ✅ |
| Privileged/staff access — impersonation audited, time-boxed, consent, break-glass | A01 | A.8.2 | CC6.1 | §164.312(a)(1) | Art 32 | ➖ | ✅ |
| Access recertification — quarterly review + inactivity auto-disable | A01 | A.5.18 | CC6.3 | §164.308(a)(3)(ii)(B) | ➖ | ➖ | ✅ decided |
| Security monitoring + breach detection/alerting (→ monitor) | A09 | A.8.16 | CC7.2 / CC7.4 | §164.308(a)(6) + §164.400–414 | Art 33 / 34 | ➖ | ✅ detect · ⚠️ runbook |
| Secrets in KMS/Secrets Mgr · creds in Cognito · keys hashed · HMAC webhooks | A02 | A.8.24 / A.5.17 | CC6.1 / CC6.7 | §164.312(a)(2)(iv) / (e) | Art 32 | §1798.81.5 | ✅ |
| Immutable security audit (`AuditEvent`) — content-hashed + verify-on-read, chained; **retention dev 1w / prod 1y (configurable)** | A09 | A.8.15 | CC7.2 / CC7.3 | §164.312(b) / (c) | Art 33 / 34 | ➖ | ✅ |
| Monitoring / anomaly (adaptive MFA, X-Ray, monitor) | A09 | A.8.16 | CC7.2 | §164.308(a)(1)(ii)(D) | Art 33 | ➖ | ✅ |
| Rate limiting | A04 / A07 | A.8.6 | CC6.6 | ➖ | Art 32 | ➖ | ✅ |
| PII minimization (light JWT, opaque ids, no PII in logs) | A04 | A.8.11 / A.8.10 | CC6.x | §164.502(b) (min necessary) | Art 5(1)(c)/25 | §1798.100 | ✅ |
| Default-deny edge + internal-only endpoints + S2S workload identity | A01 / A05 | A.8.22 / A.8.20 | CC6.6 | §164.312(e) | Art 32 | ➖ | ✅ |
| Data-subject **deletion / erasure** of auth PII (tombstone) | ➖ | A.5.34 | (Privacy criteria) | ➖ | Art 17 | §1798.105 | ✅ decided |
| Data-subject **export / right-to-know** of auth PII (CSV report, self/`account`/`root`) | ➖ | A.5.34 | (Privacy criteria) | §164.524 | Art 15 / 20 | §1798.100/.110 | ✅ decided · ⚠️ reports self-scope |
| **No sale / sharing without opt-in** (affirmative, scoped, revocable, audited) | ➖ | A.5.34 | (Privacy criteria) | §164.508 | Art 6 / 7 | §1798.120/.121 | ✅ exceeds (opt-in > opt-out) |

## Gaps & open decisions (one review list)

✅ = resolved/decided · ⚠️ = **open — needs attention**.

* ✅ **Erasure ⇄ audit retention** *(GDPR Art 17 / CCPA §1798.105)* — **decided** — see
  [Privacy & compliance → Erasure](#erasure-right-to-be-forgotten--gdpr-art-17--ccpa-1798105):
  anonymize email/phone in place to a system-unique tombstone, keep `userUuid` + audit trail
  (legal-obligation basis), `application`/`root`-only, itself audited. **Remaining:** confirm the
  audit **retention period** (see audit-retention gap below).
* ✅ **Data export / right-to-know** *(GDPR Art 15/20 · CCPA §1798.110)* — **decided** — see
  [Privacy & compliance → Data export](#data-export-right-of-access--portability--gdpr-art-1520--ccpa-1798100110):
  a **CSV report** of the subject's auth data, readable **only by self / `account` / `root`**, audited.
  **Remaining (reports service):** add a **self-scope** access pattern so a subject can run the report
  *about themselves* (today reporting is account/staff-scoped only).
* ✅ **Access recertification** *(SOC 2 CC6.3 · ISO A.5.18)* — **decided** — see
  [Access recertification](#access-recertification-periodic-review): **quarterly** access-review email to
  account admins (name / last-login / role), per-user confirm-change-disable, plus **inactivity auto-disable**
  (`RecertificationConfig`). **Remaining:** the admin review surface + the report-service self/admin scope.
* ✅ **Audit retention + tamper-evidence** *(SOC 2 CC7 · ISO A.8.15)* — **decided.** Integrity: append-only,
  content-hashed, verify-on-read, hash-chained (see
  [Audit & security events → Immutable + tamper-evident](#immutable--tamper-evident-content-hashing)).
  **Retention is environment-dependent + configurable** (AppConfig per env) — default **dev = 1 week**,
  **prod = 1 year**; longer-term / compliance archival rides the central **[audit](../../audit/SPECS.md)**
  service (WORM / S3 Object Lock) where a longer tier applies (`auth-19.5`).
* ✅ **Breach detection → notification** *(GDPR Art 33/34 — 72 h)* — **split decided; auth's part complete.**
  *Detection + alerting* lives in [monitor → Security monitoring & breach detection](../../monitor/SPECS.md)
  (consumes auth's hashed security `AuditEvent`s; security on-call routing). **Auth's technical obligations
  exist** — immutable hashed audit + revocation epoch + IP block (containment) + emit-to-monitor — so there is
  **no open auth work**. The *"is this a reportable breach" + 72 h notification* is a **security / legal / DPO
  process**, now homed in the top-level **[RUNBOOK](../../../../docs/RUNBOOK.md)** (the 72 h / Art 34 clocks +
  reportability decision tree; templates **TBD by legal**) — tracked there, **not** an auth gap.
* ✅ **Data residency** *(GDPR Ch. V)* — **decided** — the **EU market runs in its own AWS account** with
  **all services deployed in an EU-approved (EU-region) data center**, so EU data subjects' identity/PII
  **stays in-region** and never lands in the US account. A **separate-account-per-market** model (not
  cross-region replication of one account), consistent with the "never two environments per AWS account"
  posture. **No cross-region flows** — no Global Tables, S3 CRR, Kafka mirroring, cross-region backups, or
  out-of-region logs/analytics carry EU PII out of the EU account. See
  [AWS → Region & account topology](../../../../packages/services/src/aws/SPECS.md).
* ✅ **Data sale / sharing** *(CCPA §1798.120/.121 · GDPR Art 6/7)* — **decided** — see
  [Privacy & compliance → Data sale / sharing](#data-sale--sharing-opt-in-required--ccpa-1798120121--gdpr-art-67):
  **no sale/sharing by default; explicit user opt-in required** (affirmative, scoped, recorded/audited,
  revocable) — stricter than CCPA's opt-out. **Remaining:** where consent state lives + the per-recipient
  scope catalog (likely shared with account/contact consent).
* ✅ **HIPAA / PHI — DECIDED: no PHI** *(45 CFR §164.308/.312)* — the platform **does not support PHI** (no
  BAA). Sending PHI / regulated health data is **prohibited by the AUP/Terms** + a **one-time account
  acknowledgment** (see [account → Acceptable use & PHI](../../account/specs/SPECS.md)). The auth safeguards
  still **map** to the Security Rule (column kept for reference), but HIPAA is **out of scope / ➖** — there's
  no PHI to protect. **Revisit only if** a **HIPAA-enabled tier** is pursued (then: BAA + §164.308
  administrative safeguards + the technical safeguards already mapped).
* ✅ **Account-hierarchy cascade — decided (per-sub-account config).** Each sub-account sets **`parentAccess`**:
  **`open`** — parent users have **implicit, standing** access into the child (capped by the child's ceiling,
  audited); **`granted`** — no implicit access, a sub-account user issues an explicit time-boxed grant.
  **Default `granted`** (least-privilege); setting lives in account config.
* ✅ **Rate-limiter failure mode — decided: fail-OPEN.** If Redis is down the **rate limiter continues
  (allow + log + alert) — it must NOT block** traffic; a limiter outage can't be allowed to take down the API.
  The **authz decision still fails CLOSED** (no role / revocation data → deny). Limiter = availability-biased,
  authz = security-biased (`auth-12.2`).
* ✅ **Maker-checker for role grants — decided (configurable).** Off by default; an **account** can require
  two-person approval on its sensitive role grants; app/staff scope governed by `root`. See *Maker-checker*.
* ✅ **Ladder ordering — confirmed / frozen (for now).** Account scope **`sender < user < billing < account`**;
  app scope **`support < application < root`**. Frozen as the canonical order — every endpoint's `minAccess`
  derives from a role's position, so reordering is a **breaking change**; revisit only via a deliberate, audited
  migration.

# Service & Job topology

**Convention (platform-wide).** Each service layers **framework base → domain base → concrete role**. A **domain
Service base** (`AuthService extends Service`) and a **domain Job base** (`AuthJob extends Job`) hold the
**shared domain code** — the **Cognito** client, **JWT mint / verify**, the **RBAC `Access`** resolver, **cached
membership** (read from [account](../../account/specs/SPECS.md)), the **Redis revocation epoch + rate-limit**
client, the **risk engine**, the **reputation provider factory**, and **audit emit** — so every concrete role
inherits it. Auth's defining trait: **the authorization decision runs in a Lambda REQUEST Authorizer**, separate
from the API service — so auth's **hot-path "read split" is the Authorizer Lambda**, not a second Fastify service.

```
Application
├── Service (Fastify, long-running — ECS)
│     └── AuthService             (domain base — Cognito · JWT mint/verify · RBAC resolver · cached membership · Redis revocation/rate-limit · risk engine · reputation factory · audit emit; not deployed alone)
│           └── AuthMainService    (the /auth/* API: staged sign-in · MFA/step-up · tokens (issue/refresh/switch/revoke) · password reset · SSO/passwordless · API keys · cross-account grants · IP rules · recert admin · internal S2S (reputation, membership) · config/health)
└── Job (Lambda)
      └── AuthJob                  (domain base — same shared internals for non-HTTP contexts)
            ├── AuthAuthorizer        (API Gateway REQUEST authorizer — THE hot-path gate: JWT / API-key → one (accountId, role, scopes) · RBAC · Redis rate-limit + revocation epoch · allow/deny; warm-cached)
            ├── AuthCognitoTriggerJob (Cognito Lambda triggers — post-auth notify session · pre-token · custom-message)
            ├── AuthForgetJob         (SQS auth-forget — anonymize identity + presence, fan known-PII match-set to content services)
            └── AuthRecertificationJob (EventBridge, quarterly — per-account access-review report + email; inactivity auto-disable)
```

**Services (HTTP, ECS Fargate)**

| Class | Extends | Role |
|---|---|---|
| **`AuthService`** | `Service` | **Domain base** — Cognito · JWT · RBAC resolver · cached membership · Redis revocation/rate-limit · risk engine · reputation factory · audit emit; **not deployed alone**. |
| **`AuthMainService`** | `AuthService` | The **`/auth/*` API** — staged **sign-in** pipeline, **MFA / step-up**, **tokens** (issue / refresh / **switch** / revoke), **password reset**, **SSO / passwordless**, **API keys**, **cross-account grants** (issue / redeem), **IP allow/deny**, **recertification** admin surface, **internal S2S** (`/auth/internal/reputation`, membership), config / health. |

**Jobs (Lambda)** — each extends `AuthJob`:

| Class | Trigger | Role | Req |
|---|---|---|---|
| **`AuthAuthorizer`** | **API Gateway** (REQUEST authorizer) | **THE hot-path gate on every route** — converge JWT *or* API key → one `(accountId, role, scopes)`, run **RBAC** + **Redis rate-limit** + **revocation-epoch** check, allow/deny; **warm-cached** (the read-optimized split). **Fails CLOSED** (no role/revocation data → deny); the rate-limiter portion **fails OPEN** | auth-8.0 / 12.0 / 6.4 |
| **`AuthCognitoTriggerJob`** | Cognito (Lambda triggers) | Post-auth → **notify the session sub-domain** on login; pre-token / custom-message hooks | auth-1.0 / 2.0 |
| **`AuthForgetJob`** | SQS `auth-forget` | GDPR forget responder — **anonymize** the user's identity + presence, then **fan the known-PII match-set** to content services for exact-match obfuscation | auth-21.5 |
| **`AuthRecertificationJob`** | EventBridge (quarterly) | Generate the per-account **access-review report** + email config admins / staff; **inactivity auto-disable**; run recorded in the [monitor](../../monitor/SPECS.md) job-run ledger | auth-20.0 |

> **Shared modules (not deployables).** The **RBAC `Access`** library lives in
> [`@repo/endpoint`](../../../../packages/endpoint/SPECS.md) (used by the authorizer + *every* service), and
> **JWT mint/verify + the revocation epoch** + the **reputation provider factory** sit on the `AuthService` /
> `AuthJob` bases so the **API service and the Authorizer share one implementation** (a divergence between them
> would be a security hole). The **emit side** — `Application.audit()` (→ SQS audit) + the Kafka auth/usage
> events — is platform-wide, not auth-specific. **Root seeding** (new-install) is a **one-shot deploy-time CDK
> custom resource**, not a standing Job.

# AWS Services and Other Dependencies

**AWS services**
* **Cognito** — single user pool; credentials, MFA (TOTP), advanced security; post-auth Lambda trigger.
* **API Gateway (HTTP API v2)** — JWT-native edge; **Lambda REQUEST Authorizer** — the single gate on every route.
* **DynamoDB** — **cross-account grants** (auth-owned) + **cached membership** (read from account), API keys, user metadata, audit / security events.
* **Redis (ElastiCache)** — rate-limit counters + the JWT/key revocation set.
* **Kafka** — emit auth / usage events to session + analytics.
* **SNS / SES** — password-reset, verification codes, security notifications.
* **KMS / Secrets Manager** — secrets + signing keys.

**Third-party libraries / services**
* **MaxMind GeoLite2** — free geo + ASN reputation, + Tor exit-list (the cheapest reputation feed). Optional paid VPN/fraud feed (MaxMind Anonymous-IP / IPQS / Spur) via the provider factory. Local `.mmdb` kept current via MaxMind **[`geoipupdate`](https://github.com/maxmind/geoipupdate)** (scheduled → S3, hot-reloaded; `auth-17.7`).

**Internal (`@repo/*`)**
* `@repo/services`, `@repo/endpoint` (`Access` — the role model), `@repo/common` (`Type`).

# Requirements

Traceable requirement register for this service. IDs are stable handles (**`auth-N.M`**) — cite them in code,
tickets, and tests. **Priority:** **A** = MVP (ship first; the A's alone = a working, secure auth), **B** =
core hardening / common features, **C** = advanced / later-phase. One level of sub-requirements only; a
group's priority is its floor (it has at least one item at that priority).

## auth-1.0 Identity & accounts — A
- **auth-1.1** UserProfile metadata over the Cognito identity — A
- **auth-1.2** Email + verified-phone uniqueness lookups — A
- **auth-1.3** Account membership + role resolution — **read from [account](../../account/specs/SPECS.md)** (the SoT; cached for the hot path), never owned here — A
- **auth-1.4** Acting account + role selection / switch (≤ account-owned `maxRole`, scale-down-not-up) — A
- **auth-1.5** Account-switch auto-downgrade + UI notify — B
- **auth-1.6** Identity linking — multi-method, link-never-fork — B
- **auth-1.7** Root seed on new install (`RESET_REQUIRED`, no default cred, deploy-config email + bootstrap-token, break-glass-once) — A

## auth-2.0 Sign-in — staged challenge pipeline — A
- **auth-2.1** Identifier-first staged flow (Cognito `CUSTOM_AUTH` state machine) — A
- **auth-2.2** Email/phone + password primary credential — A
- **auth-2.3** Server-driven challenge state (`next` vs terminal) — A
- **auth-2.4** Enumeration-neutral surfaces (constant wording + timing) — A
- **auth-2.5** OTP channel choice (email/SMS; default by identifier) — B

## auth-3.0 MFA & step-up — A
- **auth-3.1** Enforced MFA (TOTP / SMS) via `MfaConfig` — A
- **auth-3.2** Step-up on role escalation beyond login role — A
- **auth-3.3** Step-up on system/service config writes — B
- **auth-3.4** Remember-device window (role-keyed, configurable) — B
- **auth-3.5** Backlogged step-up triggers (security/money/data) — C

## auth-4.0 Passwordless — B
- **auth-4.1** Passkeys / WebAuthn (strategic primary) — B
- **auth-4.2** Email OTP (scoped: low-priv + recovery, never sole for privileged) — B
- **auth-4.3** Magic links reserved-but-not-built — C

## auth-5.0 SSO & federation — B
- **auth-5.1** Social SSO (Google / Microsoft / Apple) — B
- **auth-5.2** Enterprise SAML / OIDC, domain-routed — B
- **auth-5.3** SSO-only enforcement (opt-in) + staff break-glass — B
- **auth-5.4** JIT provisioning + SCIM — C

## auth-6.0 Tokens & sessions — A
- **auth-6.1** Light identity-only JWT — A
- **auth-6.2** Session records (so a stateless JWT is revocable) — A
- **auth-6.3** Refresh rotation + reuse-detection (family revoke) — A
- **auth-6.4** Revocation epoch + blacklist (Redis) — A
- **auth-6.5** Logout / sign-out-everywhere — A

## auth-7.0 Idle timeout & heartbeat — B
- **auth-7.1** Session heartbeat poll (`GET /auth/session`) — B
- **auth-7.2** `lastActivityAt` tracking (excludes the ping) — B
- **auth-7.3** Role-keyed idle timeout (higher role → shorter) — B

## auth-8.0 Authorization / RBAC — A
- **auth-8.1** `Access` ladders + `rank` / `isAllowed` — A
- **auth-8.2** Lambda authorizer: authn → min-role → audience → decision — A
- **auth-8.3** Per-endpoint `minAccess` from the generated map — A
- **auth-8.4** Decision caching + epoch invalidation — A
- **auth-8.5** Ladder-order CI guard (snapshot diff) — B

## auth-9.0 Cross-account delegation grants — B
- **auth-9.1** Grant model (grantor / grantee / level / window / scope) — B
- **auth-9.2** Conferral + consent ceilings enforced at use-time — B
- **auth-9.3** Grant settings (`grantable` / `grantableAs` / `grantIssuanceMinRole`) — B
- **auth-9.4** Lifecycle: extend / shorten / revoke + pre-expiry email to both sides — B
- **auth-9.5** Both-sides visibility + audit + step-up to issue — B
- **auth-9.6** Authorizer role-OR-grant allow path — B

## auth-10.0 Maker-checker (two-person approval) — C
- **auth-10.1** Two-person approval on sensitive grants — C
- **auth-10.2** Configurable per account; app-scope governed by `root` — C

## auth-11.0 API keys (machine callers) — B
- **auth-11.1** Format `rup_<keyId>.<secret>`, hash-only storage — B
- **auth-11.2** Self-service mint (role ≤ creator max), secret shown once — B
- **auth-11.3** Validated in the authorizer + tier throttle — B
- **auth-11.4** Revoke / TTL expiry — B

## auth-12.0 Rate limiting — A
- **auth-12.1** Per-IP + per-identity limiter (Redis) — A
- **auth-12.2** Fail-open limiter / fail-closed authz — A
- **auth-12.3** Per-endpoint/tier rules + account overrides — B

## auth-13.0 Service-to-service auth — A
- **auth-13.1** Internal workload identity (no edge authorizer) — A
- **auth-13.2** Internal-only endpoints (`audience: INTERNAL`) — A

## auth-14.0 Impersonation / support access — B
- **auth-14.1** Audited, time-boxed impersonation (acts-as-self) — B
- **auth-14.2** Account-consented support grant (+ optional strict mode) — B
- **auth-14.3** Break-glass (root-only, post-hoc review) — B

## auth-15.0 Failed login & lockout — A
- **auth-15.1** Per-attempt tracking + bot challenge — A
- **auth-15.2** Tier-1 temp lock w/ exponential backoff (self-healing) — A
- **auth-15.3** Tier-2 disable + admin notify — A
- **auth-15.4** Breached-password check at login — A

## auth-16.0 Password reset — A
- **auth-16.1** Emailed single-use, **source-validated, time-boxed** reset token — A
- **auth-16.2** Policy + breached-password check on new password — A
- **auth-16.3** Revoke existing sessions on reset — A
- **auth-16.4** Admin/staff-forced reset (`RESET_REQUIRED`) + login-gating ("inactive until reset") — B
- **auth-16.5** Scoped reset policy — global · account · role (both ladders); token-TTL window + forced-rotation — B

## auth-17.0 Risk-based challenges (adaptive) — B
- **auth-17.1** Per-tier `RiskPolicy` (signal → action), rule-based — B
- **auth-17.2** No-feed signals (new-IP/device, dormancy, recent-fail, weak-factor, privileged) — B
- **auth-17.3** `UserLoginContext` baseline store — B
- **auth-17.4** Geo signals (new-country / impossible-travel / ASN) via GeoIP — C
- **auth-17.5** Reputation / Tor signals (feed) + weighted risk score — C
- **auth-17.6** **Reputation/geo provider factory + generalized internal API** (`GET /auth/internal/reputation`) — auth owns the data/storage + provider factory; consumed via the `Application.reputation(ip)` base method by signup/risk/residency. Cheapest provider: **free GeoLite2 + Tor-list + ASN heuristic** ($0/call), paid VPN/fraud feed by config — B
- **auth-17.7** **Keep the GeoIP DB current — MaxMind [`geoipupdate`](https://github.com/maxmind/geoipupdate)** on a schedule (EventBridge, ~weekly) → `.mmdb` to **S3**; provider **hot-reloads** it (license key in Secrets Manager). A stale DB silently degrades geo-fencing + residency — never hand-bundle a one-off DB — B

## auth-18.0 IP allow / deny lists — B
- **auth-18.1** IP/CIDR deny + allow at app / account / user scope — B
- **auth-18.2** Precedence + windowed exceptions + override authority — B
- **auth-18.3** Country / geo entries (GeoIP) — C
- **auth-18.4** Strict-mode allowlist / IP pinning — C

## auth-19.0 Audit & security events — A
- **auth-19.1** Immutable `AuditEvent` for every security action — A
- **auth-19.2** Content-hash + verify-on-read tamper-evidence — B
- **auth-19.3** Hash-chain for sequence integrity — B
- **auth-19.4** Emit security events to monitor (breach detection) — B
- **auth-19.5** Retention period — **configurable per environment** (default **dev 1 week / prod 1 year**, AppConfig) + cold archive to the central [audit](../../audit/SPECS.md) service — B

## auth-20.0 Access recertification — B
- **auth-20.1** Quarterly access-review email (name / last-login / role) — B
- **auth-20.2** Per-user confirm / change / disable + audit — B
- **auth-20.3** Inactivity auto-disable (`RecertificationConfig`) — B

## auth-21.0 Privacy & compliance — A
- **auth-21.1** PII minimization in tokens + logs — A
- **auth-21.2** Erasure: PII tombstone, keep `userUuid` + audit, app/root-only — B
- **auth-21.3** Data export CSV (self / `account` / `root`) — B
- **auth-21.4** No data sale/sharing without explicit opt-in — B
- **auth-21.5** **SQS "forget" responder (`user`)** — a Job consumes a typed `user` "forget" request from SQS, resolves the user's **known PII values**, runs identity anonymization (`auth-21.2`), and **fans the match-set out to content-holding services** ([collab](../../collab/SPECS.md) `/internal/erase`, [campaign](../../campaign/SPECS.md), …) for **exact-match obfuscation** of free-text PII — B

## auth-22.0 Secrets & crypto — A
- **auth-22.1** Secrets in KMS / Secrets Manager (never env/code) — A
- **auth-22.2** Credentials only in Cognito; API-key secrets hashed — A
- **auth-22.3** HMAC-signed outbound webhooks — B


## auth-24.0 Data residency (per-market account) — C
- **auth-24.1** EU market = own AWS account, EU-approved region — C
- **auth-24.2** No cross-region flows of identity PII — C

## auth-25.0 Observability & performance — B
- **auth-25.1** Bounded authorizer p99 (warm cache + O(1) epoch) — B
- **auth-25.2** X-Ray `transactionId` propagation — B

## auth-26.0 Infra footprint (`ResourceManifest`) — A
- **auth-26.1** Cognito user pool + post-auth Lambda trigger — A
- **auth-26.2** DynamoDB: users, identities, role_grants, api_keys, sessions, audit, ip_rules, login_context, password_reset_tokens — A
- **auth-26.5** Secrets Manager / SSM — seed sysadmin email + bootstrap token (deploy-time) — A
- **auth-26.3** Redis (counters, revocation epoch, blacklist) — A
- **auth-26.4** Kafka (auth/usage events) + SNS/SES (reset/verify/notify) — A

## auth-27.0 Service & Job topology — B
- **auth-27.1** **Domain bases** — `AuthService extends Service` + `AuthJob extends Job` hold the shared code (Cognito · JWT mint/verify · RBAC resolver · cached membership · Redis revocation/rate-limit · risk engine · reputation factory · audit emit); **concrete roles extend the domain base** — B
- **auth-27.2** **`AuthMainService`** — the full `/auth/*` API (sign-in · MFA · tokens · reset · SSO · API keys · grants · IP rules · recert admin · internal S2S) — A
- **auth-27.3** **`AuthAuthorizer`** — the **API Gateway REQUEST authorizer**: JWT/API-key → context, RBAC + rate-limit + revocation-epoch, allow/deny; **warm-cached**, the hot-path gate; **fails closed** (authz) / rate-limiter **fails open** — A
- **auth-27.4** **Jobs extend `AuthJob`** — `AuthAuthorizer` / `AuthCognitoTriggerJob` / `AuthForgetJob` / `AuthRecertificationJob` — A
- **auth-27.5** **Authorizer + API service share one JWT/RBAC/revocation implementation** (a divergence would be a security hole) — A
- **auth-27.6** **Root seeding** is a **one-shot deploy-time** CDK custom resource, not a standing Job — B

# Endpoints (first cut)

A first pass at the endpoint surface implied by the requirements above, in
[`@repo/endpoint`](../../../../packages/endpoint/SPECS.md) style. **Conventions:** every path is
service-prefixed **`/auth/*`**; collections/items + actions follow the
[REST patterns](../../../../packages/endpoint/SPECS.md#method--path-patterns--standard-rest); list endpoints
return the `{ data, page }` paged envelope and take filters via query string; exports/large payloads return a
**presigned URL** (never bytes through the API).

**Access column:** the recommended **`minAccess`** on the `Access` ladder — **`-`** = public (no auth) ·
account ladder **`SENDER`<`USER`<`BILLING`<`ACCOUNT`** · staff ladder **`SUPPORT`<`APPLICATION`<`ROOT`** ·
**`⬆`** = also requires **step-up** (fresh strong factor) · **`Internal`** = VPC-only S2S (`audience:
INTERNAL`) · **`Refresh`** / **`SCIM`** = authenticated by the refresh token / SCIM bearer token (not a user
role). A senior role satisfies any junior minimum.

> The **Lambda Authorizer** is API-Gateway infrastructure, not a callable route. **Role *assignment*** (who is
> what in an account) is owned by the **[account](../../account/specs/SPECS.md)** service — auth *reads*
> `RoleGrant`, so there's no `/auth` role-assignment endpoint. These are **APP/INTERNAL** shapes; the published
> external API re-expresses them as the versioned `/v1/...` facade.

### Sign-in — staged pipeline (auth-2, auth-3, auth-4)
| Method | URI | Purpose | Access | Req |
|---|---|---|---|---|
| POST | `/auth/login/identify` | Stage 1 — submit email/phone; returns `ChallengeState` (next step or SSO redirect) | - | auth-2.1 |
| POST | `/auth/login/challenge` | Respond to the current challenge (password / OTP / passkey / TOTP) → next state or session | - | auth-2.2/2.3 |
| POST | `/auth/login/challenge/resend` | Resend the current OTP code (rate-limited) | - | auth-2.5 |
| POST | `/auth/login/passkey/options` | WebAuthn assertion options for passkey sign-in | - | auth-4.1 |

### SSO & federation (auth-5)
| Method | URI | Purpose | Access | Req |
|---|---|---|---|---|
| GET | `/auth/sso/{provider}/start` | Begin social/enterprise SSO → redirect to the IdP | - | auth-5.1/5.2 |
| GET, POST | `/auth/sso/{provider}/callback` | IdP callback; server-side code/assertion exchange → session | - | auth-5.1/5.2 |
| GET | `/auth/sso-connections` | List the account's SSO connections | ACCOUNT | auth-5.2 |
| POST | `/auth/sso-connections` | Create an SSO connection (SAML/OIDC, `ssoOnly`, SCIM) | ACCOUNT ⬆ | auth-5.2/5.3 |
| PUT | `/auth/sso-connections/{id}` | Update an SSO connection | ACCOUNT ⬆ | auth-5.2/5.3 |
| DELETE | `/auth/sso-connections/{id}` | Remove an SSO connection | ACCOUNT ⬆ | auth-5.2 |
| GET, POST, PUT, PATCH, DELETE | `/auth/scim/v2/{Users,Groups}` | SCIM 2.0 provisioning from the IdP | SCIM | auth-5.4 |

### Registration & verification (ACCESS-FLOWS.md)
| Method | URI | Purpose | Access | Req |
|---|---|---|---|---|
| POST | `/auth/register` | Start registration (enumeration-neutral) | - | auth-1.1 |
| POST | `/auth/register/verify` | Verify the email/phone code to activate | - | auth-1.2 |
| POST | `/auth/verify/resend` | Resend a verification code | - | auth-1.2 |
| POST | `/auth/verify/phone` | Verify a phone number for the logged-in user | USER | auth-1.2 |

### Sessions & acting context (auth-6, auth-7, auth-1)
| Method | URI | Purpose | Access | Req |
|---|---|---|---|---|
| GET | `/auth/session` | Current `Auth.Context` + heartbeat (idle-timeout poll) | USER | auth-6.1/7.1 |
| POST | `/auth/session/refresh` | Rotate refresh token → new access token (reuse-detect) | Refresh | auth-6.3 |
| DELETE | `/auth/session` | Logout the current session | USER | auth-6.5 |
| POST | `/auth/session/switch` | Switch acting account/role (≤ max; may step-up + auto-downgrade) | USER | auth-1.4/1.5 |
| GET | `/auth/sessions` | List my active sessions/devices | USER | auth-6.2 |
| DELETE | `/auth/sessions/{sessionId}` | Revoke a specific session | USER | auth-6.4 |
| POST | `/auth/sessions/revoke-all` | Sign out everywhere | USER ⬆ | auth-6.5 |
| GET | `/auth/accounts` | Accounts I can act in (+ max role) — the switcher list | USER | auth-1.3 |

### MFA & devices (auth-3)
| Method | URI | Purpose | Access | Req |
|---|---|---|---|---|
| GET | `/auth/mfa` | My MFA status/config | USER | auth-3.1 |
| POST | `/auth/mfa/totp` | Begin TOTP enrollment (secret / QR) | USER ⬆ | auth-3.1 |
| POST | `/auth/mfa/totp/verify` | Confirm TOTP enrollment with a code | USER | auth-3.1 |
| POST | `/auth/mfa/sms` | Enroll SMS MFA | USER ⬆ | auth-3.1 |
| DELETE | `/auth/mfa/{method}` | Disable an MFA method | USER ⬆ | auth-3.1 |
| POST | `/auth/mfa/step-up` | Mid-session step-up challenge (elevation / sensitive op) | USER | auth-3.2/3.3 |
| GET | `/auth/devices` | List remembered/trusted devices | USER | auth-3.4 |
| DELETE | `/auth/devices/{deviceId}` | Revoke a device's remembered trust | USER | auth-3.4 |

### Passkeys & identity linking (auth-4, auth-1.6)
| Method | URI | Purpose | Access | Req |
|---|---|---|---|---|
| GET | `/auth/passkeys` | List my passkeys | USER | auth-4.1 |
| POST | `/auth/passkeys/options` | WebAuthn registration (attestation) options | USER | auth-4.1 |
| POST | `/auth/passkeys` | Complete passkey registration | USER | auth-4.1 |
| DELETE | `/auth/passkeys/{credentialId}` | Remove a passkey | USER ⬆ | auth-4.1 |
| GET | `/auth/identities` | My linked login methods | USER | auth-1.6 |
| POST | `/auth/identities` | Link a method (connect Google / add password) | USER ⬆ | auth-1.6 |
| DELETE | `/auth/identities/{identityId}` | Unlink a method (never the last) | USER ⬆ | auth-1.6 |

### Password (auth-16)
| Method | URI | Purpose | Access | Req |
|---|---|---|---|---|
| GET | `/auth/password/policy` | Public password policy (client-side validation) | - | auth-16.2 |
| POST | `/auth/password/forgot` | Request a reset (enumeration-neutral) | - | auth-16.1 |
| POST | `/auth/password/reset` | Set a new password with a **source-validated, single-use, time-boxed** token | - | auth-16.1/16.3 |
| PUT | `/auth/password` | Change password (logged-in) | USER ⬆ | auth-16.2/16.3 |
| POST | `/auth/password/force-reset` | Force `RESET_REQUIRED` on a user / account-wide (audited) | ACCOUNT ⬆ | auth-16.4 |
| GET, PUT | `/auth/password/reset-policy` | Read/set the scoped reset policy (global → `ROOT`; account → admin) | ACCOUNT ⬆ | auth-16.5 |

### Cross-account grants & maker-checker (auth-9, auth-10)
| Method | URI | Purpose | Access | Req |
|---|---|---|---|---|
| GET | `/auth/grants` | Grants my account issued (grantor view) | ACCOUNT | auth-9.5 |
| GET | `/auth/grants/received` | Grants into accounts I'm in (grantee view) | USER | auth-9.5 |
| POST | `/auth/grants` | Issue a delegation grant | ACCOUNT ⬆ | auth-9.1/9.5 |
| GET | `/auth/grants/{grantId}` | One grant | USER | auth-9.5 |
| PATCH | `/auth/grants/{grantId}` | Extend / shorten the window | ACCOUNT | auth-9.4 |
| DELETE | `/auth/grants/{grantId}` | Revoke a grant | ACCOUNT | auth-9.4 |
| POST | `/auth/grants/{grantId}/approve` | Maker-checker approve | ACCOUNT ⬆ | auth-10.1 |
| POST | `/auth/grants/{grantId}/reject` | Maker-checker reject | ACCOUNT | auth-10.1 |
| GET | `/auth/grantable-accounts` | Grant picker — only `grantable` accounts | ACCOUNT | auth-9.3 |

### API keys (auth-11)
| Method | URI | Purpose | Access | Req |
|---|---|---|---|---|
| GET | `/auth/keys` | List API keys (mine / account) | USER | auth-11.1 |
| POST | `/auth/keys` | Mint a key (secret shown once; role ≤ creator max) | USER ⬆ | auth-11.2 |
| GET | `/auth/keys/{keyId}` | Key metadata | USER | auth-11.1 |
| DELETE | `/auth/keys/{keyId}` | Revoke a key | USER ⬆ | auth-11.4 |

### Impersonation / support access (auth-14)
| Method | URI | Purpose | Access | Req |
|---|---|---|---|---|
| GET | `/auth/impersonation` | List active impersonation sessions (staff) | SUPPORT | auth-14.1 |
| POST | `/auth/impersonation` | Start impersonation (audited, time-boxed) | SUPPORT ⬆ | auth-14.1/14.2 |
| DELETE | `/auth/impersonation/{id}` | Stop an impersonation session | SUPPORT | auth-14.1 |
| POST | `/auth/impersonation/break-glass` | Root-only emergency access (post-hoc review) | ROOT ⬆ | auth-14.3 |

### Risk policy & IP allow/deny (auth-17, auth-18)
| Method | URI | Purpose | Access | Req |
|---|---|---|---|---|
| GET | `/auth/risk-policy` | Read the per-tier risk policy set | ACCOUNT | auth-17.1 |
| PUT | `/auth/risk-policy` | Update the risk policy (system / account) | ACCOUNT ⬆ | auth-17.1 |
| GET | `/auth/ip-rules` | List IP allow/deny rules for a scope/subject | ACCOUNT | auth-18.1 |
| POST | `/auth/ip-rules` | Add a deny/allow rule or windowed exception | ACCOUNT ⬆ | auth-18.1/18.2 |
| DELETE | `/auth/ip-rules/{ruleId}` | Remove an IP rule | ACCOUNT ⬆ | auth-18.1 |

### Audit (auth-19)
| Method | URI | Purpose | Access | Req |
|---|---|---|---|---|
| GET | `/auth/audit` | Query security audit events (RBAC-scoped; filters) | ACCOUNT | auth-19.1 |
| GET | `/auth/audit/{id}` | One audit event (+ hash-verify result) | ACCOUNT | auth-19.2 |

### Access recertification (auth-20)
| Method | URI | Purpose | Access | Req |
|---|---|---|---|---|
| GET | `/auth/recertification` | Current access-review report (name / last-login / role) | ACCOUNT | auth-20.1 |
| POST | `/auth/recertification/{userId}/confirm` | Confirm a member's role is still appropriate | ACCOUNT | auth-20.2 |
| POST | `/auth/recertification/{userId}/disable` | Disable an inactive/inappropriate account | ACCOUNT ⬆ | auth-20.2/20.3 |
| GET, PUT | `/auth/recertification/config` | View/set cadence + inactivity policy | ACCOUNT ⬆ | auth-20.3 |

### Privacy & data rights (auth-21)
| Method | URI | Purpose | Access | Req |
|---|---|---|---|---|
| GET | `/auth/export` | Export **my** auth data (CSV → presigned URL) | USER | auth-21.3 |
| GET | `/auth/export/{userId}` | Admin/root export of a user's auth data | ACCOUNT ⬆ | auth-21.3 |
| GET, PUT | `/auth/consent/sharing` | View/set the data sale/sharing opt-in | USER | auth-21.4 |
| POST | `/auth/erasure/{userId}` | Erase a user — PII tombstone (app/root only) | APPLICATION ⬆ | auth-21.2 |

### Internal / service-to-service (auth-8, auth-13, auth-19)
| Method | URI | Purpose | Access | Req |
|---|---|---|---|---|
| GET | `/auth/internal/min-role-map` | The generated endpoint→min-role artifact (authorizer loads) | Internal | auth-8.3 |
| POST | `/auth/internal/access/check` | S2S authorization check (context vs min-role / grant) | Internal | auth-8.2/13.1 |
| POST | `/auth/internal/revoke` | S2S revoke — bump epoch / blacklist on a security event | Internal | auth-6.4 |
| POST | `/auth/internal/audit` | S2S append a security `AuditEvent` | Internal | auth-19.1 |
| GET | `/auth/internal/reputation` | S2S IP reputation/geo lookup (country / ASN / VPN / Tor / hosting / score) — provider-factory-backed; the generalized API the `Application.reputation()` base method calls | Internal | auth-17.6 |
| GET | `/auth/config` | Read the service's own runtime config (AppConfig-backed) | ROOT | auth-26 |
| PUT | `/auth/config` | Update service runtime config → reconfigure-without-restart; audited | ROOT ⬆ | auth-26 |
| GET | `/auth/health` | Liveness/readiness (read-only prod smoke) | Internal | auth-26 |
