#
# Registration — web sign-up flow
#

# Objective

The **new-account sign-up** flow as the web app implements it: a short, multi-step wizard that collects the
minimum to create a verified user + account, keeps bots out, and verifies the contact method — "least
friction that still keeps bots out". The deeper auth/identity architecture (Cognito, sessions, the
enumeration-neutral posture, ToS capture) lives in **[ACCESS-FLOWS](ACCESS-FLOWS.md)** and **[SPECS](SPECS.md)**;
this doc is the concrete **step-by-step UX + data contract** the `web` Register page (and the `auth` endpoints
behind it) follow.

> Status: the web UI is **scaffolded** (see `apps/core/web/src/pages/register/Register.tsx`). Bot
> verification, email/phone code verification, and the `auth` calls are **stubbed** — marked `TODO` in the
> component — pending the auth registration endpoints.

# Principle — minimum friction

Per ACCESS-FLOWS ("friction vs. trust"): the abusable action (sending) is gated later by 10DLC/TCR, so
sign-up stays light. Collect only what's needed to create the account; verify the contact method; prove
not-a-bot. Everything else (brand/EIN/use-case, billing) is progressive, after the account exists.

# Steps (the wizard)

Registration is a **multi-view flow** with a `step` state. Each step has a single primary
**Continue** / **Verify** / **Create** button (enabled only when its inputs are valid) and a **Back**
(which walks back one step; from the first step it returns to sign-in).

1. **IDENTIFIER** — **email OR phone** (a toggle, like sign-in), validated with `EmailUtils.isValid` /
   the locale `phoneValid` (country-aware). The chosen one is the account's primary contact + login.
   This panel also offers **sign up with SSO** (Google / Microsoft / Apple / Enterprise — mirrors
   login). On **Continue** we run an **existence check** for the identifier *(stubbed: always treated
   as new; TODO ask auth, enumeration-neutral)*. If it already exists → message to sign in instead.

2. **PROFILE** — only reached for a **new** account: **First name**, **Last name**, **Account name**
   (the organization/workspace name). **Continue** enabled when all three are filled.

3. **PASSWORD** — **Password** + **Confirm password**; both required, **Confirm must match Password**
   (and meet the password policy from the app bootstrap — `GetBootstrap.PasswordPolicy`, enforced
   client-side and re-enforced by auth).

4. **BOT** — **anti-bot verification** (CAPTCHA / Cloudflare Turnstile / hCaptcha — provider TBD). A
   human-verification widget; **Continue** unlocks on a passing token. *(Stubbed: auto-passes.)*

5. **VERIFY** — **contact-method verification**, branched by identifier:
   * **email** → a code is emailed; the user enters it. *(To implement.)*
   * **phone** → a code is texted; the user enters it (verified **during** registration, since the
     phone is the login). *(To implement.)*
   Shows where the code was sent and has **Resend**.

6. **TERMS** — the **final** step: the **Terms of Service** render in a **mini scrollable view**
   (`<LegalScroll>` → `<HtmlInput>` from `/legal/terms.html`); the **"I agree…"** checkbox is
   **disabled until the user scrolls to the bottom**. The ToS can be **downloaded as a PDF**
   (`PdfUtils` → `html2pdf.js`, lazy-loaded). **"Agree & Create Account"** is the call gated by ToS
   acceptance — it invokes the **create-account API** *(stubbed: `createAccount()` logs; TODO
   `POST /api/auth/v1/register`)*, capturing ToS consent + timestamp (ACCESS-FLOWS), then signs the
   user in / returns to sign-in.

Order: `IDENTIFIER → PROFILE → PASSWORD → BOT → VERIFY → TERMS`. Bot-check precedes sending a
verification code (don't let bots burn email/SMS); **account creation is deferred to the final ToS
acceptance**. A future risk signal (ACCESS-FLOWS / RISK) may insert extra challenges before creation.

# Data captured

| Field | Notes |
|---|---|
| `method` | `email` \| `phone` — primary contact + login identifier |
| `email` / `phone` | the chosen identifier (E.164 for phone) |
| `firstName`, `lastName` | user profile |
| `accountName` | new Account record name |
| `password` | set at sign-up; meets `PasswordPolicy`; never logged |
| `tos` | `{ acceptedTerms, acceptedPrivacy, at }` — consent + timestamp |
| `verification` | method + code (transient); the verified flag persists on the identity |

# Auth contract (to implement)

The web page will call `auth` (via `@repo/api` RestfulEndpoints, `/api/auth/v1/...`):

* `POST /register` — create the pending user + account from DETAILS (after bot token); triggers the
  email/SMS verification send. Returns a registration/session handle + which verification is required.
* `POST /register/verify` — submit the code; on success activates + signs in.
* `POST /register/resend` — re-send the verification code.

Enumeration-neutral (ACCESS-FLOWS): responses don't reveal whether an identifier already exists; an
already-registered identifier is handled out-of-band (e.g. "check your email").

# Related

* Sign-in + the shared methods/SSO/verification/password-policy model — **[ACCESS-FLOWS](ACCESS-FLOWS.md)**.
* Anti-abuse / bot defense / risk challenges — **[RISK](RISK.md)**.
* The real KYC gate (brand/EIN/use-case) is **TCR registration before sending**, not sign-up.
