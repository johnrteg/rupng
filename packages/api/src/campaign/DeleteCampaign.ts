//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils, Type } from "@repo/common";

//
// Archive a campaign (terminal, read-only — campaigns are archivable, never deletable; run history + audience
// snapshot are preserved for audit). USER-gated, first-party.
//
export class DeleteCampaign extends RestfulEndpoint< DeleteCampaign.Query, undefined, DeleteCampaign.Response >
{
    public readonly uri      : string = DeleteCampaign.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.DELETE;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "archiveCampaign",
        summary:     "Archive a campaign",
        description: "Archives a campaign (terminal, read-only; never hard-deleted).",
        tags:        [ "Campaign" ],
        errors:      { 404: "No such campaign in this account" },
    };

    constructor( id? : string ) { super( { id: id ?? "" } ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return [ { field: "id", location: RestfulEndpoint.AttrLocation.URI, required: true } ]; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema():  RestfulEndpoint.Schema | null { return null; }
}

export namespace DeleteCampaign
{
    export const URI : string = apiPath( "campaign", 1, "/campaigns/:id" );

    export interface Query { id : Type.UUID; }
    export interface Response { id : Type.UUID; archived : boolean; }

    export enum Error
    {
        UNAUTHORIZED          = NetworkUtils.Status.UNAUTHORIZED,
        NOT_FOUND             = NetworkUtils.Status.NOT_FOUND,
        INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR,
    }
}

export default DeleteCampaign;
