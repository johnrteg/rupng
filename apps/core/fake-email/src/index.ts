//
import { Application, Trace, Register } from "@repo/services";

import FakeEmailService from "./services/FakeEmailService";

//
// role from the environment: fake-email is single-role (MAIN = the fake ESP API on port 9100). DEV ONLY — a
// simulated email provider (see apps/core/email/specs/FAKE_PROVIDER.md); never deployed to prod.
//
const role : string = process.env.SERVICE_ROLE ?? FakeEmailService.Role.MAIN;

const services : Record<string, () => FakeEmailService> =
{
    [ FakeEmailService.Role.MAIN ] : () => new FakeEmailService(),
};

const factory : (() => FakeEmailService) | undefined = services[ role ];

if( factory !== undefined )
{
    factory().run();
}
else
{
    const log : Trace = new Trace( [ Register.Service.FAKE_EMAIL, 'index' ].join( Application.ID_DIVIDER ), "" );
    log.error( `Unknown ROLE: ${role}` );
    process.exit( 1 );
}

// eof
