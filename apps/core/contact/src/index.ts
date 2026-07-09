//
import { Application, Trace, Register } from "@repo/services";

import ContactService from "./services/ContactService";
import ContactMainService from "./services/ContactMainService";

//
// role from the environment: contact is single-role (MAIN = the /contact/* API).
//
const role : string = process.env.SERVICE_ROLE ?? ContactService.Role.MAIN;

const services : Record<string, () => ContactService> =
{
    [ ContactService.Role.MAIN ] : () => new ContactMainService(),
};

const factory : (() => ContactService) | undefined = services[ role ];

if( factory !== undefined )
{
    factory().run();
}
else
{
    const log : Trace = new Trace( [ Register.Service.CONTACT, 'index' ].join( Application.ID_DIVIDER ), "" );
    log.error( `Unknown ROLE: ${role}` );
    process.exit( 1 );
}

// eof
