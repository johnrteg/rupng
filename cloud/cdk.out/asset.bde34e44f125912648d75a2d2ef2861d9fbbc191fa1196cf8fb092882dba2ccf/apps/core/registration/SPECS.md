#
# Registration / TCR
#

Manage TCR registration and status
Hook into carrier APIs where possible
RDS DB to cache items
Poll to get updates
Centraolized managment of TCR process for accounts

# State Machine:
Registration is slow and asynchronous: brand vetting (minutes–days), campaign approval (days), number provisioning after. So the core is a per-registration state machine — draft → submitted → pending-vetting → approved/rejected → number-associated → active — with rejection/remediation paths, not just a happy path. Two consequences:

* Your DB is a cache, not the source of truth. TCR/the provider owns approval status; you mirror it. So design for reconciliation, not just storage (the README's "cache items" is right — make explicit it's a projection you reconcile).
* Rejections need a human-in-the-loop workflow. Campaigns get rejected (weak use-case description, bad sample messages, opt-in flow problems). You must surface the rejection reason to the account and support edit + resubmit. That remediation loop is a first-class part of the state machine, easy to forget if you only model the approval path.

# Webhooks
"Poll to get updates" works, but invert the priority: most CSPs (Twilio, Bandwidth) and TCR offer status callbacks/webhooks (brand vetted, campaign approved/rejected) — use those for real-time, and keep polling as a periodic reconciliation sweep to catch missed webhooks and detect drift (external systems are eventually consistent and drop events). Poll only in-flight registrations, back off, and stop polling terminal states — same self-scheduling discipline as dispatch, not a constant full-table poll. (And the callbacks slot into your unified webhook/tcr pipeline.)

# CSP
* Register through your SMS providers — simpler, but brand/campaign/throughput are tied to that provider (switching providers ≈ re-registration), and registration APIs diverge more across CSPs than sending does.
* Become a direct CSP with TCR — register once, connect multiple aggregators, portable and more control — but you take on CSP membership, cost, and compliance obligations.

# Brand
* Who is the brand? For SaaS, typically each account registers its own brand (they're legally the sender; the CTIA/TCPA liability is theirs) and you're the facilitating CSP. So it's brand-per-account, which matters legally and structurally.
* It `gates onboarding`. An account can't send A2P until registered/approved, so TCR integrates with account provisioning: new account → collect brand/KYC info (EIN, business details) → submit → await approval → then enable texting.
* `Hierarchy` (account service): does a sub-account share the parent's brand or register its own? Resolve against the account hierarchy model.

# Cross Service
* TCR status is a sending precondition. The texting service must not send on a number whose campaign isn't active — sending on unregistered/rejected campaigns gets carrier-blocked and is a compliance violation. So TCR publishes campaign/number status, and texting gates sending on it.
* `Trust score` → throughput (MPS) feeds dispatch. Brand trust score / vetting determines allowed MPS, which is exactly the per-number throughput the dispatch governor must pace to. So TCR is the source of truth for per-campaign/number throughput limits that texting/dispatch consume. Make that a real published interface, not a lookup into TCR's DB.

TCR is US 10DLC specifically. Toll-free verification is a separate process, short codes another, and there are international registries. Consider framing this as the broader registration/compliance service — of which TCR/10DLC is the first implementation — so TFN verification, SC provisioning, and intl registration fit later without a new service. (Naming: "registration" or "compliance" may age better than "tcr.")

# Registration operations (lifecycle actions)

Beyond the happy-path state machine, registration exposes the **operator + account actions** that drive a
registration through its (slow, external, drift-prone) lifecycle. All are **audited**; status-changing ones
**publish** the new status to [texting](../texting/SPECS.md) / [dispatch](../../../packages/services/DISPATCH.md).

* **Create campaign** — register a **new TCR campaign** (use-case · sample messages · opt-in flow) under an
  approved **brand** → submitted to TCR/CSP → `pending-vetting`.
* **Vetting status** — read the current **brand + campaign vetting state** (and the brand **trust / vetting
  score**) — the reconciled projection.
* **Refresh vetting score** — re-run / re-pull the brand's **external vetting** → updates the **trust-score → MPS**
  published to dispatch (`registration-7.2`). **Async** (external, minutes–days).
* **Resubmit** — after a **rejection**, edit (use-case / samples / opt-in) and **resubmit** the brand / campaign
  (the remediation loop, `registration-3.2`).
* **Reprovision** — **re-associate / re-provision numbers** to a campaign (after a release, a provider switch, or
  a failed association) → re-run association → `active`.
* **Override TCR status** *(staff break-glass, audited)* — manually **override the projected status** when the
  projection is wrong / stuck or a special case requires it (e.g. a known-good campaign whose callback was
  missed). **Reason required**; the override is the audited record and is **reconciled against the next sync** —
  an override that contradicts TCR is **re-flagged**, never silently authoritative (TCR stays the SoT).
* **Nudge** — **prod a stuck in-flight registration**: re-poke the CSP/TCR for status (out-of-band of the poll
  cadence) and/or **nudge the account** to complete KYC / remediation (notification). Accelerates progress;
  doesn't itself change status.
* **Check & sync** — **on-demand force-reconcile** one registration with TCR/CSP **now** (the same reconcile the
  poll sweep runs, on request) — for support / debugging or a suspected-missed webhook.

# Service & Job topology

**Convention (platform-wide).** Each service layers **framework base → domain base → concrete role**. A **domain
Service base** (`RegistrationService extends Service`) and a **domain Job base** (`RegistrationJob extends Job`)
hold the **shared domain code** — the **state-machine engine**, the **CSP/TCR provider factory** (Twilio /
Bandwidth / direct-CSP — registration APIs **diverge more than sending**), the **RDS projection** repo, the
**status-publish** (SNS / EventBridge), **KYC encryption**, and **audit** — so every concrete role inherits it.
Registration is a **projection + reconciliation** service: the **registry is the SoT**, our store mirrors it
(webhooks-first + polling sweep).

```
Application
├── Service (Fastify, long-running — ECS)
│     └── RegistrationService        (domain base — state-machine engine · CSP/TCR provider factory · RDS projection · status-publish · KYC encryption · audit; not deployed alone)
│           ├── RegistrationMainService    (the /registration/* API: brand/campaign CRUD + submit · the lifecycle ops (create · vetting status · refresh score · resubmit · reprovision · override · nudge · check&sync) · status reads · config/health)
│           └── RegistrationWebhookService (CSP/TCR webhook intake — signature-verified, ACK-fast → enqueue; provider-facing, scales apart)
└── Job (Lambda, event-driven)
      └── RegistrationJob          (domain base — provider factory · state-machine · RDS · idempotency)
            ├── RegistrationSubmitJob   (SQS — submit / resubmit / reprovision brand+campaign+numbers to CSP/TCR; external call, idempotent, retry/DLQ → await callback)
            ├── RegistrationWebhookJob  (SQS from webhook intake — process CSP/TCR callbacks → update projection → publish status change)
            ├── RegistrationPollJob     (EventBridge — reconciliation sweep: in-flight only, back off, STOP on terminal; also serves on-demand check&sync)
            └── RegistrationVettingJob  (SQS/EventBridge — refresh brand vetting → trust score → re-publish trust-score→MPS to dispatch)
```

**Services (HTTP, ECS Fargate)**

| Class | Extends | Role |
|---|---|---|
| **`RegistrationService`** | `Service` | **Domain base** — state-machine engine · CSP/TCR provider factory · RDS projection · status-publish · KYC encryption · audit; **not deployed alone**. |
| **`RegistrationMainService`** | `RegistrationService` | The **`/registration/*` API** — brand / campaign **CRUD + submit**, the **lifecycle operations** (create · vetting status · refresh score · resubmit · reprovision · **override** · nudge · check & sync), status reads, config/health. |
| **`RegistrationWebhookService`** | `RegistrationService` | **CSP / TCR webhook intake** — **signature-verified, ACK-fast → enqueue**; provider-facing, **scales apart** from the API. |

**Jobs (Lambda, event-driven)** — each extends `RegistrationJob`:

| Class | Trigger | Role | Req |
|---|---|---|---|
| **`RegistrationSubmitJob`** | SQS | **Submit / resubmit / reprovision** brand + campaign + numbers to the **CSP/TCR** (external, **idempotent**, retry / DLQ) → await the callback; update the projection | registration-2.0 / 3.2 / 4.0 / 11.x |
| **`RegistrationWebhookJob`** | SQS (from webhook intake) | Process CSP/TCR **callbacks** (brand vetted, campaign approved/rejected, number associated) → **update the projection** → **publish** the status change | registration-5.2 / 7.1 |
| **`RegistrationPollJob`** | EventBridge (scheduled) | **Reconciliation sweep** — in-flight only, **back off, STOP on terminal**; catches missed webhooks / drift; also serves **on-demand check & sync** | registration-5.3 |
| **`RegistrationVettingJob`** | SQS / EventBridge | **Refresh brand vetting** → recompute the **trust score** → **re-publish trust-score → MPS** to dispatch | registration-7.2 / 11.3 |

> **Shared modules (not deployables).** The **CSP/TCR provider factory** (Twilio / Bandwidth / direct-CSP — the
> registration-API divergence behind one interface), the **state-machine engine**, the **RDS projection** repo,
> and **status-publish** live on the bases and are reused across the API + workers. **The registry is the SoT** —
> every job **reconciles**, never treats the projection as authoritative; an **override** (`registration-11.6`) is
> the one human exception and is itself reconciled against the next sync. **Nudge** re-pokes via the submit/poll
> path (no new engine). Registration uses **RDS** (not DynamoDB) — status-publish is **inline on state change**,
> not a Streams CDC job.

# AWS Services and Other Dependencies

**AWS services**
* **RDS** — the registration **projection / cache** (relational fits the state-machine + status mirror; TCR/provider is the SoT).
* **SQS** — CSP/TCR **webhook** intake + reconciliation jobs.
* **EventBridge (Scheduler)** — self-scheduled **polling sweeps** (in-flight only, back off, stop on terminal).
* **SNS / EventBridge** — **publish** campaign/number status + trust-score→MPS to texting / dispatch.
* **Secrets Manager + KMS** — CSP API keys + **KYC / brand** data (EIN, business details) at rest.

**Third-party libraries / services**
* **TCR (The Campaign Registry)** — the US 10DLC registry.
* **CSPs** — Twilio · Bandwidth (registration APIs **diverge more than sending** → a provider factory); or **direct-CSP with TCR** (gap #1).

**Internal (`@repo/*`)**
* `@repo/services` (Rds/Dynamo, Sqs, Sns, Secrets, Kms), `@repo/endpoint` (`Access`), `@repo/common` (`Type`).
* **Gates** [account](../account/specs/SPECS.md) onboarding (no A2P until approved); **publishes** status + trust-score/MPS to **[texting](../texting/SPECS.md)** (sending precondition) + **[dispatch](../../../packages/services/DISPATCH.md)** (throughput pacing).

# Compliance & standards mapping

How **this registration service's** controls map to **OWASP Top 10 (2021)**, **ISO/IEC 27001:2022** (Annex A),
**SOC 2 Type 2** (TSC), **HIPAA** (if PHI), **GDPR**, **CCPA/CPRA**, and **messaging law** (TCPA / CTIA / 10DLC).
Registration is the platform's **A2P messaging-compliance** plane — **TCR / 10DLC** brand + campaign registration
that **gates A2P sending**; it holds **KYC / brand data** (EIN, business details) and **mirrors** TCR/CSP status
(the registry is the **source of truth**; our DB is a reconciled **projection**). There is **no PCI** surface;
**HIPAA** is ➖ (no PHI). Status + **trust-score→MPS** are **published** to [texting](../texting/SPECS.md) /
[dispatch](../../../packages/services/DISPATCH.md). Identity/RBAC live in [auth](../auth/specs/SPECS.md); residency is the
platform [AWS topology](../../../packages/services/src/aws/SPECS.md).

**Legend:** ✅ meets/exceeds · ⚠️ partial / open — see Gaps · ➖ n/a

| Registration control | OWASP T10 | ISO 27001:2022 | SOC 2 (TSC) | HIPAA (if PHI) | GDPR | CCPA | Messaging (TCPA/CTIA/10DLC) | |
|---|---|---|---|---|---|---|---|---|
| **10DLC registration gates A2P** — no sending until brand + campaign **approved** (the core control) | A04 | A.5.31 | CC7.x | ➖ | ➖ | ➖ | **TCPA / CTIA / 10DLC** | ✅ |
| **Sending precondition published** — texting gates on `campaign-active` (unregistered/rejected = carrier-block + violation) | A04 | A.8.2 | CC6.x | ➖ | ➖ | ➖ | 10DLC | ✅ |
| **Trust-score → MPS throughput** — published to dispatch (carrier throughput compliance) | A04 | A.8.6 | CC7.x | ➖ | ➖ | ➖ | carrier MPS | ✅ |
| **KYC / brand data** (EIN, business details) — encrypted, tenant-isolated | A02 | A.8.24 | CC6.1 | ➖ | Art 32 | §1798.100 | ➖ | ✅ |
| **Brand-per-account** — the account is the legal sender (TCPA liability is theirs); we facilitate as CSP | A01 | A.5.31 / A.5.19 | CC9.2 | ➖ | Art 28 | ➖ | TCPA | ✅ |
| **Status projection reconciliation** — TCR/provider = SoT; webhooks-first + polling sweep (no drift) | A08 | A.8.16 | CC7.1 | ➖ | ➖ | ➖ | ➖ | ✅ |
| **Webhook verification** — CSP / TCR callbacks signature-verified | A08 | A.8.24 | CC7.1 | ➖ | Art 32 | ➖ | ➖ | ✅ |
| **Tenant isolation** — per-account registrations / brands | A01 | A.8.3 | CC6.1 | ➖ | Art 32 | ➖ | ➖ | ✅ |
| **Audit** — submissions / status changes / remediation (who / when / what) | A09 | A.8.15 | CC7.2 | ➖ | Art 30 | ➖ | ➖ | ✅ |
| **Encryption** — KYC at rest (RDS / KMS) + in transit | A02 | A.8.24 | CC6.1 | ➖ | Art 32 | ➖ | ➖ | ✅ |

# Gaps & decisions

*The one review list.* ✅ = resolved/decided · ⚠️ = **open — needs attention**.

1. ⚠️ **CSP model — register-via-provider vs direct-CSP (open, the big one).** **Via SMS provider**
   (Twilio/Bandwidth) is simpler but **ties brand/campaign/throughput to that provider** (switching ≈
   re-registration; registration APIs diverge more than sending). **Direct CSP with TCR** = register once,
   connect multiple aggregators, **portable + more control**, but takes on **CSP membership, cost, and
   compliance obligations**. Start behind a **provider factory** either way; decide the model.
2. ⚠️ **Brand hierarchy** — does a **sub-account share the parent's brand** or **register its own**? Resolve
   against the [account](../account/specs/SPECS.md) hierarchy model (legal sender + liability per brand).
3. ⚠️ **Trust-score → MPS interface** — make it a **real published interface** (registration → texting /
   dispatch), **not** a DB lookup into registration's tables. Define the contract (per-campaign / per-number
   throughput).
4. ✅ **DB is a projection — DECIDED.** TCR / the CSP **owns approval status**; our store is a **reconciled
   cache/projection**, not the SoT — design for **reconciliation**, not just storage.
5. ✅ **Sync model — DECIDED: webhooks-first + polling reconciliation.** Use CSP/TCR **callbacks** for
   real-time; keep a **periodic poll sweep of in-flight registrations only** (back off, **stop on terminal
   states**) to catch missed webhooks / drift — the same self-scheduling discipline as dispatch.
6. ✅ **Scope/naming — DECIDED: a broader "registration / compliance" service.** TCR / **10DLC is the first
   implementation**; **toll-free verification (TFN)**, **short codes (SC)**, and **international registries** fit
   later **without a new service** (the dir is already `registration`, not `tcr`).

# Requirements (traceable register)

The traceable requirement register for the **registration service** (the narrative notes above are the
rationale; this is the coded list). IDs are stable handles (**`registration-N.M`**) — cite them in code,
tickets, and tests. **Priority:** **A** = MVP, **B** = core / hardening, **C** = later. One level of
sub-requirements; a group's priority is its floor. **Boundaries:** registration owns **A2P registration +
compliance status** (brand, campaign, number association, the state machine) and **publishes** status +
throughput; **[texting](../texting/SPECS.md)** gates sending on it, **[dispatch](../../../packages/services/DISPATCH.md)**
paces to the MPS, **[account](../account/specs/SPECS.md)** owns the hierarchy + onboarding; **TCR / the CSP** is
the source of truth (we project + reconcile).

## registration-1.0 Brand registration — A
- **registration-1.1** **Brand-per-account** — the account is the legal sender; collect **KYC** (EIN, business details) — A
- **registration-1.2** **Gates onboarding** — no A2P until the brand + campaign are approved (integrates with account provisioning) — A
- **registration-1.3** **Hierarchy** — sub-account shares the parent brand vs registers its own *(gap #2)* — B

## registration-2.0 Campaign registration — A
- **registration-2.1** Campaign **vetting** — use-case, sample messages, opt-in flow — A
- **registration-2.2** Approval / **rejection** with reason — A

## registration-3.0 State machine & remediation — A
- **registration-3.1** `draft → submitted → pending-vetting → approved` / `rejected → number-associated → active` — A
- **registration-3.2** **Rejection → remediation** (human-in-the-loop) — surface the reason, support **edit + resubmit** — A

## registration-4.0 Number association — A
- **registration-4.1** Associate provisioned **numbers** with the approved campaign → `active` — A

## registration-5.0 Status sync & reconciliation — A
- **registration-5.1** Store is a **projection** — TCR / CSP owns approval; **reconcile**, don't treat as SoT *(gap #4)* — A
- **registration-5.2** **Webhooks-first** — CSP / TCR callbacks for real-time status *(gap #5)* — A
- **registration-5.3** **Polling reconciliation sweep** — in-flight only, back off, **stop on terminal** *(gap #5)* — A

## registration-6.0 CSP model — A
- **registration-6.1** **Provider factory** — registration via Twilio / Bandwidth (APIs diverge more than sending) — A
- **registration-6.2** **CSP model** — register-via-provider vs **direct-CSP with TCR** *(gap #1)* — A

## registration-7.0 Cross-service interface — A
- **registration-7.1** **Publish campaign / number status** — texting gates sending on `campaign-active` — A
- **registration-7.2** **Publish trust-score → MPS** throughput — dispatch paces to it (a **published interface**, not a DB lookup) *(gap #3)* — A

## registration-8.0 Broader scope (registration / compliance) — B
- **registration-8.1** **TCR / 10DLC first**; **TFN** verification, **short codes**, **international** registries fit later — same service *(gap #6)* — B

## registration-9.0 Privacy, security & audit — A
- **registration-9.1** **KYC / brand data** encrypted (RDS / KMS) + tenant-isolated — A
- **registration-9.2** **Webhook verification** (CSP / TCR signatures) — A
- **registration-9.3** **Audit** — submissions / status changes / remediation — A

## registration-10.0 Data model & infra — A
- **registration-10.1** **RDS** projection of the registration state machine + status mirror — A
- **registration-10.2** **SQS** (webhooks / recon) · **EventBridge** (poll sweeps) · **SNS/EventBridge** (status publish) · **Secrets/KMS** (CSP keys + KYC) — A

## registration-11.0 Lifecycle operations (actions) — A
- **registration-11.1** **Create campaign** — register a **new TCR campaign** (use-case · samples · opt-in) under an approved brand → submit → `pending-vetting` — A
- **registration-11.2** **Vetting status** — read brand + campaign **vetting state + trust/vetting score** (the reconciled projection) — A
- **registration-11.3** **Refresh vetting score** — re-run / re-pull **external brand vetting** → recompute trust score → re-publish **trust-score → MPS** (`registration-7.2`); **async** — B
- **registration-11.4** **Resubmit** — edit + resubmit a **rejected** brand / campaign (the remediation loop, `registration-3.2`) — A
- **registration-11.5** **Reprovision** — **re-associate / re-provision numbers** to a campaign (after release / provider switch / failed association) → re-run association → `active` — B
- **registration-11.6** **Override TCR status** *(staff break-glass, audited, reason required)* — manually correct a wrong/stuck projection; **reconciled against the next sync** — an override that contradicts TCR is **re-flagged**, never silently authoritative (TCR stays the SoT) — B
- **registration-11.7** **Nudge** — re-poke the CSP/TCR for a stuck in-flight registration (out-of-band of the poll cadence) and/or **nudge the account** to complete KYC / remediation; doesn't change status — B
- **registration-11.8** **Check & sync** — **on-demand force-reconcile** one registration with TCR/CSP now (the poll-sweep reconcile, on request) — B

## registration-12.0 Service & Job topology — B
- **registration-12.1** **Domain bases** — `RegistrationService extends Service` + `RegistrationJob extends Job` hold the shared code (state-machine engine · CSP/TCR provider factory · RDS projection · status-publish · KYC encryption · audit); **concrete roles extend the domain base** — B
- **registration-12.2** **`RegistrationMainService`** — the `/registration/*` API (brand/campaign CRUD + submit · the lifecycle operations `registration-11.x` · status reads) — A
- **registration-12.3** **`RegistrationWebhookService`** — CSP/TCR webhook intake (signature-verified, ACK-fast → enqueue); **scales apart** — A
- **registration-12.4** **Jobs extend `RegistrationJob`** — `RegistrationSubmitJob` / `RegistrationWebhookJob` / `RegistrationPollJob` / `RegistrationVettingJob` — A
- **registration-12.5** **Registry is the SoT** — every job **reconciles**; status-publish is **inline on state change** (RDS, no Streams CDC job) — A

# eof