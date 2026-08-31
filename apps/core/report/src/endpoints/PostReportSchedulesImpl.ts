//
import { PostReportSchedules, Report } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint, Access } from "@repo/endpoint";

import ReportService from "../services/ReportService";

//
// Create a recurring (iCal) schedule (report-4.1/4.2). `params` must carry a RELATIVE date window
// (report-3.3) — the service rejects a fixed one.
//
export class PostReportSchedulesImpl extends PostReportSchedules
{
    private service : ReportService;
    constructor( service : ReportService ) { super(); this.service = service; }

    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId || !auth.accountId ) return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };

        const body : PostReportSchedules.Body | null = this.body;
        if( !body || !body.reportId || !body.ical || !body.timezone || !body.params || !body.format )
            return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "reportId, ical, timezone, params, and format are required" } };

        const callerRole : Access.Role = ( auth.role as Access.Role ) ?? Access.AccountRole.MINIMUM;
        const created : Type.Result<Report.Schedule> = await this.service.createSchedule( auth.accountId, auth.userId, body, callerRole );
        if( !created.ok )
        {
            const status : NetworkUtils.Status = created.error.includes( "requires at least" ) ? NetworkUtils.Status.FORBIDDEN : NetworkUtils.Status.BAD_REQUEST;
            return { status, data: { message: created.error } };
        }
        return { status: NetworkUtils.Status.OK, data: { schedule: created.data } };
    }
}

export default PostReportSchedulesImpl;
// eof
