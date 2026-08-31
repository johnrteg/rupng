//
import { GetReportConfig, ReportConfig } from "@repo/api";
import { NetworkUtils } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";

import ReportService from "../services/ReportService";

//
// Read the report service's runtime config. ROOT.
//
export class GetReportConfigImpl extends GetReportConfig
{
    private service : ReportService;
    constructor( service : ReportService ) { super(); this.service = service; }

    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId ) return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };
        const config : ReportConfig.Config = await this.service.reportConfig();
        return { status: NetworkUtils.Status.OK, data: { config } };
    }
}

export default GetReportConfigImpl;
// eof
