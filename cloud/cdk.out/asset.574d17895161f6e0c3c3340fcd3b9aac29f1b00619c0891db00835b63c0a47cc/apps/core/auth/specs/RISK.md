#
# Risk & anti-abuse (auth)
#

# Objective

The **cross-cutting security layer** both auth flows lean on — invoked by **[sign-in & sign-up](ACCESS-FLOWS.md)**
and the [authorizer](SPECS.md). It decides *whether a request is allowed at all* (IP lists), *whether it's
risky enough to challenge or block* (adaptive risk), *when a device may skip MFA* (remember-device), *how
brute-force is throttled* (lockout), and *how bots are kept out of signup* (anti-abuse). Pulled into its own
doc because it's shared by both flows and substantial on its own.

* Identity / session / authorizer **primitives** live in [SPECS](SPECS.md); the **flows** live in
  [access-flows](ACCESS-FLOWS.md). This doc owns the **risk decisioning + abuse defenses**.
* Models: `Auth.RiskPolicy` / `RiskSignal` / `RiskAction` / `FactorStrength`, `Auth.IpRule`, `UserLoginContext`,
  `Auth.MfaConfig.rememberDeviceWindows` — see `authModel.ts`.

# Failed login & lockout

**Two tiers, escalating** — a single bad streak self-heals; chronic abuse gets shut down for a human to review.

* **Per attempt** — track `failedLogins`; a **bot challenge** (Turnstile / hCaptcha) kicks in after a few fails.
* **Tier 1 — temporary lock (self-healing).** After **`N`** consecutive failures the login is **paused**
  (status `PAUSED`, `lockedUntil` set) and **reactivates automatically** when the delay elapses. The delay
  **escalates with each successive lockout** — **5 min → 10 → 20 → …** (exponential backoff, capped) — so a
  guesser is throttled harder each round while a fat-fingering user waits only minutes the first time.
* **Tier 2 — disable (needs a human).** After **`Y`** lockouts (a counter that **persists across** the Tier-1
  backoffs) the login is **`DISABLED`** and **no longer auto-recovers**. The account's **configured admin(s)**
  are **notified** (the "config users") to investigate + re-enable, and the user is told to contact their
  admin/support. (Platform-staff **break-glass** can also recover — see the SSO-only break-glass in access-flows.)
* **`N`, `Y`, the backoff schedule, and the cap are configurable** (system-/account-level).
* **Breached-password check at login** — a known-compromised credential forces a reset (credential-stuffing
  defense).
* **Enumeration-neutral** — lockout / backoff responses never reveal whether the identity exists (constant
  wording + timing); the authoritative posture lives in [access-flows → Security posture](ACCESS-FLOWS.md).

# Remember-device window *(decided)*

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

# Risk-based challenges (adaptive) — when the server challenges *(role-configurable)*

Beyond the static `MfaConfig`, the server **escalates the challenge stage adaptively** when a sign-in looks
risky. Each signal is evaluated at login (and re-checked for step-up); the **policy is keyed to the user's
highest access level** — more privilege → lower thresholds, more signals enforced, stronger required factor.
The adaptive challenge plugs into the [staged sign-in pipeline](ACCESS-FLOWS.md) as a Stage-3 challenge.

**Signals (v1 candidate set) — answering "what would make the server challenge?":**

| Signal | Detects | Notes |
|---|---|---|
| **New IP / IP changed** | login from an IP not seen recently for this user | the baseline "is this where they usually are" |
| **New device / fingerprint** | no trusted-device match (new browser/app) | ties to remember-device |
| **New country / geo** | country not in the user's recent set | GeoIP lookup |
| **Impossible travel** | geo distance ÷ elapsed time exceeds plausible velocity | strong — near-always challenge |
| **New network / ASN** | corporate → residential, new ISP/carrier | softer than new-country |
| **Datacenter / VPN / Tor / anonymizer** | login from hosting / proxy / exit-node ranges | category feed |
| **IP reputation** | known-bad / threat-intel listed | hard — may **block**, not just challenge |
| **Time since last login (dormancy)** | a long-idle account resuming | re-verify a dormant account |
| **Unusual time-of-day** | off-pattern hour for this user | weak; low weight |
| **Recent failures / prior lockout** | this identity was recently abused | composes with the lockout tiers |
| **Weak primary factor** | signed in via email OTP into a privileged context | force a stronger factor |
| **Privileged role** | acting as staff / admin | always challenge, regardless of other signals |

**Policy model — a `Auth.RiskPolicy` per access tier** declares, for each signal, an **action**: `ignore` ·
`challenge` (force a Stage-3 challenge) · `block` (hard-deny + audit + notify) — plus a **freshness window**
and the **minimum factor strength** at that tier. Higher tiers inherit stricter defaults:

| Tier | Default posture (configurable) |
|---|---|
| `SENDER` / `USER` | challenge on impossible-travel, datacenter/Tor, bad-reputation; ignore mild new-IP |
| `BILLING` | + challenge on new-country, dormancy; shorter freshness |
| `ACCOUNT` admin | + challenge on new-IP / new-device (MFA effectively on every new context) |
| `SUPPORT` / `APPLICATION` (staff) | challenge on nearly any anomaly; require a **strong** factor (passkey/TOTP), **never email-OTP alone** |
| `ROOT` | strongest factor on **every** sign-in; bad-reputation/Tor → **block** |

* **Recommendation — rule-based first, scored later.** Start with explicit, **auditable rules** (signal →
  action per tier): deterministic and **explainable** (needed for SOC 2 / dispute review), easy to tune. A
  weighted **risk score** (Σ signal severities vs a per-tier threshold) and/or **Cognito advanced-security
  adaptive auth** can layer on once a login-history baseline exists — but keep a **rule override** so a model
  can never *soften* staff posture.
* **Outcome is challenge OR block** — most signals add a **challenge** (Stage 3); a few (IP reputation, Tor,
  an IP on a deny list) **block**. Every adaptive decision is **audited with the signals that fired**.

# IP allow / deny lists (per user · account · application)

Network-level access control **in front of** the credential flow: **deny** (block) and **allow** (permit /
exception) lists of **IP, CIDR, or country/region (geo)**, at **three scopes**:

* **Application** — platform-wide, managed by **staff** (`Access.AppRole`) — e.g. block a sanctioned region
  or known-bad ranges.
* **Account** — per-tenant, managed by an **account admin** — e.g. an enterprise that only operates from its
  office ranges.
* **User** — per identity, managed by the **user or their account admin** — e.g. pin a high-privilege user to
  known IPs, or **grant a temporary exception** (the remote-work case).

**Each entry:** scope + subject id, match (`ip` | `cidr` | `country`), effect (`deny` | `allow`), an optional
**time window** `{ start, end }` (UTC + IANA tz — same discipline as grants), reason, who set it, audit.
Allow entries may be **time-boxed exceptions**.

**Two allowlist modes (per scope):**
* **Exception mode (default)** — allow entries are **carve-outs** to a deny (the Spain example below).
* **Strict mode (allowlist-only / IP pinning)** — only allowlisted sources may sign in; everything else is
  denied. For high-security accounts / staff. **Opt-in, default off.**

**Evaluation — most-specific-and-intentional wins:**
1. An **active user-scoped ALLOW** matching the request → **permit** (the intentional, windowed carve-out).
2. Any **DENY** (app / account / user) matching → **block**.
3. A scope in **strict mode** whose allowlist does **not** match → **block**.
4. Otherwise → **permit** — still subject to the **risk-based challenges** above.

**Override authority — you can't self-bypass a higher block.** An allow exception only overrides a deny set
at the **same or lower authority**: overriding an **account** deny needs an **account admin**; overriding an
**application** deny needs **staff**. A user can't allowlist themselves past an app/account block — the
exception is **granted** for them (same conferral principle as cross-account grants), windowed and audited.
**Self-serve narrowing is fine** (a user may pin their *own* known IPs); only **loosening** a higher-scope deny
needs admin/maker-checker.

**Worked example — "block Spain, but Ana is working there for two weeks":**
1. App (or account) sets `deny country = ES`.
2. An **admin** adds a **user** allow for Ana: `{ scope: user(Ana), country: ES, effect: allow, window: now…+14d }`.
3. In the window, Ana signs in from Spain — rule 1 **permits** her (she may still be **challenged** by risk
   policy); every other user from Spain is **blocked** by rule 2. After 14 days, Ana's exception **lapses
   automatically**.

* **Deny = hard block** (login refused, audited, user told to contact their admin/support) — distinct from a
  **risk challenge** (login continues with an extra factor). Reputation / Tor can be wired to *challenge*
  instead of *block* via the risk policy — **lists are the hard gate, risk policy the soft one**.
* **Evaluated in the Lambda authorizer / at login**, before credential work where possible (cheap deny);
  geo via a **GeoIP** lookup, cached. Every block + every list change is **audited**; list changes at
  app/account scope are **step-up** actions.

# Reputation / geo feed (shared)

The IP signals above (geo, ASN, VPN/Tor/hosting, abuse score) come from **one shared source**: the
**`Application.reputation(ip)`** base method ([@repo/services](../../../../packages/services/README.md)). **Auth
owns the data + a provider factory** and exposes a **generalized internal API** (`GET /auth/internal/reputation`);
the per-user baseline (recent IPs / countries / devices, last-login geo+time) lives in **`UserLoginContext`**.
The **same feed** serves signup anti-abuse, the login risk engine, and data-residency — see SPECS `auth-17.6`.

* **Provider factory** — `provider-geolite` / `provider-maxmind` / `provider-ipqs` / `provider-cloudflare` /
  `null`, via AppConfig `provider-<id>`; swap by config.
* **Cheapest start ($0/call):** **MaxMind GeoLite2** (geo + ASN, local `.mmdb`) + the **Tor exit-node list** +
  an **ASN-based datacenter heuristic**; add a paid VPN/fraud feed (Anonymous-IP / IPQS / Spur) later by
  config. If behind **Cloudflare**, prefer its edge country + threat score (no DB to host).
* **Keep the local DB current — MaxMind `geoipupdate`** ([github.com/maxmind/geoipupdate](https://github.com/maxmind/geoipupdate)).
  The GeoLite2 / GeoIP2 `.mmdb` files **drift** (IP→geo / ASN reassignments), so a hand-bundled DB **silently
  degrades** geo-fencing + residency accuracy over time. Run **`geoipupdate` on a schedule** (EventBridge,
  ~weekly — MaxMind publishes ~2×/week) to pull the latest `.mmdb` into **S3** (or an EFS / Lambda layer); the
  `provider-geolite` / `provider-maxmind` adapter loads it from there and **hot-reloads on update** (in-memory,
  still $0/call). Account ID + license key in **Secrets Manager**. **Never** ship a one-off DB that goes stale.

# Signup anti-abuse / bot defense (layered — "standard now")

No single check; stack cheap signals and escalate on risk (the signup-side of the same risk machinery):

* **Bot challenge** *(decided — **Cloudflare Turnstile**)* — invisible, **privacy-friendly**, **free**, **no
  Google data-sharing** (vs reCAPTCHA's GDPR/consent baggage) and **no per-call cost** (vs hCaptcha
  Enterprise); low/zero user friction on the signup form. hCaptcha / reCAPTCHA remain drop-in fallbacks.
* **Email hygiene** — always **reject disposable/throwaway** domains + **MX-validate**. Whether a **business
  email** is *required* (vs free webmail) is **plan-defined** (a `requireBusinessEmail` entitlement),
  **overridable by a coupon** (promos / partner signups); otherwise free webmail is allowed (flag → risk
  score, not a hard block).
* **Phone verification** — the strongest gate; dedupe on the verified number (see [access-flows → Verification](ACCESS-FLOWS.md)).
* **Velocity / rate limits** — per IP, per fingerprint, per email-domain signup caps (reuse the platform
  rate-limiter); throttle bursts.
* **Reputation** — IP/ASN reputation (via the shared feed above); raise friction (not auto-block) for
  VPN/Tor/known-bad ranges.
* **Breached-password rejection** — Cognito advanced security (HIBP-style).
* **Honeypot + timing** — a hidden field + a "submitted in 300ms" heuristic catch naive bots for free.
* **Risk score → step-up** — combine the above into a score; low → straight through, high → force phone verify
  + **hold for manual review** (status `pending_review`), which **publishes to an SQS queue the app service
  consumes to open a support ticket** (Zendesk, factory-abstracted; see *Support ticketing integration*) for
  **customer support** to clear.

# Support ticketing integration

Flagged signups become **support tickets** — owned by the **[app service (BFF)](../../app/SPECS.md)**, which
already holds the support glue (Zendesk help-article proxy, ticket creation, page-sharing). **No separate
support service** — it'd be too small to justify its own AWS footprint; support stays consolidated in the BFF.

* **Registration emits, the app service submits.** A `pending_review` flag **publishes the signup context to
  an SQS queue**; the **app service consumes it and creates the ticket** — so a provider outage / rate-limit
  can't block signup (the queue gives **retries + DLQ**). Target SLA **≤ 1 business day**, **escalate on
  timeout** (never silently auto-approve).
* **Provider-abstracted** — the app service wraps the ticketing provider behind a **factory** (same pattern as
  the texting/email provider factories): a common `Ticket` interface, **Zendesk first** (token in Secrets
  Manager, AppConfig `provider-<id>`), Freshdesk / Intercom later.
* **One home for the integration** — registration, account (billing/dunning), and the BFF's own support UI all
  route through the **app service's** ticketing, so the provider lives in **one place**.

# Requirements (traceable register)

Traceable requirements for the **risk & anti-abuse layer of auth**. IDs are **`auth-risk-N.M`** (a sub-register
of [auth](SPECS.md)). **Priority:** **A** = MVP · **B** = core / next · **C** = later. One sub-level; a group's
priority is its floor.

## auth-risk-1.0 Failed login & lockout — A
- **auth-risk-1.1** Per-attempt tracking + bot challenge — A
- **auth-risk-1.2** Tier-1 temp lock + exponential backoff (self-healing) — A
- **auth-risk-1.3** Tier-2 disable + admin notify — A
- **auth-risk-1.4** Breached-password check at login — A

## auth-risk-2.0 Adaptive risk challenges — B
- **auth-risk-2.1** Per-tier `RiskPolicy` (signal → action), **rule-based** — B
- **auth-risk-2.2** No-feed signals (new-IP/device, dormancy, recent-fail, weak-factor, privileged) — B
- **auth-risk-2.3** Geo signals (new-country / impossible-travel / ASN) — C
- **auth-risk-2.4** Reputation / Tor + weighted score — C
- **auth-risk-2.5** Outcome = challenge-or-block; audited with the signals that fired — B
- **auth-risk-2.6** Remember-device window (role-keyed, configurable) — B

## auth-risk-3.0 IP allow / deny — B
- **auth-risk-3.1** IP/CIDR deny + allow at app / account / user — B
- **auth-risk-3.2** Precedence + windowed exceptions + override authority (no self-bypass) — B
- **auth-risk-3.3** Country / geo entries (GeoIP) — C
- **auth-risk-3.4** Strict-mode allowlist / IP pinning (opt-in) — C

## auth-risk-4.0 Signup anti-abuse — A
- **auth-risk-4.1** Bot challenge — **Cloudflare Turnstile** — A
- **auth-risk-4.2** Email hygiene (disposable reject + MX; business-email plan-defined) — A
- **auth-risk-4.3** Velocity / rate limits (IP / fingerprint / email-domain) — A
- **auth-risk-4.4** Honeypot + timing heuristics — B
- **auth-risk-4.5** Risk score → step-up / `pending_review` — A
- **auth-risk-4.6** Flagged review → SQS → app BFF opens a ticket (Zendesk, factory) — B

## auth-risk-5.0 Reputation / geo feed — B
- **auth-risk-5.1** Shared `Application.reputation(ip)`; auth owns data + provider factory + API (`auth-17.6`) — B
- **auth-risk-5.2** Cheapest: GeoLite2 + Tor-list + ASN heuristic ($0/call); paid feed by config — B
- **auth-risk-5.3** Per-user `UserLoginContext` baseline — B

# Gaps & decisions (one review list)

✅ = resolved/decided · ⚠️ = **open — needs attention**. *(All decided; the **Phasing** table sequences the build.)*

1. ✅ **Adaptive risk challenges** — **role-configurable `RiskPolicy`** over the signal set; higher access →
   stricter. **Engine: rule-based now; weighted score / Cognito advanced-security later** (Phase 3), with a
   rule override that can't *soften* staff posture. *Decided 2026-06-10.*
2. ✅ **IP allow/deny** — deny + allow at **user / account / app**, time-boxed exceptions, **exception-vs-strict**
   modes, precedence "**active user-allow > deny > strict-default > permit**". **Strict-mode = opt-in, default
   off.** *Decided 2026-06-10.*
3. ✅ **IP exception self-service** — **tightening** (pin own known IPs) is self-serve; **loosening** (override
   a higher-scope deny) is **admin-granted / maker-checker** — no self-bypass. *Decided 2026-06-10.*
4. ✅ **Risk signal sourcing** — **MaxMind geo/ASN + anonymizer feed** via the shared **`Application.reputation()`**
   (auth owns it — `auth-17.6`); per-user baseline in **`UserLoginContext`**; no-feed signals first. **Cheapest:
   GeoLite2 + Tor-list + ASN heuristic ($0/call).** *Decided 2026-06-10/11.*
5. ✅ **Remember-device window** — **role-keyed, system-configurable**. *Decided 2026-06-07.*
6. ✅ **Bot-challenge vendor** — **Cloudflare Turnstile** (free, privacy-friendly, no Google data-sharing). *Decided 2026-06-11.*
7. ✅ **Flagged-signup review** — `pending_review` → **SQS → app BFF** opens a Zendesk ticket; ≤ 1 business day,
   escalate-on-timeout; **no separate support service**. *Decided 2026-06-11.*

## Phasing — easy-now → later

| Phase | Ships | Why it's here |
|---|---|---|
| **1 — now (deterministic, no external feed)** | Lockout (both tiers) · bot challenge · velocity limits · **IP/CIDR allow-deny** at all 3 scopes + precedence + windowed admin exceptions · per-tier **`RiskPolicy` rules** for the **no-feed signals** (new-IP, new-device, dormancy, recent-failures, weak-factor, privileged — from `UserLoginContext`) | pure data + logic we already have; highest security-per-effort |
| **2 — next (needs GeoIP + baseline maturity)** | **Country** denies + **new-country / impossible-travel / new-ASN** (MaxMind) · **strict-mode** allowlists / IP-pinning · self-serve user IP-pinning · Cognito advanced-security toggle | one dependency (GeoIP) + a little login history |
| **3 — later (external feeds / behavioral)** | **Anonymizer/VPN/Tor + IP-reputation** (threat-intel feed) · **weighted risk score** over the rules · **unusual-time-of-day** (behavioral baseline) | vendor feeds + accumulated behavior; diminishing-return polish |
