//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { Segment } from "./model/Segment";
import { Paging } from "../model/Paging";

//
// List the acting account's segments (the primary targeting tool; paged). USER-gated, first-party.
//
export class GetSegments extends RestfulEndpoint< GetSegments.Query, undefined, GetSegments.Response >
{
    public readonly uri      : string = GetSegments.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.GET;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.PUBLIC;   // public API (OpenAPI docs)

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "listSegments",
        summary:     "List segments",
        description: "Lists the acting account's contact segments.",
        tags:        [ "Contact" ],
    };

    constructor( query? : GetSegments.Query ) { super( query ?? {} ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema():  RestfulEndpoint.Schema | null { return null; }
    public getResponseSchema(): RestfulEndpoint.Schema | null
    {
        return { type: "object", required: [ "records", "page" ], properties: {
            records: { type: "array", description: "Segments on this page.", items: { type: "object", properties: {
                id: { type: "string" }, name: { type: "string" }, size: { type: "number" }, status: { type: "string" } } } },
            page: { type: "object", description: "Paging envelope.", properties: {
                count: { type: "number" }, total: { type: "number" }, next: { type: "string" } } },
        } };
    }
}

export namespace GetSegments
{
    export const URI : string = apiPath( "contact", 1, "/segments" );

    export interface Query extends Paging.Request
    {
        includeHidden? : boolean;   // include campaign-built / hidden segments (default: hidden are excluded)
    }
    export interface Response extends Paging.Result<Segment.Entity> {}

    export enum Error
    {
        UNAUTHORIZED          = NetworkUtils.Status.UNAUTHORIZED,
        INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR,
    }
}

export default GetSegments;
