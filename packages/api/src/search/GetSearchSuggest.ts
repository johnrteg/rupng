//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { Search } from "./model/Search";

//
// Type-ahead suggestions (search-2.3, gap #2 — later enhancement, not v1). Same mandatory account + role
// filter as `GetSearch`; a thin, capped-result variant meant for an input's live dropdown.
//
export class GetSearchSuggest extends RestfulEndpoint< GetSearchSuggest.Query, undefined, GetSearchSuggest.Response >
{
    public readonly uri      : string = GetSearchSuggest.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.GET;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "searchSuggest",
        summary:     "Search type-ahead suggestions",
        description: "A capped set of ranked suggestions for a partial query, same RBAC filter as GetSearch.",
        tags:        [ "Search" ],
    };

    constructor( query? : GetSearchSuggest.Query ) { super( query ?? { q: "" } ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap>
    { return [ { field: "q", location: RestfulEndpoint.AttrLocation.QUERY_PARAM, required: true } ]; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema():  RestfulEndpoint.Schema | null { return null; }
}

export namespace GetSearchSuggest
{
    export const URI : string = apiPath( "search", 1, "/suggest" );
    export interface Query { q : string; }
    export interface Response { hits : Array<Search.Hit>; }
    export enum Error { UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED }
}

export default GetSearchSuggest;
// eof
