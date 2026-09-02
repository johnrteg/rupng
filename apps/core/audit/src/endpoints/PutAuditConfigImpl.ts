//
import { PutAuditConfig, AuditConfig } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";
import AuditQueryService from "../services/AuditQueryService";

//
// Set the audit service's runtime config — ROOT. Validates against AuditConfig.SCHEMA, then persists
// a new AppConfig version + deploys it.
//
export class PutAuditConfigImpl extends PutAuditConfig
{
    private service : AuditQueryService;
    constructor( service : AuditQueryService ) { super(); this.service = service; }

    ///////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId ) return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };

        const config : AuditConfig.Config | undefined = this.body?.config;
        if( !config ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "config is required" } };
        if( !AuditConfig.validate( config ) ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "invalid audit config" } };

        const saved : Type.Result<void> = await this.service.saveConfig( config );
        if( !saved.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "could not save the config" } };

        return { status: NetworkUtils.Status.OK, data: { config } };
    }
}

export default PutAuditConfigImpl;
