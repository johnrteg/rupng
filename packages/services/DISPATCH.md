#
# Dispatch — the `WorkQueue` governor (design)
#

> **Design doc for the [`WorkQueue`](README.md) dispatch governor in `@repo/services`** — the fair-share +
> rate-limit mechanism **composed as a member** by channels (not a base class). This is **not** a standalone
> service spec: the former `apps/core/dispatch` app was **retired** — the *mechanism* is a library, and the thin
> *cross-cutting coordinator* (cross-account priority + the send-window reservation / CS "tetris" view) is
> described under *Service & Consumer topology* below. Sibling to [DATABASE.md](DATABASE.md).

Objective: Since AWS SQS is a `blind` queue in that there is not a way to query the queue and find out information about what is in the queue (e.g. account id), to layer a database before SQS to keep track of pending, in process and completed items in the queue and use that database to govern what gets sent onto the queue for downstream processing at regualr intervals (TBD).  Wanting to avoid where one account may dominate the backlog of the queue and block newer items from getting thru.  For example, account A palces 100,000 messages to be emailed out.  Account B then places 10 messages to be emailed out.  It could be a substaintial amount of time before account B's messages are sent.  Want to have some fairness on the distribution of messages that SQS alone cannot manage.

# DECIDED: the governor is a `@repo/services` library (`WorkQueue`), composed as a member

The fairness/rate machinery — **per-account fair-share (WFQ/DRR) + per-downstream rate limiting (token bucket)** —
is the reusable mechanism the platform uses **everywhere**, so it lives in
**[`@repo/services` → `WorkQueue`](README.md)**, **composed as a member**
(`this.workQueue = new WorkQueue(cloud, "<channel>", rules)`) — **not a base class**, and **not** a central
service every message routes through for routine pacing. Dispatching is **channel-specific**: each channel
configures its own `WorkQueue.Rules` (limits, weights, batch size) and the governor self-governs its Redis
metrics. The long-running **coordinator** that drives a `WorkQueue` is a **`Consumer`** (self-driven, event- +
timer-woken). A standalone **`dispatch` service shrinks** to the genuinely **cross-account / cross-channel** role
— global account priority, the **send-window reservation + CS "tetris" operator view**, cross-channel
observability — using the same library. See *Service & Consumer topology* + gap #10.

From Claude:
* Single active dispatcher (leader election) — simplest; the dispatch decision is rarely the bottleneck (the Lambdas are), so one instance is usually plenty.
* The central dispatcher pulling from a governed DB is the one that matches your stated objective (fairness + control). Combine it with a small fixed set of priority queues (e.g. email/standard, email/application, or gold/silver/bronze) that workers poll in a weighted ratio. That gives you fairness via the dispatcher and coarse priority isolation via a handful of queues.
* `Durable job store` (lifecycle: pending/processing/complete, must survive restarts) → DynamoDB.
* `Rate/window counters` (per-account per-minute bins, TTL) → Redis (atomic INCR, auto-expiry).
* Dynamo is key/GSI access, not a ranked multi-dimensional query engine. You'll likely pull candidates via a GSI (partition queue#status, sort priority#time) and then do the fairness selection in app code. Prototype this access pattern early — it's the thing most likely to force a redesign. Redis sorted sets (score = fairness/virtual-time, ZPOPMIN) may model the "who's next" decision more naturally than Dynamo.
* Two datastores = two failure modes + consistency between them. Worth a hard look at whether `Redis-alone` (sorted set as the queue + counters) or Dynamo-alone (TTL + atomic counters) could cut it, to reduce moving parts.

# Model
* "dispatch whoever has the least frequent recent send rate" — that's `Weighted Fair Queuing / Deficit Round Robin` reinvented. Adopting one explicitly buys you a well-understood model: give each account a virtual finish time (or DRR deficit counter) scaled by its priority weight, and always dispatch the smallest. Pair it with a token bucket per account for the hard rate limits (100/min etc.). That's cleaner and more predictable than ad-hoc "least frequent."

# Redis
* maintaining 1m/5m/1h/1d counters and decrementing the windows as bins expire — that's a genuine consistency hazard (you flagged it yourself). Avoid it: `keep only per-minute bins with TTL`, and compute each window on read by summing the relevant bins (pipelined, cheap). Don't try to keep synchronized rolling totals. Simpler mental model, no expiry-decrement bugs.

# SQS
* Put a job-id pointer in the SQS message, not the payload. Sidesteps the 256KB limit and keeps your DB the source of truth (you're already storing metadata there). Worker reads the job from the DB by id.
* `Don't trust ApproximateNumberOfMessages` for "only add if backlog < threshold" — it's eventually consistent and approximate. Since you're the one dispatching, track in-flight counts yourself (you already are, in the counters).
* Wire `SQS DLQ → failed status`, and handle the crash-after-push-before-mark case with the lease/idempotency key so you don't double-send.


# Triggers
* Work arrived — a new item landed in the governor DB. Easy to make event-driven.
* Capacity freed — a worker finished, queue drained, or a rate window rolled over / token refilled. This one is partly time-based ("max 100/min" only resolves over time), so you can't be 100% event-based.

1) Credit-based:
Instead of "how often do I push," flip it to "push exactly as fast as workers consume." Keep SQS deliberately shallow (near a low-water-mark). Each worker completion emits a "capacity freed" signal that returns a credit and wakes the dispatcher to refill. Pace then equals consumption rate automatically — no interval to tune. This is the cleanest event-driven model: demand-driven flow control. Signals can be an `EventBridge` event from the Lambda, or simply the worker decrementing an in-flight counter that the dispatcher watches (via `Redis`).

2) Event-driven activation on new work — but coalesced:
Use DynamoDB Streams (or CDC) so an insert of a pending item triggers a dispatch evaluation. The critical caveat: don't dispatch per item. Account A inserting 100k rows must not fire 100k evaluations or 100k sends — that defeats batching, fairness, and hammers the DB. So the event sets a dirty flag / schedules one coalesced evaluation after a short debounce (250ms–1s); all events in that window collapse into a single round. Event-driven responsiveness, batch-sized work.

3) Decouple trigger from rate with a token bucket
Whatever wakes the dispatcher, the amount allowed is governed by a token bucket per account+queue (refills at the rate limit, e.g. 100/min). Triggers can fire as often as they like; the bucket says "you may send K right now." Refill is time-based but lazily computed on read (tokens = min(cap, last + elapsed·rate)) — no timer needed. This is what lets you be aggressive on event triggers without violating limits.

4) Self-scheduled precise wake-ups (this is what kills blind polling)
When the dispatcher is blocked by time (every account is at its rate limit, or the queue is full), don't poll every 5s hoping. Instead compute the earliest moment anything could change — next token refill, next rate-window rollover, next lease expiry — and schedule exactly one wake-up then:
* EventBridge Scheduler one-off (at(T)), or
* a delayed SQS "control" message: the dispatcher is itself an SQS consumer; after a round it enqueues its own next control message with DelaySeconds = computed backoff. The timer becomes an event, and the dispatcher reacts only to events while pacing itself.

#
# Recommendation
#
A hybrid: events activate, time is precise, a sweep is the backstop.

* Single long-running coordinator (your Service), woken by:
** `DynamoDB Stream events` (new work) → coalesced into one evaluation,
** worker-completion / credit events (freed capacity),
** its own self-scheduled wake-up (delayed control message or EventBridge one-off) computed from the next token refill.
* Token buckets per account+queue as the rate governor (lazily refilled).
* Single-flight guard so a round never overlaps itself.
* A low-frequency safety sweep (every 1–5 min via EventBridge) to catch missed stream events, stuck processing leases, and clock drift — event systems always need this belt-and-suspenders.

[ producer ] -> sqs -> [ dispatch drainer ] -> [ ddb / redis ] -> [ dispatcher ] -> sqs -> [ consumer ]

By Type:
[ email-dispatcher ] [ sms-dispatcher ] [ webhook-dispatcher ]

Use SQS MessageGroupId = AccountId for interleaving messages.  In a FIFO queue, one message group would not block another message group.


# ==============================================================================================
* Dynamo DB or Redis
* Store: job type (queue) (email, image, webhook, report, sms, etc), accountId, priority, status (pending, processing, suspended, complete, failed), createdTime, lastUpdate, completeTime, metaData based on type, errors, stats.
* Service polls on an interval (config).  Scale out based on the number of items in the DB queue. Query DB for status=pending and accountId != suspended and based on priority and account weighting. 
* Pull a configurable count and place them on the appropriate queues for processing.
* Jobs (Lambda) consume the item in the queue.
* Separate, priority queues that are account specific to those that are application specific so import items like password reset and alike can get out in parallel to account level items.
** /email/standard
** /email/application

# The count to place in the queue each time is based upon:
* *Maximum number of jobs per worker consumption
* SQS throughput
* Per account rate limits and priority (max 100 jobs per minute per account)
* Config batch size per type
* Query SQS queue depth and only add to queue if backlog is below some threshold.
* Note, SQS has a max message size of 256KB per message and retention period of 14 days.
* Ideally, when an item is added to the queue, we track the queue, account id, and time so we can build a profile of the distribution of items added by an account, to a queue over some period of time (1 day). Each bin of counts could be of intervals of 1 minute. We discussed that adding this to redis might be possible where the key would be queue+account id+bin and the value would be the count. Then when we query the dispatch db, we can get a count of all the pending accounts, determine and send based on who has the least frequent send rate to allow those accounts fair access to the queue.

* Key: queue:{queueId}:account:{accountId}:bin:{minuteBin}
`Example: queue:email:account:123:bin:20260527T1532`
* Value: Integer count (number of items added in that minute bin)

* Operation:
When an item is added: INCR the key for the current minute bin.
Set an expiry (e.g., 2 days) so old bins are auto-removed.

* Look into rolling sums per bin vs incremental count
* Keep count for bin size (e.g. 1 minutes) increment
* Increment the other windows (5 minutes, 1 hour, 1 day, etc)
* As a bin expires (old), remove that count to each of the windows.
* No a distribution, but just a total count per window

# Query: for a particular message type, how would I query based on these variables
* Message/queue type
* Message priority (0-10), 0 being message is suspended
* Number of Messages pending per account
* Account priority (0-10), 0 being suspended.
* Message type/queue depth and config limit (1000 max, current 750, no more than 250 more)
* Account limits per message type (per minutes, per 5 minutes, per hour, per day) and knowing the counts for each type for each account for the last minute, 5 minutes, hour and day.
What other metrics might need to be tracked? 1 Minutes, 5 Minutes, 1 hour, Consumption rate per message type?
* May want to suspend all account A email messages, but leave sms traffic alone.
* May want to unsuspend email messages in blocks.

# Fair Queues
* How to manage queues where one account may dominate the backlog and not allow smaller campaigns thru.
* Multiple queues by account and priority.
* Different queue per account and priority: queue-account-a, queue-account-b, queue-gold, queue-silver, queue-bronze
* Jobs pull from queues in a round robin or weighted fashion, poll based on queue ratio (5:2:1) for (gold:silver:bronze).
* No single account monopolizes the system
* Pro: simple, effective, easy scale
* Con: More infrastructure, more queue management
* Central dispatcher
* Central dispatcher that pulls messages from a shared database and dispatches based on a round-robing, weighted by account and/or priority.
* Pro: Maximum control, custom logic
* More complex, single point of control

# Service & Consumer topology

**Dispatch is a *pattern*, not one deployed thing every message routes through** — three layers:

| Layer | What | Where / shape |
|---|---|---|
| **Governor (mechanism)** | **`WorkQueue`** — WFQ/DRR fair-share + token-bucket rate limit + per-minute Redis bins + governed DDB job-store + backpressure | **[`@repo/services`](README.md)** library, **composed as a member** by any Service / Consumer / Job |
| **Coordinator (the loop)** | the control loop — woken by DDB-Stream events + worker-credit + self-scheduled wake-ups; single-flight; meters job-id pointers to SQS | a **`Consumer`** (self-driven), **per-channel** — each channel runs/embeds its own, using the governor |
| **Cross-cutting service (thin)** | cross-account / cross-channel fairness, **global account priority (1–5)**, the **send-window reservation + CS "tetris" operator view**, cross-channel observability | a thin **dispatch** deployable (`Consumer` + small API), using the same governor |

```
producer → [ channel send Consumer: workQueue.admit() + workQueue.dispatch() ] → SQS → [ worker Job ] → consumer
                                     ↑ per-channel WorkQueue.Rules + self-governed Redis metrics
cross-cutting only → [ dispatch Consumer + operator/tetris API ]   — global account priority · send-window reservation
```

* **Intra-channel** pacing (fair-share across accounts on a channel's queue; rate-limit *out* to its provider) is
  **just the library** — no hop, channel-specific rules, **opt-in** (transactional / one-off sends bypass, #15).
* **Cross-account / cross-channel** governance (an account's global priority spanning channels; the CS tetris
  board; send-window reservation) is the **one part that needs a center** → the thin dispatch service.
* **`Job` vs `Consumer`:** the per-event SQS **workers stay `Job`s** (Lambda); the **coordinator that paces them
  is a `Consumer`** (long-running, self-scheduled) — dispatch is `Consumer`'s second canonical user after
  [realtime](../../apps/core/realtime/SPECS.md). **Compliance stays the channel's** (`canSend()`); the governor does only
  fairness / rate / priority / order.

# AWS Services and Other Dependencies

**AWS services**
* **SQS** (+ **DLQ**) — the downstream work queues; the dispatcher is itself an SQS consumer (delayed control messages).
* **DynamoDB** (+ **Streams**) — the durable job store (pending / processing / complete).
* **Redis (ElastiCache)** — per-account rate/window counters (per-minute bins) + the fairness sorted set.
* **EventBridge (Scheduler)** — self-scheduled wake-ups + the low-frequency safety sweep.
* **Lambda** — the job-worker consumers.

**Third-party libraries / services** — none.

**Internal (`@repo/*`)**
* `@repo/services` (`WorkQueue`, Sqs, Dynamo, Cache) — and dispatch is itself slated to **become / merge into** a `@repo` library (gap #10).

# Compliance & standards mapping

How **this dispatch service's** controls map to **OWASP Top 10 (2021)**, **ISO/IEC 27001:2022** (Annex A),
**SOC 2 Type 2** (TSC), **HIPAA** (if PHI), **GDPR**, **CCPA/CPRA**, and **messaging law** (TCPA / CAN-SPAM —
rate, quiet-hours, suppression, no-duplicate). Clause refs are **indicative**; this is a **design-intent**
self-assessment (certification is operating-effectiveness over time + an ISMS — beyond a spec). Dispatch is
**internal infrastructure** (no direct end-user surface) — its compliance value is **deliverability fairness
(anti-monopolization)** and **no-PII-in-the-queue** (the **send-compliance gate itself is the channel's**, not
dispatch's). There is **no PCI**
surface (no payment data); **HIPAA** is ➖ (queue carries job-id pointers, no content/PHI). Identity/RBAC live
in [auth](../../apps/core/auth/specs/SPECS.md); encryption/residency per the platform
[AWS topology](src/aws/SPECS.md).

**Legend:** ✅ meets/exceeds · ⚠️ partial / open — see Gaps · ➖ n/a

| Dispatch control | OWASP T10 | ISO 27001:2022 | SOC 2 (TSC) | HIPAA (if PHI) | GDPR | CCPA | Messaging | |
|---|---|---|---|---|---|---|---|---|
| **Fair-queuing / anti-monopolization** — WFQ/DRR + token bucket; no account starves others (DoS-resistance) | A04 (insecure design) | A.8.6 / A.8.20 | CC7.2 / A1.2 | ➖ | ➖ | ➖ | ➖ | ✅ |
| **Per-account rate limits** — token bucket, hard caps (e.g. 100/min); carrier/provider ceilings | A04 | A.8.6 | CC6.6 / CC7.2 | ➖ | ➖ | ➖ | TCPA / carrier | ✅ |
| **Send-compliance gate — owned by the channel, *not* dispatch** — the channel decides `canSend()` (suppression / consent / quiet-hours / block-list) at send; dispatch governs only fairness / rate / order | A04 | A.5.34 | (Privacy) | ➖ | Art 21 | §1798.120 | TCPA / CAN-SPAM | ✅ delegated to channel |
| **No PII in the queue** — SQS carries a **job-id pointer**, not the payload; the DB is system-of-record | A04 / A09 | A.8.11 | CC6.1 | ➖ | Art 5(1)(c) / 32 | §1798.100 | ➖ | ✅ |
| **Idempotency / no double-send** — lease + idempotency key; crash-after-push handled; DLQ → `failed` | A04 / A08 | A.8.24 / A.8.16 | CC7.1 / CC7.2 | ➖ | ➖ | ➖ | CAN-SPAM (no dup) | ✅ |
| **Account / type suspension** — priority `0` suspends per account **per channel** (compliance hold / abuse); unsuspend in blocks | A01 | A.8.7 | CC7.2 | ➖ | ➖ | ➖ | ➖ | ✅ |
| **Application-priority isolation** — security mail (password reset) on a separate priority queue, never blocked by account bulk | A07 | A.8.6 | A1.2 | ➖ | ➖ | ➖ | ➖ | ✅ |
| **Tenant isolation** — per-account governance; FIFO `MessageGroupId = accountId` interleave; A's backlog can't block/read B | A01 | A.8.3 | CC6.1 | ➖ | Art 32 | ➖ | ➖ | ✅ |
| **Audit of dispatch actions** — suspensions, manual holds, priority/weight changes (who/when) | A09 | A.8.15 | CC7.2 | ➖ | ➖ | ➖ | ➖ | ✅ |
| **Encryption** — in transit + at rest (DynamoDB / Redis / SQS SSE-KMS) | A02 | A.8.24 | CC6.1 | ➖ | Art 32 | ➖ | ➖ | ✅ |
| **Reliability** — DLQ → `failed`, stuck-lease recovery, low-frequency safety sweep (availability) | A04 | A.8.16 / A.5.30 | A1.2 / CC7.x | ➖ | ➖ | ➖ | ➖ | ✅ |

# Gaps & decisions

*The one review list — design notes above are the rationale; this is what's settled vs open.* ✅ = resolved/decided · ⚠️ = **open — needs attention**.

1. ✅ **Fairness model — DECIDED: Weighted Fair Queuing / DRR + token bucket.** Each account gets a **virtual
   finish time / DRR deficit** scaled by its priority weight; always dispatch the smallest. A **per-account +
   queue token bucket** (lazily refilled) enforces the hard rate caps (100/min). Cleaner than ad-hoc "least
   frequent."
2. ✅ **Coordinator & triggers — DECIDED: hybrid.** A **single long-running coordinator** (leader-elected),
   woken by **DynamoDB-Stream events** (coalesced/debounced — never per-item), **worker-completion credit**
   events (freed capacity), and **self-scheduled precise wake-ups** (delayed control message / EventBridge
   one-off at the next token refill). **Single-flight guard**; a **1–5 min safety sweep** backstops missed
   events / stuck leases.
3. ✅ **Window counters — DECIDED: per-minute bins + sum-on-read.** Keep **only per-minute bins with TTL**;
   compute 5m / 1h / 1d **on read** by summing bins (pipelined). **No** synchronized rolling totals (avoids the
   expiry-decrement consistency bug).
4. ✅ **SQS message — DECIDED: job-id pointer, not payload.** Sidesteps the 256 KB limit; the DB stays
   system-of-record; the worker reads the job by id.
5. ✅ **Backlog gating — DECIDED: track in-flight ourselves.** Don't trust `ApproximateNumberOfMessages`
   (eventually consistent); the dispatcher already holds the counters.
6. ✅ **Idempotency — DECIDED: lease + idempotency key; DLQ → `failed`.** Handles crash-after-push-before-mark
   so a job is never double-sent.
7. ✅ **Suspension model — DECIDED.** Priority `0–10` (`0` = suspended) **per account *and* per message/type**
   — suspend an account's **email** while leaving **SMS** flowing; **unsuspend in blocks**.
8. ⚠️ **Datastore — Redis-alone vs DynamoDB-alone vs both.** DDB = durable job store (lifecycle survives
   restart); Redis = atomic counters + a sorted-set "who's-next". **Two stores = a consistency hazard** — hard
   look at whether one suffices. **Prototype the GSI access pattern early** (`PK queue#status` / `SK
   priority#time` + app-side fairness selection) — it's the thing most likely to force a redesign.
9. ⚠️ **Queue topology.** A **small fixed set of priority queues** (gold/silver/bronze; `/email/standard` vs
   `/email/application`) polled in a **weighted ratio** + **FIFO `MessageGroupId = accountId`** for interleave,
   **vs** many per-account queues (more infra). Leaning the fixed-priority-set + dispatcher fairness; finalize.
10. ✅ **DECIDED: governor = `@repo/services` `WorkQueue` library (member); dispatch service shrinks.** The
    fairness/rate machinery now lives in **[`@repo/services` `WorkQueue`](README.md)**,
    **composed as a member** by each channel (it configures `WorkQueue.Rules` + self-governs its Redis metrics) —
    **not** a base class, **not** a central service routine pacing routes through. The **coordinator is a
    `Consumer`**; the **channel** still owns send-eligibility (#12); fair-share is **opt-in per channel** (#15). A
    standalone **dispatch service shrinks** to the cross-account / cross-channel role only (*Service & Consumer
    topology*). **Remaining (migration, tracked):** retire the deployed dispatch CDK app where channels now
    self-govern via the library, and extract the thin cross-cutting coordinator — a code move + deploy-topology
    change (`cloud/src/app.ts`, root `tsconfig.json` ref, `package-lock.json`), settled separately.
11. ⚠️ **Per-channel rules.** Dispatch is **channel-specific** (email / sms / webhook / report / image); each
    may need unique governance (limits, batch size, provider ceilings). Define the per-channel rule set.
12. ✅ **Pre-send compliance enforcement — DECIDED: the channel owns it.** The **channel** (its send worker /
    dispatcher) decides **`canSend()`** — suppression / consent / quiet-hours / account block-list — at send
    time. **Dispatch does *not* enforce compliance**; it governs only **fairness, rate, priority, and
    ordering**. (Ties to the [`Application` `canSend()`](src/Application.ts)
    primitive, which the **channel** invokes — dispatch is the *foundation* beneath each channel dispatcher; see #10.)
13. ⚠️ **Leader election + scale-out.** A **single coordinator** decides (leader-elected — Redis lock / DDB lock
    / single ECS task — pick one); **workers (Lambda) scale** on DB depth. Confirm the mechanism.
14. ⚠️ **Pacing specifics.** Low-water-mark for "keep SQS shallow", **per-type batch sizes**, and the
    credit-refill rate — the "poll interval (TBD)" resolves into credit-based + self-scheduled wake-ups (#2),
    but the constants need tuning.
15. ✅ **Uniform fair-share metrics, opt-in per channel — DECIDED.** Fairness is measured the **same way across
    channels** — one **uniform metric model** (per-account virtual-finish-time / DRR deficit + the per-minute
    bin counters of #3), so any adopting channel computes "who's next" identically. **But not every channel
    needs fair share** — high-volume **bulk** channels (email, SMS) opt in; **low-volume / transactional /
    one-off** channels (e.g. a single webhook, a password-reset send) can **bypass the governor** entirely. The
    library is **adopted per channel**, never mandatory.

