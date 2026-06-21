#
# Report service
#

# Objective

The **reporting factory of the platform** — where an account turns the data scattered across the services
(sends, responses, contacts, billing, attribution) into a **parameterized, role-gated, repeatable artifact** it
can download, schedule, and route. Report's job is to **own the lifecycle of a report run** — submission →
async generation → durable artifact → completion event — while **delegating the data to the services that own
it** and the **delivery to the account's workflow**. It is the **read-side companion** to the live dashboards in
[analytics](../analytics/SPECS.md): analytics answers *"what's happening now"* interactively; report produces
the **point-in-time, formatted, shareable deliverable** (the month-end CSV, the compliance PDF, the recurring
Excel export) that lives outside the app.

Account-scoped **report generation, scheduling, and cataloging**: submit a report (ad-hoc or on a recurring iCal
schedule), generate it asynchronously, store the artifact(s) in S3, and let the **account's workflow** route
delivery. Reports are gated by role (`minAccess`), parameterized like endpoints, versioned for long-lived
schedules, and every submission is audited.

The load-bearing ideas:
* a **code-defined catalog** (a registry shared with the client at build time, like `@repo/endpoint` definitions
  — **no runtime discovery API**, no per-account report tables) so the UI knows the available reports + their
  parameter schemas locally and filters by role, while the server **re-checks `minAccess` on submit**;
* **declarative parameters with a specialized-component escape hatch** — most reports declare `0..N` params via a
  shared schema (a common base carries date-range / format / etc.); the few that need custom validation the
  schema can't express may reference a **specialized component**;
* **async, fan-out-tolerant generation** — submissions enqueue to **SQS**, **Lambda / ECS** workers pull data
  from the **owning services or materialized views** (Athena + S3), **never reaching into another service's DB**;
* **one-time · scheduled · recurring (iCal)** runs, with each definition carrying a stable **`reportId`** and each
  execution a **`submissionId`** users can list, download, and delete;
* **multi-format output** — CSV · PDF · Excel (xlsx) · JSON — and **spec versioning** so a long-lived recurring
  schedule keeps generating against the version it was created with until deliberately migrated;
* a **clean delivery boundary** — on completion report emits **`report.completed`** and the **account's workflow**
  decides the destination (download-only, email, SFTP, Dropbox / Drive / OneDrive / Box, CRM, …); report
  **hardcodes no destinations**;
* **everything audited** — who submitted what (report + params + spec version), when, where the artifacts landed,
  and the delivery the workflow performed.

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
* Each report declares **0..N parameters** via a schema **like an endpoint** (code-defined, shared with the
  client) so the UI knows what to collect; a **common base interface** carries shared params (date range,
  format, etc.). Some reports need a **specialized component + custom validation** the declarative schema can't
  express — the definition may reference one.
* Each report has a stable **`reportId`**; each execution a **`submissionId`**.
* Users can see a **list of their submissions** and **download** / **delete** them.
* Reports support **1+ formats**: CSV, PDF, Excel (xlsx), JSON.
* **All submissions are audited** — who, when, what (report + params + spec version), where (outputs +
  the delivery the workflow performed).
* **Version the report spec** — a long recurring schedule keeps generating against the spec version it
  was created with until migrated.
* On completion, **delivery is driven by the account's workflow** (download, email, SFTP, Dropbox,
  Google Drive, OneDrive, Box, CRM, …).

# Data model

The typed model lives in **[`src/ReportModel.ts`](src/ReportModel.ts)** (`Report.*`); the sketches below are
the rationale.

The **`Report` catalog is CODE-defined** — a **registry declared in code** (like `@repo/endpoint` endpoint
definitions), **shared with the client at build time**; it is **not** a stored table and there's **no runtime
discovery API** (the client already knows the reports + their schemas; it filters by the caller's role locally,
and the server **re-checks `minAccess` on submit**). **`Submission` + `Schedule` are DynamoDB** (account-scoped
runtime). The catalog is **universal / global**, scoped only by **`minAccess`** (no per-account definitions).

### Report — the catalog entry (CODE-defined; not a DynamoDB table)
```
Report {                       // declared in code (a registry, like an endpoint definition)
  reportId    : ID            // stable definition id (e.g. "delivery-summary")
  name        : string
  minAccess   : Access.AccountRole   // dashboard lists only reports ≤ the caller's role
  generator   : string        // which generator/handler builds it
  paramsSchema: Schema        // declared params (ajv) — drives a generic UI form; extends a shared base
  component?  : string        // OPTIONAL custom UI component + validator when params can't be parametric
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
  status      : "scheduled" | "submitted" | "running" | "error" | "complete"
                              //   scheduled = queued for the next scheduled run (not yet enqueued to a worker)
  params      : Json          // the inputs for THIS submission (incl. the DateWindow, if any)
  window?     : { start: ISODateTime; end: ISODateTime }   // RESOLVED date range this run covered
                              //   (a relative window is resolved to concrete dates at submit/fire time)
  format      : Format        // the single format this run produces (one per run)
  outputKey?  : string        // the S3 key produced — on complete
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
`createdAt`, tags — with the execution facts (`status`/`size`/`recordCount`/`outputKey`) living here.

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
  format      : Format        // the single output format (one per run)
  createdBy   : ID
  status      : "active" | "paused" | "auto_paused"   // paused = user; auto_paused = a failed run
  pausedReason? : string      // why (the error reason for auto_paused; user note for paused)
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

RelativePreset = LAST_7_DAYS | LAST_30_DAYS | LAST_90_DAYS                       // day sugar (rolling shorthands)
               | WEEK_TO_DATE | MONTH_TO_DATE | QUARTER_TO_DATE | YEAR_TO_DATE   // current period, TO-DATE
               | LAST_WEEK | LAST_MONTH | LAST_QUARTER | LAST_YEAR               // complete PRIOR period
Unit = "day" | "week" | "month" | "quarter" | "year"
// THIS_WEEK/MONTH/QUARTER/YEAR are dropped — a report can't cover future dates, so "this period" = *_TO_DATE.
```

* **One-time submissions** may use **fixed** *or* relative.
* **Scheduled submissions** must use **relative** — a **fixed** window is **blocked / rejected** for a Schedule
  (it would re-pull the same frozen dates every fire). (e.g. "last 7 days", "month-to-date", "last quarter".)
* **Scheduled timezone** — the Schedule's **selected IANA zone** is used: the server computes the next local
  occurrence and **fires off UTC** (DST-correct). Ad-hoc runs default to the **account-default** zone,
  submitter-overridable — never server-local or implicit-browser.
* **`endOffsetDays`** handles "**until N days ago**" — e.g. end at *yesterday* (`endOffsetDays: 1`) so a
  run doesn't include today's partial/incomplete data.

### Resolved at run time, then **stamped**
When a Submission is created — and **per Schedule fire** — the relative window is **resolved to concrete
`{ start, end }` at that moment** and written to **`Submission.window`**. The generator queries those
absolute dates, and the artifact is **reproducible + auditable**: each run records exactly which range it
covered. (So Monday's run says `2026-06-01 → 2026-06-08`, the next Monday says `2026-06-08 → 2026-06-15`.)

### Timezone discipline (get this right — it's where reports break)

> This is the **platform-wide** convention for any scheduled time / window / quiet-hour — see root
> [SPECS.md → Time, scheduling & timezones](../../../docs/SPECS.md). It's spelled out here (with the worked
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

A **generation failure** (the job errored) records a structured **`error.reason`** (+ `code`, `permanent`).
**Empty results are *not* a failure** — a run that produced **zero rows** is `status=complete` with
`recordCount=0` (a valid, deliverable artifact), and **never pauses** the schedule. Only a **failed generation**
triggers the pause policy, because a failing run shouldn't keep firing into the same wall:

* **Any generation failure → `auto_paused` immediately.** A failing scheduled run **pauses the schedule**
  (`pausedReason` = the error reason, `pausedBy` = `"system"`) — we don't keep firing into the same wall, and
  we **don't bother counting** transient vs permanent: **one failure pauses**.
* **Notify the user who scheduled it.** The Schedule's **`createdBy`** gets a notification that the report
  **failed to run** — via a `report.failed` / `report.schedule_paused` event the account workflow can route.
* **Manual resume.** The user fixes the cause (params / access / source) and **resumes** (`status=active`).
  Only **`active`** schedules fire; `paused` / `auto_paused` are skipped until resumed.
* **Ad-hoc** submissions just terminate as `error` with a reason — no pause concept (nothing recurring to pause).

> Auto-pause is a **stop-loss**, not a fix: it halts wasted runs + error noise and tells the **scheduler** to
> investigate; they fix the cause and resume. (No retry threshold — any failure pauses.)

# Storage layout (S3)

```
acct/<accountId>/reports/<reportId>/<submissionId>.<ext>
```
Built via the typed `S3.Domain.REPORT` descriptor — see **[`packages/services/src/aws/SPECS.md`](../../../packages/services/src/aws/SPECS.md)** → S3 object keys.
Grouped by `reportId` (all of an account's submissions of a report together); each submission is its own
artifact, **one object** (`<submissionId>.<ext>` — `Submission.outputKey`). Private bucket; downloads via
**presigned GET**. Lifecycle expiry by **object age** — the **environment max** retention, with a **per-account**
TTL **≤ that max** (reports are regenerable); no date in the key, the DB is the index.

# Architecture & flow

```
 submit (API) ─ validate params vs paramsSchema · check minAccess
   └─► write Submission (DDB, status=submitted)
        └─► EventBridge Scheduler ── enqueue now │ one-off at T │ recurring (Schedule iCal → new Submission per fire)
             └─► [report dispatcher] ─► SQS (+ DLQ)
                  └─► worker: Lambda (<15 min)  │  ECS/Fargate (long)
                       · pull data (services / Athena materialized views)
                       · generate artifact(s) → write to S3
                       · update Submission (running → complete; size, recordCount, outputKey)
                       └─► publish  report.completed  (Kafka entity event)
                            └─► ACCOUNT WORKFLOW consumes ─► delivery (download / email / storage / CRM)
   on failure → status=error (+ error.reason); DLQ; if scheduled → pause policy (see Failure handling)
```

**Workers:** Lambda for "short" reports (< 15 min); ECS/Fargate for "long" ones. Submissions ride SQS
with a DLQ; **per-account fair-share (the `WorkQueue` / dispatch governor) is required** — an account's many
frequent / long-running reports must not starve others (a dozen reports each every 5 min, each ~5 min, would
otherwise monopolize the pool).

# Completion → delivery is workflow-driven (per account)

A completed report does **not** ship from the report service directly. Instead:

* On success the report service **publishes `report.completed`** — a Kafka entity event:
  `{ accountId, reportId, submissionId, outputKey, format, size, recordCount, submittedBy, tags }`.
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
  `specVersion`), where (`outputKey` + the workflow-performed delivery).

# Versioning

`specVersion` on the Report is pinned onto each Submission/Schedule at creation. A **long recurring
schedule keeps generating against its pinned version** even after the report's current spec moves on, so
output stays consistent.

* **Backward-compatible by default.** Spec changes are **additive / backward-compatible** where possible, so a
  new version doesn't break schedules pinned to an old one — most changes need **no migration**.
* **Find old-version schedules.** Before an old version is **dropped**, an **API lists schedules still pinned to
  it** ("running forever on the old version") so they can be surfaced.
* **CS-driven remediation.** **Coordinate with CS** to **stop + restart** those schedules on the **latest**
  version (human-in-the-loop) — rather than silently mutating a standing definition.
* **Auto-migration is TBD** — only if back-compat can't cover a breaking change *and* the old-version backlog
  becomes a **blocker** does an actual migration get built.

# Materialized views

Heavy reports shouldn't hammer operational DBs. Services **export materialized views** to a reporting store
(**Athena + S3**), kept **near-real-time** by **consuming Kafka events** (the same streaming backbone as
[analytics](../analytics/SPECS.md)). Report jobs query those views — **freshness is *not* report's concern**;
the views are current by construction (the owning services / the analytics pipeline maintain them).

# Service & Job topology

**Convention (platform-wide).** Each service layers **framework base → domain base → concrete role**. A **domain
Service base** (`ReportService extends Service`) and a **domain Job base** (`ReportJob extends Job`) hold the
**shared domain code** — the **catalog / submission** model, **paramsSchema** validation, the **report-generator
factory** (by report type × format), the **Athena / materialized-view** query clients, the **S3 artifact** store,
the **iCal scheduling** logic, and **audit / `report.completed` emit** — so every concrete role inherits it.
Report **generates artifacts; it does not deliver them** — delivery is **workflow-driven** (it publishes
`report.completed`; the account's workflow + channel/dispatch ship it).

```
Application
├── Service (Fastify, long-running — ECS)
│     └── ReportService           (domain base — catalog/submission model · paramsSchema validation · generator factory · Athena/materialized-view clients · S3 artifact store · iCal scheduling · audit/emit; not deployed alone)
│           └── ReportMainService  (the /report/* API: catalog · submit · status · parameters · schedule (iCal) mgmt · artifact download (presigned GET) · config/health — authed)
└── Job (Lambda / Fargate, event-driven)
      └── ReportJob                (domain base — generator factory · Athena clients · S3 · idempotency)
            ├── ReportGenerateJob   (SQS — pull data (services / Athena views) · generate artifact(s) → S3 · update Submission · publish report.completed; Lambda < 15 min / Fargate long; per-account fair-share)
            ├── ReportScheduleJob   (EventBridge Scheduler — fire recurring (iCal) / one-off → new Submission per fire → enqueue; auto-pause a failing scheduled report)
            └── ReportViewJob       (EventBridge — refresh Athena materialized views; artifact lifecycle / S3 expiry)
```

**Services (HTTP, ECS Fargate)**

| Class | Extends | Role |
|---|---|---|
| **`ReportService`** | `Service` | **Domain base** — catalog/submission model · paramsSchema validation · generator factory · Athena/materialized-view clients · S3 artifact store · iCal scheduling · audit/emit; **not deployed alone**. |
| **`ReportMainService`** | `ReportService` | The **authed `/report/*` API** — **catalog**, **submit**, **status**, **parameters**, **schedule (iCal)** management, **artifact download** (presigned GET), config/health. (No delivery — that's workflow's.) |

**Jobs (Lambda / Fargate, event-driven)** — each extends `ReportJob`:

| Class | Trigger | Role | Req |
|---|---|---|---|
| **`ReportGenerateJob`** | SQS (per-account fair-share) | **Generate** — pull data (owning services / **Athena materialized views**, never operational DBs), build artifact(s) (CSV / PDF / xlsx) → **S3**, update the Submission, **publish `report.completed`** (Kafka). **Lambda < 15 min / Fargate long** — duration picks the runtime, same logic | report-2.0 / 5.0 |
| **`ReportScheduleJob`** | EventBridge Scheduler | Fire **recurring (iCal) / one-off** schedules → create a **new Submission per fire** → enqueue; **auto-pause** a scheduled report after repeated failure | report-4.0 / 6.0 |
| **`ReportViewJob`** | EventBridge (scheduled) | **Refresh Athena materialized views** + **artifact lifecycle** (S3 expiry by age) | report-9.0 |

> **Shared modules (not deployables).** The **report-generator factory** (by type × format), the
> **paramsSchema (ajv)** validation, the **Athena / materialized-view** query clients, the **S3 artifact** store,
> and the **iCal scheduling** live on the bases and are reused across the API + workers. **Report never
> delivers** — `ReportGenerateJob` publishes **`report.completed`** and the **account workflow** (+ channel /
> dispatch / marketplace) routes it (download / email / SFTP / Drive / CRM); there is **no delivery job here**.
> Workers pull from **Athena views or owning-service APIs, never another service's DB**.

# AWS Services and Other Dependencies

**AWS services**
* **EventBridge Scheduler** — enqueue now / one-off at T / recurring (drives Schedule iCal fires).
* **SQS** (+ **DLQ**) — the submission queue feeding workers.
* **Lambda** (< 15 min) + **ECS / Fargate** (long-running) — report generators.
* **S3** — artifact output (private; **presigned GET**; lifecycle expiry by age) + materialized-view storage.
* **DynamoDB** (+ **TTL**) — Report / Submission / Schedule.
* **Athena** (+ S3) — the materialized views report jobs query (never operational DBs).
* **Kafka** — the `report.completed` entity event the account workflow consumes.

**Third-party libraries / services**
* **Report-rendering libraries** — PDF + **xlsx** generation per generator (lib TBD per format).
* Delivery connectors (email / SFTP / Dropbox / Drive / CRM …) are **not** called here — the **workflow + marketplace** invoke them on `report.completed`.

**Internal (`@repo/*`)**
* `@repo/services` (Scheduler, Sqs, S3, Dynamo, Athena, Kafka, `WorkQueue`), `@repo/endpoint` (`Access` + the param `Schema` / ajv), `@repo/common` (`Type`, `ISODateTime`).
* **Delivery** delegated to **[workflow](../workflow/SPECS.md)** + channel / dispatch / marketplace; **data** pulled from owning services / **[analytics](../analytics/SPECS.md)** (Athena views), **never** another service's DB.

# Compliance & standards mapping

How **this report service's** controls map to **OWASP Top 10 (2021)**, **ISO/IEC 27001:2022** (Annex A),
**SOC 2 Type 2** (TSC), **HIPAA** (if PHI), **GDPR**, and **CCPA/CPRA**. Report is **account-scoped report
generation + cataloging**; artifacts are **PII-bearing exports**, role-gated (`minAccess`), audited, stored
**private** in S3. There is **no PCI** and **no messaging-law** surface. **HIPAA** is ➖ (no PHI by
[AUP](../account/specs/SPECS.md); an export *could* carry PII for the account). It **never reaches into another
service's DB** — it pulls from owning services / Athena views. **Delivery** (and its 3rd-party sub-processor
exposure) is **workflow / marketplace**, not report. Identity/RBAC live in [auth](../auth/specs/SPECS.md);
residency is the platform [AWS topology](../../../packages/services/src/aws/SPECS.md).

**Legend:** ✅ meets/exceeds · ⚠️ partial / open — see Gaps · ➖ n/a

| Report control | OWASP T10 | ISO 27001:2022 | SOC 2 (TSC) | HIPAA (if PHI) | GDPR | CCPA | |
|---|---|---|---|---|---|---|---|
| **Role-gating (`minAccess`)** — dashboard lists only reports ≤ the caller's role; **submit re-checks** | A01 | A.5.15 / A.8.3 | CC6.1 / CC6.3 | §164.312(a)(1) | Art 32 | ➖ | ✅ |
| **Tenant isolation** — account-scoped submissions + S3 prefix (`acct/<id>/…`) + DDB `PK` | A01 | A.8.3 | CC6.1 | §164.312(a)(1) | Art 32 | §1798.100 | ✅ |
| **No direct DB reach** — pull from owning services / Athena views, never another service's DB | A01 / A08 | A.8.3 | CC6.x | ➖ | Art 32 | ➖ | ✅ |
| **Artifact access** — **private** S3 + **time-limited presigned GET**; no public bucket | A01 / A02 | A.8.20 | CC6.6 | §164.312(e) | Art 32 | ➖ | ✅ |
| **Artifacts are PII-bearing exports** — **retention TTL** (environment max + per-account ≤ max); private S3; regenerable | A04 | A.5.33 / A.8.10 | (Privacy) | §164.310(d)(2) | Art 17 / 5(1)(e) | §1798.105 | ✅ retention bounded |
| **Audit every submission** — who / when / what (report + params + `specVersion`) / where (outputs + delivery) | A09 | A.8.15 | CC7.2 | §164.312(b) | Art 30 | ➖ | ✅ |
| **Parameter validation** — typed `paramsSchema` (ajv); reject bad input | A03 / A04 | A.8.28 | CC7.1 | ➖ | ➖ | ➖ | ✅ |
| **Reproducibility** — `specVersion` pinned + resolved `window` stamped (consistent, auditable runs) | A08 | A.8.32 | CC7.1 | ➖ | Art 5(2) | ➖ | ✅ |
| **Encryption** — at rest (S3 / DDB SSE-KMS) + in transit | A02 | A.8.24 | CC6.1 | §164.312(e) | Art 32 | ➖ | ✅ |
| **Delivery egress = workflow / marketplace** — report publishes the event; destinations + their sub-processor exposure live there | A04 | A.5.19 | CC9.2 | ➖ | Art 28 | ➖ | ✅ delegated |

# Gaps & open decisions

*The one review list.* ✅ = resolved/decided · ⚠️ = **open — needs attention**.

1. ✅ **Catalog scope — DECIDED: universal.** One **global** report catalog (no per-account definitions);
   reports are scoped **only by `minAccess`** — the role required to **view + run** each report (the dashboard
   lists those ≤ the caller's role; submit re-checks).
2. ✅ **Submission retention — DECIDED.** The **audit record** (who / what / when + report + params +
   `specVersion`) is **retained** per audit policy. The **artifact** has a retention TTL configured **per
   environment** (e.g. dev short, prod longer) as the **environment max**, with a **per-account** setting that
   **may not exceed** the environment max; S3 lifecycle expires artifacts by age (they're **regenerable**).
   *(Forget: short retention + expiry is the baseline; an explicit pre-expiry purge can ride the contact-forget
   job — `report-11.1`.)*
3. ✅ **Output format — DECIDED: one format per run.** A submission produces a **single** format — the Report
   declares the **available** set; the submitter picks **one**. Multiple formats = multiple submissions — so
   there's **no multi-format-per-run** (no N-object-vs-zip question).
4. ✅ **Default delivery — DECIDED.** When an account defines no workflow, the artifact is **download-only**
   (dashboard) + a completion notification.
5. ✅ **`specVersion` migration — DECIDED (back-compat + find-old + CS restart).** Specs are **versioned but
   backward-compatible** (additive), so a new version rarely breaks a pinned schedule. Before dropping an old
   version, an **API lists schedules still pinned to it**; **CS stops + restarts** them on the latest
   (human-in-the-loop). A real **auto-migration is TBD** — built only if back-compat can't cover a breaking
   change and the old-version backlog becomes a **blocker** (`report-8.x`).
6. ✅ **Materialized-view freshness — DECIDED: near-real-time from Kafka.** The reporting views (Athena + S3)
   are kept up to date **near-real-time by consuming Kafka events** (the owning services / the analytics
   pipeline maintain them). **Not a report concern** — reports just query current views; there's no per-report
   refresh cadence to tune.
7. ✅ **Fair-share — DECIDED: yes, per-account.** Report submissions ride the **per-account `WorkQueue`**
   fair-share (the dispatch governor). An account can schedule **many frequent + long-running** reports — e.g.
   **a dozen reports, each every 5 min, each taking ~5 min** — which would otherwise **monopolize the worker
   pool and starve other accounts**. Fair-share paces per account so no one account's backlog blocks others.
8. ✅ **Auto-pause — DECIDED: pause on failure, notify the scheduler.** Any **generation failure** on a
   scheduled run **pauses the schedule** (`auto_paused`) — **no** transient-vs-permanent counting, **no**
   `maxConsecutiveFailures` threshold. **Notify the user who scheduled it** (the Schedule's `createdBy`) that it
   failed; they fix the cause and **manually resume**. (Empty results aren't a failure — `report-6.5`.)
9. ✅ **Date-window catalog — DECIDED.** **Presets:** the rolling form `{amount, unit, endOffsetDays}` + day
   sugar (`LAST_7/30/90_DAYS`) + **complete prior period** (`LAST_WEEK/MONTH/QUARTER/YEAR`) + **to-date**
   (`WEEK/MONTH/QUARTER/YEAR_TO_DATE`); **`THIS_*` dropped** (a report can't cover future dates). **Timezone:**
   scheduled runs use the **Schedule's selected IANA zone** (server computes the next local occurrence →
   **fires off UTC**, DST-correct); ad-hoc defaults to the **account-default** zone, submitter-overridable —
   never server/implicit-browser. **Fixed-on-schedule = blocked** (one-time runs may use fixed or relative).

# Requirements (traceable register)

The traceable requirement register for the **report service** (the narrative sections above are the rationale;
this is the coded list). IDs are stable handles (**`report-N.M`**) — cite them in code, tickets, and tests.
**Priority:** **A** = MVP, **B** = core / hardening, **C** = later. One level of sub-requirements; a group's
priority is its floor. **Boundaries:** report owns the **catalog, submissions, scheduling, generation,
artifact storage, and the `report.completed` event**; **[workflow](../workflow/SPECS.md)** owns
**delivery routing** (channel / dispatch / marketplace do the sends); data comes from **owning services /
[analytics](../analytics/SPECS.md)** (Athena views), never another service's DB.

## report-1.0 Catalog — A
- **report-1.1** **Code-defined catalog** — reports declared **in code** (a registry, like `@repo/endpoint` definitions) + **shared with the client**; the dashboard filters by role **locally** (no runtime catalog API); the server **re-checks `minAccess` on submit** — A
- **report-1.2** `Report` **definition (code)** — `reportId`, name, `minAccess`, `generator`, `paramsSchema`, `specVersion`, formats — A
- **report-1.3** **Universal catalog** — one global catalog (no per-account definitions); scoped **only by `minAccess`** (view + run) *(gap #1)* — A
- **report-1.4** **Specialized component + validation** — a report may ship a **custom UI component + validator** where the declarative `paramsSchema` can't express the need (parametric form is the default) — A

## report-2.0 Submission & generation — A
- **report-2.1** **Submit** — validate params vs `paramsSchema` + check `minAccess` → `Submission` (`status=submitted`) — A
- **report-2.2** **SQS → Lambda (<15 min) / ECS (long)** workers; pull data from services / Athena views — A
- **report-2.3** Status `submitted → running → complete` / `error`; on complete stamp `outputKey` / `size` / `recordCount` — A
- **report-2.4** Users **list** their submissions + **download** + **delete** — A

## report-3.0 Parameters & date windows — A
- **report-3.1** **0..N params** via schema (ajv); a **shared base** (date range, format) — A
- **report-3.2** **`DateWindow`** — `fixed` vs `relative` (presets · rolling · `endOffsetDays`) — A
- **report-3.3** One-time = fixed **or** relative; **scheduled MUST be relative** (fixed window **blocked** on a schedule) — A
- **report-3.4** **Resolve** relative → concrete `{start,end}` at run + **stamp `Submission.window`** (reproducible) — A
- **report-3.5** **Date-window catalog** — rolling + `LAST_*` + `*_TO_DATE` (no `THIS_*`); tz = Schedule zone (scheduled) / account-default-overridable (ad-hoc); **fixed-on-schedule blocked** *(gap #9)* — A

## report-4.0 Scheduling (iCal) — A
- **report-4.1** One-time / one-off-at-T / **recurring (iCal RFC-5545)** — A
- **report-4.2** **iCal lives on `Schedule`**; each fire = a **fresh Submission** (`scheduleId` set) — A
- **report-4.3** **Timezone discipline** — store IANA zone; **compute-in-zone → fire-UTC**; persist UTC; **display the zone**; DST-correct — A

## report-5.0 Formats & artifacts — A
- **report-5.1** **One format per run** — the Report declares the available set (CSV / PDF / xlsx / JSON); a submission produces **one** (multiple formats = multiple submissions) *(gap #3)* — A
- **report-5.2** S3 layout `acct/<id>/reports/<reportId>/<submissionId>.<ext>` — **one object per submission**; **private** + presigned GET — A

## report-6.0 Failure handling & auto-pause — A
- **report-6.1** Structured **`error`** — `reason` / `code` / `permanent` — A
- **report-6.2** **Any generation failure → `auto_paused`** (no transient counting / threshold) *(gap #8)* — A
- **report-6.3** **Notify the scheduler** (Schedule `createdBy`) on failure (`report.failed` / `report.schedule_paused`); **manual resume**; only `active` fires; ad-hoc just `error`s *(gap #8)* — A
- **report-6.5** **Empty result ≠ failure** — a zero-row run is `complete` (`recordCount=0`), **no pause**; only a **generation error** triggers the pause policy — A

## report-7.0 Completion → delivery (workflow-driven) — A
- **report-7.1** On success **publish `report.completed`** (Kafka entity event) — A
- **report-7.2** The **account workflow** routes delivery (download / email / SFTP / storage / CRM); report **hardcodes no destinations** — A
- **report-7.3** **Default** (no workflow) — download + notification *(gap #4)* — A

## report-8.0 Versioning — A
- **report-8.1** `specVersion` **pinned** on Submission / Schedule at creation; **versions are backward-compatible** (additive) so a new version doesn't break a pinned schedule — A
- **report-8.2** **Find old-version schedules** — an **API lists schedules still pinned** to a version before it's dropped *(gap #5)* — B
- **report-8.3** **CS-driven remediation** — stop + restart old-version schedules on the latest (human-in-the-loop); **auto-migration TBD** (only if a breaking change + backlog blocks) *(gap #5)* — C

## report-9.0 Materialized views — B
- **report-9.1** Services **export materialized views** (Athena + S3); report jobs query those, not operational DBs — B
- **report-9.2** View **freshness** — kept **near-real-time from Kafka** (owning services / analytics); **not a report concern** *(gap #6)* — B

## report-10.0 Access control & audit — A
- **report-10.1** **`minAccess`** per report; dashboard ≤ role; **submit re-checks** — A
- **report-10.2** **Every submission audited** — who / when / what / where — A

## report-11.0 Privacy & compliance — A
- **report-11.1** Artifacts are **PII-bearing** — private S3 + presigned GET; **retention TTL = environment max + per-account (≤ max)**, lifecycle by age (regenerable); GDPR forget = expiry + optional pre-expiry purge via the contact-forget job; the **audit record is retained** separately *(gap #2)* — A
- **report-11.2** **Encryption** + tenant isolation; **no direct cross-service DB** access — A

## report-12.0 Infra & throughput — A
- **report-12.1** **DynamoDB** (Report / Submission / Schedule, TTL) · **EventBridge Scheduler** · **SQS + DLQ** · **Lambda / ECS** · **S3** · **Athena** · **Kafka** — A
- **report-12.2** **Per-account fair-share** — submissions ride the **`WorkQueue`** / dispatch governor so one account's many frequent/long reports can't starve others *(gap #7)* — A

## report-13.0 Service & Job topology — B
- **report-13.1** **Domain bases** — `ReportService extends Service` + `ReportJob extends Job` hold the shared code (catalog/submission model · paramsSchema validation · generator factory · Athena/materialized-view clients · S3 artifact store · iCal scheduling · audit/emit); **concrete roles extend the domain base** — B
- **report-13.2** **`ReportMainService`** — the authed `/report/*` API (catalog · submit · status · parameters · schedule mgmt · presigned download) — A
- **report-13.3** **Jobs extend `ReportJob`** — `ReportGenerateJob` / `ReportScheduleJob` / `ReportViewJob` — A
- **report-13.4** **`ReportGenerateJob`** — pull (Athena views / owning-service APIs, never another service's DB) → artifact → S3 → publish `report.completed`; **Lambda < 15 min / Fargate long**; per-account fair-share — A
- **report-13.5** **No delivery job** — report publishes `report.completed`; the **account workflow** (+ channel/dispatch/marketplace) delivers (download / email / SFTP / Drive / CRM) — A

# Endpoints (first cut)

A first pass at the endpoint surface, in [`@repo/endpoint`](../../../packages/endpoint/SPECS.md) style — all
service-prefixed **`/report/*`**. Reads return the `{ data, page }` envelope.

> **Generation + delivery are not synchronous HTTP.** Submitting **enqueues** (SQS → worker); on completion
> report **publishes `report.completed` (Kafka)** and the **account workflow** routes delivery — there is **no
> "send the report" route** here. Report data is pulled from owning services / **Athena views**, never another
> service's DB.

**Access column:** **`minAccess`** on the `Access` ladder — **`-`** = public · account ladder
**`SENDER`<`USER`<`BILLING`<`ACCOUNT`** · staff ladder **`SUPPORT`<`APPLICATION`<`ROOT`** · **`⬆`** = step-up ·
**`Internal`** = VPC-only S2S. Browse/run is `USER`, but **each report re-checks its own `minAccess`** (a
report may require a higher role); catalog definitions are platform-global (`APPLICATION`+).

> **No catalog API.** The report catalog is **code-defined** (a registry, like endpoint definitions) and
> **shipped to the client** — so there's **no `GET /report/catalog`** discovery route and no runtime definition
> CRUD. The client knows the reports + their `paramsSchema`/component, filters by the caller's role locally, and
> the server **re-checks `minAccess` on submit** (`report-1.1`).

### Submissions — ad-hoc run, list, download (report-2, report-5)
| Method | URI | Purpose | Access | Req |
|---|---|---|---|---|
| POST | `/report/submissions` | **Submit a run** — `{ reportId, params (incl. DateWindow), format }`; validate vs schema + re-check `minAccess` | USER (report's `minAccess`) | report-2.1 |
| GET | `/report/submissions` | List submissions (filter report / status / window) | USER | report-2.4 |
| GET | `/report/submissions/{id}` | Status + facts (`status`, `size`, `recordCount`, resolved `window`, `error`) | USER | report-2.3 |
| GET | `/report/submissions/{id}/download` | **Presigned GET** to the artifact | USER | report-5.2 |
| DELETE | `/report/submissions/{id}` | Delete a submission + its artifact | USER | report-2.4 |

### Schedules — recurring (report-4, report-6, report-8)
| Method | URI | Purpose | Access | Req |
|---|---|---|---|---|
| GET | `/report/schedules` | List schedules (filter status / reportId / `specVersion`) | USER | report-4.1 |
| POST | `/report/schedules` | Create — `{ reportId, ical, timezone, params (relative), format }`; **relative-only** (fixed blocked) | USER (report's `minAccess`) | report-4.1/4.2/3.3 |
| GET | `/report/schedules/{id}` | Schedule detail (+ `lastFiredAt` / `nextFireAt` / pause state) | USER | report-4.2 |
| PATCH | `/report/schedules/{id}` | Edit `ical` / `params` / `format` / `timezone` | USER | report-4.1 |
| POST | `/report/schedules/{id}/pause` | Manual pause | USER | report-6.3 |
| POST | `/report/schedules/{id}/resume` | Resume (after fixing an `auto_paused` failure) | USER | report-6.3 |
| DELETE | `/report/schedules/{id}` | Delete a schedule | USER | report-4.2 |
| GET | `/report/schedules/stale?specVersion={v}` | **Schedules pinned to an old `specVersion`** (pre-drop sweep, CS remediation) | APPLICATION | report-8.2 |

### Internal / S2S & ops
| Method | URI | Purpose | Access | Req |
|---|---|---|---|---|
| POST | `/report/internal/erase` | S2S — purge artifacts containing a forgotten subject's PII (`contact-forget` fan-out) | Internal | report-11.1 |
| GET, PUT | `/report/config` | Read / set runtime config (incl. the **environment-max retention** TTL) | ROOT | report-11.1 |
| GET | `/report/health` | Liveness / readiness (worker fleet + scheduler) | - | report-12.1 |

# eof
