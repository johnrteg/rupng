//
import { GetReportSchedules, Report, Paging } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";

import ReportService from "../services/ReportService";

//
// List the acting account's recurring schedules (paged), filterable by reportId/status/specVersion (report-4.1).
//
export class GetReportSchedulesImpl extends GetReportSchedules
{
    private service : ReportService;
    constructor( service : ReportService ) { super(); this.service = service; }

    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId || !auth.accountId ) return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };

        const query : GetReportSchedules.Query = this.query ?? {};
        const found : Type.Result<Array<Report.Schedule>> = await this.service.listSchedules( auth.accountId, query.reportId, query.status, query.specVersion );
        if( !found.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: found.error } };

        const paged : Paging.Result<Report.Schedule> = Paging.paginate( found.data, query );
        return { status: NetworkUtils.Status.OK, data: paged };
    }
}

export default GetReportSchedulesImpl;
// eof
