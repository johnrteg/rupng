//
import MonitorService from "./MonitorService";

import GetMonitorWidgetsImpl from "../endpoints/GetMonitorWidgetsImpl";
import GetMonitorWidgetDataImpl from "../endpoints/GetMonitorWidgetDataImpl";
import GetMonitorConfigImpl from "../endpoints/GetMonitorConfigImpl";
import PutMonitorConfigImpl from "../endpoints/PutMonitorConfigImpl";

//
// MAIN role — the /monitor/* API (widget list + live widget reads + config). Single-role today;
// the topology/ledger/alert/security Jobs are later additions (see SPECS.md).
//
export class MonitorMainService extends MonitorService
{
    ////////////////////////////////////////////////////////////////////////////////////////////
    constructor() { super( MonitorService.Role.MAIN ); }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Register the monitor endpoint impls (after the inherited /health + /version). */
    protected override async registerEndpoints() : Promise<void>
    {
        await super.registerEndpoints();          // keeps /health + /version
        this.register( new GetMonitorWidgetsImpl( this ) );
        this.register( new GetMonitorWidgetDataImpl( this ) );
        this.register( new GetMonitorConfigImpl( this ) );
        this.register( new PutMonitorConfigImpl( this ) );
    }
}

export default MonitorMainService;
