#
# Campaign Service
#

# Objective

The **orchestration brain of outbound** — where an account turns *intent* (**a message, an audience, a goal**)
into a **governed, scheduled, measured** send across one or more channels ([texting](../texting/SPECS.md) ·
[email](../email/SPECS.md) · [print](../print/SPECS.md) · …). A **campaign** is one such effort — one-shot or
scheduled — and campaign's job is to **compose the rest of the platform** to execute it: it owns the
**definition, the approval lifecycle, the audience snapshot, the schedule, the run orchestration, and the cost
cap**, and **delegates every mechanic** (segmentation, sending, pacing, attribution) to the service that owns it.

The load-bearing ideas:
* a **lifecycle state machine** (`draft → in_review → approved → scheduled → sending → sent`, with **pause /
  resume / cancel** mid-send and send-window expiry) where **every transition is audited**;
* **per-channel × language × A/B content**, with **AI-assisted drafting under guardrails** (no PII to the model ·
  SHAFT-screened · **always human-approved, never auto-sent**);
* a **frozen audience snapshot** at run start (a [contact](../contact/SPECS.md) segment + a materialized recipient
  set) so a campaign always knows **exactly who it sent to**, with a consent overlay at send;
* **`0..N` approvals** (a distinct approver each, immutable + audited);
* the **cross-channel budget cap** it owns as the **[channel-cost-management](#cost-limits--entitlements)
  authority** — bounding **send + follow-on engagement**, composed with the account balance gate.

**It never sends.** The **channels** deliver (with **`canSend()`** enforced there),
**[dispatch](../../../packages/services/DISPATCH.md)** paces, **[contact](../contact/SPECS.md)** segments +
supplies consent, **[analytics](../analytics/SPECS.md)** measures — campaign **hands off and tracks**. Put
sending, carrier, or segmentation logic in here and it gets reimplemented in every other send path.

# Role & boundaries (read this first)

Campaign is an **orchestrator + state machine**, not a send engine. It owns the
*definition*, the *approval lifecycle*, the *audience snapshot*, the *schedule*, and
the *run orchestration* — and it **delegates the actual work** to the services that own
each capability. If sending mechanics, carrier logic, or segmentation live in this
service, they will be reimplemented in every other send path.

What Campaign **owns**:
* The campaign definition, content/variants, and channel selection.
* The approval workflow and its audit trail.
* The audience reference + the materialized recipient snapshot for a run.
* The schedule, pacing intent, and run lifecycle (start/pause/resume/cancel).
* Per-campaign cost estimate, budget cap, and entitlement gating.

What Campaign **delegates** (calls out to, does not implement):

| Concern | Owning service |
|---|---|
| Segments, sub-segment filters, contact attributes, consent state | **contact** |
| Throughput, pacing, carrier skip/fallback, retries, DLQ, per-number TPS | **dispatch** |
| SMS/MMS send + managed replies + conversations + auto-responses + tagging | **texting** |
| Email send, templates, deliverability | **email** |
| Media upload/library/transcode (images, video, processed video) | **media** |
| Link shortening + branded domains + click tracking | **links/tracking** |
| Delivery/engagement metrics aggregation & reporting | **analytics** |
| 10DLC brand/use-case registration & number↔registration mapping | **tcr** |
| Suppression / opt-out/STOP, global frequency cap, quiet-hours, SHAFT | the shared **`canSend()`** gate (Application base) — composes **contact** + **account** block-list + counters |
| Plan limits / feature gating (`ResolvedEntitlements`) | **account** |
| Approver identity & role checks (`Access` ladder) | **auth** |

# Out of scope (deferred)

* **Integration-triggered campaigns** (e.g. Shopify order → send) and any external
  workflow orchestration → the future **workflow service**. A workflow may *invoke* a
  campaign (or a campaign template), but Campaign does not own triggers or connectors.
* **Recurring / drip / multi-step journeys** → also workflow service. Campaign is the
  unit a journey schedules; it is not itself a journey engine.

# Core concepts

* **Campaign** — the top-level definition: name, objective, channels, schedule, owner.
* **Variant** — a message version. Content is addressed by **channel × language/locale × A-B variant**: each
  **channel** (SMS/MMS/Email) has its own content, **localized** per the account's languages, with optional
  **A/B** variants *within* a language.
* **Audience** — a reference to a segment (+ optional sub-segment filters) plus the
  **materialized recipient snapshot** captured when a run starts.
* **Approval** — a sign-off record: **approver (a distinct user), decision, comments, date/time** — immutable
  + audited; `0..N` required per the account/campaign setting.
* **Run** — one execution of a campaign against its audience snapshot; tracks
  per-recipient/per-channel send state, retries, and outcomes.
* **Template** — a reusable, saved campaign definition (no audience/run).

> Naming: this user-facing **Campaign** is **not** the 10DLC/TCR "campaign"
> (a registered messaging use-case under a Brand). The registered object is referred
> to here as the **10DLC registration**, owned by the **tcr** service, to avoid the
> collision leaking into code and APIs.

# Lifecycle (state machine)

```
 draft ──submit──► in_review ──approve(all)──► approved ──schedule──► scheduled
   ▲  ▲                │                            │                    │
   │  └──changes_req───┘ (with reason)              │ send now           │ window opens
   │                                                ▼                    ▼
   └────────────── reject ───────────────────────  ┴──────────────►  sending ──► sent
                                                                       │  │        │
                                                              pause ◄──┘  └─► partially_sent
                                                                │                  (some failed)
                                                             paused ──resume──► sending
   any non-terminal ──cancel──► canceled            sending/scheduled ──error──► failed
   sent / partially_sent / canceled / failed ──archive──► archived (read-only)
```

* Transitions are **explicit and RBAC-gated**; every transition emits an `AuditEvent`.
* **draft / in_review** lock content edits once submitted (changes require re-review).
* **pause / resume / cancel mid-send** are hard operational requirements.
* **scheduled** carries a send window; **send-window expiry** auto-cancels if not
  started by a deadline.
* Runs are **idempotent**: a recipient is sent at most once per run; retries are safe.
* **Campaigns are archivable, never deletable.** `archived` is terminal + read-only;
  the campaign, its run history, and its audience snapshot are preserved for audit (same
  archive-not-delete rule as segments and contacts). **Tracked-link behavior after archive**
  follows a per-campaign **post-archive link policy** (see *Metrics & reporting* / [links](../links/SPECS.md)).

# Service & Job topology

**Convention (platform-wide).** Each service layers **framework base → domain base → concrete role**. A **domain
Service base** (`CampaignService extends Service`) and a **domain Job base** (`CampaignJob extends Job`) hold the
**shared domain code** — the **campaign / variant / run** model, the **lifecycle state-machine** engine, the
**audience-snapshot** logic, the **`canSend()`** client, **approval** logic, and **audit** emit — so every
concrete role inherits it. Campaign is **orchestration, not a channel**: it **composes** contact + the channels
and never sends directly.

```
Application
├── Service (Fastify, long-running — ECS)
│     └── CampaignService          (domain base — campaign/variant/run model · state-machine engine · audience snapshot · canSend · approval logic · audit; not deployed alone)
│           └── CampaignMainService (the /campaign/* API: CRUD campaigns/variants · audience selection · approvals · lifecycle transitions (submit/approve/schedule/pause/resume/cancel) · templates · metrics reads (from analytics) · config/health; co-edit via collab)
└── Job (Lambda, event-driven)
      └── CampaignJob               (domain base — run model · state machine · canSend · idempotency)
            ├── CampaignRunJob       (SQS — execute a run: materialize the audience snapshot · per-recipient/channel canSend + frequency cap + consent overlay · hand sends to the channels (texting/email) via dispatch; idempotent send-once-per-run)
            ├── CampaignScheduleJob  (EventBridge — launch scheduled campaigns at window open; send-window expiry → auto-cancel)
            └── CampaignStatusJob    (Kafka — channel delivery/failure outcomes → update per-recipient run state → transition run to sent / partially_sent)
```

**Services (HTTP, ECS Fargate)**

| Class | Extends | Role |
|---|---|---|
| **`CampaignService`** | `Service` | **Domain base** — campaign/variant/run model · state-machine engine · audience snapshot · `canSend` · approval logic · audit; **not deployed alone**. |
| **`CampaignMainService`** | `CampaignService` | The **`/campaign/*` API** — CRUD campaigns / variants, **audience** selection, **approvals**, **lifecycle transitions** (submit / approve / schedule / pause / resume / cancel — each emits an `AuditEvent`), templates, **metrics reads** (composed from [analytics](../analytics/SPECS.md)), config/health; co-editing delegated to [collab](../collab/SPECS.md). |

**Jobs (Lambda, event-driven)** — each extends `CampaignJob`:

| Class | Trigger | Role |
|---|---|---|
| **`CampaignRunJob`** | SQS | **Execute a run** — materialize the **audience snapshot**, iterate recipients × channels applying **`canSend` + frequency cap + consent overlay**, and **hand sends to the channels** ([texting](../texting/SPECS.md) / [email](../email/SPECS.md)) ordered by [dispatch](../../../packages/services/DISPATCH.md); **idempotent** (send-once-per-run), retry-safe. |
| **`CampaignScheduleJob`** | EventBridge | **Launch scheduled campaigns** at window open; **send-window expiry → auto-cancel** if not started by the deadline. |
| **`CampaignStatusJob`** | Kafka (channel status) | Consume channel **delivery / failure** outcomes → update **per-recipient run state** → transition the run to **`sent` / `partially_sent`** (closes the lifecycle). |

> **Shared modules (not deployables).** The **state-machine engine**, the **audience-snapshot** logic, the
> **`canSend()`** client (on the `Application` base), and **approval** logic are reused across the service +
> jobs. Campaign **never sends** — `CampaignRunJob` hands off to the channels; attribution is
> [analytics](../analytics/SPECS.md); the actual delivery + DLR/feedback is the channel's worker.

# AWS Services and Other Dependencies

**AWS services**
* **DynamoDB** — campaigns, versions, runs, approvals, audit.
* **S3** — the sent-content record (keyed by campaign + contact + message).
* **EventBridge** — scheduled launches.
* **SQS** — send dispatch (fair-shared by dispatch).
* **Redis (ElastiCache)** — pause flags + the shared `canSend()` frequency counters.

**Third-party libraries / services** — none directly (Stripe via **account**; real-time co-edit via **collab**).

**Internal (`@repo/*`)**
* `@repo/services` (S3, Dynamo, the shared **`canSend()`** gate, `WorkQueue`), `@repo/endpoint` (`Access`), `@repo/common` (`Type`).
* Composes **contact** (suppression) + **account** (block-list, limits, billing) + **auth** (grants, maker-checker); delegates co-editing to **[collab](../collab/SPECS.md)**, tracked links to **[links](../links/SPECS.md)**, sending to the **channels**, attribution to **analytics**.

# Requirements

## Definition & content
* Any number of campaigns per account, subject to plan limit.
* Name; campaign **objective** (feeds AI message tailoring).
* **AI-assisted content** *(decided)* — AI may **draft/tailor** copy (from the objective) and **assist
  translation**, under firm guardrails: **no PII/PHI is sent to the model** (opaque inputs / Bedrock
  no-retention), AI output is **run through the SHAFT / prohibited-content screen**, and **all AI-created
  content requires human approval before send** — AI **never auto-sends** (human-in-the-loop, via the normal
  approval flow).
* **Merge fields / templating** from contact attributes, with fallback values and
  validation that referenced fields exist.
* **Per-channel message variants** (SMS vs MMS vs Email differ in length/format).
* **Per-language content variants (localization)** — *per message, per channel*. A campaign **elects to
  support `1..N` of the account's defined languages** and authors content for each.
  * **Render selection:** the **contact's `primary` then `secondary` language** picks the variant.
  * **No match ⇒ not sent.** If neither of the contact's languages is one the campaign supports, the contact
    is **excluded from the run** — we don't push a message in a language they didn't ask for. It's **surfaced
    in the reachability estimate** (who'd be skipped, by language) so the author can add the variant.
    *(Optional per-campaign **fallback language** to include otherwise-unmatched contacts instead of skipping —
    **default off**.)*
  * **Requires** a `primary` + `secondary` **language on the contact** (owned by the **contact** service); a
    contact with no language set is treated as unmatched (skipped unless a fallback is configured).
  * Authoring supports **manual translation** + optional **machine-translation assist** (human-reviewed before
    approval). Localization is **orthogonal** to A/B (A/B runs *within* a language) and to channel. SMS
    **segment counting is per-language** (a UCS-2/accented translation can cost more segments than the source).
* SMS **segment/character counting** (GSM-7 vs UCS-2) surfaced at edit time (drives
  cost + deliverability).
* Email **templates** with graphics/layouts (internal or 3rd-party); deliverability /
  spam-score hint at edit time.
* Attach **media** by upload or from the library (images / video / processed video),
  respecting per-channel size limits (SMS, MMS, email attachment).
* **Test send to self** and **preview** per channel before submit.

## Channels & sending number
* Channels: **Email | Texting** (extensible).
* Outgoing number (LC | SC | TF) registered to the account, or a from-address
  (incl. no-reply) for email.
* The number must map to an **approved 10DLC registration** (via tcr) for the
  campaign's use case, or the send is rejected/carrier-filtered.
* High-volume sends may use a **number pool / rotation** (delegated to dispatch).

## Audience & segmentation
* Select a **segment**, with optional **sub-segment filters**; dedup across overlapping
  sub-segments and across channels.
* **Freeze semantics:** the segment *query* is fixed at schedule; the **recipient list is materialized when
  the run starts as a snapshot of `contactId`s only — never copied PII** (no phone/email/attrs in the
  snapshot). **Contact data + merge fields + consent + suppression + language match are resolved *live, per
  batch, at dispatch time**, so **edits to a contact after scheduling are reflected in the send** — a
  corrected phone number applies, a late opt-out is suppressed, and a **contact whose language no longer
  matches a supported variant is skipped** (like a suppression). **Surface this in the UI:** *"recipients are
  locked at run start, but their contact details are read live at send — changes made before sending will
  apply."*
* **Language as a segment / filter dimension** *(per account config)* — segments + sub-segment filters can
  target by the contact's **primary/secondary language**, so an account can build a Spanish-audience campaign
  directly.
* **Reachability estimate** before send: how many recipients have a valid phone/email, **current consent**,
  **and a campaign-supported language** (primary or secondary) — the estimate **breaks out who'd be skipped
  for an unsupported language**, so the author can add the variant or set a fallback before sending.
* **Test subset**: a small group, in or out of the segment, reusable across campaigns.

## A/B / multivariate & holdout
* Define ≥2 **variants** with a split ratio (e.g. 20% A / 80% B); support >2.
* Declare a **success metric**; optional **auto-promote winner**. The **winner is determined when the minimum
  sample size *and* the significance threshold are both met within a measurement window** on the test slice
  (the metric — clicks/replies/conversions — accrues *after* send, so it's evaluated over a window, not at
  send-time). The winner is then sent to the **remaining (un-sent) audience**. If the window elapses without a
  clear winner, the **max-wait timeout** fires → promote the **current leader**, or fall back to a designated
  **default variant** if still inconclusive. **Manual-confirm by default; opt-in fully-automatic.**
  **Configurable by account (default) + per-campaign override.**
* Optional **holdout/control group** (no send) for lift measurement — distinct from
  A/B variants.

## Approvals  *(decided)*
* **`0..N` required approvals — an app/account *setting*** (default per account; overridable per campaign).
  **`0` = none required.**
* **Self-approval allowed by default** — the **creator may approve their own** campaign. An account may turn
  **maker-checker on** to forbid self-approval / require a *different* checker (per the
  [account](../account/specs/SPECS.md) maker-checker setting + the [auth maker-checker](../auth/specs/SPECS.md)
  pattern).
* **Approvers must be distinct users** — each of the `N` approvals comes from a **different** account user
  (and, when maker-checker is on, **none may be the creator**).
* **Mode:** **sequential** or **any N-of-M**; **reject / changes-requested with reason** → resubmit (re-review).
* **Each approval record captures** the **approver**, the **decision** (approve / reject / changes-requested),
  any **comments**, and the **date/time** — immutable, part of the campaign audit trail.
* Approver eligibility is gated by **`Access` role**.

## Scheduling & pacing
* Send **now** or in a **future window** (enables fair-use interleaving with other
  campaigns competing for the same number/throughput).
* **Per-recipient-timezone** send ("10am local").
* **Pacing intent** (blast vs drip rate) declared here; *enforced* by dispatch.

## Compliance & consent  *(critical — non-optional)*
* **Consent/opt-in enforced at send time**, per recipient, per channel.
* **Suppression overlay** at dispatch: global do-not-contact, hard bounces, complaints,
  prior opt-outs/STOP.
* **Required opt-out / unsubscribe language injected automatically** (not author opt-in).
* **Quiet hours**: per-recipient TZ + federal/state windows + holiday rules; never send
  outside the allowed window.
* **Global frequency cap / fatigue**: max messages per contact per period **across all
  campaigns** (enforced above the individual campaign).
* **Content screening**: SHAFT / prohibited-content checks before approval.

## Cost, limits & entitlements  *(channel cost management — the canonical home)*

> **Campaign owns *channel cost management*** — the **cross-channel cost authority**: budget caps + cost gating
> across **all channels + follow-on engagement**. The channels ([texting](../texting/SPECS.md) ·
> [email](../email/SPECS.md) · [print](../print/SPECS.md)) and [links](../links/SPECS.md) **meter against and gate
> to** the campaign cap; the **account prepaid balance / `max_out`** ([account](../account/specs/SPECS.md), via
> the `canSend` balance gate) is the separate per-account ceiling a send must **also** pass. **This section is the
> reference** — other specs point here for the cost-cap model rather than redefining it.

* **Cost estimate preview** before send (recipients × channels × per-message rate,
  incl. SMS segment count).
* **Budget cap / spend limit** per campaign — **two configurable thresholds:**
  * **Alert threshold** (soft — e.g. 80%) — **notify** the owner / CS and **keep sending** (overage allowed);
    may set several (80 / 90 / …).
  * **Hard cap** — the absolute limit; on reach, **hard-stop** all further sends + follow-on (remaining queued
    work held / canceled per policy).
  * **Bounded overage, never unbounded.** Cost is **reserved before dispatch** (on the estimate) and
    **committed on actual** (post-DLR — confirmed segments / MMS / surcharge), so **concurrency can't blow past
    the cap**: a send isn't dispatched if its reserve would exceed the hard cap. Overshoot is bounded to
    **in-flight reserves + estimate-vs-actual drift**, then reconciled.
  * **Composes with the account ceiling** — a send must pass **both** the campaign cap **and** the account
    prepaid balance / `max_out` (the `canSend` balance gate, [texting `texting-11.5`](../texting/SPECS.md)); the
    campaign cap is a **per-campaign sub-limit within** the account balance, never a bypass of it.
* **Cross-channel + follow-on engagement.** The cap is **campaign config** and spans **all channels** in the
  campaign **and follow-on engagement** — a **link click / QR scan** that triggers a **follow-on action / send**
  counts toward the cap. Campaign **owns** the cap; the channels + **[links](../links/SPECS.md)** (`links-10.3`)
  **meter against it and gate the follow-on** at the hard cap. So a runaway drip / reply-triggered fan-out can't
  blow past the budget. A follow-on that **launches a different campaign** is bound by **that** campaign's cap.
* **Plan entitlement enforcement** via `ResolvedEntitlements`: max campaigns, allowed
  channels, and gated features (A/B, automation) — same gate pattern as `sms.bulk_send`.

## Execution & reliability
* A run hands batches to **dispatch**; campaign tracks per-recipient/per-channel
  outcome state, never the carrier mechanics.
* **Idempotent** dispatch (no double-send); **retries** + **DLQ** for failed recipients
  (owned by dispatch; campaign reflects status).
* **partially_sent** terminal state when some recipients fail permanently.

## Metrics & reporting
* Per-channel metrics: delivered, line type, bounces, opt-outs, link clicks, replies,
  complaints, conversions — **aggregated by analytics**, surfaced on the campaign.
* **Live run progress** (queued / sent / failed counts) during sending.
* Cost **actuals vs estimate**.
* **Post-archive link policy.** A **per-campaign** setting governs **tracked links once the campaign is
  archived** (link tracing loses most of its meaning after archive): **`resolve_only`** (default — the short
  link still **redirects** for late scans, per links' availability-decoupling rule, but **engagement tracking
  stops**), **`resolve_and_track`** (keep both), or **`disable`** (link goes dead — 410). Optional
  **`expire_after_days`** TTL. Campaign **owns** the setting; **[links](../links/SPECS.md) enforces it on
  resolve** (`links-9.4`).

## Multi-tenancy
* Respect parent/child accounts: whether a **parent may create/launch on behalf of
  sub-accounts**, and how **shared templates/segments + branding** inherit (replace vs
  merge), per the account spec.

## Cross-account sharing — "send on behalf"
* A user/account may be granted **scoped access to *another* account's campaign** — e.g.
  **send** on a specific campaign (or that account's campaigns), without a full role in
  the other account. Campaign **owns the resource + the delegable action vocabulary**
  (`send`; *not* `delete`/`edit` unless explicitly granted) and **consults the
  authorization decision** — it does **not** invent its own.
* The authorization primitive lives in **[auth → Cross-account delegation grants](../auth/specs/SPECS.md)**
  (owner-issued, capped at the issuer's own level, windowed, revocable, admin-notified,
  audited, acts-as-self). Campaign just declares *what* is shareable and at what action
  granularity; auth decides *whether* a caller may.
* The grantee acts under **their own identity** — a send executed via a grant is audited
  as "*user X (acct A) sent on campaign B/123 via grant G*".

## Reuse & collaboration
* **Clone/duplicate**; **save-as-template**; campaign-definition **versioning**.
* **Collaborative authoring** *(decided)* — a campaign **starts single-author**; the owner can **invite other
  account users** to collaborate, each with a per-collaborator role — **edit**, **comment**, or **view** (the
  familiar docs model). **Real-time co-editing** is delegated to the **[collab](../collab/SPECS.md)** service
  (CRDT + presence), so concurrent edits **merge without clobber** — **superseding the old draft-lock** for
  concurrent edits. **Comments** thread on the content (reply / resolve).
  * Invitations are **account-scoped**; **cross-account** collaboration rides an
    [auth grant](../auth/specs/SPECS.md).
  * The collaborator role is a **resource-level** grant on the campaign — **distinct from** the account
    `Access` role and **capped by it** (you can't invite someone to *edit* beyond what their account role
    allows).
  * **Lifecycle locks still apply** — content **freezes at `submitted`/`in_review`** (edits need
    changes-requested → resubmit), regardless of collaborators. All collaboration actions are **audited**.

## Sent-content record (compliance proof)  *(decided)*
* The **exact rendered message** delivered to each recipient is **saved with the campaign + contact** (the
  per-recipient, per-variant content actually sent, **including the injected opt-out language**) — the
  **TCPA / CAN-SPAM proof** of *what we sent, to whom, when*. (This is how SMS history already works.)
* **Stored in S3**, account-scoped, **keyed by campaign + contact + message** — a new `S3.Domain`, e.g.
  `acct/<accountId>/campaign/<campaignId>/sent/<contactId>/<messageId>` — with the DB holding the index/mapping
  (per the [S3 conventions](../../../packages/services/src/aws/SPECS.md#s3--object-storage-layout)).
* **GDPR forget:** sent content can embed PII via merge fields, so on an erasure request the **stored message
  body is wiped and replaced** with a tombstone — **"Purged for GDPR forget-me request on `<DATE>`"** — while
  the **mapping (campaign / contact / timestamp / outcome) is retained** for audit + recordkeeping. Driven by
  the [auth erasure](../auth/specs/SPECS.md) fan-out on the contact's id.

## Audit
* Immutable audit on every definition change and lifecycle transition: who, when, what,
  before/after — same `AuditEvent` shape used elsewhere, **content-hashed + append-only + verify-on-read**
  (the [auth tamper-evident pattern](../auth/specs/SPECS.md)). Covers approvals (approver/decision/comments/
  time) and AI-content provenance.

# Compliance & standards mapping

How the campaign service's controls map to **OWASP Top 10 (2021)**, **ISO/IEC 27001:2022** (Annex A),
**SOC 2 Type 2** (TSC), **HIPAA** (Security Rule, if PHI), **GDPR**, **CCPA/CPRA**, and the
**messaging-regulatory** regimes that dominate outbound campaigns — **TCPA**, **CAN-SPAM**, **10DLC/TCR**,
**SHAFT**. Clause refs are **indicative**; this is a **design-intent** self-assessment. Much of the
*enforcement* is **delegated** (consent/suppression → contact/compliance; quiet-hours/pacing → dispatch;
10DLC → tcr) — campaign **declares + gates**, the owning service **enforces**.

**Legend:** ✅ meets/exceeds · ⚠️ partial — see Gaps · ➖ n/a

| Campaign control | OWASP T10 | ISO 27001 | SOC 2 | HIPAA (if PHI) | GDPR | CCPA | Messaging (TCPA/CAN-SPAM/10DLC) | |
|---|---|---|---|---|---|---|---|---|
| RBAC-gated lifecycle transitions + tenant isolation | A01 | A.5.15 / A.8.3 | CC6.1 / CC6.3 | §164.312(a)(1) | Art 32 | ➖ | ➖ | ✅ |
| Approvals + **maker-checker** (separation of duties) | A01 | A.5.3 (SoD) | CC6.3 / CC1.x | §164.308(a)(3) | Art 32 | ➖ | ➖ | ✅ |
| Cross-account "send on behalf" via **auth grants** (capped, windowed, audited) | A01 | A.5.18 | CC6.2 / CC6.3 | §164.308(a)(4) | Art 32 | ➖ | ➖ | ✅ |
| Immutable audit on change + lifecycle (who/when/before-after) | A09 | A.8.15 | CC7.2 | §164.312(b) | Art 5(2) | ➖ | recordkeeping | ✅ · ⚠️ hashed audit |
| **Consent / opt-in enforced at send** (per recipient, per channel) | A04 | A.5.34 | CC6.x | ➖ | Art 6 / 7 | §1798.120 | **TCPA prior consent** | ✅ |
| **Suppression overlay** (global DNC / bounce / complaint / STOP) | ➖ | A.5.34 | CC7.2 | ➖ | Art 21 | §1798.120 | **TCPA / CAN-SPAM** | ✅ |
| **Auto-injected opt-out / unsubscribe** language (not author opt-in) | ➖ | A.5.34 | ➖ | ➖ | Art 21 | §1798.120 | **CAN-SPAM / TCPA STOP** | ✅ |
| **Quiet hours** (recipient TZ + federal/state + holiday) | ➖ | ➖ | ➖ | ➖ | ➖ | ➖ | **TCPA** | ✅ |
| **Global frequency cap / fatigue** (cross-campaign) | ➖ | ➖ | ➖ | ➖ | Art 5(1)(a) | ➖ | **TCPA** | ✅ |
| **Content screening** (SHAFT / prohibited) before approval | A04 | A.8.28 | ➖ | ➖ | ➖ | ➖ | **SHAFT / 10DLC / carrier** | ✅ |
| **10DLC registration** mapping (number ↔ approved use-case) | ➖ | ➖ | ➖ | ➖ | ➖ | ➖ | **10DLC / TCR** | ✅ (via tcr) |
| **Audience snapshot** — **`contactId`s only, no PII**; data resolved live at dispatch | A01 / A04 | A.8.11 | CC6.x | §164.502(b) | Art 5(1)(c)/25 | §1798.100 | ➖ | ✅ decided |
| **Merge fields + AI message tailoring** (content PII) | A04 | A.8.11 | ➖ | §164.502(b) | Art 5 / 25 | §1798.100 | ➖ | ⚠️ AI guardrails |
| **Sent-content record** in S3 (campaign+contact+message; GDPR-purge tombstone) | A08 | A.8.15 | CC7.1 (integrity) | §164.312(c) | Art 5(2) / 17 | §1798.105 | **TCPA/CAN-SPAM proof** | ✅ decided |
| **Links in content** — tracked, **UUID-only**, `https:` (via links svc) | A01 | A.8.11 | ➖ | ➖ | Art 5(1)(c) | §1798.100 | ➖ | ✅ |
| **Plan entitlement gating** (channels / features / limits) | A01 | A.8.2 | CC6.3 | ➖ | ➖ | ➖ | ➖ | ✅ |
| **Archive-not-delete** (runs + snapshot preserved for audit) | A09 | A.8.15 | CC7.2 | §164.316(b) | Art 5(2) | ➖ | recordkeeping | ✅ · ⚠️ erasure tension |

## Gaps, issues & open decisions (one review list)

*Open decisions are merged here — a single list to review.* ✅ = resolved/decided · ⚠️ = **open — needs attention**.

1. ✅ **Recurring / automation — deferred to the workflow service.** Campaign stays one-shot/scheduled; a
   workflow may *invoke* a campaign. (Recorded so it isn't re-litigated.)
2. ✅ **Link safety.** Content links are **tracked, UUID-only, `https:`** via the links service — no PII in
   URLs (consistent with the analytics no-PII-in-links decision).
3. ✅ **Audience snapshot — `contactId`s only (no PII) — DECIDED.** The snapshot stores **only `contactId`s**;
   contact data + merge fields are **resolved live at dispatch**, so edits before sending apply (**UI must
   make users aware**). Erasure of the *snapshot* is moot (no PII in it). See **Sent-content record** for
   content erasure. (See Audience & segmentation → Freeze semantics.)
4. ✅ **Sent-content record — saved with campaign + contact — DECIDED.** The exact rendered message (per
   recipient/variant, with the opt-out language) is the **TCPA/CAN-SPAM proof**, **stored in S3** keyed by
   campaign+contact+message. **GDPR forget wipes the body** → *"Purged for GDPR forget-me request on `<DATE>`"*,
   keeping the mapping. (See Sent-content record.)
5. ✅ **AI message-tailoring guardrails — DECIDED.** **No PII/PHI to the model** (opaque inputs / Bedrock
   no-retention), AI output **screened (SHAFT/prohibited)**, and **all AI-created content requires human
   approval before send** — AI never auto-sends. (See Definition & content → AI-assisted content.)
6. ✅ **Tamper-evident audit — DECIDED.** All campaign audit (change + lifecycle + approvals) is **hashed,
   append-only, verify-on-read** — the [auth pattern](../auth/specs/SPECS.md). (See Audit.)
7. ✅ **Message-content localization — DECIDED.** **Per-message, per-channel language variants**; a campaign
   supports **1..N of the account's languages**; the **contact's `primary`→`secondary` language selects the
   variant**, and **no match ⇒ not sent** (skipped + surfaced in reachability; optional per-campaign fallback).
   Manual + machine-assist (human-reviewed) translation. **Depends on `primary`/`secondary` language fields on
   the contact** (contact service). (See Definition & content.)
8. ✅ **Collaborative authoring — DECIDED (Google-Docs model).** Starts single-author; owner **invites account
   users** as **edit / comment / view**, with **real-time co-editing via the [collab](../collab/SPECS.md)
   service** (CRDT merges — supersedes the draft-lock for concurrent edits) + **threaded comments**.
   Resource-level role **capped by the account `Access` role**; cross-account via an auth grant; **lifecycle
   locks still freeze content at `submitted`/`in_review`**; audited. (See Reuse & collaboration.)
9. ✅ **Suppression / consent home — DECIDED: a shared `canSend()` gate on the Application base.** Every
   service + job calls **one** pre-send gate (like the RBAC `Access` check / entitlements gate) that
   **composes** per-contact suppression (contact) + account block-list (account) + global frequency cap +
   quiet-hours + SHAFT — so **no caller can forget a check**. **Mechanism TBD** (frequency counters likely
   Redis; base-method-backed-by-library vs a dedicated `compliance` service). See
   [@repo/services → canSend](../../../packages/services/README.md).
10. ✅ **Approvals — DECIDED.** `0..N` required approvals is an **app/account setting**; **self-approval
    allowed by default** (maker-checker is opt-in to forbid it); approvals come from **distinct users**, each
    recording **approver + decision + comments + date/time**. (See Approvals.)
11. ✅ **Winner auto-promotion — DECIDED.** Opt-in auto-promote (**manual-confirm default**). **Winner is
    determined when the min sample size *and* significance threshold are met within a measurement window** on
    the test slice; if the window elapses without a clear winner, the **max-wait timeout** promotes the
    current **leader** (or a designated **default variant** if inconclusive). **Config: account default +
    per-campaign override** (which guardrail values are account-fixed vs campaign-tunable is a build detail).
    (See A/B / multivariate & holdout.)
12. ✅ **HIPAA / PHI — DECIDED: no PHI.** The platform **does not support PHI** (no BAA); sending PHI /
    regulated health data is **prohibited by the AUP/Terms** and gated by a **one-time account
    acknowledgment** (not a per-save warning) — see [account → Acceptable use & PHI](../account/specs/SPECS.md).
    HIPAA column stays ➖ (mappings shown for reference). Revisit only if a HIPAA-enabled tier is pursued.

# Endpoints (first cut)

A first pass at the endpoint surface, in [`@repo/endpoint`](../../../packages/endpoint/SPECS.md) style — all
service-prefixed **`/campaign/*`**; lists return the `{ data, page }` envelope with query-string filters; reads
are **RBAC-scoped + tenant-isolated**. *(A `campaign-*` requirements register is a future addition — the
**Spec §** column references the section above until then.)*

**Access column:** recommended **`minAccess`** — **`-`** = public · **`SENDER`<`USER`<`BILLING`<`ACCOUNT`** ·
**`SUPPORT`<`APPLICATION`<`ROOT`** · **`⬆`** = step-up · **`Internal`** = S2S. Within a campaign, edit/comment/
view is **also** gated by the per-resource **collaborator role** (capped by the account role).

> **No public endpoints.** **Lifecycle transitions are RBAC-gated + each emits an `AuditEvent`.** **`launch`
> is the delegable `send` action** — cross-account "send on behalf" rides an [auth grant](../auth/specs/SPECS.md)
> (acts-as-self). **Real-time co-editing** is the [collab](../collab/SPECS.md) service's WebSocket channel, not
> REST. **Run outcomes** (delivered/clicked/…) arrive **via Kafka** from dispatch/analytics — not a REST intake.
> Every send is gated by the shared [`canSend()`](../../../packages/services/README.md) compliance check.

### Campaign CRUD, templates & versioning
| Method | URI | Purpose | Access | Spec § |
|---|---|---|---|---|
| GET | `/campaign` | List campaigns (status / channel / owner filters) | USER | Core / Lifecycle |
| POST | `/campaign` | Create a campaign (draft) | USER | Definition & content |
| GET | `/campaign/{id}` | Get a campaign (definition + content) | USER | Core concepts |
| PATCH | `/campaign/{id}` | Edit definition / content (draft; locked once submitted) | USER | Definition & content |
| DELETE | `/campaign/{id}` | **Archive** (terminal, never hard-deleted) | USER | Lifecycle |
| POST | `/campaign/{id}/clone` | Clone / duplicate | USER | Reuse & collaboration |
| GET | `/campaign/{id}/versions` | Definition version history | USER | Reuse & collaboration |
| GET | `/campaign/templates` | List saved templates | USER | Reuse & collaboration |
| POST | `/campaign/{id}/template` | Save the definition as a reusable template | USER | Reuse & collaboration |
| POST | `/campaign/templates/{templateId}/use` | Create a campaign from a template | USER | Reuse & collaboration |

### Content, variants, audience & preview
| Method | URI | Purpose | Access | Spec § |
|---|---|---|---|---|
| PUT | `/campaign/{id}/content` | Set content per **channel × language × A/B variant** (merge fields) | USER | Definition & content |
| GET | `/campaign/{id}/preview` | Preview per channel/language/variant (+ SMS segment count) | USER | Definition & content |
| POST | `/campaign/{id}/test-send` | Test-send to self / a test subset | USER | Definition & content |
| GET, PUT | `/campaign/{id}/audience` | Get/set segment ref + sub-segment filters, holdout, test subset | USER | Audience & segmentation |
| GET | `/campaign/{id}/reachability` | Reachability estimate (valid address + consent + **supported language**; skipped-by-language breakout) | USER | Audience & segmentation |
| GET | `/campaign/{id}/cost-estimate` | Cost preview (recipients × channels × rate, incl. SMS segments) | USER | Cost, limits & entitlements |

### Collaboration (Google-Docs model) & comments
| Method | URI | Purpose | Access | Spec § |
|---|---|---|---|---|
| GET | `/campaign/{id}/collaborators` | List collaborators + roles | USER | Reuse & collaboration |
| POST | `/campaign/{id}/collaborators` | Invite a user — **edit / comment / view** (capped by their account role) | USER | Reuse & collaboration |
| PATCH | `/campaign/{id}/collaborators/{userId}` | Change a collaborator's role | USER | Reuse & collaboration |
| DELETE | `/campaign/{id}/collaborators/{userId}` | Remove a collaborator | USER | Reuse & collaboration |
| GET | `/campaign/{id}/comments` | List comment threads | USER | Reuse & collaboration |
| POST | `/campaign/{id}/comments` | Add a comment | USER | Reuse & collaboration |
| POST | `/campaign/{id}/comments/{commentId}/resolve` | Resolve / reply | USER | Reuse & collaboration |

### Approvals & lifecycle  *(RBAC-gated; each emits an `AuditEvent`)*
| Method | URI | Purpose | Access | Spec § |
|---|---|---|---|---|
| POST | `/campaign/{id}/submit` | Submit for review (`draft → in_review`) | USER | Approvals |
| POST | `/campaign/{id}/approve` | Record an approval (**distinct user** + comments) | USER | Approvals |
| POST | `/campaign/{id}/reject` | Reject / changes-requested (with reason) | USER | Approvals |
| GET | `/campaign/{id}/approvals` | Approval records (approver / decision / comments / time) | USER | Approvals |
| POST | `/campaign/{id}/schedule` | Schedule with a send window (`approved → scheduled`) | USER | Scheduling & pacing |
| POST | `/campaign/{id}/launch` | **Send now** (`approved → sending`) — the delegable **`send`** action | USER | Cross-account sharing |
| POST | `/campaign/{id}/pause` | Pause mid-send | USER | Lifecycle |
| POST | `/campaign/{id}/resume` | Resume | USER | Lifecycle |
| POST | `/campaign/{id}/cancel` | Cancel (non-terminal → `canceled`) | USER | Lifecycle |
| POST | `/campaign/{id}/archive` | Archive (terminal, read-only) | USER | Lifecycle |

### A/B winner
| Method | URI | Purpose | Access | Spec § |
|---|---|---|---|---|
| GET | `/campaign/{id}/ab/results` | A/B test results (per-variant success metric) | USER | A/B / multivariate |
| POST | `/campaign/{id}/ab/promote` | Manually promote the winner to the remaining audience | USER | A/B / multivariate |

### Runs, metrics & sent-content
| Method | URI | Purpose | Access | Spec § |
|---|---|---|---|---|
| GET | `/campaign/{id}/runs` | List runs | USER | Execution & reliability |
| GET | `/campaign/{id}/runs/{runId}` | Run detail (per-recipient / per-channel state) | USER | Execution & reliability |
| GET | `/campaign/{id}/runs/{runId}/progress` | Live progress (queued / sent / failed) | USER | Metrics & reporting |
| GET | `/campaign/{id}/metrics` | Aggregated metrics (delivered/clicks/opt-outs/…, via analytics) | USER | Metrics & reporting |
| GET | `/campaign/{id}/runs/{runId}/sent/{contactId}` | The **sent-content** compliance record (what went out; GDPR-tombstoned if forgotten) | USER | Sent-content record |

### Internal / ops
| Method | URI | Purpose | Access | Spec § |
|---|---|---|---|---|
| GET | `/campaign/config` | Read the service's own runtime config (AppConfig-backed) | ROOT | — |
| PUT | `/campaign/config` | Update service runtime config → reconfigure-without-restart; audited | ROOT ⬆ | — |
| GET | `/campaign/health` | Liveness / readiness (read-only smoke) | Internal | — |
