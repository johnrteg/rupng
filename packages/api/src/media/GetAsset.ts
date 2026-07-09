//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { Media } from "./model/Media";

// One asset's metadata (the index record).
export class GetAsset extends RestfulEndpoint<GetAsset.Query, undefined, GetAsset.Response>
{
    public readonly uri      : string = GetAsset.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.GET;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.PUBLIC;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "getMediaAsset",
        summary:     "Get a media asset",
        description: "Returns one media asset (the envelope index record + its items) by id.",
        tags:        [ "Media" ],
        errors:      { 404: "Asset not found" },
    };

    constructor( guid? : string ) { super( { guid: guid ?? "" } ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return [ { field: "guid", location: RestfulEndpoint.AttrLocation.URI, required: true } ]; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema():  RestfulEndpoint.Schema | null { return null; }

    // success body — one asset (envelope) summary; item detail is intentionally shallow here
    public getResponseSchema(): RestfulEndpoint.Schema | null
    {
        return {
            type: "object",
            required: [ "asset" ],
            properties: {
                asset: {
                    type: "object",
                    properties: {
                        guid:        { type: "string", description: "Envelope id (the media id)." },
                        name:        { type: "string", description: "Display name." },
                        kind:        { type: "string", enum: Object.values( Media.Kind ),   description: "Media family." },
                        tier:        { type: "string", enum: Object.values( Media.Tier ),   description: "Delivery tier." },
                        status:      { type: "string", enum: Object.values( Media.Status ), description: "Readiness / lifecycle." },
                        accessRole:  { type: "string", description: "Minimum role to access a protected/private envelope." },
                        scope:       { type: "string", enum: Object.values( Media.Scope ),  description: "Owner scope." },
                        campaignIds: { type: "array", items: { type: "string" }, description: "Campaigns using this asset." },
                        tags:        { type: "array", items: { type: "string" } },
                        createdAt:   { type: "string", format: "date-time" },
                        items:       { type: "array", description: "The original + derived media items." },
                    },
                },
            },
        };
    }
}

export namespace GetAsset
{
    export const URI : string = apiPath( "media", 1, "/assets/:guid" );
    export interface Query { guid : string; }
    export interface Response { asset : Media.Asset; }
    export enum Error { UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED, FORBIDDEN = NetworkUtils.Status.FORBIDDEN, NOT_FOUND = NetworkUtils.Status.NOT_FOUND, INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR }
}

export default GetAsset;
