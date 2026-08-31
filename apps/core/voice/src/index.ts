import { Application, Trace, Register } from "@repo/services";

import VoiceService from "./services/VoiceService";
import VoiceMainService from "./services/VoiceMainService";

const role : string = process.env.SERVICE_ROLE ?? VoiceService.Role.MAIN;

const services : Record<string, () => VoiceService> =
{
    [ VoiceService.Role.MAIN ] : () => new VoiceMainService(),
};

const factory : (() => VoiceService) | undefined = services[ role ];

if( factory !== undefined )
{
    factory().run();
}
else
{
    const log : Trace = new Trace( [ Register.Service.VOICE, 'index' ].join( Application.ID_DIVIDER ), "" );
    log.error( `Unknown ROLE: ${role}` );
    process.exit( 1 );
}
// eof
