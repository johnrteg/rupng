//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { Search } from "./model/Search";

//
// Global content search (search-2.1) — text + filters → ranked results. ALWAYS account- + role-filtered
// server-side (search-3.1/3.2/3.3); the caller's `X-Account` + resolved role are injected as a mandatory
// query filter and nothing sent here can widen that scope. Redis-first (search-2.2); phonetic +
// case-insensitive matching by default, `exact=true` opts into a verbatim phrase match (search-2.3/2.3.1).
//
export class GetSearch extends RestfulEndpoint< GetSearch.Query, undefined, GetSearch.Response >
{
    public readonly uri      : string = GetSearch.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.GET;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "search",
        summary:     "Global content search",
        description: "Text + filters -> ranked results, always scoped to the caller's account + role.",
        tags:        [ "Search" ],
    };

    constructor( query? : GetSearch.Query ) { super( query ?? { q: "" } ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap>
    {
        return [
            { field: "q",        location: RestfulEndpoint.AttrLocation.QUERY_PARAM, required: true },
            { field: "type",     location: RestfulEndpoint.AttrLocation.QUERY_PARAM, required: false },
            { field: "from",     location: RestfulEndpoint.AttrLocation.QUERY_PARAM, required: false },
            { field: "to",       location: RestfulEndpoint.AttrLocation.QUERY_PARAM, required: false },
            { field: "exact",    location: RestfulEndpoint.AttrLocation.QUERY_PARAM, required: false },
            { field: "page",     location: RestfulEndpoint.AttrLocation.QUERY_PARAM, required: false },
            { field: "pageSize", location: RestfulEndpoint.AttrLocation.QUERY_PARAM, required: false },
        ];
    }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema():  RestfulEndpoint.Schema | null { return null; }
}

export namespace GetSearch
{
    export const URI : string = apiPath( "search", 1, "" );

    export interface Query
    {
        q:         string;
        type?:     Search.DocType;
        from?:     string;
        to?:       string;
        exact?:    boolean;
        page?:     number;
        pageSize?: number;
    }

    export interface Response extends Search.Result {}

    export enum Error
    {
        BAD_REQUEST           = NetworkUtils.Status.BAD_REQUEST,
        UNAUTHORIZED          = NetworkUtils.Status.UNAUTHORIZED,
        INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR,
    }
}

export default GetSearch;
// eof
