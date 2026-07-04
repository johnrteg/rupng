//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { Media } from "./model/Media";

// List the S3 version history of a single ITEM within an envelope (media-1.4) — newest first — so the user can
// see prior versions and revert to one (PostItemRevert). The `item` is the item key `usage[.profile]`
// (e.g. "original" | "compressed.mms" | "display.thumb").
export class GetItemVersions extends RestfulEndpoint<GetItemVersions.Query, undefined, GetItemVersions.Response>
{
    public readonly uri      : string = GetItemVersions.URI;
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

export namespace GetItemVersions
{
    export const URI : string = apiPath( "media", 1, "/assets/:guid/versions" );
    export interface Query { guid : string; item? : string; }   // item key `usage[.profile]`; "" / "original" = the source
    export interface Response { versions : Array<Media.ItemVersion>; }
    export enum Error { BAD_REQUEST = NetworkUtils.Status.BAD_REQUEST, UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED, NOT_FOUND = NetworkUtils.Status.NOT_FOUND, INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR }
}

export default GetItemVersions;
