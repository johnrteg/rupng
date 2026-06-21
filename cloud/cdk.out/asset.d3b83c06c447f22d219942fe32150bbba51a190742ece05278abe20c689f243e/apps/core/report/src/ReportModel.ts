//
// Report domain model — the report catalog, submissions, schedules, and the
// date-window / completion shapes.
//
// Everything is scoped under the `Report` namespace:
//   Report.Definition (the CODE-defined catalog entry), Report.Submission, Report.Schedule, ...
//
// Scalars come from `Type` in @repo/common (ID, ISODateTime, Json); the role ladder
// from `Access` in @repo/endpoint.
//
// Relationships + storage (see SPECS.md "Data model"):
//   Report.Definition — **CODE-defined** registry (like an endpoint definition; shared to the
//                        client, NOT a DynamoDB table; universal/global, gated by `minAccess`)
//        └─< Submission  (DynamoDB, account-scoped — one execution; pins `specVersion`)
//        └─< Schedule    (DynamoDB, account-scoped — a recurring request; each fire = a fresh Submission)
//   Artifacts → S3 (`acct/<accountId>/reports/<reportId>/<submissionId>.<ext>`); one object per submission.
//

import type { Type }   from "@repo/common";
import type { Access } from "@repo/endpoint";

export namespace Report
{
    export type Format = "csv" | "pdf" | "xlsx" | "json";

    /** An ajv JSON-Schema document for a report's declared params. */
    export type ParamsSchema = Type.Json;

    // ──────────────────────────────────────────────────────────────────────────
    // Enums / unions
    // ──────────────────────────────────────────────────────────────────────────

    export enum SubmissionStatus
    {
        SCHEDULED = "scheduled",   // queued for the next scheduled run (created by a Schedule, not yet enqueued)
        SUBMITTED = "submitted",   // enqueued to a worker
        RUNNING   = "running",
        ERROR     = "error",
        COMPLETE  = "complete",
    }

    /** `paused` = user; `auto_paused` = a failed run (any generation failure pauses). */
    export enum ScheduleStatus { ACTIVE = "active", PAUSED = "paused", AUTO_PAUSED = "auto_paused" }

    export type Unit = "day" | "week" | "month" | "quarter" | "year";

    /** Relative presets shipped (THIS_* dropped — a report can't cover future dates). */
    export enum RelativePreset
    {
        // day sugar (rolling shorthands)
        LAST_7_DAYS   = "LAST_7_DAYS",
        LAST_30_DAYS  = "LAST_30_DAYS",
        LAST_90_DAYS  = "LAST_90_DAYS",
        // current period, to-date
        WEEK_TO_DATE    = "WEEK_TO_DATE",
        MONTH_TO_DATE   = "MONTH_TO_DATE",
        QUARTER_TO_DATE = "QUARTER_TO_DATE",
        YEAR_TO_DATE    = "YEAR_TO_DATE",
        // complete prior period
        LAST_WEEK     = "LAST_WEEK",
        LAST_MONTH    = "LAST_MONTH",
        LAST_QUARTER  = "LAST_QUARTER",
        LAST_YEAR     = "LAST_YEAR",
    }

    /**
     * A time-bounded report's window. **Fixed** is for one-time runs only — a Schedule must use
     * a **relative** window (a fixed one is blocked; it would re-pull frozen dates every fire).
     * Resolved to a concrete `{ start, end }` at submit / fire time and stamped on `Submission.window`.
     */
    export type DateWindow =
        | { kind: "fixed"; start?: Type.ISODateTime; end?: Type.ISODateTime }
        | { kind: "relative"; preset: RelativePreset }
        | { kind: "relative"; rolling: { amount: number; unit: Unit }; endOffsetDays?: number };

    // ──────────────────────────────────────────────────────────────────────────
    // Report — the catalog entry (CODE-defined; not a DynamoDB table)
    // ──────────────────────────────────────────────────────────────────────────

    export interface Definition
    {
        reportId:     Type.ID;             // stable definition id (e.g. "delivery-summary")
        name:         string;
        minAccess:    Access.AccountRole;  // dashboard lists only reports ≤ the caller's role
        generator:    string;              // which generator/handler builds it
        paramsSchema: ParamsSchema;        // declared params (ajv) → drives a generic UI form
        component?:   string;              // OPTIONAL custom UI component + validator (when params can't be parametric)
        specVersion:  number;              // backward-compatible; pinned onto Submission / Schedule
        formats:      Array<Format>;       // formats this report can emit (a run picks one)
        description?: string;
        tags?:        Array<string>;
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Submission — one execution (DynamoDB; account-scoped)
    //   pk=ACCOUNT#<accountId>  sk=SUB#<submissionId>
    // ──────────────────────────────────────────────────────────────────────────

    export interface SubmissionError
    {
        reason:     string;    // human-readable (shown in the dashboard)
        code?:      string;    // machine class (BAD_PARAMS / ACCESS_DENIED / SOURCE_UNAVAILABLE / …)
        permanent?: boolean;   // will recur as-is — irrelevant to pausing now (any failure pauses)
    }

    export interface Submission
    {
        accountId:    Type.ID;
        submissionId: Type.ID;
        reportId:     Type.ID;             // → Definition.reportId
        specVersion:  number;              // pinned at submit (matches the spec used)
        submittedBy:  Type.ID;
        createdAt:    Type.ISODateTime;
        status:       SubmissionStatus;
        params:       Type.Json;           // the inputs for THIS run (incl. the DateWindow, if any)
        window?:      { start: Type.ISODateTime; end: Type.ISODateTime };   // RESOLVED range this run covered
        format:       Format;              // the single format this run produces (one per run)
        outputKey?:   string;              // S3 key — on complete
        size?:        number;              // total bytes — on complete
        recordCount?: number;              // rows/records — on complete (0 = empty, NOT a failure)
        startedAt?:   Type.ISODateTime;
        completedAt?: Type.ISODateTime;
        error?:       SubmissionError;     // when status = error
        scheduleId?:  Type.ID;             // set when spawned by a Schedule; absent = ad-hoc
        tags?:        Array<string>;
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Schedule — a recurring request (DynamoDB; account-scoped)
    //   pk=ACCOUNT#<accountId>  sk=SCHED#<scheduleId>   (each fire = a fresh Submission)
    // ──────────────────────────────────────────────────────────────────────────

    export interface Schedule
    {
        accountId:     Type.ID;
        scheduleId:    Type.ID;
        reportId:      Type.ID;            // → Definition.reportId
        specVersion:   number;
        ical:          string;             // RFC-5545 recurrence
        timezone:      string;             // IANA zone — fires off UTC + resolves relative windows in this zone
        params:        Type.Json;          // includes a RELATIVE DateWindow (fixed is blocked on a Schedule)
        format:        Format;             // single output format (one per run)
        createdBy:     Type.ID;            // notified on failure
        status:        ScheduleStatus;
        pausedReason?: string;             // error reason (auto_paused) or user note (paused)
        pausedAt?:     Type.ISODateTime;
        pausedBy?:     Type.ID | "system"; // userId (manual) or "system" (auto-pause on failure)
        tags?:         Array<string>;
        createdAt:     Type.ISODateTime;
        lastFiredAt?:  Type.ISODateTime;
        nextFireAt?:   Type.ISODateTime;
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Events / API payloads
    // ──────────────────────────────────────────────────────────────────────────

    /** The `report.completed` Kafka entity event the account workflow consumes (drives delivery). */
    export interface CompletedEvent
    {
        accountId:    Type.ID;
        reportId:     Type.ID;
        submissionId: Type.ID;
        outputKey:    string;
        format:       Format;
        size:         number;
        recordCount:  number;
        submittedBy:  Type.ID;
        tags?:        Array<string>;
    }

    /** Submit an ad-hoc run (POST /report/submissions). */
    export interface SubmitRequest { reportId: Type.ID; params: Type.Json; format: Format; }

    /** Create a recurring schedule (POST /report/schedules) — relative window only. */
    export interface CreateSchedule { reportId: Type.ID; ical: string; timezone: string; params: Type.Json; format: Format; }
}

export default Report;
// eof
