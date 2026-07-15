//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils, Type } from "@repo/common";
import { Campaign } from "./model/Campaign";

//
// Fetch a single campaign by id (definition + its channels → strategies → plans). Tenant-scoped to the
// acting account. USER-gated, first-party.
//
export class GetCampaign extends RestfulEndpoint< GetCampaign.Query, undefined, GetCampaign.Response >
{
    public readonly uri      : string = GetCampaign.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.GET;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.PUBLIC;   // public API (OpenAPI docs)

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "getCampaign",
        summary:     "Get a campaign",
        description: "Fetches a campaign (definition + its channels/strategies/plans).",
        tags:        [ "Campaign" ],
        errors:      { 404: "No such campaign in this account" },
    };

    constructor( id? : string ) { super( { id: id ?? "" } ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return [ { field: "id", location: RestfulEndpoint.AttrLocation.URI, required: true } ]; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema():  RestfulEndpoint.Schema | null { return null; }
    public getResponseSchema(): RestfulEndpoint.Schema | null
    {
        return { type: "object", description: "The campaign.", properties: {
            id:        { type: "string", description: "Campaign id." },
            name:      { type: "string", description: "Display name." },
            objective: { type: "string", description: "Free-text goal." },
            status:    { type: "string", description: "Lifecycle state." },
            channels:  { type: "array", description: "Selected channels (each with a strategy + plans)." },
        } };
    }
}

export namespace GetCampaign
{
    export const URI : string = apiPath( "campaign", 1, "/campaigns/:id" );

    export interface Query { id : Type.UUID; }
    export interface Response extends Campaign.Entity {}

    export enum Error
    {
        UNAUTHORIZED          = NetworkUtils.Status.UNAUTHORIZED,
        NOT_FOUND             = NetworkUtils.Status.NOT_FOUND,
        INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR,
    }
}

export default GetCampaign;
