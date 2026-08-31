//
import { PatchReportSchedule, Report } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";

import ReportService from "../services/ReportService";

//
// Partially update a schedule's ical/params/format/timezone/destination (report-4.1).
//
export class PatchReportScheduleImpl extends PatchReportSchedule
{
    private service : ReportService;
    constructor( service : ReportService ) { super(); this.service = service; }

    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId || !auth.accountId ) return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };

        const body : PatchReportSchedule.Body | null = this.body;
        if( !body ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "a body is required" } };

        const patched : Type.Result<Report.Schedule | undefined> = await this.service.patchSchedule( auth.accountId, this.query.scheduleId, body );
        if( !patched.ok ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: patched.error } };
        if( patched.data === undefined ) return { status: NetworkUtils.Status.NOT_FOUND, data: { message: "schedule not found" } };
        return { status: NetworkUtils.Status.OK, data: { schedule: patched.data } };
    }
}

export default PatchReportScheduleImpl;
// eof
