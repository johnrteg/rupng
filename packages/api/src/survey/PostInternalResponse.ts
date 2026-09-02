//
import { RestfulEndpoint, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";

//
// S2S: ingest one captured answer/response from a channel runner — workflow's `collect-input` step
// completion (SMS) or channel inbound — into SurveyResponseJob's processing queue (survey-4.1). INTERNAL
// audience (VPC-only); no user session, caller passes accountId/contactId explicitly.
//
export class PostInternalResponse extends RestfulEndpoint< {}, PostInternalResponse.Body, PostInternalResponse.Response >
{
    public readonly uri      : string = PostInternalResponse.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : undefined = undefined;   // S2S (INTERNAL audience) — no RBAC role
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.INTERNAL;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "ingestInternalSurveyResponse",
        summary:     "Ingest a survey response (S2S)",
        description: "Ingests one answer/response from a channel runner (workflow collect-input, channel inbound).",
        tags:        [ "Survey" ],
    };

    constructor( body? : PostInternalResponse.Body ) { super( {}, body ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null
    {
        return {
            type: "object", additionalProperties: false, required: [ "accountId", "surveyId", "channel", "answers" ],
            properties:
            {
                accountId:      { type: "string" },
                surveyId:       { type: "string" },
                distributionId: { type: "string" },
                contactId:      { type: "string" },
                channel:        { type: "string" },
                answers:        { type: "array", items: {
                    type: "object", additionalProperties: false, required: [ "questionId", "value" ],
                    properties: { questionId: { type: "string" }, value: {} },
                } },
                complete: { type: "boolean" },
            },
        };
    }
}

export namespace PostInternalResponse
{
    export const URI : string = apiPath( "survey", 1, "/internal/responses" );

    export interface AnswerInput { questionId : string; value : unknown; }
    export interface Body
    {
        accountId:       string;
        surveyId:        string;
        distributionId?: string;
        contactId?:      string;
        channel:         string;
        answers:         Array<AnswerInput>;
        complete?:       boolean;
    }
    export interface Response { responseId : string; }

    export enum Error
    {
        BAD_REQUEST           = NetworkUtils.Status.BAD_REQUEST,
        NOT_FOUND             = NetworkUtils.Status.NOT_FOUND,
        INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR,
    }
}

export default PostInternalResponse;
// eof
