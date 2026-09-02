//
import { GetResponses, SurveyResponse, Paging } from "@repo/api";
import { NetworkUtils, ObjectUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";
import SurveyService from "../services/SurveyService";

//
// List a survey's captured responses, including in_progress/abandoned partials (survey-4.1). Queries the
// `bySurvey` GSI so this stays a partition read, not a scan, even on a large account.
//
export class GetResponsesImpl extends GetResponses
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

        const found : Type.Result<Array<SurveyResponse.Entity>> = await this.service.dynamo.query<SurveyResponse.Entity>( "survey_responses", {
            IndexName:                 "bySurvey",
            KeyConditionExpression:    "accountId = :a and surveyId = :s",
            ExpressionAttributeValues: { ":a": accountId, ":s": surveyId },
        } );
        if( !found.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "responses read failed" } };

        const query : GetResponses.Query = this.query ?? { surveyId };
        const responses : Array<SurveyResponse.Entity> = found.data
            .map( ( row : SurveyResponse.Entity ) : SurveyResponse.Entity => ObjectUtils.withDefaults( row, SurveyResponse.DEFAULT ) )
            .filter( ( row : SurveyResponse.Entity ) : boolean => !query.status || row.status === query.status )
            .sort( ( first : SurveyResponse.Entity, second : SurveyResponse.Entity ) : number => String( second.startedAt ?? "" ).localeCompare( String( first.startedAt ?? "" ) ) );

        const paged : Paging.Result<SurveyResponse.Entity> = Paging.paginate( responses, query );
        return { status: NetworkUtils.Status.OK, data: paged };
    }
}

export default GetResponsesImpl;
// eof
