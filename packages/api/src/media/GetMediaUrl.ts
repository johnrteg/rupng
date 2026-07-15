//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";

// Resolve an asset (optionally a specific ITEM) to a time-limited delivery URL for preview/download — the
// service decides access (tier + accessRole + logs), then hands off a pre-signed URL; it NEVER streams bytes.
export class GetMediaUrl extends RestfulEndpoint<GetMediaUrl.Query, undefined, GetMediaUrl.Response>
{
    public readonly uri      : string = GetMediaUrl.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.GET;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    constructor( guid? : string, item? : string ) { super( { guid: guid ?? "", item: item ?? "" } ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap>
    {
        return [
            { field: "guid", location: RestfulEndpoint.AttrLocation.URI, required: true },
            { field: "item", location: RestfulEndpoint.AttrLocation.QUERY_PARAM, required: false },
        ];
    }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema():  RestfulEndpoint.Schema | null { return null; }
}

export namespace GetMediaUrl
{
    export const URI : string = apiPath( "media", 1, "/assets/:guid/url" );
    export interface Query { guid : string; item? : string; }   // item key `usage[.profile]`; "" / "original" = the source
    export interface Response { url : string; expiresAt : string; }
    export enum Error { UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED, FORBIDDEN = NetworkUtils.Status.FORBIDDEN, NOT_FOUND = NetworkUtils.Status.NOT_FOUND, INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR }
}

export default GetMediaUrl;
