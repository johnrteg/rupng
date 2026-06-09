#
# Login (sign-in / authentication)
#

# Objective

Authenticate an **existing** user and establish a session: identify → verify a credential →
(MFA if required) → issue a token → resolve the **acting account + role**. The recurring counterpart
to the one-time **[REGISTRATION](REGISTRATION.md)** flow. The *architecture* (Cognito, the Lambda
authorizer, the light JWT, sessions, revocation, rate limiting) lives in the auth **[SPECS](../SPECS.md)**;
this spec is the **sign-in flow and its sub-flows** (MFA, reset, identity linking, lockout).

# Role & boundaries

* **auth** (this flow) — sign-in across methods, MFA challenge / step-up, **session**
  issue / refresh / revoke, account & role switching, password reset, identity linking, lockout.
* **Cognito** — the **credential authority**: password hashes, social / SAML / OIDC federation,
  TOTP / SMS MFA.
* **account** — membership + **role grants** (`Auth.RoleGrant`); login *reads* the resolved grant,
  it doesn't own it.
* Models live in the `Auth` namespace (`UserProfile`, `UserIdentity` / `AuthMethod`, `Session`,
  `JwtClaims`, `Context`, `PasswordPolicy`, `MfaConfig`) — see `authModel.ts`.

# Sign-in methods

A single user may hold **several** (see `Auth.AuthMethod` + `Auth.UserIdentity`) — the sign-in screen
offers whatever they've linked:

* **Email + password** — Cognito-native (+ MFA).
* **Social SSO** (Google, Microsoft) — Cognito federation; a provider-verified email.
* **Enterprise SSO** (SAML / OIDC) — per-account `Auth.SsoConnection`, **domain-routed** (an email at a
  federated domain is sent to that account's IdP), optional **JIT provisioning** + SCIM. An account may
  enforce **SSO-only** (no password) — see below.

## Enterprise SSO enforcement *(decided)*

An account **may configure SSO-only access** — 100% SSO, **password login disabled** for its members:

* **Account-level, opt-in toggle** — `Auth.SsoConnection.ssoOnly` (off by default). When on, members of
  that account can sign in **only** through the account's IdP; the password (and email-OTP) paths are
  refused for them, and existing password identities are deactivated for sign-in.
* **Domain-routed enforcement** — an email at the account's federated domain is sent straight to the IdP;
  there's no password fallback to enumerate or phish.
* **Break-glass** — at least one **platform-staff** path (`Access.AppRole`) must remain so support can
  recover an account whose IdP is misconfigured/down; the lockout applies to *account members*, not to
  staff recovery. (Exact break-glass mechanism → backlog with the other recovery flows.)
* MFA/step-up still apply on top — SSO-only governs *which credential*, not whether step-up fires.
* **Passkey / WebAuthn** — the **strategic primary passwordless** method; phishing-resistant. See below.
* **Email OTP** — a one-time emailed code; convenience for low-privilege roles + recovery. See below.

## Passwordless *(decided — two-track)*

We pursue passwordless on **two tracks**, and explicitly **do not** ship clickable magic links:

1. **Passkeys (`AuthMethod.PASSKEY`) — the strategic primary.** WebAuthn / FIDO2 (Cognito-native),
   device- or platform-synced, unlocked by biometric / PIN. **Phishing-resistant** and strong even as a
   single gesture (possession + inherence). The long-term password replacement for **every** role;
   *rollout timing* is still open (see Open decisions).
2. **Email OTP (`AuthMethod.EMAIL_OTP`) — convenience + recovery, scoped.** A short-TTL, single-use,
   rate-limited emailed **code** offered to **low-privilege roles** (`SENDER` / `USER`) and as an
   account-access fallback. Subject to the same **enumeration-neutral** wording ("if that email exists,
   we sent a code"), constant-timing, and MFA/step-up rules as every other surface.
   * **Never a sole factor** for `BILLING` / `ACCOUNT` admin / staff — those require password + MFA or a
     passkey.
3. **Magic link (`AuthMethod.MAGIC_LINK`) — deprioritized, not planned.** Reserved in the enum but **not
   on the roadmap**: clickable links are consumed by corporate **link scanners** (SafeLinks et al.),
   break **cross-device** (link opens in the phone's mail app), and gate login on email deliverability.
   **Email OTP wins** on every one of these — if we ever want emailed passwordless, it's the code, not the link.

* **Baseline unchanged** — **password + MFA** remains the default until passkeys are broadly adopted.
* Implemented via Cognito's **custom auth flow** (`CUSTOM_AUTH` + the `*AuthChallenge` Lambda triggers)
  for OTP; native WebAuthn for passkeys.

# The flow

```
 identify (email / SSO) ─► authenticate (Cognito)
        │                        │ fail → lockout tracking (below)
        │                        ▼
        │                 MFA required? ──yes──► challenge (TOTP / SMS) ──ok──┐
        │                        │ no                                         │
        │                        └────────────────────────────────────────────┤
        ▼                                                                      ▼
 (enumeration-neutral —                              issue SESSION → light JWT (identity only)
  same response whether or                           resolve acting ACCOUNT + ROLE (RoleGrant, ≤ max)
  not the email exists)                              → return Auth.Context
```

* **The JWT is identity-only** — roles / permissions are resolved **per request** by the authorizer
  from DynamoDB (matches the README), so a role change takes effect without re-issuing a token.
* **Acting account + role** — a user with grants in several accounts selects which account to act in;
  the chosen role must be **≤ their `maxRole`** in that account ("scale down, never up").

# MFA

* The Cognito MFA setting is **OPTIONAL**; we **enforce** the requirement ourselves per `Auth.MfaConfig`.
* **Step-up** — an extra challenge mid-session in front of sensitive actions, even when already signed
  in. **Adaptive** step-up also fires on an anomalous sign-in (new device / geo / impossible-travel).
  The v1 trigger set is below.
* **Remember-device** — a trusted device may skip MFA for a bounded window (`Auth.DeviceInfo.trusted`),
  then must re-verify. See below.

## Step-up triggers *(decided — v1)*

Two triggers ship in v1; everything else is backlogged (below). A step-up is an MFA challenge (or, once
available, a passkey) re-verifying the *current* user — it does **not** start a new session.

1. **Role escalation beyond what you logged in as.** Whenever a user **acts at a higher role than the
   role they authenticated with** — on either ladder, with the **application / staff ladder**
   (`Access.AppRole`: `SUPPORT → APPLICATION → ROOT`) the primary case — step up before the elevated
   role takes effect. The session records the role it was established at; switching *up* (see Sessions →
   "Switch account / role") re-challenges; switching back *down* does not.
2. **Saving system / service configuration *(minimally)*.** Any **write** to system- or service-level
   configuration requires a step-up at save time. (Read/normal app work does not.)

> A step-up is **scoped + time-boxed**: it satisfies the elevated context for that session/role for a
> freshness window, then must be re-verified — and it fires **regardless of an active remember-device
> window** (remember-device only skips the *routine login* MFA; see below).

### Backlogged step-up triggers
Tracked for a later phase, not enforced in v1:
* **Security/identity** — change password, change email/phone, enable/disable/reset MFA, add/remove a
  login method (identity linking), "sign out everywhere".
* **Money & keys** — change payment method or plan; create/rotate **dev API keys**.
* **Data & blast-radius** — export/view PII or contact lists; kick off a large/bulk send; delete the account.
* **Access admin** — invite/remove users, change a user's role, transfer ownership, configure SSO/SCIM.
* **Risk/context** — long-idle resume; **weak-factor escalation** (a session established via email OTP
  attempting a strong action); explicit **auth-freshness** windows per action.

## Remember-device window *(decided)*

A verified device may skip the MFA challenge for a window, after which it re-verifies. The window is
**keyed to the user's max access rights** — more privilege → shorter trust — and is **system-configurable**
(`Auth.MfaConfig.rememberDeviceWindows`, overridable per **environment** and per **account**, bounded by
a platform maximum). It scales to the **highest role the user can act as** (their `maxRole` across every
account *and* any staff identity); **the most-privileged role wins** (the shortest window applies).

Example defaults — *configurable, not hard-coded:*

| Account ladder (`Access.AccountRole`) | Default window |
|---|---|
| `SENDER` — send/queue only | **30 days** |
| `USER` — normal user | **14 days** |
| `BILLING` — billing access | **7 days** |
| `ACCOUNT` — account admin | **3 days** |

| Staff ladder (`Access.AppRole`) — cross-account, always shorter | Default window |
|---|---|
| `SUPPORT` — application support | **24 hours** |
| `APPLICATION` — app admin across accounts | **8 hours** |
| `ROOT` — platform config | **not eligible — MFA on every sign-in** |

Rules around the window:

* **Revoke the trust grant** on: password change/reset, **role elevation**, MFA reset, or an explicit
  "sign out everywhere". A device's remembered status does not survive any of these.
* **Step-up still applies** on a trusted device — elevating to a higher role or hitting a sensitive
  action re-challenges **regardless** of an active window (the window only skips the *routine* login MFA).
* **Anomaly overrides trust** — a new geo / impossible-travel signal forces a re-challenge even within
  the window.

# Sessions

* **Issue** on success — the `Auth.Session` record exists so a stateless JWT can be **revoked**.
* **Refresh** with **rotation** — reuse of a retired refresh token revokes the whole **family** (theft
  signal via `refreshFamilyId` / `refreshGeneration`).
* **Switch account / role** — re-scope the session to another granted account (≤ max), audited.
* **Logout / revoke** — blacklist the `jti` / session; the **revocation epoch** invalidates cached
  authorizer allows immediately (no waiting on the JWT TTL).

# Identity linking *(authoritative here)*

A user accumulates methods over time, and we **link, never fork**:

* A **SSO sign-in whose verified email matches an existing user** attaches a new `Auth.UserIdentity`
  to that user (after verifying control of the email) rather than creating a second account — and the
  reverse (a password user later "Connect Google").
* **From settings:** "add a password", "connect / disconnect SSO", manage passkeys — each adds or
  removes a `UserIdentity`; you **cannot remove the last method** (that would lock the user out).
* The **registration** flow defers to this when it detects an existing email — see
  [REGISTRATION](REGISTRATION.md) → "Existing-account detection".

# Failed login & lockout

* Track `failedLogins`; **progressive backoff** → a temporary lock (`lockedUntil`, status `LOCKED`).
* **Bot challenge** (Turnstile / hCaptcha) after repeated failures.
* **Breached-password check at login** — if the credential is known-compromised, force a reset
  (credential-stuffing defense).

# Password reset / forgot

* Request → **email a time-boxed, single-use reset link / code** → set a new password (**policy +
  breached-password check**) → **revoke existing sessions** (a reset means "lock everyone else out").
* **Enumeration-neutral** (below) — the same "if that email exists, we sent a link" response regardless.

# Security posture

* **Enumeration-neutral *(decided)*** across login, reset, **and** registration — never reveal whether
  an email or phone is registered. This is the authoritative home for the posture that registration also
  follows. Concretely:
  * **Identical response** on every auth surface, regardless of whether the identifier exists:
    * **Login** — "Email or password is incorrect" (never distinguish *wrong password* from *no account*).
    * **Reset / forgot** — "If that email exists, we've sent a link" (sent or not, the same reply).
    * **Registration** — the same neutral acknowledgement; the truthful "you already have an account"
      is **emailed to the address's real owner**, never shown to the anonymous form.
  * **Constant timing** — equalize work so an attacker can't enumerate by latency: do the password-hash
    / email-send work (or a dummy equivalent) on **both** branches — no fast bail on "no such account".
  * **Notify the owner, not the form** — when an identifier *does* exist, the actionable message
    (sign in / reset / you-already-have-an-account) goes to that **verified inbox**, out of band.
  * **Scope** — strict neutral on all **anonymous, pre-auth** surfaces. An **authenticated / B2B admin**
    context (e.g. an org admin inviting or looking up a teammate) may surface existence — the actor is
    already trusted and enumeration isn't the threat there.
* **Rate-limited** per IP + per identity (reuse the platform limiter); **breached-password** rejection;
  **MFA** + adaptive step-up; **audit** every login / switch / reset / link (`Auth.AuditEvent`).

# Later phases (committed, not yet scheduled)

* **Passkeys / WebAuthn (`AuthMethod.PASSKEY`)** — a **later-phase requirement**, not v1. Direction is
  decided (the strategic primary passwordless — see Passwordless); we build password + MFA and (scoped)
  email OTP first, and add passkeys in a subsequent phase. Keep the model + UI seams ready for it.

# Open decisions

*None — all resolved (see below). Backlog items live inline (Step-up triggers → backlog; SSO break-glass).*

> **Resolved**
> * *Account-enumeration posture* → **strict neutral** (see Security posture). Decided 2026-06-07.
> * *Remember-device window* → **role-keyed, system-configurable** (see MFA → Remember-device window).
>   Decided 2026-06-07.
> * *Passwordless / magic link* → **two-track: passkeys (strategic primary) + email OTP (scoped
>   convenience/recovery); no magic links** (see Passwordless). Decided 2026-06-07.
> * *Step-up triggers* → **v1: role escalation beyond login + saving system/service config; rest
>   backlogged** (see MFA → Step-up triggers). Decided 2026-06-07.
> * *Enterprise SSO enforcement* → **accounts may configure SSO-only (password disabled), opt-in, with
>   staff break-glass** (see Enterprise SSO enforcement). Decided 2026-06-07.
