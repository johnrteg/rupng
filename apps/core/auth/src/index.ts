//
import { Application, Trace } from "@repo/services";

import AuthService from "./services/AuthService";
import AuthReaderService from "./services/AuthReaderService";
import AuthWriterService from "./services/AuthWriterService";


//
// get role from environment variable
//
const role : string = process.env.SERVICE_ROLE ?? AuthService.Role.READER;

//
// available services
//
const services : Record<string, () => AuthService> =
{
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
    const log : Trace = new Trace( [ AuthService.ID, 'index' ].join( Application.ID_DIVIDER ), "" );
    log.error( `Unknown ROLE: ${role}` );
    process.exit( 1 );
}


//