//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { Survey } from "./model/Survey";

//
// Read one survey definition by id. USER-gated, first-party.
//
export class GetSurvey extends RestfulEndpoint< GetSurvey.Query, undefined, GetSurvey.Response >
{
    public readonly uri      : string = GetSurvey.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.GET;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.PUBLIC;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "getSurvey",
        summary:     "Read a survey",
        description: "Reads one survey definition by id.",
        tags:        [ "Survey" ],
    };

    constructor( surveyId? : string ) { super( { surveyId: surveyId ?? "" } ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return [ { field: "surveyId", location: RestfulEndpoint.AttrLocation.URI, required: true } ]; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null { return null; }
}

export namespace GetSurvey
{
    export const URI : string = apiPath( "survey", 1, "/surveys/:surveyId" );

    export interface Query { surveyId : string; }
    export interface Response extends Survey.Entity {}

    export enum Error
    {
        NOT_FOUND             = NetworkUtils.Status.NOT_FOUND,
        UNAUTHORIZED          = NetworkUtils.Status.UNAUTHORIZED,
        INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR,
    }
}

export default GetSurvey;
// eof
