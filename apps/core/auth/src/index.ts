//
import { Application, Trace, Register } from "@repo/services";

import AuthService from "./services/AuthService";
import AuthMainService from "./services/AuthMainService";
import AuthReaderService from "./services/AuthReaderService";
import AuthWriterService from "./services/AuthWriterService";


//
// get role from environment variable — default MAIN (the combined read+write service local dev + the
// webproxy target on :8110). READER/WRITER are the prod scale-out split, selected via SERVICE_ROLE.
//
const role : string = process.env.SERVICE_ROLE ?? AuthService.Role.MAIN;

//
// available services
//
const services : Record<string, () => AuthService> =
{
    [ AuthService.Role.MAIN ]   : () => new AuthMainService(),
    [ AuthService.Role.READER ] : () => new AuthReaderService(),
    [ AuthService.Role.WRITER ] : () => new AuthWriterService(),
};

// factory
const factory : (() => AuthService) | undefined = services[ role ];

// check and run
if( factory !== undefined )
{
    factory().run();
}
else
{
    const log : Trace = new Trace( [ Register.Service.AUTH, 'index' ].join( Application.ID_DIVIDER ), "" );
    log.error( `Unknown ROLE: ${role}` );
    process.exit( 1 );
}


//