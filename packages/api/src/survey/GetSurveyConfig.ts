//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { SurveyConfig } from "./model/SurveyConfig";

//
// Read the account's survey config defaults — anonymity default, partial-response/abandonment policy
// (survey-4.4). ACCOUNT-gated (account-admin operational setting).
//
export class GetSurveyConfig extends RestfulEndpoint< {}, undefined, GetSurveyConfig.Response >
{
    public readonly uri      : string = GetSurveyConfig.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.GET;
    public readonly access   : Access.Role = Access.AccountRole.ACCOUNT;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.PUBLIC;

    constructor() { super( {} ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null { return null; }
}

export namespace GetSurveyConfig
{
    export const URI : string = apiPath( "survey", 1, "/config" );

    export interface Response extends SurveyConfig.Config {}

    export enum Error
    {
        UNAUTHORIZED          = NetworkUtils.Status.UNAUTHORIZED,
        INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR,
    }
}

export default GetSurveyConfig;
// eof
