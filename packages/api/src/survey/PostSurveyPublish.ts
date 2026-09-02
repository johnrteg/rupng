//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { Survey } from "./model/Survey";

//
// Publish a survey (draft -> published), bumping `version` (survey-1.4). Responses captured after this
// point pin the new version; historical responses keep pointing at the version they actually answered.
//
export class PostSurveyPublish extends RestfulEndpoint< PostSurveyPublish.Query, undefined, PostSurveyPublish.Response >
{
    public readonly uri      : string = PostSurveyPublish.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.PUBLIC;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "publishSurvey",
        summary:     "Publish a survey",
        description: "Flips a draft survey to published, bumping its version.",
        tags:        [ "Survey" ],
    };

    constructor( surveyId? : string ) { super( { surveyId: surveyId ?? "" } ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return [ { field: "surveyId", location: RestfulEndpoint.AttrLocation.URI, required: true } ]; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null { return null; }
}

export namespace PostSurveyPublish
{
    export const URI : string = apiPath( "survey", 1, "/surveys/:surveyId/publish" );

    export interface Query { surveyId : string; }
    export interface Response extends Survey.Entity {}

    export enum Error
    {
        BAD_REQUEST           = NetworkUtils.Status.BAD_REQUEST,
        NOT_FOUND             = NetworkUtils.Status.NOT_FOUND,
        UNAUTHORIZED          = NetworkUtils.Status.UNAUTHORIZED,
        INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR,
    }
}

export default PostSurveyPublish;
// eof
