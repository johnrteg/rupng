//
import { GetReportSchedule, Report } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";

import ReportService from "../services/ReportService";

//
// Get a single schedule's detail by id (report-4.2) — including lastFiredAt/nextFireAt/pause state.
//
export class GetReportScheduleImpl extends GetReportSchedule
{
    private service : ReportService;
    constructor( service : ReportService ) { super(); this.service = service; }

    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId || !auth.accountId ) return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };

        const found : Type.Result<Report.Schedule | undefined> = await this.service.getSchedule( auth.accountId, this.query.scheduleId );
        if( !found.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: found.error } };
        if( found.data === undefined ) return { status: NetworkUtils.Status.NOT_FOUND, data: { message: "schedule not found" } };
        return { status: NetworkUtils.Status.OK, data: { schedule: found.data } };
    }
}

export default GetReportScheduleImpl;
// eof
