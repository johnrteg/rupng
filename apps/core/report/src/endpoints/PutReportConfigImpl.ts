//
import { PutReportConfig, ReportConfig } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";

import ReportService from "../services/ReportService";

//
// Set the report service's runtime config. ROOT. Validates against ReportConfig.SCHEMA before persisting.
//
export class PutReportConfigImpl extends PutReportConfig
{
    private service : ReportService;
    constructor( service : ReportService ) { super(); this.service = service; }

    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId ) return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };

        const body : PutReportConfig.Body | null = this.body;
        if( !body || !ReportConfig.validate.is( body.config ) )
            return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "invalid report config" } };

        const saved : Type.Result<void> = await this.service.saveConfig( body.config );
        if( !saved.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "could not save config" } };
        return { status: NetworkUtils.Status.OK, data: { config: body.config } };
    }
}

export default PutReportConfigImpl;
// eof
