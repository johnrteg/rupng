//
import { PostReportInternalErase } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";

import ReportService from "../services/ReportService";

//
// S2S forget hook (report-11.1) — purges artifacts that may contain a forgotten subject's PII, ahead of the
// retention-TTL expiry. INTERNAL audience — no session/RBAC to check.
//
export class PostReportInternalEraseImpl extends PostReportInternalErase
{
    private service : ReportService;
    constructor( service : ReportService ) { super(); this.service = service; }

    public async execute( _auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        const body : PostReportInternalErase.Body | null = this.body;
        if( !body || !body.accountId || !body.subjectId )
            return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "accountId and subjectId are required" } };

        const purged : Type.Result<number> = await this.service.eraseSubject( body.accountId, body.subjectId );
        if( !purged.ok ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: purged.error } };
        return { status: NetworkUtils.Status.OK, data: { purged: purged.data } };
    }
}

export default PostReportInternalEraseImpl;
// eof
