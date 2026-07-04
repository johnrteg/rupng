//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { Media } from "./model/Media";

// The media library view — list the acting account's assets, optionally filtered by scope / scopeId / kind /
// status. Excludes soft-deleted by default.
export class GetAssets extends RestfulEndpoint<GetAssets.Query, undefined, GetAssets.Response>
{
    public readonly uri      : string = GetAssets.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.GET;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    constructor( query? : GetAssets.Query ) { super( query ?? {} ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap>
    {
        return [
            { field: "scope",   location: RestfulEndpoint.AttrLocation.QUERY_PARAM, required: false },
            { field: "scopeId", location: RestfulEndpoint.AttrLocation.QUERY_PARAM, required: false },
            { field: "kind",    location: RestfulEndpoint.AttrLocation.QUERY_PARAM, required: false },
            { field: "status",  location: RestfulEndpoint.AttrLocation.QUERY_PARAM, required: false },
            { field: "campaignId", location: RestfulEndpoint.AttrLocation.QUERY_PARAM, required: false },
        ];
    }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema():  RestfulEndpoint.Schema | null { return null; }
}

export namespace GetAssets
{
    export const URI : string = apiPath( "media", 1, "/assets" );
    export interface Query { scope? : Media.Scope; scopeId? : string; kind? : Media.Kind; status? : Media.Status; campaignId? : string; }
    export interface Response { assets : Array<Media.Asset>; }
    export enum Error { UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED, FORBIDDEN = NetworkUtils.Status.FORBIDDEN, INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR }
}

export default GetAssets;
