//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";

//
// Aggregate results for a survey — response rate, score distribution/trend, by-segment, drop-off-by-step,
// time-to-complete/time-to-abandon (survey-5.1). USER-gated.
//
export class GetResults extends RestfulEndpoint< GetResults.Query, undefined, GetResults.Response >
{
    public readonly uri      : string = GetResults.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.GET;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.PUBLIC;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "getSurveyResults",
        summary:     "Read survey results",
        description: "Aggregate results: response rate, score distribution/trend, by segment, drop-off funnel, timing.",
        tags:        [ "Survey" ],
    };

    constructor( surveyId? : string ) { super( { surveyId: surveyId ?? "" } ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return [ { field: "surveyId", location: RestfulEndpoint.AttrLocation.URI, required: true } ]; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null { return null; }
}

export namespace GetResults
{
    export const URI : string = apiPath( "survey", 1, "/surveys/:surveyId/results" );

    export interface Query { surveyId : string; }

    /** Per-segment score-distribution breakdown (survey-5.1). */
    export interface SegmentBreakdown { segmentId : string; responseCount : number; averageScore? : number; }

    export interface Response
    {
        surveyId:              string;
        responseRate:          number;              // completed / distributed
        scoreDistribution?:    Record<string, number>; // bucket/value -> count (e.g. NPS detractor/passive/promoter)
        scoreTrend?:           Array<{ date : string; averageScore : number }>;
        bySegment?:            Array<SegmentBreakdown>;
        dropOffByStep?:        Array<{ questionId : string; abandonedCount : number }>;
        averageTimeToCompleteSeconds?: number;
        averageTimeToAbandonSeconds?:  number;
    }

    export enum Error
    {
        NOT_FOUND             = NetworkUtils.Status.NOT_FOUND,
        UNAUTHORIZED          = NetworkUtils.Status.UNAUTHORIZED,
        INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR,
    }
}

export default GetResults;
// eof
