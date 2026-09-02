import { Application, Trace, Register } from "@repo/services";

import PrintService from "./services/PrintService";
import PrintMainService from "./services/PrintMainService";

const role : string = process.env.SERVICE_ROLE ?? PrintService.Role.MAIN;

const services : Record<string, () => PrintService> =
{
    [ PrintService.Role.MAIN ] : () => new PrintMainService(),
};

const factory : (() => PrintService) | undefined = services[ role ];

if( factory !== undefined )
{
    factory().run();
}
else
{
    const log : Trace = new Trace( [ Register.Service.PRINT, 'index' ].join( Application.ID_DIVIDER ), "" );
    log.error( `Unknown ROLE: ${role}` );
    process.exit( 1 );
}
// eof
