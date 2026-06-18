//
import { Application, Trace, Events } from "@repo/services";

import AppService from "./services/AppService";
import AppMainService from "./services/AppMainService";
import AppPublicService from "./services/AppPublicService";


//
// get role from environment variable (defaults to the authed BFF)
//
const role : string = process.env.SERVICE_ROLE ?? AppService.Role.MAIN;

//
// available services
//
const services : Record<string, () => AppService> =
{
    [ AppService.Role.MAIN ]   : () => new AppMainService(),
    [ AppService.Role.PUBLIC ] : () => new AppPublicService(),
};

// factory
const factory : (() => AppService) | undefined = services[ role ];

// check and run
if( factory !== undefined )
{
    factory().run();
}
else
{
    const log : Trace = new Trace( [ Events.Service.APP, 'index' ].join( Application.ID_DIVIDER ), "" );
    log.error( `Unknown ROLE: ${role}` );
    process.exit( 1 );
}
