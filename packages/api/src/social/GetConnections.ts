//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { SocialAccount } from "./model/SocialAccount";
import { Paging } from "../model/Paging";

//
// List the acting account's connected destinations (paged, `{ data, page }` envelope). USER-gated.
//
export class GetConnections extends RestfulEndpoint< GetConnections.Query, undefined, GetConnections.Response >
{
    public readonly uri      : string = GetConnections.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.GET;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.PUBLIC;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "listSocialConnections",
        summary:     "List connected destinations",
        description: "Lists the acting account's connected social destinations (paged).",
        tags:        [ "Social" ],
    };

    constructor( query? : GetConnections.Query ) { super( query ?? {} ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema():  RestfulEndpoint.Schema | null { return null; }
    public getResponseSchema(): RestfulEndpoint.Schema | null
    {
        return { type: "object", required: [ "records", "page" ], properties: {
            records: { type: "array", description: "Connections on this page." },
            page:    { type: "object", description: "Paging envelope." },
        } };
    }
}

export namespace GetConnections
{
    export const URI : string = apiPath( "social", 1, "/connections" );

    export interface Query extends Paging.Request
    {
        platform? : SocialAccount.Platform;
    }

    export interface Response extends Paging.Result<SocialAccount.Entity> {}

    export enum Error
    {
        UNAUTHORIZED          = NetworkUtils.Status.UNAUTHORIZED,
        INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR,
    }
}

export default GetConnections;
