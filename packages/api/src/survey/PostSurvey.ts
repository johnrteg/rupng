//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { Survey } from "./model/Survey";

//
// Create a survey definition (draft). Server assigns id / accountId / status(DRAFT) / version(0) / ownerId /
// timestamps. USER-gated, first-party (survey-1.1).
//
export class PostSurvey extends RestfulEndpoint< {}, PostSurvey.Body, PostSurvey.Response >
{
    public readonly uri      : string = PostSurvey.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.PUBLIC;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "createSurvey",
        summary:     "Create a survey",
        description: "Creates a survey definition in draft state under the acting account.",
        tags:        [ "Survey" ],
    };

    constructor( body? : PostSurvey.Body ) { super( {}, body ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null
    {
        return {
            type: "object", additionalProperties: true, required: [ "name" ],
            properties:
            {
                name:      { type: "string", minLength: 1 },
                questions: { type: "array" },
                scoring:   { type: "array" },
            },
        };
    }
    public getResponseSchema(): RestfulEndpoint.Schema | null
    {
        return { type: "object", description: "The created survey (draft).", properties: {
            id:     { type: "string", description: "New survey id." },
            name:   { type: "string", description: "Display name." },
            status: { type: "string", description: "Lifecycle state (draft)." },
        } };
    }
}

export namespace PostSurvey
{
    export const URI : string = apiPath( "survey", 1, "/surveys" );

    export interface Body extends RestfulEndpoint.AuthRequest, Survey.CreateSurvey {}
    export interface Response extends Survey.Entity {}

    export enum Error
    {
        BAD_REQUEST           = NetworkUtils.Status.BAD_REQUEST,
        UNAUTHORIZED          = NetworkUtils.Status.UNAUTHORIZED,
        INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR,
    }
}

export default PostSurvey;
// eof
