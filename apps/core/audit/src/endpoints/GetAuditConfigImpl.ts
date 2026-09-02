//
import { GetAuditConfig, AuditConfig } from "@repo/api";
import { NetworkUtils } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";
import AuditQueryService from "../services/AuditQueryService";

//
// Read the audit service's runtime config — ROOT. Returns the live AppConfig value (deep-filled
// from DEFAULT).
//
export class GetAuditConfigImpl extends GetAuditConfig
{
    private service : AuditQueryService;
    constructor( service : AuditQueryService ) { super(); this.service = service; }

    ///////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId ) return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };

        const config : AuditConfig.Config = await this.service.auditConfig();
        return { status: NetworkUtils.Status.OK, data: { config } };
    }
}

export default GetAuditConfigImpl;
