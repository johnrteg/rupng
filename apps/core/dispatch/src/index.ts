//
import DispatchMainService from "./services/DispatchMainService";
import DispatchService from "./services/DispatchService";
import { Application, Trace } from "@repo/services";


//
// get role from environment variable
//
const role : string = process.env.SERVICE_ROLE ?? DispatchService.Role.MAIN;

//
// available services
//
const services : Record<string, () => DispatchService> =
{
    [ DispatchService.Role.MAIN ] : () => new DispatchMainService(),
};

// factory
const factory : (() => DispatchService) | undefined = services[ role ];

// check and run
if( factory !== undefined )
{
    factory().run();
}
else
{
    const log : Trace = new Trace( [ DispatchService.ID, 'index' ].join( Application.ID_DIVIDER ), "" );
    log.error( `Unknown ROLE: ${role}` );
    process.exit( 1 );
}


//