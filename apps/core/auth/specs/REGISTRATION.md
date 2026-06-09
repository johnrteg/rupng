#
# Registration (self-service signup)
#

# Objective

The **self-service signup flow**: how a new prospect becomes a verified user + account with the
**least friction that still keeps the spammers and bots out**. It collects who they are, what they
do, and how they found us — verifies the contact points — and provisions the first user and account.

> Not to be confused with the **registration** service (TCR / 10DLC brand registration) or the
> **account** service (the account/plan/billing model). This spec is the *sign-up experience* the
> auth service owns; it *creates* records those services then own.

# Role & boundaries

* **auth** (this flow) — owns the signup steps, identity creation (Cognito user), **email + phone
  verification**, password policy, bot/abuse defenses, ToS/consent capture.
* **account** — the new **Account** record (status `pending` → `active`), plan selection, billing.
  Registration hands it the business name + sector + attribution.
* **registration (TCR)** — **the real anti-spam KYC gate**: legal business name, EIN, address,
  use-case — required *before sending*, not at signup (see "Where the real gate is").
* **email / texting** — deliver the verification messages (auth triggers; doesn't send).

# Design principle — friction vs. trust (read this first)

Two failure modes pull in opposite directions: **too little friction** → bots and throwaway accounts
flood in; **too much** → real prospects bounce before they see value. The resolution:

1. **Gate the *abusable action*, not exploration.** On a messaging platform the abuse is *sending
   spam* — and sending is **already gated** by 10DLC/TCR brand registration (EIN + business vetting).
   So let signup be light; you physically cannot blast messages until you've passed the carrier's KYC.
2. **Progressive profiling.** Collect the *minimum* to create an account, then ask for the rest as it
   becomes relevant (sector/use-case at onboarding, KYC at "enable sending", billing at upgrade).
3. **Risk-based step-up.** Default path is low-friction; *suspicious* signups escalate (force phone
   verification, hold for review) — friction is applied to the risky few, not everyone.
4. **Verify the contact points cheaply but for real.** Email verify is table stakes; **phone (SMS
   OTP)** is the high-value anti-abuse signal *and* something a texting platform needs anyway.

# What we collect

### Identity — required to create the account (keep this short)
| Field | Why | Verify |
|---|---|---|
| **Email** | login + system comms | **yes** — code/link |
| **Password** + **Confirm password** | credential — **double-entered**, non-SSO only (see Credentials) | match + policy + breached-password check |
| **First / last name** | personalization, audit | — |
| **Business / account name** | the account's display name | — |
| **Phone (E.164)** | strong anti-abuse signal + platform need | **yes** — SMS OTP (may be risk-deferred) |
| **Country / region** | compliance, number provisioning, data residency | — |

> **Social / SSO signup (Google, Microsoft)** is offered first — it *lowers* friction *and raises*
> trust (a provider-verified email + a real identity), so it's both a UX and an anti-abuse win.

## Existing-account detection (email **and** phone)

Before creating anything, check whether the identity already exists — matched on **either**
identifier, each **normalized** the same way the rest of the platform stores it:

* **Email** — lowercased / trimmed (the unique login key in Cognito).
* **Phone** — **E.164**, and only a **verified** number counts as a match (an unverified number a
  bot typed proves nothing).

Outcomes:

| Situation | What happens |
|---|---|
| **Email already registered** | Don't create a duplicate. Show a **neutral** message ("If that email has an account, we've sent a sign-in link") **and email the existing address** a "you already have an account → sign in / reset password" message. Avoids **account enumeration** (don't confirm to an anonymous form that an email is registered). |
| **Verified phone already on another account** | Governed by open decision #4 (one-account-per-phone). Default: **block + neutral message**; agencies that legitimately reuse a number get a flagged exception. A reused phone is also a **risk signal** (raises the abuse score). |
| **Email matches, but they meant to join that org** | Route to the **invite/seat** flow (open decision #6), not a new account — they should be invited into the existing account, inheriting its trust. |
| **SSO email maps to an existing password account** (or vice-versa) | **Link** the identities to the one user (after verifying control), don't fork a second account — see [LOGIN](LOGIN.md) → "Identity linking" (authoritative). |

**Decided: strict neutral.** On an existing email/phone we never confirm existence to the anonymous
form — same message **and** timing whether or not the identifier is registered — and the truthful "you
already have an account" goes to the address's **verified owner**, out of band. This posture is shared
with sign-in and reset; the authoritative treatment (per-surface wording, constant-timing, the
authenticated/B2B-admin exception) lives in [LOGIN](LOGIN.md) → "Security posture". Keep the two consistent.

## Credentials (non-SSO)

Two distinct sign-up paths, chosen up front:

* **SSO / social (Google, Microsoft, …)** — **no password is collected or stored**; the provider
  authenticates and returns a verified email. Skip the password step entirely.
* **Email + password** — collect a **password and a confirmation ("double-entered")**, and:
  * **Match** the two server-side (the client-side check is UX only) — reject a mismatch before anything else.
  * Enforce the **password policy** (`Auth.PasswordPolicy`: min length, complexity, etc.).
  * **Reject breached/compromised passwords** (Cognito advanced security / HIBP-style) — a top
    anti-credential-stuffing measure.
  * Never log or echo the password; only Cognito stores the hash.

> The "double-verified password" applies **only** to the email+password path; SSO users never set one.
> Giving an account *both* methods later ("add a password" / "connect SSO") is a sign-in concern —
> see [LOGIN](LOGIN.md) → "Identity linking".

### Profile — collected at onboarding (just after account creation)
| Field | Why |
|---|---|
| **Channels** (multi-select) | **what they want to do** — Texting/SMS · Email · WhatsApp/RCS · Voice · Push · "just exploring". Drives the onboarding path + which **approval tracks** start (below) |
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

### Deferred — asked only when needed (not at signup)
* **Billing** → account service, at upgrade / paid plan.
* **Brand KYC** (legal name, EIN/tax id, address, website, authorized rep) → **registration (TCR)**,
  before the account can send.

## Sector / vertical (enum)
`marketing` · `technology` · `nonprofit` · `political` · `ecommerce` · `healthcare` · `education` ·
`financial` · `real_estate` · `hospitality` · `agency` · `government` · `other` — aligns with the
platform's target verticals and the marketplace vertical tags.

# Verification

* **Email** — Cognito-issued code or magic link; required before the account leaves `pending`.
* **Phone** — **SMS OTP** (6-digit, short TTL, attempt-limited). This is the anti-abuse workhorse:
  it costs the abuser, **dedupes** (one account per verified number — or flag duplicates), and ties
  the account to a reachable identity. May be **risk-deferred** to just-before-first-send for
  low-risk signups (friction balance), but **always required before sending**.
* Both run through Cognito (TOTP / SMS) + the email/texting services for delivery.

# Explore now, send later — sandbox while approvals run

Each channel has its **own async setup** that gates *real* sending, and **none of it should block
exploring the platform**. The moment email is verified, the account is `active` and the user can do
everything *except* deliver to the outside world — build campaigns and workflows, import contacts,
design templates, configure — while the slow approvals run **in parallel, per channel**:

* **Texting/SMS** → **TCR / 10DLC** brand + campaign registration (the **registration** service) and
  number provisioning — minutes-to-days. (Toll-free verification / short codes are their own tracks.)
* **Email** → **domain authentication** (SPF / DKIM / DMARC), sender identity, and IP warm-up — its
  analog of TCR. Until verified, we must **not** send under the account's real domain (reputation risk).
* **WhatsApp / others** → their respective provider onboarding.

These are discussed/handled **once logged in** (onboarding checklist), not crammed into signup.

## Sandbox / test mode (fake providers)
While a channel's approval is pending, the account runs in **sandbox**: the platform wires a
**simulated provider** so the user can drive the *whole* flow end-to-end — compose, schedule, run a
workflow, see events/analytics — with **nothing actually delivered**:

* Sends are **simulated** (synthetic delivery/open/click/reply events) so dashboards + funnels work.
* If anything *is* sent for testing, it goes **only to a platform sandbox sender** (a test number /
  a `@sandbox.<platform>` domain) and **only to verified test recipients** (e.g. the user's own
  verified phone/email) — **never** the account's real contacts and **never** under the account's
  unverified domain.
* Sandbox output is **clearly labeled** (banner + tagged events) so test data never masquerades as real.
* **Flip to live per channel** automatically when that channel's approval completes — same campaign,
  real provider. Exploration carries straight into production with no rebuild.

This is the friction resolution in practice: **signup is light, the platform is explorable
immediately, and the heavy gates (TCR / domain auth) run in the background** without a dead-end wait.

# Anti-abuse / bot defense (layered — "standard now")

No single check; stack cheap signals and escalate on risk:

* **Bot challenge** — invisible **Cloudflare Turnstile / hCaptcha** (privacy-friendly) or reCAPTCHA v3
  score on the signup form. Low/zero user friction.
* **Email hygiene** — reject **disposable/throwaway** domains; MX-validate; (optionally) **prefer a
  business email** over free webmail for higher tiers (flag, don't hard-block at signup).
* **Phone verification** — the strongest gate (above); dedupe on the verified number.
* **Velocity / rate limits** — per IP, per fingerprint, per email-domain signup caps (reuse the
  platform rate-limiter); throttle bursts.
* **Reputation** — IP/ASN reputation; raise friction (not auto-block) for VPN/Tor/known-bad ranges.
* **Breached-password rejection** — Cognito advanced security (HIBP-style).
* **Honeypot + timing** — a hidden field + a "submitted in 300ms" heuristic catch naive bots for free.
* **Risk score → step-up** — combine the above into a score; low → straight through, high → force
  phone verify + **hold for manual review** (status `pending_review`).

# Flow / state machine

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

* **Email verify** flips the account to `ACTIVE` — they can log in, build, and run everything in
  **sandbox** — but **not** deliver to the outside world.
* **Approval tracks run in parallel, per channel** (texting=TCR, email=domain auth, …) in the
  background; each channel **flips sandbox→live on its own** when approved — no all-or-nothing wait.
* **Phone verify** is required before *any* live send (risk-deferred for low-risk users).
* **High-risk** signups divert to `pending_review` (manual queue) instead of auto-activating.

# Data model (sketch)

Registration produces an **`Auth.UserProfile`** (+ Cognito user) and an **Account** (account service);
it also persists a registration record for funnel analytics + abuse review:

```
Registration   pk=ACCOUNT#<accountId>  sk=REG#<userId>
  { email, emailVerified, phone, phoneVerified, name, businessName, sector, useCase, expectedVolume,
    attribution: { heardAbout, referralCode, utm{} }, consents: { tos{version,at}, marketing, sms },
    risk: { score, signals[], status: ok|review|rejected }, createdAt, country, ip, userAgent }
```

* **PII minimization** — store only what's needed; the marketing/attribution bag is analytics-grade.
* Feeds: identity → **Cognito + `Auth.UserProfile`**; business/sector/attribution → **account**;
  use-case → seeds the **TCR** campaign description later.

# Privacy & compliance

* **Consent versioned + timestamped**; marketing opt-in **separate and unchecked**.
* **OTP SMS is transactional** (TCPA-permissible without marketing consent), but the number still
  enters the normal consent model — no marketing to it without opt-in.
* **GDPR** — a forget request purges the registration PII (the account/contact tombstone rules apply);
  retain only what compliance requires (e.g. consent proof).

# Where the real gate is (don't over-friction signup)

The instinct to "stop crap accounts" is right, but the leverage isn't a longer signup form — it's
that **sending is gated by 10DLC/TCR brand registration** (EIN + business vetting + carrier approval).
A bot can create an account; it **cannot** pass brand KYC and get an approved campaign, so it can't
actually spam. Keep signup light, lean on **phone verification + bot challenge** for the cheap wins,
and let the carrier-mandated KYC be the heavy gate it already is.

# Open decisions

1. **Phone-verify timing** — at signup (more friction, cleaner funnel data) vs deferred to pre-send
   (less friction). Lean: **deferred for low-risk, immediate for high-risk** (risk-based).
2. **Free vs business email** — flag-only, or hard-require a business email for certain plans?
3. **Bot-challenge vendor** — Turnstile vs hCaptcha vs reCAPTCHA (privacy + cost + accuracy).
4. **One-account-per-phone** — hard-unique, or allow with a flag (agencies legitimately reuse a number)?
5. **Manual-review SLA + queue owner** — who clears `pending_review`, and how fast?
6. **Invite / seat signup** — a user invited to an existing account skips most of this (no new account,
   inherits trust); confirm that path bypasses the heavy checks.
7. **Sandbox fidelity** — fully **simulated** events only, or also allow **real test sends** to the
   user's *own verified* phone/email via a platform sandbox sender? (Real test sends prove
   deliverability but cost money + need their own abuse guard.) And how long may an account linger in
   sandbox before a channel approval is required (anti-abuse vs. evaluation time).
8. ~~**Account-enumeration posture**~~ — **decided: strict neutral** (neutral message + notify the
   owner by email, no existence leak; authenticated/B2B-admin context excepted). See "Existing-account
   detection" above and [LOGIN](LOGIN.md) → "Security posture" (authoritative). Still pairs with #4
   (one-account-per-phone) for the *phone* case.
