//
import { Application, Trace, Register } from "@repo/services";

import AuditService from "./services/AuditService";
import AuditQueryService from "./services/AuditQueryService";

//
// role from the environment: audit is single-role today (MAIN = the /audit/* API). The four Lambda
// jobs (AuditSinkJob / AuditArchiveJob / AuditRetentionJob) run as their own separate Lambda entrypoints
// (see jobs/) — not dispatched through this role switch, same as social's Lambda workers.
//
const role : string = process.env.SERVICE_ROLE ?? AuditService.Role.MAIN;

const services : Record<string, () => AuditService> =
{
    [ AuditService.Role.MAIN ] : () => new AuditQueryService(),
};

const factory : ( () => AuditService ) | undefined = services[ role ];

if( factory !== undefined )
{
    factory().run();
}
else
{
    const log : Trace = new Trace( [ Register.Service.AUDIT, 'index' ].join( Application.ID_DIVIDER ), "" );
    log.error( `Unknown ROLE: ${role}` );
    process.exit( 1 );
}

// eof
