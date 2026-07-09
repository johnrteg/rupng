//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { Media } from "./model/Media";
import { Paging } from "../model/Paging";

// The media library view — list the acting account's assets, optionally filtered by scope / scopeId / kind /
// status. Excludes soft-deleted by default.
export class GetAssets extends RestfulEndpoint<GetAssets.Query, undefined, GetAssets.Response>
{
    public readonly uri      : string = GetAssets.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.GET;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.PUBLIC;   // published dev API

    // published-docs metadata — a secured, service-prefix-routed endpoint (drives the auth + min-role chips)
    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "listMediaAssets",
        summary:     "List media assets",
        description: "Lists the acting account's media library, optionally filtered by scope / kind / status / campaign. Soft-deleted assets are excluded by default.",
        tags:        [ "Media" ],
        errors:      { 500: "Failed to list assets" },
    };

    constructor( query? : GetAssets.Query ) { super( query ?? {} ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap>
    {
        return [
            { field: "scope",   location: RestfulEndpoint.AttrLocation.QUERY_PARAM, required: false },
            { field: "scopeId", location: RestfulEndpoint.AttrLocation.QUERY_PARAM, required: false },
            { field: "kind",    location: RestfulEndpoint.AttrLocation.QUERY_PARAM, required: false },
            { field: "status",  location: RestfulEndpoint.AttrLocation.QUERY_PARAM, required: false },
            { field: "campaignId", location: RestfulEndpoint.AttrLocation.QUERY_PARAM, required: false },
            { field: "count",   location: RestfulEndpoint.AttrLocation.QUERY_PARAM, required: false },
            { field: "start",   location: RestfulEndpoint.AttrLocation.QUERY_PARAM, required: false },
        ];
    }

    // query params with enum values so the docs show the allowed filter values (media enums = closed sets)
    public getQuerySchema(): RestfulEndpoint.Schema | null
    {
        return {
            type: "object",
            properties: {
                scope:      { type: "string", enum: Object.values( Media.Scope ),  description: "Owner scope (account library vs a user's avatars)." },
                scopeId:    { type: "string", description: "User id — for a USER/avatar-scoped listing." },
                kind:       { type: "string", enum: Object.values( Media.Kind ),   description: "Filter by media kind." },
                status:     { type: "string", enum: Object.values( Media.Status ), description: "Filter by lifecycle status." },
                campaignId: { type: "string", description: "Filter to assets used by a campaign." },
            },
        };
    }

    public getBodySchema():  RestfulEndpoint.Schema | null { return null; }

    // success body — a paged list of envelope (Asset) summaries under the standard { records, page } envelope
    public getResponseSchema(): RestfulEndpoint.Schema | null
    {
        return {
            type: "object",
            required: [ "records", "page" ],
            properties: {
                records: {
                    type: "array",
                    description: "The account's media assets (envelopes) on this page.",
                    items: {
                        type: "object",
                        properties: {
                            guid:        { type: "string", description: "Envelope id (the media id).", examples: [ "8920054f-…" ] },
                            name:        { type: "string", description: "Display name." },
                            kind:        { type: "string", enum: Object.values( Media.Kind ),   description: "Media family (from the original)." },
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
                page: { type: "object", description: "Paging envelope.", properties: {
                    count: { type: "number" }, total: { type: "number" }, next: { type: "string" } } },
            },
        };
    }
}

export namespace GetAssets
{
    export const URI : string = apiPath( "media", 1, "/assets" );
    export interface Query extends Paging.Request { scope? : Media.Scope; scopeId? : string; kind? : Media.Kind; status? : Media.Status; campaignId? : string; }
    export interface Response extends Paging.Result<Media.Asset> {}
    export enum Error { UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED, FORBIDDEN = NetworkUtils.Status.FORBIDDEN, INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR }
}

export default GetAssets;
