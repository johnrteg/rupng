//
import { Application, Trace, Register } from "@repo/services";

import SocialService from "./services/SocialService";
import SocialMainService from "./services/SocialMainService";

//
// role from the environment: social is single-role today (MAIN = the /social/* API). The webhook
// intake role + publish/inbound/poll/schedule Jobs are later additions (see SPECS.md).
//
const role : string = process.env.SERVICE_ROLE ?? SocialService.Role.MAIN;

const services : Record<string, () => SocialService> =
{
    [ SocialService.Role.MAIN ] : () => new SocialMainService(),
};

const factory : (() => SocialService) | undefined = services[ role ];

if( factory !== undefined )
{
    factory().run();
}
else
{
    const log : Trace = new Trace( [ Register.Service.SOCIAL, 'index' ].join( Application.ID_DIVIDER ), "" );
    log.error( `Unknown ROLE: ${role}` );
    process.exit( 1 );
}

// eof
