//
import { Application, Trace, Register } from "@repo/services";

import MonitorService from "./services/MonitorService";
import MonitorMainService from "./services/MonitorMainService";

//
// role from the environment: monitor is single-role today (MAIN = the /monitor/* read + config API).
// The topology/ledger/alert/security Jobs are later additions (see SPECS.md).
//
const role : string = process.env.SERVICE_ROLE ?? MonitorService.Role.MAIN;

const services : Record<string, () => MonitorService> =
{
    [ MonitorService.Role.MAIN ] : () => new MonitorMainService(),
};

const factory : (() => MonitorService) | undefined = services[ role ];

if( factory !== undefined )
{
    factory().run();
}
else
{
    const log : Trace = new Trace( [ Register.Service.MONITOR, 'index' ].join( Application.ID_DIVIDER ), "" );
    log.error( `Unknown ROLE: ${role}` );
    process.exit( 1 );
}

// eof
