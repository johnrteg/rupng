//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { Media } from "./model/Media";

// Update an envelope's editable metadata (tags / display name).
export class PatchAsset extends RestfulEndpoint<PatchAsset.Query, PatchAsset.Body, PatchAsset.Response>
{
    public readonly uri      : string = PatchAsset.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.PATCH;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    constructor( guid? : string, body? : PatchAsset.Body ) { super( { guid: guid ?? "" }, body ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return [ { field: "guid", location: RestfulEndpoint.AttrLocation.URI, required: true } ]; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null
    {
        return { type: "object", additionalProperties: false, properties: {
            tags: { type: "array", items: { type: "string" } },
            name: { type: "string", minLength: 1, maxLength: 300 },
        } };
    }
}

export namespace PatchAsset
{
    export const URI : string = apiPath( "media", 1, "/assets/:guid" );
    export interface Query { guid : string; }
    export interface Body extends RestfulEndpoint.AuthRequest { tags? : Array<string>; name? : string; }
    export interface Response { asset : Media.Asset; }
    export enum Error { BAD_REQUEST = NetworkUtils.Status.BAD_REQUEST, UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED, NOT_FOUND = NetworkUtils.Status.NOT_FOUND, INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR }
}

export default PatchAsset;
