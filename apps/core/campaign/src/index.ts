//
import { Application, Trace, Register } from "@repo/services";

import CampaignService from "./services/CampaignService";
import CampaignMainService from "./services/CampaignMainService";

//
// role from the environment: campaign is single-role (MAIN = the /campaign/* API). Run orchestration Jobs
// (CampaignRunJob / ScheduleJob / StatusJob) are later additions.
//
const role : string = process.env.SERVICE_ROLE ?? CampaignService.Role.MAIN;

const services : Record<string, () => CampaignService> =
{
    [ CampaignService.Role.MAIN ] : () => new CampaignMainService(),
};

const factory : (() => CampaignService) | undefined = services[ role ];

if( factory !== undefined )
{
    factory().run();
}
else
{
    const log : Trace = new Trace( [ Register.Service.CAMPAIGN, 'index' ].join( Application.ID_DIVIDER ), "" );
    log.error( `Unknown ROLE: ${role}` );
    process.exit( 1 );
}

// eof
