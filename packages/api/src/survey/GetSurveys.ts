//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { Survey } from "./model/Survey";
import { Paging } from "../model/Paging";

//
// List the acting account's survey definitions (paged). USER-gated, first-party.
//
export class GetSurveys extends RestfulEndpoint< GetSurveys.Query, undefined, GetSurveys.Response >
{
    public readonly uri      : string = GetSurveys.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.GET;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.PUBLIC;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "listSurveys",
        summary:     "List surveys",
        description: "Lists the acting account's survey definitions (paged — ?count / ?start).",
        tags:        [ "Survey" ],
    };

    constructor( query? : GetSurveys.Query ) { super( query ?? {} ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null
    {
        return {
            type: "object", additionalProperties: false,
            properties:
            {
                status: { type: "string", enum: Object.values( Survey.Status ) },
                count:  { type: "number" },
                start:  { type: "string" },
            },
        };
    }
    public getBodySchema(): RestfulEndpoint.Schema | null { return null; }
}

export namespace GetSurveys
{
    export const URI : string = apiPath( "survey", 1, "/surveys" );

    export interface Query extends Paging.Request { status? : Survey.Status; }
    export interface Response extends Paging.Result<Survey.Entity> {}

    export enum Error
    {
        BAD_REQUEST           = NetworkUtils.Status.BAD_REQUEST,
        UNAUTHORIZED          = NetworkUtils.Status.UNAUTHORIZED,
        INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR,
    }
}

export default GetSurveys;
// eof
