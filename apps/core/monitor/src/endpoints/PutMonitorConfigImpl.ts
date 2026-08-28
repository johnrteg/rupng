//
import { PutMonitorConfig, MonitorConfig } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";
import MonitorService from "../services/MonitorService";

//
// Set the monitor service's runtime config — ROOT. Validates against MonitorConfig.SCHEMA, then
// persists a new AppConfig version + deploys it.
//
export class PutMonitorConfigImpl extends PutMonitorConfig
{
    private service : MonitorService;
    constructor( service : MonitorService ) { super(); this.service = service; }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId ) return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };

        const config : MonitorConfig.Config | undefined = this.body?.config;
        if( !config ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "config is required" } };
        if( !MonitorConfig.validate( config ) ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "invalid monitor config" } };

        const saved : Type.Result<void> = await this.service.saveConfig( config );
        if( !saved.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "could not save the config" } };

        return { status: NetworkUtils.Status.OK, data: { config } };
    }
}

export default PutMonitorConfigImpl;
