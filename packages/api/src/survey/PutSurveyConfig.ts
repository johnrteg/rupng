//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { SurveyConfig } from "./model/SurveyConfig";

//
// Update the account's survey config defaults (survey-4.4). ACCOUNT-gated. Validated against
// `SurveyConfig.SCHEMA` (registered in ConfigSchema.ts) both here and by the Console JSON editor.
//
export class PutSurveyConfig extends RestfulEndpoint< {}, PutSurveyConfig.Body, PutSurveyConfig.Response >
{
    public readonly uri      : string = PutSurveyConfig.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.PUT;
    public readonly access   : Access.Role = Access.AccountRole.ACCOUNT;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.PUBLIC;

    constructor( body? : PutSurveyConfig.Body ) { super( {}, body ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null
    {
        return {
            type: "object", additionalProperties: false,
            properties:
            {
                anonymousDefault:          { type: "boolean" },
                abandonmentTimeoutMinutes: { type: "number" },
                partialRetentionDays:      { type: "number" },
                logLevel:                  { type: "string" },
            },
        };
    }
}

export namespace PutSurveyConfig
{
    export const URI : string = apiPath( "survey", 1, "/config" );

    export interface Body extends RestfulEndpoint.AuthRequest, Partial<SurveyConfig.Config> {}
    export interface Response extends SurveyConfig.Config {}

    export enum Error
    {
        BAD_REQUEST           = NetworkUtils.Status.BAD_REQUEST,
        UNAUTHORIZED          = NetworkUtils.Status.UNAUTHORIZED,
        INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR,
    }
}

export default PutSurveyConfig;
// eof
