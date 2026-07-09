//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { Campaign } from "./model/Campaign";
import { Paging } from "../model/Paging";

//
// List the acting account's campaigns (paged, `{ data, page }` envelope). USER-gated, first-party (APP).
//
export class GetCampaigns extends RestfulEndpoint< GetCampaigns.Query, undefined, GetCampaigns.Response >
{
    public readonly uri      : string = GetCampaigns.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.GET;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.PUBLIC;   // public API (OpenAPI docs)

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "listCampaigns",
        summary:     "List campaigns",
        description: "Lists the acting account's campaigns (paged).",
        tags:        [ "Campaign" ],
    };

    constructor( query? : GetCampaigns.Query ) { super( query ?? {} ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema():  RestfulEndpoint.Schema | null { return null; }
    public getResponseSchema(): RestfulEndpoint.Schema | null
    {
        return { type: "object", required: [ "records", "page" ], properties: {
            records: { type: "array", description: "Campaigns on this page.", items: { type: "object", properties: {
                id: { type: "string" }, name: { type: "string" }, status: { type: "string" } } } },
            page: { type: "object", description: "Paging envelope.", properties: {
                count: { type: "number" }, total: { type: "number" }, next: { type: "string" } } },
        } };
    }
}

export namespace GetCampaigns
{
    export const URI : string = apiPath( "campaign", 1, "/campaigns" );

    export interface Query extends Paging.Request
    {
        status? : Campaign.Status;
    }

    export interface Response extends Paging.Result<Campaign.Entity> {}

    export enum Error
    {
        UNAUTHORIZED          = NetworkUtils.Status.UNAUTHORIZED,
        INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR,
    }
}

export default GetCampaigns;
