//
import { DeleteReportSubmission } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";

import ReportService from "../services/ReportService";

//
// Delete a submission + its artifact (report-2.4).
//
export class DeleteReportSubmissionImpl extends DeleteReportSubmission
{
    private service : ReportService;
    constructor( service : ReportService ) { super(); this.service = service; }

    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId || !auth.accountId ) return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };

        const removed : Type.Result<boolean> = await this.service.deleteSubmission( auth.accountId, this.query.submissionId );
        if( !removed.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: removed.error } };
        if( !removed.data ) return { status: NetworkUtils.Status.NOT_FOUND, data: { message: "submission not found" } };
        return { status: NetworkUtils.Status.OK, data: { deleted: true } };
    }
}

export default DeleteReportSubmissionImpl;
// eof
