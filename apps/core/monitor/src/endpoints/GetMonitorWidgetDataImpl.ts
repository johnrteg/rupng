//
import { GetMonitorWidgetData, MonitorConfig, MonitorWidgetStatus } from "@repo/api";
import { NetworkUtils } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";
import MonitorService from "../services/MonitorService";
import MonitorWidgetReader from "../services/MonitorWidgetReader";

//
// Read one widget's live status — cache-first, TTL = the widget's own `refreshIntervalSec`.
// SUPPORT+.
//
export class GetMonitorWidgetDataImpl extends GetMonitorWidgetData
{
    private service : MonitorService;
    constructor( service : MonitorService ) { super(); this.service = service; }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId ) return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };
        const id : string = this.query?.id ?? "";
        if( !id ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "id required" } };

        const config : MonitorConfig.Config = await this.service.monitorConfig();
        const widget : MonitorConfig.WidgetConfig | undefined = config.widgets.find( ( entry : MonitorConfig.WidgetConfig ) : boolean => entry.id === id );
        if( !widget ) return { status: NetworkUtils.Status.NOT_FOUND, data: { message: "no such widget" } };

        const data : MonitorWidgetStatus.Data = await this.service.cachedWidgetRead(
            widget.id, widget.refreshIntervalSec, () => MonitorWidgetReader.read( this.service, widget ),
        );
        return { status: NetworkUtils.Status.OK, data };
    }
}

export default GetMonitorWidgetDataImpl;
