#
# Report service
#

# Objective

Account-scoped **report generation, scheduling, and cataloging**: submit a report (ad-hoc or on a
recurring iCal schedule), generate it asynchronously, store the artifact(s) in S3, and let the
**account's workflow** route delivery. Reports are gated by role (`minAccess`), parameterized like
endpoints, versioned for long-lived schedules, and every submission is audited.

# Role & boundaries

* **report** (owns) — the report **catalog**, **submissions** + status, **scheduling**, generation
  orchestration, **artifact storage** (S3), and emitting the **`report.completed`** event.
* **workflow** (delegated) — **delivery / destination routing**. A completed report triggers an
  **account-defined workflow** (download-only, or fan-out to email / SFTP / storage / CRM). The report
  service does **not** hardcode destinations. See "Completion → delivery".
* **channel / dispatch + marketplace** (delegated) — the actual sends (email/SMS) and storage connectors
  (Dropbox, Google Drive, OneDrive, Box, SFTP, CRM) the workflow invokes, including per-account provider
  **failover**.
* **owning services / analytics** (data) — a report job pulls its data from the owning services or from
  **materialized views** (Athena + S3), never by reaching into another service's DB directly.

# Requirements

* Manage report generation; centralized **dashboard of available reports filtered by the caller's role**.
* Submissions enqueue to **SQS**; **Lambda/ECS** jobs pick them up and generate.
* Reports can be **one-time, scheduled (one-off at a time), or recurring** (iCal).
* A report job pulls needed data from other services / materialized views.
* Each report declares **0..N parameters** via a schema (like an endpoint) so the UI knows what to
  collect; a **common base interface** carries shared params (date range, format, etc.).
* Each report has a stable **`reportId`**; each execution a **`submissionId`**.
* Users can see a **list of their submissions** and **download** / **delete** them.
* Reports support **1+ formats**: CSV, PDF, Excel (xlsx), JSON.
* **All submissions are audited** — who, when, what (report + params + spec version), where (outputs +
  the delivery the workflow performed).
* **Version the report spec** — a long recurring schedule keeps generating against the spec version it
  was created with until migrated.
* On completion, **delivery is driven by the account's workflow** (download, email, SFTP, Dropbox,
  Google Drive, OneDrive, Box, CRM, …).

# Data model (DynamoDB)

Three entities. Submissions + their artifacts are **account-scoped**; the catalog may be global templates
surfaced per account.

### Report — the catalog entry (what can be run)
```
Report {
  reportId    : ID            // stable definition id (e.g. "delivery-summary")
  name        : string
  minAccess   : Access.AccountRole   // dashboard lists only reports ≤ the caller's role
  generator   : string        // which generator/handler builds it
  paramsSchema: Schema        // declared params (ajv) — the UI form; extends a shared base
  specVersion : number        // bumped on a breaking spec change (see Versioning)
  formats     : Array<Format> // formats this report can emit
  description? : string
  tags?       : Array<string>
  createdAt   : ISODateTime
}
```

### Submission — one execution (what produced an artifact)
```
Submission {
  accountId   : ID
  submissionId: ID
  reportId    : ID            // -> Report
  specVersion : number        // pinned at submit (matches the spec used)
  submittedBy : ID            // who
  createdAt   : ISODateTime   // when
  status      : "submitted" | "running" | "error" | "complete"
  params      : Json          // the inputs for THIS submission (incl. the DateWindow, if any)
  window?     : { start: ISODateTime; end: ISODateTime }   // RESOLVED date range this run covered
                              //   (a relative window is resolved to concrete dates at submit/fire time)
  formats     : Array<Format> // requested formats (1+)
  outputKeys? : Array<string> // S3 keys produced (one per format) — on complete
  size?       : number        // total bytes — on complete
  recordCount?: number        // rows/records — on complete
  startedAt?  : ISODateTime
  completedAt?: ISODateTime
  error?      : {             // populated when status=error
    reason     : string       // human-readable why (shown in the dashboard)
    code?      : string       // machine class (e.g. BAD_PARAMS, ACCESS_DENIED, SOURCE_UNAVAILABLE)
    permanent? : boolean      // true ⇒ will recur as-is (bad params / access) → auto-pause its schedule
  }
  scheduleId? : ID            // set when spawned by a Schedule; absent = ad-hoc
  tags?       : Array<string>
}
```
This is the **submission** you described — `reportId` ref, who/when, status, size, record count,
`createdAt`, tags — with the execution facts (`status`/`size`/`recordCount`/`outputKeys`) living here.

### Schedule — a recurring request (resolves the iCal question)
```
Schedule {
  accountId   : ID
  scheduleId  : ID
  reportId    : ID
  specVersion : number
  ical        : string        // RFC-5545 recurrence (e.g. weekly on Monday)
  timezone    : string        // IANA tz for evaluating the iCal AND resolving relative windows ("America/New_York")
  params      : Json          // includes a RELATIVE DateWindow for time-bounded reports (fixed dates are meaningless here)
  formats     : Array<Format>
  createdBy   : ID
  status      : "active" | "paused" | "auto_paused"   // paused = user; auto_paused = repeated/permanent failure
  consecutiveFailures   : number   // terminal submission failures in a row; reset to 0 on a success
  maxConsecutiveFailures: number   // auto-pause threshold for *transient* errors (a permanent error pauses at once)
  pausedReason? : string      // why (last error reason for auto_paused; user note for paused)
  pausedAt?     : ISODateTime
  pausedBy?     : ID | "system"   // userId (manual) or "system" (auto)
  tags?       : Array<string>
  createdAt   : ISODateTime
  lastFiredAt?: ISODateTime
  nextFireAt? : ISODateTime
}
```

> **Where the iCal lives — decided: on `Schedule`, not on `Submission`.** A schedule is a *standing
> definition*; each fire creates a **fresh Submission** (with `scheduleId` set). That keeps every
> Submission a single, immutable execution record with its own status/size/records/outputs — clean to
> list, audit, and store. Ad-hoc submissions simply have no `Schedule`. (Putting iCal on a Submission
> would conflate "the recurring request" with "one run" and muddy the status/size fields.)

`Format = "csv" | "pdf" | "xlsx" | "json"`.

# Date windows — relative vs. fixed

Most reports are time-bounded (pick a start, end, or both). This is the prime **shared base param**.
A **fixed** window is fine for a one-time run, but **meaningless on a schedule** — every fire would
re-pull the *same* frozen dates. So a time-bounded report's window is a tagged union:

```
DateWindow =
  | { kind: "fixed";    start?: ISODate; end?: ISODate }            // explicit; one-time runs
  | { kind: "relative"; preset: RelativePreset }                   // resolved at run time
  | { kind: "relative"; rolling: { amount: number; unit: Unit }; endOffsetDays?: number }   // e.g. last 7 days, ending yesterday

RelativePreset = LAST_7_DAYS | LAST_30_DAYS | LAST_90_DAYS
               | WEEK_TO_DATE | MONTH_TO_DATE | QUARTER_TO_DATE | YEAR_TO_DATE
               | THIS_WEEK | THIS_MONTH | THIS_QUARTER | THIS_YEAR
               | LAST_WEEK | LAST_MONTH | LAST_QUARTER | LAST_YEAR
Unit = "day" | "week" | "month" | "quarter" | "year"
```

* **One-time submissions** may use **fixed** *or* relative.
* **Scheduled submissions** must use **relative** — fixed dates are rejected (or warned) for a Schedule,
  since they don't move. (e.g. "last 7 days", "month-to-date", "this quarter".)
* **`endOffsetDays`** handles "**until N days ago**" — e.g. end at *yesterday* (`endOffsetDays: 1`) so a
  run doesn't include today's partial/incomplete data.

### Resolved at run time, then **stamped**
When a Submission is created — and **per Schedule fire** — the relative window is **resolved to concrete
`{ start, end }` at that moment** and written to **`Submission.window`**. The generator queries those
absolute dates, and the artifact is **reproducible + auditable**: each run records exactly which range it
covered. (So Monday's run says `2026-06-01 → 2026-06-08`, the next Monday says `2026-06-08 → 2026-06-15`.)

### Timezone discipline (get this right — it's where reports break)

> This is the **platform-wide** convention for any scheduled time / window / quiet-hour — see root
> [SPECS.md → Time, scheduling & timezones](../../../SPECS.md). It's spelled out here (with the worked
> example) as the authoritative reference.

Scheduling bugs almost always trace to ambiguous time. The rules:

* **Store an explicit IANA zone** on the schedule (`America/New_York`) — **never** a bare local time, a
  fixed UTC offset, or "the viewer's timezone." The iCal fire time *and* the relative-window boundaries
  ("this month", "yesterday") are interpreted **in that zone**.
* **Compute in the zone → fire in UTC.** The scheduler converts the next local occurrence to a **UTC
  instant** (DST-correct, via the IANA zone) and fires on that instant. The **service's own timezone is
  irrelevant** — never use server-local time, never use the requester's browser tz, for computation.
* **Persist everything in UTC** (`Type.ISODateTime`, `…Z`). The zone is used only to (a) compute the
  instant and (b) **display**.
* **Always display the zone.** Show "**3:00 PM America/New_York (EDT)**", never a bare "3:00 PM" — so a
  user in California reads it as Eastern, not Pacific. (Your exact concern: 3PM EST ≠ 3PM PST.)
* **DST is automatic and intended.** "3 PM Eastern weekly" stays 3 PM *local* across the EST↔EDT switch;
  the **UTC instant shifts** (20:00Z in winter, 19:00Z in summer). That's *why* you store IANA-zone +
  local-time, not a fixed offset or a fixed UTC time — a fixed-UTC schedule would silently drift an hour
  twice a year. (A one-time relative run uses the submitter's / account-default zone, captured the same way.)

### Worked example — weekly Monday 6 AM Eastern, "last week"

```
Schedule: ical = FREQ=WEEKLY;BYDAY=MO;BYHOUR=6;BYMINUTE=0
          timezone = "America/New_York"
          window   = { kind: "relative", preset: LAST_WEEK }
```
* **Summer fire** — Mon 2026-06-08 **06:00 ET (EDT, UTC-4)** → fires at **10:00Z**.
  Resolved window (prev Mon 00:00 → this Mon 00:00, ET) → `Submission.window =
  { start: 2026-06-01T04:00:00Z, end: 2026-06-08T04:00:00Z }`.
* **Winter fire** — Mon 2026-01-05 **06:00 ET (EST, UTC-5)** → fires at **11:00Z** — *same 6 AM local,
  one hour later in UTC*. The schedule still displays "Mondays 6:00 AM America/New_York".

Fire time and window line up (the window ends at the run's week boundary, in the schedule's zone), every
run records its exact UTC range, and the user always sees the zone — so a 3PM-Eastern report never gets
misread as 3PM Pacific.

# Failure handling & auto-pause

A failed submission records a structured **`error.reason`** (+ `code`, `permanent`). For **scheduled**
reports, a failing run shouldn't keep firing into the same wall:

* **Permanent failure** (`error.permanent` — bad params, access denied, deleted source, spec gone):
  the schedule is **`auto_paused` immediately** (the next run would fail identically), `pausedReason` =
  the error reason, `pausedBy` = `"system"`.
* **Transient failure** (downstream blip, timeout): increment `consecutiveFailures`; **auto-pause when it
  reaches `maxConsecutiveFailures`** (so a one-off hiccup doesn't kill a weekly report, but a persistent
  problem stops the bleed). A **successful** run resets `consecutiveFailures` to `0`.
* **Notify the owner** on auto-pause (and ideally on the first failure) — `report.failed` /
  `report.schedule_paused` events the account workflow can route, so someone knows to investigate.
* **Manual pause/resume** — a user can `paused` a schedule anytime (`pausedBy` = userId). **Resuming**
  (manual or after fixing an auto-pause) sets `status=active` and clears `consecutiveFailures`.
* Only **`active`** schedules fire; `paused` / `auto_paused` are skipped by the scheduler until resumed.
* **Ad-hoc** submissions just terminate as `error` with a reason — no pause concept (there's nothing
  recurring to pause).

> Auto-pause is a **stop-loss**, not a fix: it halts wasted runs + error noise and surfaces the problem;
> the user fixes the cause (params/access/source) and resumes. Threshold default + whether to alert on the
> *first* failure vs only on pause are open decisions.

# Storage layout (S3)

```
acct/<accountId>/reports/<reportId>/<submissionId>.<ext>
```
Built via the typed `S3.Domain.REPORT` descriptor — see **[`packages/services/src/aws/SPECS.md`](../../../packages/services/src/aws/SPECS.md)** → S3 object keys.
Grouped by `reportId` (all of an account's submissions of a report together); each submission is its own
artifact, **one object per format** (`<submissionId>.csv`, `<submissionId>.pdf`, … — `Submission.outputKeys`
holds them). Private bucket; downloads via **presigned GET**. Lifecycle expiry by **object age** (reports
are regenerable) — no date in the key, the DB is the index.

# Architecture & flow

```
 submit (API) ─ validate params vs paramsSchema · check minAccess
   └─► write Submission (DDB, status=submitted)
        └─► EventBridge Scheduler ── enqueue now │ one-off at T │ recurring (Schedule iCal → new Submission per fire)
             └─► [report dispatcher] ─► SQS (+ DLQ)
                  └─► worker: Lambda (<15 min)  │  ECS/Fargate (long)
                       · pull data (services / Athena materialized views)
                       · generate artifact(s) → write to S3
                       · update Submission (running → complete; size, recordCount, outputKeys)
                       └─► publish  report.completed  (Kafka entity event)
                            └─► ACCOUNT WORKFLOW consumes ─► delivery (download / email / storage / CRM)
   on failure → status=error (+ error.reason); DLQ; if scheduled → pause policy (see Failure handling)
```

**Workers:** Lambda for "short" reports (< 15 min); ECS/Fargate for "long" ones. Submissions ride SQS
with a DLQ; fair-share per account can layer on (see WorkQueue) if one account's bulk runs would starve
others.

# Completion → delivery is workflow-driven (per account)

A completed report does **not** ship from the report service directly. Instead:

* On success the report service **publishes `report.completed`** — a Kafka entity event:
  `{ accountId, reportId, submissionId, outputKeys, formats, size, recordCount, submittedBy, tags }`.
* The **account's workflow** (configured in the workflow service) is **triggered by that event** and
  decides the destination(s): **download-only** (dashboard + optional notification), or fan-out to
  **email · SFTP · Dropbox · Google Drive · OneDrive · Box · CRM** via channel services + marketplace
  connectors. Different accounts route the same report differently — that's the point.
* So **delivery + per-account provider failover** (try provider N times → next provider → DLQ + notify
  on total failure) live in the **channel / dispatch** layer the workflow invokes, *not* in report. The
  delivery envelope model (`deliveryId`, `accountId`, `providerChain[]`, `payloadRef` = the S3 key,
  `destination`, per-attempt envelopes) belongs to that delivery layer.
* **Default** (account defines no workflow): the artifact is available for **download** in the dashboard
  plus a completion notification.

# Access control & audit

* **`minAccess`** (`Access.AccountRole`) per report — the dashboard surfaces only reports at/below the
  caller's role, and submit re-checks it.
* **Every submission is audited**: who (`submittedBy`), when (`createdAt`), what (`reportId` + `params` +
  `specVersion`), where (`outputKeys` + the workflow-performed delivery).

# Versioning

`specVersion` on the Report is pinned onto each Submission/Schedule at creation. A **long recurring
schedule keeps generating against its pinned version** even after the report's current spec moves on, so
output stays consistent until the schedule is deliberately migrated.

# Materialized views

Heavy reports shouldn't hammer operational DBs. Services can **export materialized views** to a reporting
store (**Athena + S3**); report jobs query those instead. (Refresh cadence is an open decision.)

# Services (AWS)

* **EventBridge Scheduler** — enqueue now, one-off at a time, or recurring (drives Schedule fires).
* **SQS + DLQ** — submission queue feeding the workers.
* **Lambda** (< 15 min) and **ECS/Fargate** (long-running) generators.
* **S3** — artifact output (private; presigned GET).
* **DynamoDB** — Report / Submission / Schedule, with **TTL** on transient submission state.
* **Athena + S3** — materialized views for report data.
* **Kafka** — the `report.completed` entity event the workflow consumes.

# Open decisions

1. **Catalog scope** — are Reports global templates entitled per account, or per-account definitions?
   (Leaning: global templates + per-account entitlement, with `minAccess` gating.)
2. **Submission retention** — DDB TTL on transient state vs. how long to keep the audit record; S3 expiry
   window per account.
3. **Multi-format output** — N sibling objects (current) vs. a single archive (zip) for multi-format runs.
4. **Default delivery** when an account has no workflow (download-only assumed).
5. **specVersion migration** — how/when a long schedule is moved to a newer spec.
6. **Materialized-view freshness** — refresh cadence + staleness tolerance per report.
7. **Fair-share** — do report submissions need the per-account WorkQueue, or is a single queue enough?
8. **Auto-pause tuning** — default `maxConsecutiveFailures` for transient errors; alert on the **first**
   failure or only on auto-pause; auto-resume-after-cooldown vs. require an explicit user resume.
9. **Date-window catalog** — the exact `RelativePreset` set to ship; timezone source (schedule-level vs
   account default vs submitter); whether a Schedule may *ever* use a fixed window (block vs. warn).
