//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { Registration } from "./model/Registration";

//
// Get a single campaign by id (registration-2.0).
//
export class GetRegistrationCampaign extends RestfulEndpoint< GetRegistrationCampaign.Query, undefined, GetRegistrationCampaign.Response >
{
    public readonly uri      : string = GetRegistrationCampaign.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.GET;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "getRegistrationCampaign",
        summary:     "Get a campaign",
        description: "Fetches a single registered campaign by id (the reconciled TCR projection).",
        tags:        [ "Registration" ],
    };

    constructor( campaignId? : string ) { super( { campaignId: campaignId ?? "" } ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return [ { field: "campaignId", location: RestfulEndpoint.AttrLocation.URI, required: true } ]; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null { return null; }
}

export namespace GetRegistrationCampaign
{
    export const URI : string = apiPath( "registration", 1, "/campaign/:campaignId" );
    export interface Query { campaignId : string; }
    export interface Response extends Registration.Campaign {}
    export enum Error { UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED, NOT_FOUND = NetworkUtils.Status.NOT_FOUND }
}

export default GetRegistrationCampaign;
// eof
