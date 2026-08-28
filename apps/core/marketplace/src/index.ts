//
import { Application, Trace, Register } from "@repo/services";

import MarketplaceService from "./services/MarketplaceService";
import MarketplaceMainService from "./services/MarketplaceMainService";

//
// role from the environment: marketplace is single-role today (MAIN = the internal installations API).
// MarketplaceWebhookService + the token-refresh/health Jobs are later additions (see SPECS.md).
//
const role : string = process.env.SERVICE_ROLE ?? MarketplaceService.Role.MAIN;

const services : Record<string, () => MarketplaceService> =
{
    [ MarketplaceService.Role.MAIN ] : () => new MarketplaceMainService(),
};

const factory : (() => MarketplaceService) | undefined = services[ role ];

if( factory !== undefined )
{
    factory().run();
}
else
{
    const log : Trace = new Trace( [ Register.Service.MARKETPLACE, 'index' ].join( Application.ID_DIVIDER ), "" );
    log.error( `Unknown ROLE: ${role}` );
    process.exit( 1 );
}

// eof
