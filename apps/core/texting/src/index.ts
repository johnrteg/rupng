//
import { Application, Trace, Register } from "@repo/services";

import TextingService from "./services/TextingService";
import TextingMainService from "./services/TextingMainService";

//
// role from the environment: texting is single-role today (MAIN = the /texting/* API + local
// send/dlr consumers). MVP cut — no separate TextingWebhookService/TextingSendWorker/TextingDlrJob
// deployables yet (mirrors print's/email's own "scaffold + fake provider" maturity).
//
const role : string = process.env.SERVICE_ROLE ?? TextingService.Role.MAIN;

const services : Record<string, () => TextingService> =
{
    [ TextingService.Role.MAIN ] : () => new TextingMainService(),
};

const factory : ( () => TextingService ) | undefined = services[ role ];

if( factory !== undefined )
{
    factory().run();
}
else
{
    const log : Trace = new Trace( [ Register.Service.TEXTING, 'index' ].join( Application.ID_DIVIDER ), "" );
    log.error( `Unknown ROLE: ${role}` );
    process.exit( 1 );
}

// eof
