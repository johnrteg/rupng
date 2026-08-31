//
import { GetReportSubmission, Report } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";

import ReportService from "../services/ReportService";

//
// Get a single submission's status + facts by id (report-2.3).
//
export class GetReportSubmissionImpl extends GetReportSubmission
{
    private service : ReportService;
    constructor( service : ReportService ) { super(); this.service = service; }

    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId || !auth.accountId ) return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };

        const found : Type.Result<Report.Submission | undefined> = await this.service.getSubmission( auth.accountId, this.query.submissionId );
        if( !found.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: found.error } };
        if( found.data === undefined ) return { status: NetworkUtils.Status.NOT_FOUND, data: { message: "submission not found" } };
        return { status: NetworkUtils.Status.OK, data: { submission: found.data } };
    }
}

export default GetReportSubmissionImpl;
// eof
