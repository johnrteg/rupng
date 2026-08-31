//
import { PostReportRuns, Report } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint, Access } from "@repo/endpoint";

import ReportService from "../services/ReportService";

//
// Create a report run (report-2.1/4.1/4.2) — ONE endpoint for both an ad-hoc run and a recurring schedule.
// Omitting `schedule` enqueues an ad-hoc Submission (status=submitted); supplying it (RFC-5545 `ical` + an
// IANA `timezone`) creates a standing Schedule instead. Exactly one of `{submission, schedule}` comes back.
//
export class PostReportRunsImpl extends PostReportRuns
{
    private service : ReportService;
    constructor( service : ReportService ) { super(); this.service = service; }

    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId || !auth.accountId ) return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };

        const body : PostReportRuns.Body | null = this.body;
        if( !body || !body.reportId || !body.params || !body.format )
            return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "reportId, params, and format are required" } };
        if( body.schedule !== undefined && ( !body.schedule.ical || !body.schedule.timezone ) )
            return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "schedule.ical and schedule.timezone are required when schedule is supplied" } };

        const callerRole : Access.Role = ( auth.role as Access.Role ) ?? Access.AccountRole.MINIMUM;
        const created : Type.Result<{ submission? : Report.Submission; schedule? : Report.Schedule }> =
            await this.service.createRun( auth.accountId, auth.userId, body, callerRole );
        if( !created.ok )
        {
            const status : NetworkUtils.Status = created.error.includes( "requires at least" ) ? NetworkUtils.Status.FORBIDDEN : NetworkUtils.Status.BAD_REQUEST;
            return { status, data: { message: created.error } };
        }
        return { status: NetworkUtils.Status.OK, data: created.data };
    }
}

export default PostReportRunsImpl;
// eof
