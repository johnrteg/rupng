//
import { Application, Trace, Register } from "@repo/services";

import RealtimeService from "./services/RealtimeService";

//
// role from the environment: realtime is single-role today (MAIN = the Kafka consumer + dev WebSocket
// bridge on port 8310). See SPECS.md "Service & Job topology" for the eventual multi-role split
// (RealtimeApiService / RealtimeIngestConsumer / RealtimeDrainer) once this needs to scale past one instance.
//
const role : string = process.env.SERVICE_ROLE ?? RealtimeService.Role.MAIN;

const services : Record<string, () => RealtimeService> =
{
    [ RealtimeService.Role.MAIN ] : () => new RealtimeService(),
};

const factory : ( () => RealtimeService ) | undefined = services[ role ];

if( factory !== undefined )
{
    factory().run();
}
else
{
    const log : Trace = new Trace( [ Register.Service.REALTIME, 'index' ].join( Application.ID_DIVIDER ), "" );
    log.error( `Unknown ROLE: ${role}` );
    process.exit( 1 );
}

// eof
