//
import { GetSurveyConfig, SurveyConfig } from "@repo/api";
import { NetworkUtils } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";
import SurveyService from "../services/SurveyService";

//
// Read the account's survey config defaults — anonymity default, partial-response/abandonment policy
// (survey-4.4). ACCOUNT-gated. Returns the live AppConfig value (deep-filled from DEFAULT).
//
export class GetSurveyConfigImpl extends GetSurveyConfig
{
    private service : SurveyService;
    constructor( service : SurveyService ) { super(); this.service = service; }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId ) return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };

        const config : SurveyConfig.Config = await this.service.surveyConfig();
        return { status: NetworkUtils.Status.OK, data: config };
    }
}

export default GetSurveyConfigImpl;
// eof
