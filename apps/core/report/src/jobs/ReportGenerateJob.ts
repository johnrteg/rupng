//
import { Context } from "aws-lambda";

import ReportJob from "./ReportJob";

//
// ReportGenerateJob — SQS-triggered (per-account fair-share, released by `ReportMainService`/a future
// dedicated dispatcher's `WorkQueue` round). For each `{ accountId, submissionId }` ref in the batch, runs
// the SAME `ReportService.processSubmission` pipeline `ReportMainService`'s local queue drain calls (see
// `ReportJob`'s doc) — pull data, render the format, store to S3, stamp the Submission, deliver the
// completion notice, publish `report.completed`. Lambda < 15 min (report-13.4); a Fargate long-generation
// path is deferred (see CloudManifest's file-header note).
//
export class ReportGenerateJob extends ReportJob<unknown, void>
{
    /////////////////////////////////////////////////////////////////////
    constructor() { super( "reportGenerateJob" ); }

    /////////////////////////////////////////////////////////////////////
    public async handler( event : unknown, _context : Context ) : Promise<void>
    {
        const refs : Array<{ accountId : string; submissionId : string }> = this.submissionRefs( event );
        for( const ref of refs ) await this.report.processSubmission( ref.accountId, ref.submissionId );
    }
}

//
// Lambda entrypoint — manifest `jobs.reportGenerateJob`, handler "jobs/ReportGenerateJob.handler".
//
const job : ReportGenerateJob = new ReportGenerateJob();
export const handler = ( event : unknown, context : Context ) : Promise<void> => job.invoke( event, context );

export default ReportGenerateJob;
// eof
