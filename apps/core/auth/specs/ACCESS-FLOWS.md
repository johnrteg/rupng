#
# Access flows — Sign-up & Sign-in
#

# Objective

The two halves of **how a user gets into the system**: **sign-up** (a new prospect becomes a verified user +
account, least friction that still keeps bots out) and **sign-in** (an existing user authenticates →
identify → verify a credential → challenges → session → acting account+role). They share methods, SSO,
passwordless, verification, password policy, identity linking, and the enumeration-neutral posture, so they
live together here.

* The **architecture** (Cognito, the Lambda authorizer, the light JWT, sessions, revocation, rate limiting)
  lives in **[SPECS](SPECS.md)**.
* **Risk & anti-abuse** (adaptive risk challenges, IP allow/deny, failed-login lockout, remember-device, bot
  defense, reputation feed) is cross-cutting to both flows and lives in **[risk](RISK.md)**.

# Role & boundaries

* **auth** (these flows) — signup steps + identity creation (Cognito user), sign-in across methods, email +
  phone verification, password policy, MFA challenge / step-up, **session** issue / refresh / revoke, account
  & role switching, password reset, identity linking, ToS/consent capture.
* **Cognito** — the **credential authority**: password hashes, social / SAML / OIDC federation, TOTP / SMS MFA.
* **account** — the new **Account** record (`pending` → `active`), plan/billing, membership + **role grants**
  (`Auth.RoleGrant`); auth *reads* the resolved grant, doesn't own it.
* **registration (TCR)** — the **real anti-spam KYC gate** (legal name, EIN, use-case) — *before sending*,
  not at signup (see "Where the real gate is").
* **email / texting** — deliver verification + reset messages (auth triggers; doesn't send).
* Models live in the `Auth` namespace (`UserProfile`, `UserIdentity` / `AuthMethod`, `Session`, `JwtClaims`,
  `Context`, `PasswordPolicy`, `MfaConfig`, `PasswordResetPolicy`, …) — see `authModel.ts`.

# Design principle — friction vs. trust (read this first)

Two failure modes pull in opposite directions: **too little friction** → bots and throwaway accounts flood in;
**too much** → real prospects bounce before they see value. The resolution:

1. **Gate the *abusable action*, not exploration.** On a messaging platform the abuse is *sending spam* — and
   sending is **already gated** by 10DLC/TCR brand registration. So let signup be light; you physically cannot
   blast messages until you've passed the carrier's KYC.
2. **Progressive profiling.** Collect the *minimum* to create an account, then ask for the rest as it becomes
   relevant (sector/use-case at onboarding, KYC at "enable sending", billing at upgrade).
3. **Risk-based step-up.** Default path is low-friction; *suspicious* signups escalate (see [risk](RISK.md)) —
   friction is applied to the risky few, not everyone.
4. **Verify the contact points cheaply but for real.** Email verify is table stakes; **phone (SMS OTP)** is a
   high-value anti-abuse signal *and* something a texting platform needs anyway.

# Sign-in methods

A single user may hold **several** (see `Auth.AuthMethod` + `Auth.UserIdentity`) — the sign-in screen offers
whatever they've linked:

* **Email + password** — Cognito-native (+ MFA).
* **Social SSO** (Google, Microsoft, Apple) — Cognito federation; a provider-verified email. (Google +
  Microsoft cover the B2B majority; **Apple** for consumer reach. **Facebook / LinkedIn** are demand-driven
  add-ons, off by default.)
* **Enterprise SSO** (SAML / OIDC) — per-account `Auth.SsoConnection`, **domain-routed** (an email at a
  federated domain is sent to that account's IdP), optional **JIT provisioning** + SCIM. An account may
  enforce **SSO-only** (no password) — see below.

## Enterprise SSO enforcement *(decided)*

An account **may configure SSO-only access** — 100% SSO, **password login disabled** for its members:

* **Account-level, opt-in toggle** — `Auth.SsoConnection.ssoOnly` (off by default). When on, members of that
  account can sign in **only** through the account's IdP; the password (and email-OTP) paths are refused for
  them, and existing password identities are deactivated for sign-in.
* **Domain-routed enforcement** — an email at the account's federated domain is sent straight to the IdP;
  there's no password fallback to enumerate or phish.
* **Break-glass** — at least one **platform-staff** path (`Access.AppRole`) must remain so support can recover
  an account whose IdP is misconfigured/down; the lockout applies to *account members*, not staff recovery.
* MFA/step-up still apply on top — SSO-only governs *which credential*, not whether step-up fires.

## Passwordless *(decided — two-track)*

We pursue passwordless on **two tracks**, and explicitly **do not** ship clickable magic links:

1. **Passkeys (`AuthMethod.PASSKEY`) — the strategic primary.** WebAuthn / FIDO2 (Cognito-native), device- or
   platform-synced, unlocked by biometric / PIN. **Phishing-resistant** and strong even as a single gesture.
   The long-term password replacement for **every** role; *rollout timing* is a later phase.
2. **Email OTP (`AuthMethod.EMAIL_OTP`) — convenience + recovery, scoped.** A short-TTL, single-use,
   rate-limited emailed **code** offered to **low-privilege roles** (`SENDER` / `USER`) and as an
   account-access fallback. Same **enumeration-neutral** wording, constant-timing, and MFA/step-up rules.
   * **Never a sole factor** for `BILLING` / `ACCOUNT` admin / staff — those require password + MFA or a passkey.
3. **Magic link (`AuthMethod.MAGIC_LINK`) — deprioritized, not planned.** Reserved in the enum but **not on
   the roadmap** (link scanners consume them, they break cross-device, and gate login on deliverability —
   email OTP wins on all of these).

* **Baseline unchanged** — **password + MFA** remains the default until passkeys are broadly adopted.
* Implemented via Cognito's **custom auth flow** (`CUSTOM_AUTH` + the `*AuthChallenge` Lambda triggers) for
  OTP; native WebAuthn for passkeys.

## Sign-in surface (the login screen)

How the methods above are *presented* on the [web login page](../../web/src/pages/login/Login.tsx):

* **Password form** — email **or** phone identifier (toggle) + password, in a real `<form>` (password-manager
  friendly: `autocomplete="username"` / `"current-password"`), with **forgot-password** and a per-host
  **whitelabel banner**.
* **SSO buttons** — *Continue with* **Google / Microsoft / Apple** (social), plus **"Use your organization's
  SSO"** (enterprise, identifier-first → resolve the account's `SsoConnection` by **domain** → redirect to that
  IdP; token exchange server-side via auth + `@repo/oauth`, no secrets in the browser).
* **SSO-only accounts hide the password form** — when the resolved account is `ssoOnly`, only the SSO path
  shows. Resolution comes from app-bootstrap / account config; until known, the default shows **password + SSO**.
* **Theme + language** pickers are available **pre-auth** (localized; default `en-US`).
* **Brand compliance** — Google/Apple sign-in buttons must follow each provider's official button guidelines.
* All wording stays **enumeration-neutral** (see Security posture) regardless of method.

# Sign-up — what we collect

### Identity — required to create the account (keep this short) — *email is the **minimum**; **verified before the account activates***
| Field | Why | Verify |
|---|---|---|
| **Email** | login + system comms | **yes** — code/link |
| **Password** + **Confirm password** | credential — **double-entered**, non-SSO only (see Credentials) | match + policy + breached-password check |
| **First / last name** | personalization, audit | — |
| **Business / account name** | the account's display name | — |
| **Phone (E.164)** — *optional* | strong anti-abuse signal + platform need | **if provided** — SMS OTP (one-time code); else collected before sending |
| **Country / region** | compliance, number provisioning, data residency | — |

> **Social / SSO signup (Google, Microsoft)** is offered first — it *lowers* friction *and raises* trust (a
> provider-verified email + a real identity), so it's both a UX and an anti-abuse win.

## Existing-account detection (email **and** phone)

Before creating anything, check whether the identity already exists — matched on **either** identifier, each
**normalized** the way the platform stores it: **email** lowercased/trimmed; **phone** E.164, and only a
**verified** number counts as a match.

| Situation | What happens |
|---|---|
| **Email already registered** | Don't create a duplicate. **Neutral** message ("If that email has an account, we've sent a sign-in link") **and email the existing address** a "sign in / reset" message. Avoids **account enumeration**. |
| **Verified phone already exists** | A **verified phone identifies the *user*** (not the account). A returning number = an **existing user** → sign-in / identity-linking, **not** a new account; that user can belong to **multiple accounts** (so an agency reusing one number is *one user across accounts*). Cold form stays neutral; a *different* person presenting an already-verified number is a **risk signal**. |
| **Email matches, but they meant to join that org** | Route to the **invite/seat** flow, not a new account — invited into the existing account, inheriting its trust. |
| **SSO / social signup, email already exists** | The IdP **authenticated** them, so it's safe to **redirect straight into the existing account** (no enumeration leak): **link** the SSO identity to the one user and **sign them in** — never fork a second account. See Identity linking. |

**Decided: strict neutral — with one authenticated exception (SSO).** On an existing email/phone we never
confirm existence to the **anonymous cold email+password form** — same message + timing — and the truthful
"you already have an account" goes to the **verified owner** out of band. **The exception is SSO:** because the
IdP authenticated the user, an SSO signup whose email exists **redirects into that account** (link + sign in).
The authoritative posture is in Security posture (below); keep sign-up, sign-in, and reset consistent.

## Credentials (non-SSO)

Two distinct sign-up paths, chosen up front:

* **SSO / social** — **no password is collected or stored**; the provider authenticates and returns a verified
  email. Skip the password step entirely.
* **Email + password** — collect a **password and a confirmation ("double-entered")**, and:
  * **Match** the two server-side (client check is UX only) — reject a mismatch first.
  * Enforce the **password policy** (`Auth.PasswordPolicy`).
  * **Reject breached/compromised passwords** (Cognito advanced security / HIBP-style).
  * Never log or echo the password; only Cognito stores the hash.

> The "double-verified password" applies **only** to the email+password path; SSO users never set one. Adding
> *both* methods later ("add a password" / "connect SSO") is a sign-in concern — see Identity linking.

### Profile — collected at onboarding (just after account creation)
| Field | Why |
|---|---|
| **Channels** (multi-select) | what they want to do — Texting/SMS · Email · WhatsApp/RCS · Voice · Push · "just exploring". Drives onboarding + which **approval tracks** start |
| **Sector / vertical** | routing, templates, vertical packs, risk scoring (see enum) |
| **Intended use case** (short text) | onboarding + **feeds the TCR campaign description** + abuse screening |
| **Expected volume** (band) | plan fit + risk signal |
| **Company size / role** (optional) | sales / segmentation |

### Marketing / attribution — optional, low-friction
| Field | Why |
|---|---|
| **"How did you hear about us?"** (enum + free text) | attribution: Search · Social · Referral · Ad · Event · Word-of-mouth · Other |
| **Referral / partner code** | partner attribution + credits |
| **UTM params** (`source`/`medium`/`campaign`) | captured **silently** from the landing URL — zero friction |

### Consent — required, compliance (captured with version + timestamp)
* **Terms of Service + Privacy Policy** acceptance — **versioned + timestamped** (not pre-checked).
* **Verification SMS consent** — the OTP is transactional (TCPA-safe), but record the agreement.
* **Marketing opt-in** — a **separate, unchecked** box (GDPR / CAN-SPAM); never bundled with ToS.
* **AUP / no-PHI acknowledgment** — ToS/AUP acceptance includes the platform's **no-PHI prohibition**; this is
  where the account's [one-time no-PHI acknowledgment](../../account/specs/SPECS.md) is captured (versioned +
  timestamped). The `healthcare` sector is allowed as a vertical, but **PHI content is prohibited** absent a BAA.

### Deferred — asked only when needed (not at signup)
* **Billing** → account service, at upgrade / paid plan.
* **Brand KYC** (legal name, EIN, address, website, authorized rep) → **registration (TCR)**, before sending.

## Sector / vertical (enum)
`marketing` · `technology` · `nonprofit` · `political` · `ecommerce` · `healthcare` · `education` ·
`financial` · `real_estate` · `hospitality` · `agency` · `government` · `other`.

# Verification

* **Email** — Cognito-issued code or link; required before the account leaves `pending` (flips it to `active`).
* **Phone — optional at signup; if provided, validated with an SMS OTP** (6-digit, short TTL, attempt-limited).
  The anti-abuse workhorse: it costs the abuser, **dedupes** (one **user** per verified number — the phone is a
  *user* identifier, not account-scoped), and ties the user to a reachable identity. If omitted at signup it's
  collected later; a **verified phone is required before sending** (number provisioning / TCR).
* Both run through Cognito (TOTP / SMS) + the email/texting services for delivery.

# The sign-in flow — staged, server-driven challenge pipeline *(decided)*

Sign-in is **identifier-first and staged**: the client shows **one step at a time** and the **server decides
the next step**. Auth runs a **challenge state machine** (Cognito `CUSTOM_AUTH` + the `*AuthChallenge` Lambda
triggers); each client response returns either the **next challenge** or a **terminal** (`authenticated` /
`denied`). The client is a thin renderer — a new challenge type slots in **without a client rewrite**.

```
 ┌─ Stage 1: IDENTIFY ─────────────────────────────────────────────────────────┐
 │ email / phone (toggle). Server resolves routing:                             │
 │   • federated domain  → redirect to account IdP (enterprise SSO; no pw stage)│
 │   • ssoOnly account   → SSO path only                                        │
 │   • else              → continue to credential                               │
 │ ALWAYS advances (enumeration-neutral — unknown identifier not revealed here) │
 └───────────────────────────────┬──────────────────────────────────────────────┘
                                  ▼
 ┌─ Stage 2: PRIMARY CREDENTIAL ─────────────────────────────────────────────────┐
 │ password  OR  passkey/WebAuthn  OR  passcode (email/SMS OTP, where permitted). │
 │   fail → lockout tracking (see RISK.md)                                        │
 └───────────────────────────────┬──────────────────────────────────────────────┘
                                  ▼
 ┌─ Stage 3: CHALLENGES (0..N, server-driven) ───────────────────────────────────┐
 │ After the primary factor verifies, server returns the required challenge(s)    │
 │ from (a) MfaConfig, (b) the RISK signals (RISK.md), (c) HIGHEST access level.  │
 │   • Code verification — emailed or texted OTP (channel defaults to identifier  │
 │     type; the other offered). • TOTP / authenticator, passkey step-up, …       │
 └───────────────────────────────┬──────────────────────────────────────────────┘
                                  ▼
 TERMINAL: issue SESSION → light JWT (identity only); resolve acting ACCOUNT + ROLE
           (RoleGrant, ≤ max) → return Auth.Context.
           hard IP/policy denial → block + audit (see RISK.md → IP allow/deny).
```

* **The JWT is identity-only** — roles/permissions resolve **per request** by the authorizer from DynamoDB.
* **Acting account + role** — a user with grants in several accounts selects which to act in; the chosen role
  must be **≤ their `maxRole`** ("scale down, never up").
* **Why staged** — lets the server insert **any** challenge dynamically (MFA, risk step-up, future factors),
  supports SSO-only + passwordless primaries cleanly. The enumeration risk is handled in Security posture.

# MFA & step-up

* The Cognito MFA setting is **OPTIONAL**; we **enforce** the requirement ourselves per `Auth.MfaConfig`.
* **Step-up** — an extra challenge mid-session in front of sensitive actions. **Adaptive** step-up also fires
  on an anomalous sign-in — the full role-configurable signal set + the **remember-device window** live in
  **[risk](RISK.md)**.

## Step-up triggers *(decided — v1)*

Two triggers ship in v1; everything else is backlogged. A step-up re-verifies the *current* user (MFA or, once
available, a passkey) — it does **not** start a new session.

1. **Role escalation beyond what you logged in as.** Acting at a higher role than the role you authenticated
   with (the staff ladder the primary case) step-ups before the elevated role takes effect. Switching *up*
   re-challenges; switching back *down* does not.
2. **Saving system / service configuration *(minimally)*.** Any **write** to system-/service-level config
   requires a step-up at save time.

> A step-up is **scoped + time-boxed** and fires **regardless of an active remember-device window** (which only
> skips the *routine login* MFA).

**Backlogged step-up triggers** (later phase): change password / email / phone, enable/disable/reset MFA,
add/remove a login method, "sign out everywhere"; change payment method/plan, create/rotate dev API keys;
export/view PII or bulk send; invite/remove users, change a role, transfer ownership, configure SSO/SCIM;
long-idle resume, weak-factor escalation.

# Sessions

* **Issue** on success — the `Auth.Session` record exists so a stateless JWT can be **revoked**.
* **Refresh** with **rotation** — reuse of a retired refresh token revokes the whole **family** (theft signal
  via `refreshFamilyId` / `refreshGeneration`).
* **Switch account / role** — re-scope the session to another granted account (≤ max), audited.
* **Logout / revoke** — blacklist the `jti` / session; the **revocation epoch** invalidates cached authorizer
  allows immediately (no waiting on the JWT TTL).

# Identity linking *(authoritative here)*

A user accumulates methods over time, and we **link, never fork**:

* An **SSO sign-in whose verified email matches an existing user** attaches a new `Auth.UserIdentity` to that
  user (after verifying control) rather than creating a second account — and the reverse (a password user later
  "Connect Google").
* **From settings:** "add a password", "connect / disconnect SSO", manage passkeys — each adds/removes a
  `UserIdentity`; you **cannot remove the last method** (that would lock the user out).
* The signup flow defers here when it detects an existing email (see Existing-account detection).

# Password reset / forgot

Three entry points, **one mechanism** — a single-use, time-boxed, **source-validated** reset token emailed to
the verified address; setting a new password runs the **policy + breached-password check** and **revokes
existing sessions** ("a reset locks everyone else out").

## Self-service (forgot)
* Request → **email a time-boxed, single-use reset link / code** → set a new password → revoke sessions.
* **Enumeration-neutral** — the same "if that email exists, we sent a link" reply regardless.

## Admin / staff-forced reset *(decided)*
* **Who can force it:** an **`AppRole` (staff, `SUPPORT`+ per policy)** can force a reset for **any account /
  user** (recovery, suspected compromise, breach); an **account admin (`ACCOUNT`)** can force one for
  **members of their own account**.
* **Effect:** the target flips to **`UserStatus.RESET_REQUIRED`** — the current password **no longer yields a
  full session** and existing sessions are **revoked**. **Audited** (who/when/why/scope).
* **Scope:** a single user **or account-wide**. **Triggers the reset email** + enforced at next login.

## Login gating — "inactive until you reset" *(decided)*
When a `RESET_REQUIRED` user authenticates, the **primary credential still verifies**, but the staged flow
**does not issue a full session** — it returns a terminal **`RESET_REQUIRED`** outcome telling the user **their
account is inactive until they reset**, and routes them into reset. A successful reset **clears the flag** and
issues a normal session.

## The reset link / token — validated + time-boxed
* **Single-use, hashed-at-rest token** (`Auth.PasswordResetToken` — only its hash is stored); the email carries
  the raw token in a link to **`POST /auth/password/reset`**.
* **The endpoint validates the source:** token exists, **not expired**, **not used**, **bound to the user**,
  consumed **atomically** (no replay). A bad/expired token gets the neutral response.
* **Time window** — TTL from the reset policy (below): short by default, **shorter for privileged roles**.

## Reset policy — scoped: global · account · role *(decided)*
`Auth.PasswordResetPolicy` resolves at three scopes, **most-specific / most-privileged wins** (same pattern as
the idle-timeout + remember-device windows):
1. **Global** — platform default.
2. **Per-account** — overrides the global (a regulated tenant may want tighter windows).
3. **By role — both ladders** — per `AccountRole` *and* `AppRole`; the higher role takes the stricter value.

Policy fields (`PasswordResetRule`): **token TTL** (the reset window), optional **forced-rotation max age**
(→ auto-`RESET_REQUIRED`), whether email reset is allowed vs **admin-only** for a tier, and **breached-password
forces reset**. All resets stay **enumeration-neutral**, **rate-limited**, and **audited**.

# Explore now, send later — sandbox while approvals run

Each channel has its **own async setup** that gates *real* sending, and **none of it blocks exploring**. The
moment email is verified, the account is `active` and the user can do everything *except* deliver to the
outside world — while the slow approvals run **in parallel, per channel**:

* **Texting/SMS** → **TCR / 10DLC** brand + campaign registration + number provisioning.
* **Email** → **domain authentication** (SPF / DKIM / DMARC), sender identity, IP warm-up.
* **WhatsApp / others** → their respective provider onboarding.

## Sandbox / test mode (fake providers)
While a channel's approval is pending, the account runs in **sandbox**: a **simulated provider** lets the user
drive the whole flow end-to-end with **nothing actually delivered**:

* Sends are **simulated** (synthetic delivery/open/click/reply events) so dashboards + funnels work.
* **Real test sends — only to *yourself* (decided).** A real send is allowed **only to the user's own verified
  email and verified phone** (the **phone must be entered + OTP-verified** first), via a platform sandbox
  sender — **never** the account's real contacts or an unverified number/domain. Proves deliverability with
  **no abuse vector**.
* Sandbox output is **clearly labeled** (banner + tagged events).
* **Bounded duration (decided, configurable).** An account may linger in sandbox only for a **configurable
  window**; past it the account must **upgrade / complete a channel approval** or it is **disabled** (anti-abuse
  — sandbox is not a permanent free tier).
* **Flip to live per channel** automatically when that channel's approval completes — same campaign, real provider.

# Flow / state machine (sign-up)

```
 start ─submit(form + bot-challenge)
        │
        ├─ exists? (email OR verified phone) ──► neutral msg + email existing user → sign-in / reset / accept-invite
        │
        ├─ SSO ───────────────► (provider verifies email) ──┐
        ├─ email + password ──► confirm match + policy +    ├─► email_pending ─verify email─► ACTIVE (log in, explore, SANDBOX)
        │                        breached check ────────────┘        │                          │  onboarding: channels, sector, use-case
        │                                                 (high risk) │                          │
        │                                                             ▼                          ├─ texting: TCR/10DLC KYC ──approved─┐
        │                                                       pending_review ──approve──► …     ├─ email:   domain auth (DKIM) ──────┤
        │                                                             │                          └─ (others) provider onboarding ─────┤
        │                                                          reject                                                             ▼
        │                                                                                              channel flips SANDBOX → LIVE
```

* **Email verify** flips the account to `ACTIVE` (log in, build, run in **sandbox**) — but **not** deliver.
* **Approval tracks run in parallel, per channel**; each flips sandbox→live on its own when approved.
* **Phone verify** required before any live send. **High-risk** signups divert to `pending_review` (see [risk](RISK.md)).

# Data model (sketch)

> **Migrated.** The public **user profile** contract is now in **`@repo/api` → `User`**
> ([`packages/api/src/auth/User.ts`](../../../../packages/api/src/auth/User.ts)) — `User.Entity` (**no
> secrets**) + `User.Status`/`User.MfaMethod`/`User.Membership`. The contract **splits fields by source**
> so reads/writes route without duplicating Cognito:
> * **`User.CognitoProfile`** — Cognito-owned (email/phone + verified, name, picture, locale, zoneinfo,
>   MFA). Source of truth is **Cognito**; not copied into our store.
> * **`User.Augmented`** — DynamoDB-only metadata (status, `resetPassword`, icon, timestamps); the
>   public projection of the internal SoT **`Auth.UserProfile`** ([AuthModel.ts](../src/models/AuthModel.ts)).
> * `User.Entity` = `CognitoProfile ⊕ Augmented`, and `User.Update` is grouped (`cognito` → Cognito
>   AdminUpdateUserAttributes · `augmented` → the DynamoDB row). So **GET composes both stores; POST
>   routes each part** — password/MFA never travel these attribute writes.
>
> **Status / reset:** `User.Status` mirrors the internal `Auth.UserStatus` 1:1 (incl. `RESET_REQUIRED`);
> `User.Entity.resetPassword` is just the projection of `status === RESET_REQUIRED`.
>
> The credential/identity-link storage (password in Cognito; SSO `UserIdentity`/`AuthMethod`;
> `SsoConnection`; sessions) stays **auth-internal** — see *Security posture* below +
> [SPECS.md](SPECS.md#identity--accounts). The `Registration` record below stays here (auth-internal
> funnel/abuse analytics, not part of the API).

Sign-up produces an **`Auth.UserProfile`** (+ Cognito user) and an **Account**; it also persists a registration
record for funnel analytics + abuse review:

```
Registration   pk=ACCOUNT#<accountId>  sk=REG#<userId>
  { email, emailVerified, phone, phoneVerified, name, businessName, sector, useCase, expectedVolume,
    attribution: { heardAbout, referralCode, utm{} }, consents: { tos{version,at}, marketing, sms },
    risk: { score, signals[], status: ok|review|rejected }, createdAt, country, ip, userAgent }
```

* **PII minimization** — store only what's needed; the marketing/attribution bag is analytics-grade.
* Feeds: identity → **Cognito + `Auth.UserProfile`**; business/sector/attribution → **account**; use-case →
  seeds the **TCR** campaign description.

# Where the real gate is (don't over-friction signup)

The leverage isn't a longer signup form — it's that **sending is gated by 10DLC/TCR brand registration** (EIN +
business vetting + carrier approval). A bot can create an account; it **cannot** pass brand KYC and get an
approved campaign, so it can't actually spam. Keep signup light, lean on **phone verification + bot challenge**
(see [risk](RISK.md)) for the cheap wins, and let the carrier-mandated KYC be the heavy gate it already is.

# Security posture

* **Enumeration-neutral *(decided)*** across login, reset, **and** registration — never reveal whether an
  email or phone is registered. The authoritative home for the posture both flows follow. Concretely:
  * **Identical response** on every auth surface, regardless of whether the identifier exists:
    * **Login** — "Email or password is incorrect" (never distinguish *wrong password* from *no account*).
    * **Reset / forgot** — "If that email exists, we've sent a link."
    * **Registration** — the same neutral acknowledgement; the truthful "you already have an account" is
      **emailed to the real owner**, never shown to the anonymous form.
  * **Constant timing** — equalize work on **both** branches; no fast bail on "no such account".
  * **Notify the owner, not the form** — the actionable message goes to the **verified inbox**, out of band.
  * **Scope** — strict neutral on all **anonymous, pre-auth** surfaces. An **authenticated / B2B-admin**
    context may surface existence (the actor is already trusted). **SSO is the authenticated exception** — an
    SSO signup whose email exists redirects into that account (the IdP proved control).
  * **Identifier-first staging stays neutral** — the staged flow **always advances** to a credential stage for
    any well-formed identifier, **SSO routing is by email *domain*** (account config, not per-user existence),
    and a user's **available challenge/method set is disclosed only *after* the primary factor verifies**.
* **Rate-limited** per IP + per identity; **breached-password** rejection; **MFA** + adaptive step-up; **audit**
  every login / switch / reset / link (`Auth.AuditEvent`). Lockout + adaptive risk live in [risk](RISK.md).

# Later phases (committed, not yet scheduled)

* **Passkeys / WebAuthn (`AuthMethod.PASSKEY`)** — a later-phase requirement; direction decided (the strategic
  primary passwordless). Build password + MFA and (scoped) email OTP first; keep the model + UI seams ready.

# Requirements (traceable register)

Traceable requirements for the **access flows (sign-up & sign-in) of auth**. IDs are **`auth-flow-N.M`** (a
sub-register of [auth](SPECS.md); the **risk** layer has its own `auth-risk-*` register in [risk](RISK.md)).
**Priority:** **A** = MVP · **B** = core / next · **C** = later. One sub-level; a group's priority is its floor.

## auth-flow-1.0 Sign-up & provisioning — A
- **auth-flow-1.1** Self-service signup → Cognito user + `Auth.UserProfile` + **Account** (`pending`→`active`) — A
- **auth-flow-1.2** **Email is the minimum** — verified before the account activates — A
- **auth-flow-1.3** SSO / social signup (Google / Microsoft, provider-verified) — offered first — A
- **auth-flow-1.4** Email+password path — double-entry **match** + policy + **breached-password reject** — A
- **auth-flow-1.5** Progressive profiling — minimum at signup, the rest at onboarding — B

## auth-flow-2.0 Sign-in pipeline — A
- **auth-flow-2.1** Identifier-first staged flow (Cognito `CUSTOM_AUTH` state machine) — A
- **auth-flow-2.2** Server-driven `ChallengeState` (next-challenge vs terminal) — A
- **auth-flow-2.3** Stage 1 identify + SSO-domain / `ssoOnly` routing — A
- **auth-flow-2.4** Stage 2 primary credential (password / passkey / passcode) — A
- **auth-flow-2.5** Stage 3 challenges (0..N server-chosen); **OTP channel choice** (default by identifier) — B
- **auth-flow-2.6** Terminal → session + identity JWT + acting account/role — A

## auth-flow-3.0 Methods & sign-in surface — A
- **auth-flow-3.1** Email/phone + password — A
- **auth-flow-3.2** Social SSO (Google / Microsoft / Apple) — B
- **auth-flow-3.3** Enterprise SSO (SAML/OIDC, domain-routed, JIT/SCIM) — B
- **auth-flow-3.4** SSO-only enforcement (opt-in) + staff break-glass — B
- **auth-flow-3.5** Login screen (forms, SSO buttons, theme/lang, whitelabel banner) — A
- **auth-flow-3.6** Brand-compliant SSO buttons (Google/Apple guidelines) — B

## auth-flow-4.0 Passwordless — B
- **auth-flow-4.1** Passkeys / WebAuthn (strategic primary) — B
- **auth-flow-4.2** Email OTP (scoped: low-priv + recovery; never sole for privileged) — B
- **auth-flow-4.3** Magic links reserved-but-not-built — C

## auth-flow-5.0 Identity, verification & existing-account — A
- **auth-flow-5.1** Email verification (code / link) gates `active` — A
- **auth-flow-5.2** Phone **optional**; if given, **SMS-OTP validated**; required before sending — A
- **auth-flow-5.3** **Phone tied to the user** (unique per user; a user spans accounts) — A
- **auth-flow-5.4** Existing-account detection (email + verified phone, normalized) — A
- **auth-flow-5.5** **Enumeration-neutral** handling — neutral on the form + notify the owner out-of-band — A
- **auth-flow-5.6** **SSO existing-email → redirect into the account** (authenticated exception) — B
- **auth-flow-5.7** Identity linking — link never fork; SSO↔password after verifying control; can't remove last — B

## auth-flow-6.0 MFA & step-up — A *(remember-device + adaptive risk → [risk](RISK.md))*
- **auth-flow-6.1** Enforced MFA (TOTP / SMS) per `MfaConfig` — A
- **auth-flow-6.2** Step-up on role escalation beyond login role — A
- **auth-flow-6.3** Step-up on system/service config writes — B
- **auth-flow-6.4** Backlogged step-up triggers (security / money / data) — C

## auth-flow-7.0 Sessions — A
- **auth-flow-7.1** Issue session (revocable) — A
- **auth-flow-7.2** Refresh rotation + reuse-detection (family revoke) — A
- **auth-flow-7.3** Switch account/role (≤ max; auto-downgrade) — A
- **auth-flow-7.4** Logout / revoke (epoch) + sign-out-everywhere — A
- **auth-flow-7.5** Idle timeout + heartbeat (role-keyed) — B

## auth-flow-8.0 Password reset / forgot — A
- **auth-flow-8.1** Self-service forgot — emailed single-use, **source-validated, time-boxed** token — A
- **auth-flow-8.2** Policy + breached check + **revoke sessions** on reset — A
- **auth-flow-8.3** Change password (logged-in, step-up) — A
- **auth-flow-8.4** Admin/staff-forced reset (`RESET_REQUIRED`) + login-gating — B
- **auth-flow-8.5** Scoped reset policy (global / account / role) + token TTL — B

## auth-flow-9.0 Consent & compliance — A
- **auth-flow-9.1** ToS + Privacy acceptance — **versioned + timestamped** (not pre-checked) — A
- **auth-flow-9.2** Marketing opt-in — **separate, unchecked** box — A
- **auth-flow-9.3** OTP-SMS consent (transactional) recorded — A
- **auth-flow-9.4** **AUP no-PHI acknowledgment** captured at the ToS step — A
- **auth-flow-9.5** PII minimization in the registration record — A
- **auth-flow-9.6** GDPR forget purges registration PII (retain consent proof) — B

## auth-flow-10.0 Profile & attribution — B
- **auth-flow-10.1** Onboarding profile (channels, sector, use-case, expected volume) — B
- **auth-flow-10.2** Attribution (heard-about, referral / partner code, **silent UTM**) — B
- **auth-flow-10.3** Sector / vertical enum — B
- **auth-flow-10.4** Business-email requirement — **plan-defined, coupon-overridable** — B

## auth-flow-11.0 Sandbox — explore-now, send-later — B
- **auth-flow-11.1** Email-verified → `active` → **explore in sandbox** (no external delivery) — B
- **auth-flow-11.2** Simulated provider (synthetic events) — B
- **auth-flow-11.3** **Real test sends only to the user's own verified email / phone** — B
- **auth-flow-11.4** Per-channel approval tracks (TCR/10DLC, domain auth) run **in parallel** — B
- **auth-flow-11.5** Flip **sandbox → live per channel** on approval — B
- **auth-flow-11.6** **Bounded sandbox duration** (configurable) → upgrade or disabled — B

## auth-flow-12.0 Security posture — A
- **auth-flow-12.1** Enumeration-neutral (login / reset / registration) — A
- **auth-flow-12.2** Constant timing + notify-owner-not-form — A
- **auth-flow-12.3** Identifier-first staging stays neutral; SSO authenticated-redirect exception — A
- **auth-flow-12.4** Rate-limited per IP + identity; audit every login / switch / reset / link — A

## auth-flow-13.0 Data model, state & deferred gates — A
- **auth-flow-13.1** `Registration` record (funnel analytics + abuse review) — A
- **auth-flow-13.2** Signup **state machine** (`email_pending` → `active`; high-risk → `pending_review`) — A
- **auth-flow-13.3** Heavy gates **deferred** — billing → account; brand KYC → **TCR** (before send) — A

> **Risk & anti-abuse requirements** (lockout, adaptive challenges, IP allow/deny, remember-device, signup
> anti-abuse, reputation feed) live in **[risk → auth-risk-*](RISK.md)**.

# Compliance & standards mapping

How the **access-flow** controls map to **OWASP Top 10 (2021)**, **ISO/IEC 27001:2022**, **SOC 2 Type 2**,
**HIPAA** (if PHI), **GDPR**, **CCPA/CPRA**, and the **messaging-regulatory** regimes (**TCPA / CAN-SPAM /
10DLC**). Indicative; design-intent. Identity/session architecture is in [auth → Compliance](SPECS.md); risk &
anti-abuse controls are in [risk](RISK.md); the **real anti-spam gate is 10DLC/TCR *before sending***.

**Legend:** ✅ meets/exceeds · ⚠️ partial — see Gaps · ➖ n/a

| Control | OWASP | ISO 27001 | SOC 2 | HIPAA | GDPR | CCPA | Messaging | |
|---|---|---|---|---|---|---|---|---|
| Staged sign-in pipeline (server-driven challenges) | A07 | A.8.5 | CC6.1 | §164.312(d) | Art 32 | ➖ | ➖ | ✅ |
| Password policy + double-entry + breached-password reject | A07 | A.5.17 / A.8.5 | CC6.1 | §164.308(a)(5) | Art 32 | §1798.81.5 | ➖ | ✅ |
| Email verification (before `active`) | A07 | A.8.5 | CC6.1 | ➖ | Art 32 | ➖ | ➖ | ✅ |
| Phone verification (SMS OTP) + dedupe (user-scoped) | A07 | A.8.5 | CC6.1 | ➖ | Art 32 | ➖ | **TCPA** (transactional OTP) | ✅ |
| SSO (social + enterprise) + SSO-only + JIT/SCIM | A07 | A.5.16 / A.5.18 | CC6.1 / CC6.2 | §164.312(d) | Art 32 | ➖ | ➖ | ✅ |
| MFA + step-up on elevation / config writes | A07 / A01 | A.8.5 | CC6.1 | §164.312(d) | Art 32 | ➖ | ➖ | ✅ |
| Sessions — short TTL, refresh rotation + reuse-detect, revocation epoch | A07 | A.8.5 | CC6.1 | §164.312(a)(2)(iii) | Art 32 | §1798.81.5 | ➖ | ✅ |
| Enumeration-neutral (login / reset / registration) | A04 / A07 | A.8.5 | CC6.1 | ➖ | Art 5(1)(c)/32 | ➖ | ➖ | ✅ exceeds |
| Password reset — source-validated, time-boxed, scoped policy, forced-reset | A07 | A.5.17 / A.8.5 | CC6.1 | §164.308(a)(5) | Art 32 | §1798.81.5 | ➖ | ✅ |
| Identity linking (link never fork; can't remove last method) | A07 | A.5.16 | CC6.1 | ➖ | Art 32 | ➖ | ➖ | ✅ |
| Consent capture (ToS/Privacy versioned; marketing **separate-unchecked**) | A04 | A.5.34 | (Privacy) | ➖ | Art 6 / 7 | §1798.100 | **CAN-SPAM** | ✅ |
| OTP-SMS consent (transactional; no marketing w/o opt-in) | ➖ | A.5.34 | ➖ | ➖ | Art 6 | §1798.120 | **TCPA** | ✅ |
| **AUP no-PHI acknowledgment** at the ToS step | ➖ | A.5.34 | ➖ | **no PHI (AUP)** | Art 6 | ➖ | ➖ | ✅ |
| PII minimization in the registration record | A04 | A.8.11 / A.8.10 | CC6.x | ➖ | Art 5(1)(c)/25 | §1798.100 | ➖ | ✅ |
| GDPR forget purges registration PII (consent proof retained) | ➖ | A.5.34 | (Privacy) | ➖ | Art 17 | §1798.105 | recordkeeping | ✅ |
| Sending gated by **10DLC / TCR brand KYC** (the real anti-spam gate) | A04 | ➖ | ➖ | ➖ | ➖ | ➖ | **10DLC / TCR** | ✅ (via tcr) |
| Sandbox — **no real delivery** until a channel is approved | A04 | ➖ | ➖ | ➖ | ➖ | ➖ | 10DLC / domain-auth | ✅ |

> **Risk/abuse controls** (bot challenge, lockout, adaptive risk, IP allow/deny, reputation) are mapped in
> [risk](RISK.md). Architecture-level controls (RBAC, authorizer, audit, grants, residency, infra) are in [SPECS](SPECS.md).

# Gaps & decisions (one review list)

✅ = resolved/decided · ⚠️ = **open — needs attention**. *(Risk & anti-abuse decisions live in [risk → Gaps](RISK.md).)*

1. ✅ **Staged sign-in** — identifier-first, **server-driven challenge pipeline**; OTP channel defaults to the
   identifier type. *Decided 2026-06-10.*
2. ✅ **Registration minimum + phone** — **email is the minimum** (verified before activation); **phone optional**,
   OTP-validated if given (required before sending); **phone tied to the user** (one user across accounts). *Decided.*
3. ✅ **Business-email requirement** — **plan-defined** (`requireBusinessEmail`), **coupon-overridable**;
   disposable domains always rejected + MX-validated. (See [account/pricing](../../account/specs/PRICING.md).)
4. ✅ **Invite / seat signup** — invited users **only verify identity (email/phone)**; no new account, no KYC;
   inherit the inviting account's trust.
5. ✅ **Sandbox** — real test sends **only to the user's own verified email/phone**; **bounded, configurable
   duration** → upgrade or disabled.
6. ✅ **Account-enumeration posture** — **strict neutral** (neutral + notify owner); **SSO authenticated
   exception** redirects into the account. *Decided 2026-06-07/11.*
7. ✅ **HIPAA / PHI — no PHI** — captured at the **ToS/AUP step** (no-PHI acknowledgment); `healthcare` sector
   allowed but PHI content prohibited absent a BAA. (See [account → Acceptable use & PHI](../../account/specs/SPECS.md).)
8. ✅ **Passwordless / magic link** — passkeys (strategic primary) + email OTP (scoped); **no magic links**. *Decided 2026-06-07.*
9. ✅ **Step-up triggers (v1)** — role escalation beyond login + system/service config writes; rest backlogged. *Decided 2026-06-07.*
10. ✅ **Enterprise SSO enforcement** — accounts may configure **SSO-only** (password disabled), opt-in, with **staff break-glass**. *Decided 2026-06-07.*
