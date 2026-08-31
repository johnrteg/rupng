//
import { PostReportSubmissions, Report } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint, Access } from "@repo/endpoint";

import ReportService from "../services/ReportService";

//
// Submit an ad-hoc report run (report-2.1).
//
export class PostReportSubmissionsImpl extends PostReportSubmissions
{
    private service : ReportService;
    constructor( service : ReportService ) { super(); this.service = service; }

    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId || !auth.accountId ) return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };

        const body : PostReportSubmissions.Body | null = this.body;
        if( !body || !body.reportId || !body.params || !body.format )
            return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "reportId, params, and format are required" } };

        const callerRole : Access.Role = ( auth.role as Access.Role ) ?? Access.AccountRole.MINIMUM;
        const submitted : Type.Result<Report.Submission> = await this.service.submit( auth.accountId, auth.userId, body, callerRole );
        if( !submitted.ok )
        {
            const status : NetworkUtils.Status = submitted.error.includes( "requires at least" ) ? NetworkUtils.Status.FORBIDDEN : NetworkUtils.Status.BAD_REQUEST;
            return { status, data: { message: submitted.error } };
        }
        return { status: NetworkUtils.Status.OK, data: { submission: submitted.data } };
    }
}

export default PostReportSubmissionsImpl;
// eof
