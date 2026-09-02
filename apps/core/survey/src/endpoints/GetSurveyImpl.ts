//
import { GetSurvey, Survey } from "@repo/api";
import { NetworkUtils, ObjectUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";
import SurveyService from "../services/SurveyService";

//
// Read one survey definition by id.
//
export class GetSurveyImpl extends GetSurvey
{
    private service : SurveyService;
    constructor( service : SurveyService ) { super(); this.service = service; }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId )   return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };
        const accountId : string | undefined = auth.accountId;
        if( !accountId )     return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "no acting account (X-Account)" } };
        const surveyId : string = this.query?.surveyId ?? "";
        if( !surveyId )      return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "surveyId required" } };

        const got : Type.Result<Survey.Entity | undefined> = await this.service.dynamo.get<Survey.Entity>( "survey_surveys", { accountId, surveyId } );
        if( !got.ok )   return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "survey read failed" } };
        if( !got.data ) return { status: NetworkUtils.Status.NOT_FOUND, data: { message: "survey not found" } };

        return { status: NetworkUtils.Status.OK, data: ObjectUtils.withDefaults( got.data, Survey.DEFAULT ) };
    }
}

export default GetSurveyImpl;
// eof
