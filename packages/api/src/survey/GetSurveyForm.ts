//
import { RestfulEndpoint, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { Question } from "./model/Question";

//
// PUBLIC — fetch the hosted-form render for a signed PURL/submission token (survey-2.2 / 7.3). Anonymous
// (the token IS the credential); served by SurveyFormService behind CloudFront+WAF, not SurveyMainService.
// Never leaks the underlying Survey.id / contactId — only what's needed to render the next question.
//
export class GetSurveyForm extends RestfulEndpoint< GetSurveyForm.Query, undefined, GetSurveyForm.Response >
{
    public readonly uri      : string = GetSurveyForm.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.GET;
    public readonly access   : undefined = undefined;   // non-authenticated (token-gated)
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.PUBLIC;

    constructor( token? : string ) { super( { token: token ?? "" } ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return [ { field: "token", location: RestfulEndpoint.AttrLocation.URI, required: true } ]; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null { return null; }
}

export namespace GetSurveyForm
{
    export const URI : string = apiPath( "survey", 1, "/forms/:token" );

    export interface Query { token : string; }

    /** The public-safe render view — the current question(s) to show + overall progress. */
    export interface Response
    {
        surveyName:    string;
        questions:     Array<Question.Entity>;   // sanitized (survey-7.2.1) render-ready questions
        answeredCount: number;
        totalCount:    number;
        completed:     boolean;
    }

    export enum Error { NOT_FOUND = NetworkUtils.Status.NOT_FOUND, GONE = NetworkUtils.Status.GONE }
}

export default GetSurveyForm;
// eof
