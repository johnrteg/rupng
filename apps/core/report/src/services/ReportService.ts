//
import { randomUUID } from "node:crypto";
import { ScanCommand } from "@aws-sdk/lib-dynamodb";
import type { ScanCommandOutput } from "@aws-sdk/lib-dynamodb";

import { Application, Service, Register, Dynamo, S3, Sqs, Kafka, WorkQueue, Cache, Ical } from "@repo/services";
import { Events } from "@repo/system";
import { Ports } from "@repo/cloud-manifest";
import { Access } from "@repo/endpoint";
import { Report, ReportConfig, Validation, findReport } from "@repo/api";
import { ObjectUtils, ResultUtils } from "@repo/common";
import type { Type } from "@repo/common";

import { GeneratorFactory } from "../generators/GeneratorFactory";
import { ReportGenerator } from "../generators/ReportGenerator";
import { WriterFactory } from "../writers/WriterFactory";
import { Writer } from "../writers/Writer";
import { DestinationFactory } from "../destinations/DestinationFactory";
import { Destination } from "../destinations/Destination";
import { DateWindowUtils } from "../scheduling/DateWindowUtils";

//
// ReportService — the report domain's Service BASE (not deployed alone). Holds the shared domain wiring
// (Dynamo + S3 + SQS + Kafka facades, the WorkQueue fair-share governor, the generator/writer/destination
// factories, the runtime config reader) so the concrete role (ReportMainService) inherits it. Owns the
// catalog-lookup + paramsSchema validation, the Submission + Schedule stores, the ONE shared
// `processSubmission` generation pipeline (called identically by MAIN's local queue drain and by
// `ReportGenerateJob`'s Lambda handler), and the iCal scheduling helpers. Same shape as
// apps/core/voice/src/services/VoiceService.ts.
//
export class ReportService extends Service
{
    private _dynamo?    : Dynamo;
    private _s3?        : S3;
    private _sqs?       : Sqs;
    private _kafka?     : Kafka;
    private _workQueue? : WorkQueue;
    private _cache?     : Cache;

    /** The report-generator registry (report-9.1) — one entry per catalog `Definition.generator` id. */
    protected readonly generators : GeneratorFactory = new GeneratorFactory();
    /** The output-format renderer registry (report-5.1). */
    protected readonly writers : WriterFactory = new WriterFactory();
    /** The completion-destination handler registry (report-7.x). */
    protected readonly destinations : DestinationFactory = new DestinationFactory();

    ////////////////////////////////////////////////////////////////////////////////////////////
    constructor( role : ReportService.Role )
    {
        // super( serviceId, role, defaultLocalPort ) — env PORT overrides the default when set.
        super( Register.Service.REPORT, role, ReportService.PORT[ role ] );

        // stamp the running version from package.json (walks up from bin/services at runtime)
        const pkg : Application.PackageInfo = this.loadPackageInfo( __dirname );
        this.setVersion( pkg.version );
        this.log.info( "version", { name: pkg.name, version: pkg.version } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** DynamoDB facade — the SoT for submissions + schedules. Lazy + cached. */
    public get dynamo() : Dynamo { return this._dynamo ??= new Dynamo( this.cloud ); }
    /** S3 facade — the private `report` bucket holding generated artifacts. Lazy + cached. */
    public get s3() : S3 { return this._s3 ??= new S3( this.cloud ); }
    /** SQS facade — the report-generate work queue. Lazy + cached. */
    public get sqs() : Sqs { return this._sqs ??= new Sqs( this.cloud ); }
    /** Kafka facade — `report.report` / `report.schedule` lifecycle events, best-effort. Lazy + cached. */
    public get kafka() : Kafka { return this._kafka ??= new Kafka( this.cloud ); }
    /** The `WorkQueue` dispatch governor (report-12.2) — per-account fair-share so one account's many
     *  frequent/long-running reports can't starve others. Lazy + cached. */
    public get workQueue() : WorkQueue
    {
        return this._workQueue ??= new WorkQueue( this.cloud, "report", {
            batchSize: 20, lowWaterMark: 50, leaseSeconds: 300,
        } );
    }
    /** Redis facade — same `"cache"` resource the `WorkQueue` governor uses; also backs the dispatch-loop
     *  single-flight lock (see `ReportMainService.startDispatchLoop`). Lazy + cached. */
    public get cache() : Cache { return this._cache ??= new Cache( this.cloud, "cache" ); }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Seed the runtime config on a fresh environment so the service (and the Console Config tab) have usable
     *  defaults from first boot. */
    protected override async init() : Promise<void>
    {
        super.init();
        const seeded : Type.Result<ReportConfig.Config> = await this.appConfig.ensureSeeded( "config", "settings", ReportConfig.DEFAULT );
        if( seeded.ok ) this.log.info( "report config ready" );
        else this.log.warn( "report config seed failed — using DEFAULT until deployed", { error: seeded.error } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** The live runtime config (AppConfig config/settings), deep-filled from DEFAULT so an older/partial
     *  hosted row tolerates schema drift. */
    public async reportConfig() : Promise<ReportConfig.Config>
    {
        const got : Type.Result<ReportConfig.Config | undefined> = await this.appConfig.json<ReportConfig.Config>( "config", "settings" );
        this.log.trace( "config read: config/settings", { found: got.ok && got.data !== undefined } );
        return got.ok && got.data ? ObjectUtils.withDefaults( got.data, ReportConfig.DEFAULT ) : ReportConfig.DEFAULT;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Persist a new config version + deploy it (AppConfig control plane) — the PUT-config write path. */
    public async saveConfig( config : ReportConfig.Config, environment : string = process.env.APPCONFIG_ENV ?? "default" ) : Promise<Type.Result<void>>
    {
        const profileId : Type.Result<string> = await this.appConfig.profileId( "config", "settings" );
        if( !profileId.ok ) return { ok: false, error: profileId.error };
        const environmentId : Type.Result<string> = await this.appConfig.environmentId( "config", environment );
        if( !environmentId.ok ) return { ok: false, error: environmentId.error };

        const version : Type.Result<number> = await this.appConfig.createVersion( "config", profileId.data, JSON.stringify( config ) );
        if( !version.ok ) return { ok: false, error: version.error };
        const deployed : Type.Result<number> = await this.appConfig.deploy( "config", profileId.data, environmentId.data, version.data, { description: "report config update" } );
        if( !deployed.ok ) return { ok: false, error: deployed.error };
        return { ok: true, data: undefined };
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // ── Submissions (report-2.0) ───────────────────────────────────────────────────────────────

    /** Look up the report + validate it ONCE — `minAccess`, declared `format`, and `params` against the
     *  catalog's `paramsSchema` — shared by both the ad-hoc-submission and standing-schedule paths of
     *  {@link createRun} so the check never drifts between them. */
    private validateRunRequest( request : Report.CreateRun, callerRole : Access.Role ) : Type.Result<Report.Definition>
    {
        const definition : Report.Definition | undefined = findReport( request.reportId );
        if( definition === undefined ) return { ok: false, error: `unknown reportId "${ request.reportId }"` };
        if( !Access.isAllowed( callerRole, definition.minAccess ) ) return { ok: false, error: `report "${ request.reportId }" requires at least ${ definition.minAccess }` };
        if( !definition.formats.includes( request.format ) ) return { ok: false, error: `report "${ request.reportId }" does not support format "${ request.format }"` };

        const validator : Validation.Validator<unknown> = Validation.compile( definition.paramsSchema as Validation.Schema );
        const validated : Validation.Result = validator( request.params );
        if( !validated.valid ) return { ok: false, error: `invalid params: ${ validated.issues.map( ( issue : Validation.Issue ) : string => issue.message ).join( "; " ) }` };
        return { ok: true, data: definition };
    }

    /** Create a report run (`POST /report/runs`, report-2.1/4.1/4.2) — the ONE entry point for both an
     *  ad-hoc submission and a standing recurring schedule. Validates the report + params + `minAccess`
     *  ONCE (`validateRunRequest`), then branches on whether `request.schedule` was supplied: present →
     *  create a standing `Schedule` (each of its fires spawns its own fresh `Submission`); absent → create
     *  an ad-hoc `Submission` right away. Exactly one of the returned `{submission, schedule}` is set. */
    public async createRun( accountId : Type.ID, actingUserId : Type.ID, request : Report.CreateRun, callerRole : Access.Role ) : Promise<Type.Result<{ submission? : Report.Submission; schedule? : Report.Schedule }>>
    {
        const validated : Type.Result<Report.Definition> = this.validateRunRequest( request, callerRole );
        if( !validated.ok ) return { ok: false, error: validated.error };

        if( request.schedule !== undefined )
        {
            const created : Type.Result<Report.Schedule> = await this.createScheduleInternal( accountId, actingUserId, request, validated.data );
            if( !created.ok ) return { ok: false, error: created.error };
            return { ok: true, data: { schedule: created.data } };
        }

        const submitted : Type.Result<Report.Submission> = await this.createSubmission( accountId, actingUserId, request, validated.data );
        if( !submitted.ok ) return { ok: false, error: submitted.error };
        return { ok: true, data: { submission: submitted.data } };
    }

    /** Submit an ad-hoc run (report-2.1) — writes the Submission (status=SUBMITTED) and hands it to the
     *  `WorkQueue` governor for paced release onto the report-generate queue. Caller (`createRun`) has
     *  already validated `params`/`format`/`minAccess` via `validateRunRequest`. */
    private async createSubmission( accountId : Type.ID, submittedBy : Type.ID, request : Report.CreateRun, definition : Report.Definition ) : Promise<Type.Result<Report.Submission>>
    {
        const submissionId : Type.ID = randomUUID();
        const now : Type.ISODateTime = new Date().toISOString();
        const submission : Report.Submission =
        {
            accountId, submissionId, reportId: request.reportId, specVersion: definition.specVersion,
            submittedBy, createdAt: now, status: Report.SubmissionStatus.SUBMITTED,
            params: request.params, format: request.format,
            destinations: request.destinations?.length ? request.destinations : [ { kind: Report.DestinationKind.DOWNLOAD, config: {} } ],
        };

        const wrote : Type.Result<void> = await this.putSubmission( submission );
        if( !wrote.ok ) return { ok: false, error: wrote.error };

        await this.workQueue.enqueue( {
            jobId: submissionId, accountId, queue: "report", priority: 5, payloadRef: submissionId,
            idempotencyKey: submissionId, createdAt: now, meta: { submissionId },
        } );
        this.log.info( "report submitted", { accountId, submissionId, reportId: request.reportId, submittedBy, specVersion: definition.specVersion, params: request.params as Type.Json } );
        await this.emitSubmission( Events.Verb.CREATED, submission );
        return { ok: true, data: submission };
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** List an account's submissions (optionally filtered by report / status), newest first. Unpaged —
     *  the caller (impl) applies `Paging.paginate`. */
    public async listSubmissions( accountId : Type.ID, reportId? : Type.ID, status? : Report.SubmissionStatus ) : Promise<Type.Result<Array<Report.Submission>>>
    {
        const found : Type.Result<Array<Report.Submission>> = await this.dynamo.query<Report.Submission>( "report_submissions", {
            KeyConditionExpression:    "accountId = :a",
            ExpressionAttributeValues: { ":a": accountId },
        } );
        if( !found.ok ) return found;

        const rows : Array<Report.Submission> = found.data
            .filter( ( row : Report.Submission ) : boolean => reportId === undefined || row.reportId === reportId )
            .filter( ( row : Report.Submission ) : boolean => status === undefined || row.status === status )
            .sort( ( first : Report.Submission, second : Report.Submission ) : number => second.createdAt.localeCompare( first.createdAt ) );
        return { ok: true, data: rows };
    }

    /** One submission by id. */
    public async getSubmission( accountId : Type.ID, submissionId : Type.ID ) : Promise<Type.Result<Report.Submission | undefined>>
    {
        return this.dynamo.get<Report.Submission>( "report_submissions", { accountId, submissionId } );
    }

    /** Delete a submission's audit row + its S3 artifact (when present). Idempotent — the impl decides
     *  NOT_FOUND vs OK from the returned `found` flag. */
    public async deleteSubmission( accountId : Type.ID, submissionId : Type.ID ) : Promise<Type.Result<boolean>>
    {
        const found : Type.Result<Report.Submission | undefined> = await this.getSubmission( accountId, submissionId );
        if( !found.ok ) return { ok: false, error: found.error };
        if( found.data === undefined ) return { ok: true, data: false };

        if( found.data.outputKey !== undefined )
        {
            const removed : Type.Result<void> = await this.s3.remove( "report", found.data.outputKey );
            if( !removed.ok ) this.log.warn( "submission artifact removal failed", { accountId, submissionId, error: removed.error } );
        }
        const deleted : Type.Result<void> = await this.dynamo.remove( "report_submissions", { accountId, submissionId } );
        if( !deleted.ok ) return { ok: false, error: deleted.error };
        this.log.info( "report submission deleted", { accountId, submissionId } );
        return { ok: true, data: true };
    }

    /** S2S forget hook (report-11.1) — purge artifacts that MAY contain a forgotten subject's PII, ahead of
     *  the retention-TTL expiry. Report keeps no per-subject index into a report's generated rows (a
     *  submission's `params` is the only subject-adjacent field it stores — the artifact bytes themselves
     *  are opaque to report once written), so this is a best-effort scan: any submission whose serialized
     *  `params` mentions `subjectId` (e.g. a report scoped to a specific contact) has its artifact removed.
     *  Idempotent — matching zero rows is a normal, successful no-op. A broader per-artifact PII sweep would
     *  need each generator to record which subject ids it touched; deferred until a report actually needs it. */
    public async eraseSubject( accountId : Type.ID, subjectId : Type.ID ) : Promise<Type.Result<number>>
    {
        const found : Type.Result<Array<Report.Submission>> = await this.listSubmissions( accountId );
        if( !found.ok ) return { ok: false, error: found.error };

        const matches : Array<Report.Submission> = found.data.filter( ( row : Report.Submission ) : boolean => JSON.stringify( row.params ).includes( subjectId ) );
        let purged : number = 0;
        for( const row of matches )
        {
            if( row.outputKey === undefined ) continue;
            const removed : Type.Result<void> = await this.s3.remove( "report", row.outputKey );
            if( !removed.ok ) { this.log.warn( "erase: artifact removal failed", { accountId, submissionId: row.submissionId, error: removed.error } ); continue; }
            await this.putSubmission( { ...row, outputKey: undefined } );
            purged += 1;
        }
        this.log.info( "report erase applied", { accountId, subjectId, purged } );
        return { ok: true, data: purged };
    }

    /** A short-lived presigned GET for a completed submission's artifact. `undefined` when the submission
     *  isn't complete / has no artifact yet (the impl maps that to a distinct CONFLICT, not a plain 404). */
    public async presignDownload( accountId : Type.ID, submissionId : Type.ID ) : Promise<Type.Result<ReportService.DownloadLink | undefined>>
    {
        const found : Type.Result<Report.Submission | undefined> = await this.getSubmission( accountId, submissionId );
        if( !found.ok ) return { ok: false, error: found.error };
        if( found.data === undefined || found.data.outputKey === undefined ) return { ok: true, data: undefined };

        const ttlSec : number = 900;
        const presigned : Type.Result<string> = await this.s3.presignGet( "report", found.data.outputKey, ttlSec );
        if( !presigned.ok ) return { ok: false, error: presigned.error };
        return { ok: true, data: { url: presigned.data, expiresAt: new Date( Date.now() + ( ttlSec * 1000 ) ).toISOString() } };
    }

    // persist a submission row.
    private async putSubmission( submission : Report.Submission ) : Promise<Type.Result<void>>
    {
        const wrote : Type.Result<void> = await this.dynamo.put( "report_submissions", { ...submission } );
        if( !wrote.ok ) this.log.warn( "submission write failed", { accountId: submission.accountId, submissionId: submission.submissionId, error: wrote.error } );
        return wrote;
    }

    /** Publish a `report.report` lifecycle event (best-effort — report-7.1's `report.completed`, and the
     *  submission's own created/updated occurrences). */
    public async emitSubmission( verb : Events.Verb, submission : Report.Submission ) : Promise<void>
    {
        const published : Type.Result<void> = await this.kafka.publishEvent( Events.envelope( {
            object:    Events.Object.REPORT_REPORT,
            verb,
            accountId: submission.accountId,
            target:    { type: "report.submission", id: submission.submissionId },
            data:      submission,
            actorUserId: submission.submittedBy,
        } ) );
        if( !published.ok ) this.log.warn( "report.report event publish failed", { submissionId: submission.submissionId, verb, error: published.error } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // ── Schedules (report-4.0) ─────────────────────────────────────────────────────────────────

    /** Create a recurring schedule (report-4.1/4.2) — validates the params carry a RELATIVE window
     *  (report-3.3) + the `ical` recurrence, computes the initial `nextFireAt`, and writes the row ACTIVE.
     *  Caller (`createRun`) has already validated `params`/`format`/`minAccess` via `validateRunRequest`
     *  and confirmed `request.schedule` is present. */
    private async createScheduleInternal( accountId : Type.ID, createdBy : Type.ID, request : Report.CreateRun, definition : Report.Definition ) : Promise<Type.Result<Report.Schedule>>
    {
        const window : Report.DateWindow | undefined = ReportService.windowOf( request.params );
        if( window !== undefined && window.kind === "fixed" ) return { ok: false, error: "a schedule's window must be relative — a fixed window is blocked (report-3.3)" };

        const recurrence : Report.RunSchedule = request.schedule!;
        const validIcal : Type.Result<void> = Ical.validate( recurrence.ical );
        if( !validIcal.ok ) return { ok: false, error: validIcal.error };

        const nextFire : Type.Result<Date> = Ical.nextOccurrence( recurrence.ical, recurrence.timezone, new Date() );
        if( !nextFire.ok ) return { ok: false, error: nextFire.error };

        const scheduleId : Type.ID = randomUUID();
        const now : Type.ISODateTime = new Date().toISOString();
        const schedule : Report.Schedule =
        {
            accountId, scheduleId, reportId: request.reportId, specVersion: definition.specVersion,
            ical: recurrence.ical, timezone: recurrence.timezone, params: request.params, format: request.format,
            destinations: request.destinations?.length ? request.destinations : [ { kind: Report.DestinationKind.DOWNLOAD, config: {} } ],
            createdBy, status: Report.ScheduleStatus.ACTIVE, createdAt: now, nextFireAt: nextFire.data.toISOString(),
        };

        const wrote : Type.Result<void> = await this.putSchedule( schedule );
        if( !wrote.ok ) return { ok: false, error: wrote.error };
        this.log.info( "report schedule created", { accountId, scheduleId, reportId: request.reportId, createdBy, specVersion: definition.specVersion } );
        await this.emitSchedule( Events.Verb.CREATED, schedule );
        return { ok: true, data: schedule };
    }

    /** List an account's schedules (optionally filtered by report / status / specVersion). Unpaged. */
    public async listSchedules( accountId : Type.ID, reportId? : Type.ID, status? : Report.ScheduleStatus, specVersion? : number ) : Promise<Type.Result<Array<Report.Schedule>>>
    {
        const found : Type.Result<Array<Report.Schedule>> = await this.dynamo.query<Report.Schedule>( "report_schedules", {
            KeyConditionExpression:    "accountId = :a",
            ExpressionAttributeValues: { ":a": accountId },
        } );
        if( !found.ok ) return found;

        const rows : Array<Report.Schedule> = found.data
            .filter( ( row : Report.Schedule ) : boolean => reportId === undefined || row.reportId === reportId )
            .filter( ( row : Report.Schedule ) : boolean => status === undefined || row.status === status )
            .filter( ( row : Report.Schedule ) : boolean => specVersion === undefined || row.specVersion === specVersion )
            .sort( ( first : Report.Schedule, second : Report.Schedule ) : number => second.createdAt.localeCompare( first.createdAt ) );
        return { ok: true, data: rows };
    }

    /** One schedule by id. */
    public async getSchedule( accountId : Type.ID, scheduleId : Type.ID ) : Promise<Type.Result<Report.Schedule | undefined>>
    {
        return this.dynamo.get<Report.Schedule>( "report_schedules", { accountId, scheduleId } );
    }

    /** Partially update a schedule's `ical` / `params` / `format` / `timezone` / `destination` (report-4.1).
     *  A supplied `params` is re-validated against the report's CURRENT `paramsSchema`; a supplied `ical` /
     *  `timezone` recomputes `nextFireAt`. */
    public async patchSchedule( accountId : Type.ID, scheduleId : Type.ID, patch : ReportService.SchedulePatch ) : Promise<Type.Result<Report.Schedule | undefined>>
    {
        const found : Type.Result<Report.Schedule | undefined> = await this.getSchedule( accountId, scheduleId );
        if( !found.ok ) return { ok: false, error: found.error };
        if( found.data === undefined ) return { ok: true, data: undefined };
        const existing : Report.Schedule = found.data;

        const definition : Report.Definition | undefined = findReport( existing.reportId );
        if( definition === undefined ) return { ok: false, error: `unknown reportId "${ existing.reportId }"` };

        if( patch.params !== undefined )
        {
            const window : Report.DateWindow | undefined = ReportService.windowOf( patch.params );
            if( window !== undefined && window.kind === "fixed" ) return { ok: false, error: "a schedule's window must be relative — a fixed window is blocked (report-3.3)" };
            const validator : Validation.Validator<unknown> = Validation.compile( definition.paramsSchema as Validation.Schema );
            const validated : Validation.Result = validator( patch.params );
            if( !validated.valid ) return { ok: false, error: `invalid params: ${ validated.issues.map( ( issue : Validation.Issue ) : string => issue.message ).join( "; " ) }` };
        }
        if( patch.format !== undefined && !definition.formats.includes( patch.format ) ) return { ok: false, error: `report "${ existing.reportId }" does not support format "${ patch.format }"` };
        if( patch.ical !== undefined )
        {
            const validIcal : Type.Result<void> = Ical.validate( patch.ical );
            if( !validIcal.ok ) return { ok: false, error: validIcal.error };
        }

        const merged : Report.Schedule =
        {
            ...existing,
            ical:        patch.ical ?? existing.ical,
            timezone:    patch.timezone ?? existing.timezone,
            params:      patch.params ?? existing.params,
            format:      patch.format ?? existing.format,
            destinations: patch.destinations?.length ? patch.destinations : existing.destinations,
        };

        // recompute nextFireAt whenever the recurrence or its evaluating zone changed
        if( patch.ical !== undefined || patch.timezone !== undefined )
        {
            const nextFire : Type.Result<Date> = Ical.nextOccurrence( merged.ical, merged.timezone, new Date() );
            if( !nextFire.ok ) return { ok: false, error: nextFire.error };
            merged.nextFireAt = nextFire.data.toISOString();
        }

        const wrote : Type.Result<void> = await this.putSchedule( merged );
        if( !wrote.ok ) return { ok: false, error: wrote.error };
        await this.emitSchedule( Events.Verb.UPDATED, merged );
        return { ok: true, data: merged };
    }

    /** Manually pause a schedule (report-6.3). */
    public async pauseSchedule( accountId : Type.ID, scheduleId : Type.ID, pausedBy : Type.ID, reason? : string ) : Promise<Type.Result<Report.Schedule | undefined>>
    {
        return this.setPaused( accountId, scheduleId, Report.ScheduleStatus.PAUSED, pausedBy, reason );
    }

    /** The platform's auto-pause stop-loss (report-6.2) — ANY generation failure on a scheduled run pauses
     *  it immediately; `pausedBy` is `"system"`. */
    public async autoPauseSchedule( accountId : Type.ID, scheduleId : Type.ID, reason : string ) : Promise<Type.Result<Report.Schedule | undefined>>
    {
        return this.setPaused( accountId, scheduleId, Report.ScheduleStatus.AUTO_PAUSED, "system", reason );
    }

    // shared pause application — manual PAUSED and platform AUTO_PAUSED only differ in status + pausedBy.
    private async setPaused( accountId : Type.ID, scheduleId : Type.ID, status : Report.ScheduleStatus, pausedBy : Type.ID | "system", reason? : string ) : Promise<Type.Result<Report.Schedule | undefined>>
    {
        const found : Type.Result<Report.Schedule | undefined> = await this.getSchedule( accountId, scheduleId );
        if( !found.ok ) return { ok: false, error: found.error };
        if( found.data === undefined ) return { ok: true, data: undefined };

        const paused : Report.Schedule = { ...found.data, status, pausedBy, pausedReason: reason, pausedAt: new Date().toISOString() };
        const wrote : Type.Result<void> = await this.putSchedule( paused );
        if( !wrote.ok ) return { ok: false, error: wrote.error };
        this.log.info( "report schedule paused", { accountId, scheduleId, status, pausedBy, reason } );
        await this.emitSchedule( Events.Verb.UPDATED, paused );
        return { ok: true, data: paused };
    }

    /** Resume a paused/auto-paused schedule (report-6.3) — clears the pause fields; the caller is expected
     *  to have already fixed the underlying cause. */
    public async resumeSchedule( accountId : Type.ID, scheduleId : Type.ID ) : Promise<Type.Result<Report.Schedule | undefined>>
    {
        const found : Type.Result<Report.Schedule | undefined> = await this.getSchedule( accountId, scheduleId );
        if( !found.ok ) return { ok: false, error: found.error };
        if( found.data === undefined ) return { ok: true, data: undefined };

        const resumed : Report.Schedule = { ...found.data, status: Report.ScheduleStatus.ACTIVE, pausedBy: undefined, pausedReason: undefined, pausedAt: undefined };
        const nextFire : Type.Result<Date> = Ical.nextOccurrence( resumed.ical, resumed.timezone, new Date() );
        if( nextFire.ok ) resumed.nextFireAt = nextFire.data.toISOString();

        const wrote : Type.Result<void> = await this.putSchedule( resumed );
        if( !wrote.ok ) return { ok: false, error: wrote.error };
        this.log.info( "report schedule resumed", { accountId, scheduleId } );
        await this.emitSchedule( Events.Verb.UPDATED, resumed );
        return { ok: true, data: resumed };
    }

    /** Delete a schedule (report-4.2) — does not touch already-produced Submissions, only stops future fires. */
    public async deleteSchedule( accountId : Type.ID, scheduleId : Type.ID ) : Promise<Type.Result<boolean>>
    {
        const found : Type.Result<Report.Schedule | undefined> = await this.getSchedule( accountId, scheduleId );
        if( !found.ok ) return { ok: false, error: found.error };
        if( found.data === undefined ) return { ok: true, data: false };

        const deleted : Type.Result<void> = await this.dynamo.remove( "report_schedules", { accountId, scheduleId } );
        if( !deleted.ok ) return { ok: false, error: deleted.error };
        this.log.info( "report schedule deleted", { accountId, scheduleId } );
        await this.emitSchedule( Events.Verb.DELETED, found.data );
        return { ok: true, data: true };
    }

    /** Pre-drop sweep (report-8.2) — schedules ACROSS ALL ACCOUNTS still pinned to `specVersion`. A rarely-run
     *  ops surface (APPLICATION-only), so a full-table scan (via the raw client) is acceptable here — there is
     *  no cross-account specVersion GSI (only the "due" GSI, keyed by status/nextFireAt, exists). */
    public async listStaleSchedules( specVersion : number ) : Promise<Type.Result<Array<Report.Schedule>>>
    {
        return ResultUtils.from( async () : Promise<Array<Report.Schedule>> =>
        {
            const output : ScanCommandOutput = await this.dynamo.client.send( new ScanCommand( { TableName: this.dynamo.table( "report_schedules" ) } ) );
            const rows : Array<Report.Schedule> = ( output.Items ?? [] ) as Array<Report.Schedule>;
            return rows.filter( ( row : Report.Schedule ) : boolean => row.specVersion === specVersion );
        } );
    }

    // persist a schedule row.
    private async putSchedule( schedule : Report.Schedule ) : Promise<Type.Result<void>>
    {
        const wrote : Type.Result<void> = await this.dynamo.put( "report_schedules", { ...schedule } );
        if( !wrote.ok ) this.log.warn( "schedule write failed", { accountId: schedule.accountId, scheduleId: schedule.scheduleId, error: wrote.error } );
        return wrote;
    }

    /** Publish a `report.schedule` lifecycle event (best-effort). */
    public async emitSchedule( verb : Events.Verb, schedule : Report.Schedule ) : Promise<void>
    {
        const published : Type.Result<void> = await this.kafka.publishEvent( Events.envelope( {
            object:    Events.Object.REPORT_SCHEDULE,
            verb,
            accountId: schedule.accountId,
            target:    { type: "report.schedule", id: schedule.scheduleId },
            data:      schedule,
            actorUserId: schedule.createdBy,
        } ) );
        if( !published.ok ) this.log.warn( "report.schedule event publish failed", { scheduleId: schedule.scheduleId, verb, error: published.error } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // ── Dispatch (report-12.2 — the WorkQueue governor's paced release onto report-generate) ────

    /** COORDINATOR TICK: pull the next paced batch from the `WorkQueue` governor (fair-share across accounts)
     *  and push each leased submission's id onto the real `report-generate` SQS queue — the actual generation
     *  happens off that queue (drained locally by MAIN / by `ReportGenerateJob` in a deploy), so "released to
     *  the generation queue" is this governed step's completion, not the generation's own outcome. Never
     *  throws (one bad lease is logged and skipped). */
    public async dispatchPending() : Promise<void>
    {
        const leases : Array<WorkQueue.Lease> = await this.workQueue.dispatch();
        if( leases.length === 0 ) return;
        this.log.trace( "report dispatch round", { leased: leases.length } );
        for( const lease of leases ) await this.dispatchOne( lease );
    }

    // release ONE governed submission onto the real report-generate queue, then settle the WorkQueue job.
    private async dispatchOne( lease : WorkQueue.Lease ) : Promise<void>
    {
        const sent : Type.Result<void> = await this.sqs.send( "report-generate", { accountId: lease.job.accountId, submissionId: lease.job.payloadRef } );
        if( !sent.ok )
        {
            this.log.warn( "report dispatch enqueue failed", { jobId: lease.job.jobId, error: sent.error } );
            await this.workQueue.fail( lease.job.jobId, `report-generate enqueue failed: ${ sent.error }` );
            return;
        }
        await this.workQueue.complete( lease.job.jobId );
        this.log.trace( "report submission released to generate queue", { accountId: lease.job.accountId, submissionId: lease.job.payloadRef } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // ── Generation (report-2.2/2.3, report-6.x, report-7.x) — the ONE shared pipeline ────────────

    /** WORKER: generate one submission end-to-end — resolve the window, pull the data (via the catalog's
     *  generator), render the requested format, store it in S3, stamp the Submission COMPLETE (or ERROR +
     *  auto-pause its Schedule), deliver the completion notice, and publish `report.completed`. Called
     *  IDENTICALLY by MAIN's local queue drain and by `ReportGenerateJob`'s Lambda handler — there is exactly
     *  ONE code path for generation (see apps/core/report/SPECS.md's Service & Job topology). Never throws. */
    public async processSubmission( accountId : Type.ID, submissionId : Type.ID ) : Promise<void>
    {
        const found : Type.Result<Report.Submission | undefined> = await this.getSubmission( accountId, submissionId );
        if( !found.ok || found.data === undefined ) { this.log.warn( "generation skipped — submission not found", { accountId, submissionId } ); return; }
        let submission : Report.Submission = { ...found.data, status: Report.SubmissionStatus.RUNNING, startedAt: new Date().toISOString() };
        await this.putSubmission( submission );

        const definition : Report.Definition | undefined = findReport( submission.reportId );
        if( definition === undefined ) { await this.failSubmission( submission, "unknown reportId", "BAD_REPORT" ); return; }

        // resolve the window (if this report declares one) — stamped onto the Submission for reproducibility
        const window : Report.DateWindow | undefined = ReportService.windowOf( submission.params );
        let resolvedWindow : { start : string; end : string } | undefined = undefined;
        if( window !== undefined )
        {
            const resolved : Type.Result<{ start : string; end : string }> = DateWindowUtils.resolveDateWindow( window, "UTC", new Date() );
            if( !resolved.ok ) { await this.failSubmission( submission, resolved.error, "BAD_WINDOW" ); return; }
            resolvedWindow = resolved.data;
            submission = { ...submission, window: resolvedWindow };
            await this.putSubmission( submission );
        }

        const generator : ReportGenerator | undefined = this.generators.get( definition.generator );
        if( generator === undefined ) { await this.failSubmission( submission, `no generator registered for "${ definition.generator }"`, "NO_GENERATOR" ); return; }

        const generated : Type.Result<ReportGenerator.GenerateResult> = await generator.generate( { accountId, window: resolvedWindow, params: submission.params } );
        if( !generated.ok ) { await this.failSubmission( submission, generated.error, "SOURCE_UNAVAILABLE" ); return; }

        const writer : Writer | undefined = this.writers.get( submission.format );
        if( writer === undefined ) { await this.failSubmission( submission, `no writer registered for format "${ submission.format }"`, "BAD_FORMAT" ); return; }

        const buffer : Buffer = await writer.write( generated.data.rows, generated.data.columns );

        const key : Type.Result<string> = this.s3.key( { domain: S3.Domain.REPORT, accountId, reportId: submission.reportId, submissionId, ext: submission.format } );
        if( !key.ok ) { await this.failSubmission( submission, key.error, "BAD_KEY" ); return; }
        const stored : Type.Result<void> = await this.s3.put( "report", key.data, buffer, ReportService.contentTypeFor( submission.format ) );
        if( !stored.ok ) { await this.failSubmission( submission, stored.error, "STORE_FAILED" ); return; }

        const completed : Report.Submission = {
            ...submission, status: Report.SubmissionStatus.COMPLETE, outputKey: key.data,
            size: buffer.byteLength, recordCount: generated.data.rows.length, completedAt: new Date().toISOString(),
        };
        await this.putSubmission( completed );
        this.log.info( "report generated", { accountId, submissionId, reportId: submission.reportId, format: submission.format, size: completed.size, recordCount: completed.recordCount } );

        await this.deliverCompletion( completed );
        await this.emitSubmission( Events.Verb.CREATED, completed );
    }

    // stamp a submission ERROR + auto-pause its Schedule (if it has one) — the single failure exit used
    // throughout processSubmission (report-6.1/6.2).
    private async failSubmission( submission : Report.Submission, reason : string, code : string ) : Promise<void>
    {
        const failed : Report.Submission = { ...submission, status: Report.SubmissionStatus.ERROR, error: { reason, code }, completedAt: new Date().toISOString() };
        await this.putSubmission( failed );
        this.log.warn( "report generation failed", { accountId: failed.accountId, submissionId: failed.submissionId, reason, code } );
        await this.emitSubmission( Events.Verb.UPDATED, failed );

        if( failed.scheduleId !== undefined )
        {
            await this.autoPauseSchedule( failed.accountId, failed.scheduleId, reason );
            this.log.warn( "schedule auto-paused after generation failure", { accountId: failed.accountId, scheduleId: failed.scheduleId, reason } );
            // report-6.3: notify the scheduler (createdBy) — delivered as a best-effort email via the
            // completion-destination email path is a workflow concern; here we only publish the domain event
            // (report.schedule UPDATED, already emitted by autoPauseSchedule) the account's workflow reacts to.
        }
    }

    // publish/deliver the completion notice to EVERY destination the submission declared (default DOWNLOAD) —
    // fan-out: each destination is delivered independently, and one failing must not stop the others.
    private async deliverCompletion( submission : Report.Submission ) : Promise<void>
    {
        if( submission.outputKey === undefined ) return;
        const presigned : Type.Result<string> = await this.s3.presignGet( "report", submission.outputKey, 900 );
        if( !presigned.ok ) { this.log.warn( "completion download-link presign failed", { submissionId: submission.submissionId, error: presigned.error } ); return; }

        for( const destination of submission.destinations )
        {
            const handler : Destination | undefined =
                this.destinations.get( destination.kind ) ?? this.destinations.get( Report.DestinationKind.DOWNLOAD );
            if( handler === undefined ) continue;
            const delivered : Type.Result<void> = await handler.deliver( { accountId: submission.accountId, submission, destination, downloadUrl: presigned.data } );
            if( !delivered.ok ) this.log.warn( "completion delivery failed", { submissionId: submission.submissionId, kind: destination.kind, error: delivered.error } );
        }
    }

    // the MIME type S3 stores alongside each format's artifact.
    private static contentTypeFor( format : Report.Format ) : string
    {
        switch( format )
        {
            case "csv":  return "text/csv";
            case "json": return "application/json";
            case "xlsx": return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
            case "pdf":  return "application/pdf";
            default:     return "application/octet-stream";
        }
    }

    // pull `params.window` back out of the loose Type.Json bag, if the report declared one (a type guard,
    // not a schema re-validation — the schema already confirmed its shape at submit/schedule-create time).
    private static windowOf( params : Type.Json ) : Report.DateWindow | undefined
    {
        if( typeof params !== "object" || params === null || Array.isArray( params ) ) return undefined;
        const window : unknown = ( params as Record<string, unknown> ).window;
        return window as Report.DateWindow | undefined;
    }
}

export namespace ReportService
{
    export enum Role { MAIN = "main" }
    export const PORT : Record<Role, number> = { [ Role.MAIN ]: Ports.REPORT.MAIN };

    /** {@link ReportService.presignDownload}'s result shape. */
    export interface DownloadLink { url : string; expiresAt : Type.ISODateTime; }

    /** The partial fields {@link ReportService.patchSchedule} accepts. */
    export interface SchedulePatch
    {
        ical?         : string;
        params?       : Type.Json;
        format?       : Report.Format;
        timezone?     : string;
        destinations? : Array<Report.Destination>;
    }
}

export default ReportService;
// eof
