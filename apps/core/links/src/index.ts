//
import { Application, Trace, Register } from "@repo/services";

import LinksService from "./services/LinksService";
import LinksMainService from "./services/LinksMainService";

//
// role from the environment: links is single-role today (MAIN = mint + resolve + domain registry,
// combined for the MVP cut). SPECS.md's LinksMintService/LinksResolveService split (a dedicated
// always-up redirect tier) lands when that scaling need is real — see LinksService.ts.
//
const role : string = process.env.SERVICE_ROLE ?? LinksService.Role.MAIN;

const services : Record<string, () => LinksService> =
{
    [ LinksService.Role.MAIN ] : () => new LinksMainService(),
};

const factory : ( () => LinksService ) | undefined = services[ role ];

if( factory !== undefined )
{
    factory().run();
}
else
{
    const log : Trace = new Trace( [ Register.Service.LINKS, 'index' ].join( Application.ID_DIVIDER ), "" );
    log.error( `Unknown ROLE: ${role}` );
    process.exit( 1 );
}

// eof
