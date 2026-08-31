//
import { GetReportSubmissions, Report, Paging } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";

import ReportService from "../services/ReportService";

//
// List the acting account's report submissions (paged), newest first (report-2.4).
//
export class GetReportSubmissionsImpl extends GetReportSubmissions
{
    private service : ReportService;
    constructor( service : ReportService ) { super(); this.service = service; }

    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId || !auth.accountId ) return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };

        const query : GetReportSubmissions.Query = this.query ?? {};
        const found : Type.Result<Array<Report.Submission>> = await this.service.listSubmissions( auth.accountId, query.reportId, query.status );
        if( !found.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: found.error } };

        const paged : Paging.Result<Report.Submission> = Paging.paginate( found.data, query );
        return { status: NetworkUtils.Status.OK, data: paged };
    }
}

export default GetReportSubmissionsImpl;
// eof
