import { Application, Trace, Register } from "@repo/services";

import CollabService from "./services/CollabService";
import CollabControlService from "./services/CollabControlService";
import CollabRoomServer from "./services/CollabRoomServer";

const role : string = process.env.SERVICE_ROLE ?? CollabService.Role.CONTROL;

const services : Record<string, () => CollabService> =
{
    [ CollabService.Role.CONTROL ] : () => new CollabControlService(),
    [ CollabService.Role.ROOM ]    : () => new CollabRoomServer(),
};

const factory : (() => CollabService) | undefined = services[ role ];

if( factory !== undefined )
{
    factory().run();
}
else
{
    const log : Trace = new Trace( [ Register.Service.COLLAB, 'index' ].join( Application.ID_DIVIDER ), "" );
    log.error( `Unknown ROLE: ${role}` );
    process.exit( 1 );
}
// eof
