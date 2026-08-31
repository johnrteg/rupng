//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { Registration } from "./model/Registration";
import { Paging } from "../model/Paging";

//
// List the caller's account's campaigns (paged), optionally filtered by brand/status. Read-only listing is
// USER (mirrors GetVoiceFlows) — creation/mutation stays ACCOUNT.
//
export class GetRegistrationCampaigns extends RestfulEndpoint< GetRegistrationCampaigns.Query, undefined, GetRegistrationCampaigns.Response >
{
    public readonly uri      : string = GetRegistrationCampaigns.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.GET;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "listRegistrationCampaigns",
        summary:     "List campaigns",
        description: "Lists the account's campaigns (paged — ?count/?start; optionally filtered by brandId/status).",
        tags:        [ "Registration" ],
    };

    constructor( query? : GetRegistrationCampaigns.Query ) { super( query ?? {} ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null
    {
        return {
            type: "object", additionalProperties: false,
            properties: {
                brandId: { type: "string" },
                status:  { type: "string", enum: Object.values( Registration.CampaignStatus ) },
                count:   { type: "number" },
                start:   { type: "string" },
            },
        };
    }
    public getBodySchema(): RestfulEndpoint.Schema | null { return null; }
}

export namespace GetRegistrationCampaigns
{
    export const URI : string = apiPath( "registration", 1, "/campaigns" );
    export interface Query extends Paging.Request { brandId? : string; status? : Registration.CampaignStatus; }
    export interface Response extends Paging.Result<Registration.Campaign> {}
    export enum Error { UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED }
}

export default GetRegistrationCampaigns;
// eof
