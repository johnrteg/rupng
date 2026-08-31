import { Application, Trace, Register } from "@repo/services";

import ReportService from "./services/ReportService";
import ReportMainService from "./services/ReportMainService";

// role -> concrete Service factory. Only MAIN exists today (report-13.2) — no separate scale-independent
// role has been split out yet (mirrors voice/social's single-role shape).
const role : string = process.env.SERVICE_ROLE ?? ReportService.Role.MAIN;

const services : Record<string, () => ReportService> =
{
    [ ReportService.Role.MAIN ] : () => new ReportMainService(),
};

const factory : (() => ReportService) | undefined = services[ role ];

if( factory !== undefined )
{
    factory().run();
}
else
{
    const log : Trace = new Trace( [ Register.Service.REPORT, 'index' ].join( Application.ID_DIVIDER ), "" );
    log.error( `Unknown ROLE: ${role}` );
    process.exit( 1 );
}
// eof
