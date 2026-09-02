//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { Response as SurveyResponse } from "./model/Response";
import { Paging } from "../model/Paging";

//
// List a survey's captured responses, including partials (survey-4.1). USER-gated.
//
export class GetResponses extends RestfulEndpoint< GetResponses.Query, undefined, GetResponses.Response >
{
    public readonly uri      : string = GetResponses.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.GET;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.PUBLIC;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "listSurveyResponses",
        summary:     "List survey responses",
        description: "Lists a survey's captured responses (paged), including in_progress/abandoned partials.",
        tags:        [ "Survey" ],
    };

    constructor( surveyId? : string, query? : GetResponses.Query ) { super( { surveyId: surveyId ?? "", ...( query ?? {} ) } ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return [ { field: "surveyId", location: RestfulEndpoint.AttrLocation.URI, required: true } ]; }
    public getQuerySchema(): RestfulEndpoint.Schema | null
    {
        return {
            type: "object", additionalProperties: false,
            properties:
            {
                surveyId: { type: "string" },
                status:   { type: "string", enum: Object.values( SurveyResponse.Status ) },
                count:    { type: "number" },
                start:    { type: "string" },
            },
        };
    }
    public getBodySchema(): RestfulEndpoint.Schema | null { return null; }
}

export namespace GetResponses
{
    export const URI : string = apiPath( "survey", 1, "/surveys/:surveyId/responses" );

    export interface Query extends Paging.Request { surveyId? : string; status? : SurveyResponse.Status; }
    export interface Response extends Paging.Result<SurveyResponse.Entity> {}

    export enum Error
    {
        NOT_FOUND             = NetworkUtils.Status.NOT_FOUND,
        UNAUTHORIZED          = NetworkUtils.Status.UNAUTHORIZED,
        INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR,
    }
}

export default GetResponses;
// eof
