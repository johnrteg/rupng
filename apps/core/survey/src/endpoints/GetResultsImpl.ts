//
import { GetResults, SurveyResponse, Distribution } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";
import SurveyService from "../services/SurveyService";

//
// Aggregate results for a survey — response rate, score distribution, by-segment, drop-off-by-step,
// time-to-complete/time-to-abandon (survey-5.1). Computed in-memory over the survey's responses (same
// "read partition, aggregate in code" shape as GetInternalContactsImpl) — fine at MVP volume; a heavy
// account can move this to a precomputed rollup fed by SurveyResponseJob without changing the contract.
//
export class GetResultsImpl extends GetResults
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

        const distributed : Type.Result<Array<Distribution.Entity>> = await this.service.dynamo.query<Distribution.Entity>( "survey_distributions", {
            IndexName:                 "bySurvey",
            KeyConditionExpression:    "accountId = :a and surveyId = :s",
            ExpressionAttributeValues: { ":a": accountId, ":s": surveyId },
        } );
        const found : Type.Result<Array<SurveyResponse.Entity>> = await this.service.dynamo.query<SurveyResponse.Entity>( "survey_responses", {
            IndexName:                 "bySurvey",
            KeyConditionExpression:    "accountId = :a and surveyId = :s",
            ExpressionAttributeValues: { ":a": accountId, ":s": surveyId },
        } );
        if( !found.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "responses read failed" } };

        const responses : Array<SurveyResponse.Entity> = found.data;
        const completed : Array<SurveyResponse.Entity> = responses.filter( ( row : SurveyResponse.Entity ) : boolean => row.status === SurveyResponse.Status.COMPLETED );
        const abandoned : Array<SurveyResponse.Entity> = responses.filter( ( row : SurveyResponse.Entity ) : boolean => row.status === SurveyResponse.Status.ABANDONED );
        const recipientCount : number = distributed.ok ? distributed.data.reduce( ( sum : number, row : Distribution.Entity ) : number => sum + ( row.recipientCount ?? 0 ), 0 ) : 0;

        // score distribution — bucket by the computed score itself (rounded), good enough for NPS 0-10 / CSAT 1-5
        const scoreDistribution : Record<string, number> = {};
        for( const row of completed ) if( row.score !== undefined ) scoreDistribution[ String( row.score ) ] = ( scoreDistribution[ String( row.score ) ] ?? 0 ) + 1;

        // drop-off-by-step — count abandoned responses per lastQuestionId
        const dropOffCounts : Record<string, number> = {};
        for( const row of abandoned ) if( row.lastQuestionId ) dropOffCounts[ row.lastQuestionId ] = ( dropOffCounts[ row.lastQuestionId ] ?? 0 ) + 1;

        const durationSeconds = ( row : SurveyResponse.Entity, endField : "completedAt" | "abandonedAt" ) : number | undefined =>
        {
            const end : string | undefined = row[ endField ];
            if( !end ) return undefined;
            return ( new Date( end ).getTime() - new Date( row.startedAt ).getTime() ) / 1000;
        };
        const average = ( values : Array<number> ) : number | undefined => values.length ? values.reduce( ( sum, value ) => sum + value, 0 ) / values.length : undefined;

        return { status: NetworkUtils.Status.OK, data: {
            surveyId,
            responseRate:  recipientCount > 0 ? completed.length / recipientCount : 0,
            scoreDistribution,
            dropOffByStep: Object.entries( dropOffCounts ).map( ( [ questionId, abandonedCount ] ) => ( { questionId, abandonedCount } ) ),
            averageTimeToCompleteSeconds: average( completed.map( ( row ) => durationSeconds( row, "completedAt" ) ).filter( ( value ) : value is number => value !== undefined ) ),
            averageTimeToAbandonSeconds:  average( abandoned.map( ( row ) => durationSeconds( row, "abandonedAt" ) ).filter( ( value ) : value is number => value !== undefined ) ),
        } };
    }
}

export default GetResultsImpl;
// eof
