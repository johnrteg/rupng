//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils, Type } from "@repo/common";
import { Campaign } from "./model/Campaign";

//
// Edit a campaign's definition / channels / strategies / plans (draft only — locked once submitted).
// USER-gated, first-party. Server bumps modifiedAt.
//
export class PatchCampaign extends RestfulEndpoint< PatchCampaign.Query, PatchCampaign.Body, PatchCampaign.Response >
{
    public readonly uri      : string = PatchCampaign.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.PATCH;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "updateCampaign",
        summary:     "Update a campaign",
        description: "Edits a campaign's definition/channels/strategies/plans (draft only; locked once submitted).",
        tags:        [ "Campaign" ],
        errors:      { 404: "No such campaign in this account", 409: "Campaign is locked (submitted / in review)" },
    };

    constructor( id? : string, body? : PatchCampaign.Body ) { super( { id: id ?? "" }, body ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return [ { field: "id", location: RestfulEndpoint.AttrLocation.URI, required: true } ]; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null
    {
        return { type: "object", additionalProperties: true, properties: {} };
    }
}

export namespace PatchCampaign
{
    export const URI : string = apiPath( "campaign", 1, "/campaigns/:id" );

    export interface Query { id : Type.UUID; }
    export interface Body extends RestfulEndpoint.AuthRequest, Campaign.UpdateCampaign {}
    export interface Response extends Campaign.Entity {}

    export enum Error
    {
        BAD_REQUEST           = NetworkUtils.Status.BAD_REQUEST,
        UNAUTHORIZED          = NetworkUtils.Status.UNAUTHORIZED,
        NOT_FOUND             = NetworkUtils.Status.NOT_FOUND,
        CONFLICT              = NetworkUtils.Status.CONFLICT,
        INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR,
    }
}

export default PatchCampaign;
