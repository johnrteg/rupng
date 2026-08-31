//
import { GetReportSchedulesStale, Report, Paging } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";

import ReportService from "../services/ReportService";

//
// Pre-drop sweep (report-8.2) — schedules ACROSS ALL ACCOUNTS still pinned to an old specVersion, ahead of
// dropping it (human-in-the-loop CS remediation). APPLICATION-gated (enforced by the framework's `access`
// check before `execute` runs) — a platform ops surface, not account-scoped.
//
export class GetReportSchedulesStaleImpl extends GetReportSchedulesStale
{
    private service : ReportService;
    constructor( service : ReportService ) { super(); this.service = service; }

    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId ) return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };

        const query : GetReportSchedulesStale.Query = this.query ?? { specVersion: 0 };
        const found : Type.Result<Array<Report.Schedule>> = await this.service.listStaleSchedules( query.specVersion );
        if( !found.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: found.error } };

        const paged : Paging.Result<Report.Schedule> = Paging.paginate( found.data, query );
        return { status: NetworkUtils.Status.OK, data: paged };
    }
}

export default GetReportSchedulesStaleImpl;
// eof
