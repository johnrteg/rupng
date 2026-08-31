//
import { Context } from "aws-lambda";
import { randomUUID } from "node:crypto";

import { Report, findReport } from "@repo/api";
import type { Type } from "@repo/common";
import { Events } from "@repo/system";

import ReportJob from "./ReportJob";
import { IcalUtils } from "../scheduling/IcalUtils";

//
// ReportScheduleJob — fires due recurring schedules. Runs every minute (EventBridge `rate(1 minute)`),
// sweeps the schedules table's cross-account "due" GSI for ACTIVE schedules whose `nextFireAt` has passed,
// and for each: creates a fresh Submission (`scheduleId` set, `specVersion` pinned from the Schedule),
// enqueues it via the `WorkQueue` governor (the SAME path `ReportService.submit` uses), and recomputes +
// stamps `lastFiredAt`/`nextFireAt`. Mirrors `SocialScheduleJob`'s handler structure.
//
export class ReportScheduleJob extends ReportJob<unknown, void>
{
    /////////////////////////////////////////////////////////////////////
    constructor() { super( "reportScheduleJob" ); }

    /////////////////////////////////////////////////////////////////////
    public async handler( _event : unknown, _context : Context ) : Promise<void>
    {
        const now : Type.ISODateTime = new Date().toISOString();

        const due : Type.Result<Array<Report.Schedule>> = await this.report.dynamo.query<Report.Schedule>( "report_schedules", {
            IndexName:                 "due",
            KeyConditionExpression:    "#status = :s AND nextFireAt <= :now",
            ExpressionAttributeNames:  { "#status": "status" },
            ExpressionAttributeValues: { ":s": Report.ScheduleStatus.ACTIVE, ":now": now },
        } );
        if( !due.ok ) { this.log.warn( "schedule sweep read failed", { error: due.error } ); return; }

        for( const schedule of due.data ) await this.fireOne( schedule );
    }

    /////////////////////////////////////////////////////////////////////
    // fire ONE due schedule: create its fresh Submission, enqueue it, then recompute + stamp its next fire.
    private async fireOne( schedule : Report.Schedule ) : Promise<void>
    {
        const definition : Report.Definition | undefined = findReport( schedule.reportId );
        if( definition === undefined ) { this.log.warn( "schedule fire skipped — unknown reportId", { scheduleId: schedule.scheduleId, reportId: schedule.reportId } ); return; }

        const submissionId : Type.ID = randomUUID();
        const now : Type.ISODateTime = new Date().toISOString();
        const submission : Report.Submission =
        {
            accountId: schedule.accountId, submissionId, reportId: schedule.reportId, specVersion: schedule.specVersion,
            submittedBy: schedule.createdBy, createdAt: now, status: Report.SubmissionStatus.SUBMITTED,
            params: schedule.params, format: schedule.format, destination: schedule.destination, scheduleId: schedule.scheduleId,
        };

        const wrote : Type.Result<void> = await this.report.dynamo.put( "report_submissions", { ...submission } );
        if( !wrote.ok ) { this.log.warn( "schedule fire: submission write failed", { scheduleId: schedule.scheduleId, error: wrote.error } ); return; }
        await this.report.emitSubmission( Events.Verb.CREATED, submission );

        await this.report.workQueue.enqueue( {
            jobId: submissionId, accountId: schedule.accountId, queue: "report", priority: 5, payloadRef: submissionId,
            idempotencyKey: submissionId, createdAt: now, meta: { submissionId },
        } );

        const nextFire : Type.Result<Date> = IcalUtils.nextOccurrence( schedule.ical, schedule.timezone, new Date( now ) );
        const stamped : Report.Schedule = { ...schedule, lastFiredAt: now, nextFireAt: nextFire.ok ? nextFire.data.toISOString() : undefined };
        const restamped : Type.Result<void> = await this.report.dynamo.put( "report_schedules", { ...stamped } );
        if( !restamped.ok ) this.log.warn( "schedule fire: re-stamp failed", { scheduleId: schedule.scheduleId, error: restamped.error } );
        this.log.info( "report schedule fired", { accountId: schedule.accountId, scheduleId: schedule.scheduleId, submissionId } );
    }
}

//
// Lambda entrypoint — manifest `jobs.reportScheduleJob`, handler "jobs/ReportScheduleJob.handler".
//
const job : ReportScheduleJob = new ReportScheduleJob();
export const handler = ( event : unknown, context : Context ) : Promise<void> => job.invoke( event, context );

export default ReportScheduleJob;
// eof
