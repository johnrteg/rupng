//
// Report — the core wire contracts for the reporting factory (see apps/core/report/SPECS.md). Defined ONCE
// here in @repo/api so the report service, its jobs, and every caller (web dashboard, S2S forget fan-out)
// share one vocabulary. Covers the CODE-defined report catalog (`Definition` — a registry shared with the
// client at build time, like `@repo/endpoint` definitions; NOT a DynamoDB table), one execution of a report
// (`Submission`), a recurring request (`Schedule` — the iCal definition; each fire spawns a fresh
// `Submission`), the relative/fixed date-window shape every time-bounded report parameterizes on, and the
// `report.completed` Kafka event the account's workflow consumes to drive delivery (report itself hardcodes
// no destinations). Relationships:
//   Definition (code, universal, gated by minAccess)
//        └─< Submission  (DynamoDB, account-scoped — one execution; pins specVersion)
//        └─< Schedule    (DynamoDB, account-scoped — a recurring request; each fire = a fresh Submission)
//   Artifacts → S3 (`acct/<accountId>/reports/<reportId>/<submissionId>.<ext>`); one object per submission.
//
import type { Type }   from "@repo/common";
import type { Access } from "@repo/endpoint";

export namespace Report
{
    /** The output formats a report may emit — a submission produces exactly ONE per run (report-5.1). */
    export type Format = "csv" | "pdf" | "xlsx" | "json";

    /** An ajv JSON-Schema document describing a report's declared params (drives a generic UI form). */
    export type ParamsSchema = Type.Json;

    /** The lifecycle of one execution (voice-shaped mirror: queued → in-flight → terminal). `SCHEDULED` is
     *  the transient state for a Submission spawned by a Schedule fire that hasn't been enqueued to a worker
     *  yet; `SUBMITTED` is the normal ad-hoc/enqueued entry point. */
    export enum SubmissionStatus
    {
        SCHEDULED = "scheduled",
        SUBMITTED = "submitted",
        RUNNING   = "running",
        ERROR     = "error",
        COMPLETE  = "complete",
    }

    /** A Schedule's run state. `PAUSED` is a deliberate user action; `AUTO_PAUSED` is the platform's
     *  stop-loss after ANY generation failure (no transient-vs-permanent counting — report-6.2). Only
     *  `ACTIVE` schedules fire. */
    export enum ScheduleStatus
    {
        ACTIVE      = "active",
        PAUSED      = "paused",
        AUTO_PAUSED = "auto_paused",
    }

    /** The rolling-window unit for a relative `DateWindow` (`{ amount, unit }`, e.g. "last 7 days"). */
    export type Unit = "day" | "week" | "month" | "quarter" | "year";

    /** Named relative-window shorthands (report-3.5). `THIS_*` is deliberately absent — a report can't cover
     *  future dates, so "this period" is always expressed as a `*_TO_DATE` preset instead. */
    export enum RelativePreset
    {
        LAST_7_DAYS     = "LAST_7_DAYS",
        LAST_30_DAYS    = "LAST_30_DAYS",
        LAST_90_DAYS    = "LAST_90_DAYS",
        WEEK_TO_DATE    = "WEEK_TO_DATE",
        MONTH_TO_DATE   = "MONTH_TO_DATE",
        QUARTER_TO_DATE = "QUARTER_TO_DATE",
        YEAR_TO_DATE    = "YEAR_TO_DATE",
        LAST_WEEK       = "LAST_WEEK",
        LAST_MONTH      = "LAST_MONTH",
        LAST_QUARTER    = "LAST_QUARTER",
        LAST_YEAR       = "LAST_YEAR",
    }

    /** A time-bounded report's requested window — a tagged union. `fixed` is meaningful only for a one-time
     *  submission (a Schedule's fixed window would re-pull the same frozen dates on every fire, so it's
     *  rejected server-side for a Schedule — report-3.3). Both relative forms (`preset` sugar and the
     *  general `rolling` shape) are resolved to a concrete `{ start, end }` at submit/fire time and stamped
     *  onto `Submission.window`, so every run is reproducible/auditable. */
    export type DateWindow =
        | { kind : "fixed"; start? : Type.ISODateTime; end? : Type.ISODateTime }
        | { kind : "relative"; preset : RelativePreset }
        | { kind : "relative"; rolling : { amount : number; unit : Unit }; endOffsetDays? : number };

    /** Where a completed artifact (or its notification) goes — resolved server-side when a submit/schedule
     *  omits it (defaults to `{ kind: DOWNLOAD, config: {} }`). Report itself never ships to a destination;
     *  this only records the CALLER's stated intent — actual delivery is workflow-driven off
     *  `report.completed` (report-7.x). */
    export enum DestinationKind
    {
        DOWNLOAD = "download",
        EMAIL    = "email",
        WEBHOOK  = "webhook",
    }

    /** A destination's shape is kind-specific and carried as loose `Json` (e.g. `EMAIL` → `{ to: string }`,
     *  `WEBHOOK` → `{ url: string, secret?: string }`, `DOWNLOAD` → `{}`) — the delivery LAYER (workflow +
     *  channel/dispatch) owns interpreting it; report only records + forwards it on `report.completed`. */
    export interface Destination
    {
        kind   : DestinationKind;
        config : Type.Json;
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Definition — the catalog entry (CODE-defined; NOT a DynamoDB table)
    // ──────────────────────────────────────────────────────────────────────────

    /** One report's CODE-defined catalog entry — declared in a registry (`packages/api/src/report/catalog/`)
     *  and shipped to the client at build time, like an `@repo/endpoint` contract. The dashboard filters by
     *  `minAccess` locally; the server re-checks it on submit (report-1.1/1.3). */
    export interface Definition
    {
        reportId     : Type.ID;             // stable definition id (e.g. "contacts")
        name         : string;
        minAccess    : Access.AccountRole;  // dashboard lists only reports <= the caller's role
        generator    : string;              // which generator/handler builds it
        paramsSchema : ParamsSchema;        // declared params (ajv) -> drives a generic UI form
        component?   : string;              // OPTIONAL custom UI component + validator, when params can't be parametric
        specVersion  : number;              // bumped on a breaking spec change; pinned onto Submission/Schedule
        formats      : Array<Format>;       // formats this report can emit (a run picks exactly one)
        description? : string;
        tags?        : Array<string>;
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Submission — one execution (DynamoDB; account-scoped)
    // ──────────────────────────────────────────────────────────────────────────

    /** A structured generation failure (report-6.1). `permanent` is carried for future use but is currently
     *  irrelevant to the pause decision — ANY failure auto-pauses a Schedule (report-6.2), no transient vs
     *  permanent counting. */
    export interface SubmissionError
    {
        reason     : string;     // human-readable — shown in the dashboard
        code?      : string;     // machine class (e.g. BAD_PARAMS, ACCESS_DENIED, SOURCE_UNAVAILABLE)
        permanent? : boolean;
    }

    /** One report execution — ad-hoc or spawned by a `Schedule` fire (`scheduleId` set). Every submission is
     *  audited (who/when/what/where — report-10.2); on `COMPLETE` the artifact facts (`outputKey`/`size`/
     *  `recordCount`) are stamped, and `window` records the RESOLVED concrete range this run covered (a
     *  relative window is resolved once, at submit/fire time, for reproducibility). */
    export interface Submission
    {
        accountId    : Type.ID;
        submissionId : Type.ID;
        reportId     : Type.ID;             // -> Definition.reportId
        specVersion  : number;              // pinned at submit (matches the spec used)
        submittedBy  : Type.ID;
        createdAt    : Type.ISODateTime;
        status       : SubmissionStatus;
        params       : Type.Json;           // the inputs for THIS submission (incl. the DateWindow, if any)
        window?      : { start : Type.ISODateTime; end : Type.ISODateTime };   // RESOLVED range this run covered
        format       : Format;              // the single format this run produces (one per run)
        destinations : Array<Destination>;  // fan out to every listed destination on completion (defaults to [DOWNLOAD])
        outputKey?   : string;              // the S3 key produced — on complete
        size?        : number;              // total bytes — on complete
        recordCount? : number;              // rows/records — on complete (0 = empty, NOT a failure)
        startedAt?   : Type.ISODateTime;
        completedAt? : Type.ISODateTime;
        error?       : SubmissionError;     // populated when status = ERROR
        scheduleId?  : Type.ID;             // set when spawned by a Schedule; absent = ad-hoc
        tags?        : Array<string>;
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Schedule — a recurring request (DynamoDB; account-scoped)
    // ──────────────────────────────────────────────────────────────────────────

    /** A standing recurring request (RFC-5545 `ical` + an IANA `timezone`) — a Schedule is the STANDING
     *  definition; each fire spawns a fresh `Submission` (with `scheduleId` set), keeping every Submission a
     *  single immutable execution record. `params` must carry a RELATIVE `DateWindow` — a fixed window is
     *  blocked server-side (it would re-pull the same frozen dates on every fire). Auto-paused after any
     *  generation failure; the `createdBy` user is notified and must manually resume. */
    export interface Schedule
    {
        accountId     : Type.ID;
        scheduleId    : Type.ID;
        reportId      : Type.ID;             // -> Definition.reportId
        specVersion   : number;
        ical          : string;              // RFC-5545 recurrence (e.g. weekly on Monday)
        timezone      : string;              // IANA tz — evaluates the iCal AND resolves relative windows
        params        : Type.Json;           // includes a RELATIVE DateWindow for time-bounded reports
        format        : Format;              // the single output format (one per run)
        destinations  : Array<Destination>;  // fan out to every listed destination on each fire (defaults to [DOWNLOAD])
        createdBy     : Type.ID;
        status        : ScheduleStatus;
        pausedReason? : string;              // why (the error reason for AUTO_PAUSED; a user note for PAUSED)
        pausedAt?     : Type.ISODateTime;
        pausedBy?     : Type.ID | "system";  // userId (manual) or "system" (auto)
        tags?         : Array<string>;
        createdAt     : Type.ISODateTime;
        lastFiredAt?  : Type.ISODateTime;
        nextFireAt?   : Type.ISODateTime;
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Events / API payloads
    // ──────────────────────────────────────────────────────────────────────────

    /** The `report.completed` Kafka entity event (report-7.1) — the account's workflow consumes this to
     *  decide delivery (download-only, email, SFTP, storage connector, CRM, ...); report hardcodes no
     *  destinations of its own. */
    export interface CompletedEvent
    {
        accountId    : Type.ID;
        reportId     : Type.ID;
        submissionId : Type.ID;
        outputKey    : string;
        format       : Format;
        size         : number;
        recordCount  : number;
        submittedBy  : Type.ID;
        tags?        : Array<string>;
    }

    /** The recurrence half of a `CreateRun` — presence decides ad-hoc vs standing (see `CreateRun`). */
    export interface RunSchedule { ical : string; timezone : string; }

    /** Create a report run (`POST /report/runs`) — ONE standard payload for both an ad-hoc run and a
     *  recurring schedule: omit `schedule` for a one-time `Submission`; supply it (RFC-5545 `ical` + an
     *  IANA `timezone`) to create a standing `Schedule` instead (each of its fires then spawns its own
     *  fresh `Submission` — see `Schedule`'s doc comment for why the two stay separate ROWS even though
     *  they share this one creation shape). A schedule's `params.window` must be RELATIVE (fixed is
     *  blocked server-side — report-3.3). `destinations` defaults server-side to `[{ kind: DOWNLOAD,
     *  config: {} }]` when omitted/empty. */
    export interface CreateRun
    {
        reportId      : Type.ID;
        params        : Type.Json;
        format        : Format;
        destinations? : Array<Destination>;
        schedule?     : RunSchedule;
    }
}

export default Report;
// eof
