//
import { PostReportSchedulePause, Report } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";

import ReportService from "../services/ReportService";

//
// Manually pause a schedule (report-6.3).
//
export class PostReportSchedulePauseImpl extends PostReportSchedulePause
{
    private service : ReportService;
    constructor( service : ReportService ) { super(); this.service = service; }

    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId || !auth.accountId ) return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };

        const reason : string | undefined = this.body?.reason;
        const paused : Type.Result<Report.Schedule | undefined> = await this.service.pauseSchedule( auth.accountId, this.query.scheduleId, auth.userId, reason );
        if( !paused.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: paused.error } };
        if( paused.data === undefined ) return { status: NetworkUtils.Status.NOT_FOUND, data: { message: "schedule not found" } };
        return { status: NetworkUtils.Status.OK, data: { schedule: paused.data } };
    }
}

export default PostReportSchedulePauseImpl;
// eof
