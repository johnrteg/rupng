//
import { PostReportScheduleResume, Report } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";

import ReportService from "../services/ReportService";

//
// Resume a paused/auto-paused schedule (report-6.3).
//
export class PostReportScheduleResumeImpl extends PostReportScheduleResume
{
    private service : ReportService;
    constructor( service : ReportService ) { super(); this.service = service; }

    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId || !auth.accountId ) return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };

        const resumed : Type.Result<Report.Schedule | undefined> = await this.service.resumeSchedule( auth.accountId, this.query.scheduleId );
        if( !resumed.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: resumed.error } };
        if( resumed.data === undefined ) return { status: NetworkUtils.Status.NOT_FOUND, data: { message: "schedule not found" } };
        return { status: NetworkUtils.Status.OK, data: { schedule: resumed.data } };
    }
}

export default PostReportScheduleResumeImpl;
// eof
