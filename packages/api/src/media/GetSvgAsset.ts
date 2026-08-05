//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { SvgAsset } from "./model/SvgAsset";

// Read one SVG library asset's markup (for preview + placement) — either a system-wide graphic or one owned
// by the acting account. `scope` disambiguates which owner partition to read (the list's Summary already
// carries it, so the picker never has to guess).
export class GetSvgAsset extends RestfulEndpoint<GetSvgAsset.Query, undefined, GetSvgAsset.Response>
{
    public readonly uri      : string = GetSvgAsset.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.GET;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    constructor( assetId? : string, scope? : SvgAsset.Scope ) { super( { assetId: assetId ?? "", scope } ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap>
    {
        return [
            { field: "assetId", location: RestfulEndpoint.AttrLocation.URI, required: true },
            { field: "scope",   location: RestfulEndpoint.AttrLocation.QUERY_PARAM, required: false },
        ];
    }
    // no query schema — `this.query` (validated against it) also carries `assetId` (needed for the URI
    // mapping above), and a schema declaring only `scope` would reject it under `additionalProperties: false`.
    // Every other URI-param endpoint in this codebase skips query validation the same way — the URI mapping's
    // own `required: true` already enforces assetId's presence.
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema():  RestfulEndpoint.Schema | null { return null; }
}

export namespace GetSvgAsset
{
    export const URI : string = apiPath( "media", 1, "/svg/assets/:assetId" );
    export interface Query { assetId : string; scope? : SvgAsset.Scope; }
    export interface Response { name : string; svg : string; }
    export enum Error { BAD_REQUEST = NetworkUtils.Status.BAD_REQUEST, UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED, NOT_FOUND = NetworkUtils.Status.NOT_FOUND, INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR }
}

export default GetSvgAsset;
