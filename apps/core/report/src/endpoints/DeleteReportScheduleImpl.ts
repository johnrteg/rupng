//
import { DeleteReportSchedule } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";

import ReportService from "../services/ReportService";

//
// Delete a schedule (report-4.2) — already-produced submissions are untouched.
//
export class DeleteReportScheduleImpl extends DeleteReportSchedule
{
    private service : ReportService;
    constructor( service : ReportService ) { super(); this.service = service; }

    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId || !auth.accountId ) return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };

        const removed : Type.Result<boolean> = await this.service.deleteSchedule( auth.accountId, this.query.scheduleId );
        if( !removed.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: removed.error } };
        if( !removed.data ) return { status: NetworkUtils.Status.NOT_FOUND, data: { message: "schedule not found" } };
        return { status: NetworkUtils.Status.OK, data: { deleted: true } };
    }
}

export default DeleteReportScheduleImpl;
// eof
