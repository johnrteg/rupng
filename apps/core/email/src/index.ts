//
import { Application, Trace, Register } from "@repo/services";

import EmailService from "./services/EmailService";
import EmailMainService from "./services/EmailMainService";

//
// role from the environment: email is single-role (MAIN = the /email/* API + the send/feedback queue drains +
// the transactional-event consumer). A Job Lambda owns the queues in a deploy; MAIN drains them locally in dev.
//
const role : string = process.env.SERVICE_ROLE ?? EmailService.Role.MAIN;

const services : Record<string, () => EmailService> =
{
    [ EmailService.Role.MAIN ] : () => new EmailMainService(),
};

const factory : (() => EmailService) | undefined = services[ role ];

if( factory !== undefined )
{
    factory().run();
}
else
{
    const log : Trace = new Trace( [ Register.Service.EMAIL, 'index' ].join( Application.ID_DIVIDER ), "" );
    log.error( `Unknown ROLE: ${role}` );
    process.exit( 1 );
}

// eof
