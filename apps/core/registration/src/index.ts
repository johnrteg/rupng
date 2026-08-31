import { Application, Trace, Register } from "@repo/services";

import RegistrationService from "./services/RegistrationService";
import RegistrationMainService from "./services/RegistrationMainService";
import RegistrationWebhookService from "./services/RegistrationWebhookService";

//
// role from the environment: MAIN (the /registration/* API + the registration-11.x lifecycle ops) or WEBHOOK
// (the provider-facing TCR / Campaign-Verify callback intake, which scales apart from the API — SPECS.md
// registration-12.3). The submit/webhook/poll/vetting workers run as Jobs; MAIN also drains their queues
// locally so the pipeline works end-to-end without a separate Job runtime.
//
const role : string = process.env.SERVICE_ROLE ?? RegistrationService.Role.MAIN;

const services : Record<string, () => RegistrationService> =
{
    [ RegistrationService.Role.MAIN ]    : () => new RegistrationMainService(),
    [ RegistrationService.Role.WEBHOOK ] : () => new RegistrationWebhookService(),
};

const factory : (() => RegistrationService) | undefined = services[ role ];

if( factory !== undefined )
{
    factory().run();
}
else
{
    const log : Trace = new Trace( [ Register.Service.REGISTRATION, 'index' ].join( Application.ID_DIVIDER ), "" );
    log.error( `Unknown ROLE: ${role}` );
    process.exit( 1 );
}
// eof
