//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { Survey } from "./model/Survey";

//
// Update a survey definition — editable while DRAFT (publishing is its own endpoint). USER-gated, first-party.
//
export class PutSurvey extends RestfulEndpoint< PutSurvey.Query, PutSurvey.Body, PutSurvey.Response >
{
    public readonly uri      : string = PutSurvey.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.PUT;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.PUBLIC;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "updateSurvey",
        summary:     "Update a survey",
        description: "Updates a draft survey definition's name/questions/scoring.",
        tags:        [ "Survey" ],
    };

    constructor( surveyId? : string, body? : PutSurvey.Body ) { super( { surveyId: surveyId ?? "" }, body ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return [ { field: "surveyId", location: RestfulEndpoint.AttrLocation.URI, required: true } ]; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null
    {
        return {
            type: "object", additionalProperties: true,
            properties: { name: { type: "string", minLength: 1 }, questions: { type: "array" }, scoring: { type: "array" } },
        };
    }
}

export namespace PutSurvey
{
    export const URI : string = apiPath( "survey", 1, "/surveys/:surveyId" );

    export interface Query { surveyId : string; }
    export interface Body extends RestfulEndpoint.AuthRequest, Survey.UpdateSurvey {}
    export interface Response extends Survey.Entity {}

    export enum Error
    {
        BAD_REQUEST           = NetworkUtils.Status.BAD_REQUEST,
        NOT_FOUND             = NetworkUtils.Status.NOT_FOUND,
        UNAUTHORIZED          = NetworkUtils.Status.UNAUTHORIZED,
        INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR,
    }
}

export default PutSurvey;
// eof
