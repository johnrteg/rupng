#
# Campaign Service
#

# Objective

The place an account composes, approves, schedules and launches an outbound
**campaign** — a one-shot or scheduled send to a defined audience across one or more
channels (Texting, Email, …).

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
| Suppression list, opt-out/STOP, global frequency cap | **compliance** (or contact) |
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
* **Variant** — a message version for A/B/multivariate testing (content per channel).
* **Audience** — a reference to a segment (+ optional sub-segment filters) plus the
  **materialized recipient snapshot** captured when a run starts.
* **Approval** — a required sign-off record (approver, decision, reason, timestamp).
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
  archive-not-delete rule as segments and contacts).

# Requirements

## Definition & content
* Any number of campaigns per account, subject to plan limit.
* Name; campaign **objective** (feeds AI message tailoring).
* **Merge fields / templating** from contact attributes, with fallback values and
  validation that referenced fields exist.
* **Per-channel message variants** (SMS vs MMS vs Email differ in length/format).
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
* **Freeze semantics:** the segment *query* is fixed at schedule; the **recipient list
  is materialized when the run starts**, and **consent + suppression are re-evaluated
  per batch at dispatch time** (a contact who opted out after scheduling is suppressed).
* **Reachability estimate** before send: how many recipients have a valid phone/email
  *and* current consent.
* **Test subset**: a small group, in or out of the segment, reusable across campaigns.

## A/B / multivariate & holdout
* Define ≥2 **variants** with a split ratio (e.g. 20% A / 80% B); support >2.
* Declare a **success metric**; optional **auto-promote winner** to the remaining
  audience once a significance threshold is met.
* Optional **holdout/control group** (no send) for lift measurement — distinct from
  A/B variants.

## Approvals
* 0–N required approvers (other account users).
* Mode: **sequential** or **any N-of-M**; **rejection/changes-requested with reason**
  and resubmit.
* **Maker-checker**: configurable whether the creator may approve their own campaign.
* Approver eligibility gated by **`Access` role**; full **audit trail** (who/when/what),
  consistent with the audit pattern in the billing model.

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

## Cost, limits & entitlements
* **Cost estimate preview** before send (recipients × channels × per-message rate,
  incl. SMS segment count).
* **Budget cap / spend limit** per campaign (stop or alert when reached).
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
* The authorization primitive lives in **[auth → Cross-account delegation grants](../auth/SPECS.md)**
  (owner-issued, capped at the issuer's own level, windowed, revocable, admin-notified,
  audited, acts-as-self). Campaign just declares *what* is shareable and at what action
  granularity; auth decides *whether* a caller may.
* The grantee acts under **their own identity** — a send executed via a grant is audited
  as "*user X (acct A) sent on campaign B/123 via grant G*".

## Reuse & collaboration
* **Clone/duplicate**; **save-as-template**; campaign-definition **versioning**;
  **draft locking** to prevent concurrent-edit clobber. (Extends the reusable test-set
  idea to the whole definition.)

## Audit
* Immutable audit on every definition change and lifecycle transition: who, when, what,
  before/after — same `AuditEvent` shape used elsewhere.

# Open decisions

1. **Recurring/automation:** confirmed deferred to the workflow service — Campaign stays
   one-shot/scheduled. (Recorded here so it isn't re-litigated.)
2. **Suppression/consent home:** does the suppression list + global frequency cap live in
   **compliance** as its own service, or inside **contact**?
3. **Maker-checker default:** is self-approval allowed by default, or off unless a plan/
   account setting enables it?
4. **Winner auto-promotion:** manual confirm vs fully automatic once significant?
