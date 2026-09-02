//
import { RestfulEndpoint, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { Response as SurveyResponse } from "./model/Response";

//
// PUBLIC — submit answers against a signed PURL/submission token (survey-2.2 / 7.2 / 7.3). Bot-protected
// (CAPTCHA) + input-validated + HTML-sanitized (survey-7.2.1) by SurveyFormService. Accepts partial submits
// (one question per call) or a full batch — the impl decides which questions are new vs already answered.
//
export class PostSurveyForm extends RestfulEndpoint< PostSurveyForm.Query, PostSurveyForm.Body, PostSurveyForm.Response >
{
    public readonly uri      : string = PostSurveyForm.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : undefined = undefined;   // non-authenticated (token-gated)
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.PUBLIC;

    constructor( token? : string, body? : PostSurveyForm.Body ) { super( { token: token ?? "" }, body ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return [ { field: "token", location: RestfulEndpoint.AttrLocation.URI, required: true } ]; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null
    {
        return {
            type: "object", additionalProperties: false, required: [ "answers", "captchaToken" ],
            properties:
            {
                answers: { type: "array", items: {
                    type: "object", additionalProperties: false, required: [ "questionId", "value" ],
                    properties: { questionId: { type: "string" }, value: {} },
                } },
                captchaToken: { type: "string" },   // Turnstile/hCaptcha challenge response (survey-7.2)
                complete:     { type: "boolean" },  // caller signals "this was the last question"
            },
        };
    }
}

export namespace PostSurveyForm
{
    export const URI : string = apiPath( "survey", 1, "/forms/:token" );

    export interface Query { token : string; }
    export interface AnswerInput { questionId : string; value : unknown; }
    export interface Body extends RestfulEndpoint.NonAuthRequest { answers : Array<AnswerInput>; captchaToken : string; complete? : boolean; }
    export interface Response { status : SurveyResponse.Status; nextQuestionId? : string; }

    export enum Error
    {
        BAD_REQUEST  = NetworkUtils.Status.BAD_REQUEST,
        NOT_FOUND    = NetworkUtils.Status.NOT_FOUND,
        GONE         = NetworkUtils.Status.GONE,
        FORBIDDEN    = NetworkUtils.Status.FORBIDDEN,   // failed bot-protection challenge
    }
}

export default PostSurveyForm;
// eof
