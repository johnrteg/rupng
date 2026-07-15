//
import { Application, Trace, Register } from "@repo/services";

import AccountService from "./services/AccountService";
import AccountMainService from "./services/AccountMainService";
import AccountReadService from "./services/AccountReadService";


//
// get role from environment variable
//
const role : string = process.env.SERVICE_ROLE ?? AccountService.Role.MAIN;

//
// available services
//
const services : Record<string, () => AccountService> =
{
    [ AccountService.Role.MAIN ] : () => new AccountMainService(),
    [ AccountService.Role.READ ] : () => new AccountReadService(),
};

// factory
const factory : (() => AccountService) | undefined = services[ role ];

// check and run
if( factory !== undefined )
{
    factory().run();
}
else
{
    const log : Trace = new Trace( [ Register.Service.ACCOUNT, 'index' ].join( Application.ID_DIVIDER ), "" );
    log.error( `Unknown ROLE: ${role}` );
    process.exit( 1 );
}

// eof
