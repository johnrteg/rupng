//
import { GetMonitorConfig, MonitorConfig } from "@repo/api";
import { NetworkUtils } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";
import MonitorService from "../services/MonitorService";

//
// Read the monitor service's runtime config — ROOT. Returns the live AppConfig value (deep-filled
// from DEFAULT).
//
export class GetMonitorConfigImpl extends GetMonitorConfig
{
    private service : MonitorService;
    constructor( service : MonitorService ) { super(); this.service = service; }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId ) return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };

        const config : MonitorConfig.Config = await this.service.monitorConfig();
        return { status: NetworkUtils.Status.OK, data: { config } };
    }
}

export default GetMonitorConfigImpl;
