//
import { GetReportSubmissionDownload, Report } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";

import ReportService from "../services/ReportService";

//
// Issue a short-lived presigned GET for a completed submission's artifact (report-5.2). A submission that
// exists but isn't complete yet (no artifact) is a distinct CONFLICT, not a plain 404.
//
export class GetReportSubmissionDownloadImpl extends GetReportSubmissionDownload
{
    private service : ReportService;
    constructor( service : ReportService ) { super(); this.service = service; }

    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId || !auth.accountId ) return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };

        const submission : Type.Result<Report.Submission | undefined> = await this.service.getSubmission( auth.accountId, this.query.submissionId );
        if( !submission.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: submission.error } };
        if( submission.data === undefined ) return { status: NetworkUtils.Status.NOT_FOUND, data: { message: "submission not found" } };

        const link : Type.Result<ReportService.DownloadLink | undefined> = await this.service.presignDownload( auth.accountId, this.query.submissionId );
        if( !link.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: link.error } };
        if( link.data === undefined ) return { status: NetworkUtils.Status.CONFLICT, data: { message: "the artifact isn't ready yet" } };
        return { status: NetworkUtils.Status.OK, data: link.data };
    }
}

export default GetReportSubmissionDownloadImpl;
// eof
