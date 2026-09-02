//
import { Application, Trace, Register } from "@repo/services";

import SurveyService from "./services/SurveyService";
import SurveyMainService from "./services/SurveyMainService";
import SurveyFormService from "./services/SurveyFormService";

//
// role from the environment: MAIN (the authed /survey/* API — CRUD/definition/distribution/results; also
// drains the response/ingest/distribution queues locally per survey-9.6, same pattern as email's MAIN) or
// FORM (the PUBLIC hosted-form capture ingress behind CloudFront + WAF — survey-9.3, scales apart from MAIN).
//
const role : string = process.env.SERVICE_ROLE ?? SurveyService.Role.MAIN;

const services : Record<string, () => SurveyService> =
{
    [ SurveyService.Role.MAIN ] : () => new SurveyMainService(),
    [ SurveyService.Role.FORM ] : () => new SurveyFormService(),
};

const factory : (() => SurveyService) | undefined = services[ role ];

if( factory !== undefined )
{
    factory().run();
}
else
{
    const log : Trace = new Trace( [ Register.Service.SURVEY, 'index' ].join( Application.ID_DIVIDER ), "" );
    log.error( `Unknown ROLE: ${role}` );
    process.exit( 1 );
}

// eof
