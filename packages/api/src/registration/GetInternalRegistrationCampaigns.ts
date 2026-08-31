//
import { RestfulEndpoint, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { Registration } from "./model/Registration";
import { Paging } from "../model/Paging";

//
// S2S: list ALL campaigns, optionally filtered by accountId/brandId/status (paged — `{ records, page }`
// envelope). INTERNAL audience. First consumer: the `report` service (mirrors GetInternalContacts's pattern).
//
export class GetInternalRegistrationCampaigns extends RestfulEndpoint< GetInternalRegistrationCampaigns.Query, undefined, GetInternalRegistrationCampaigns.Response >
{
    public readonly uri      : string = GetInternalRegistrationCampaigns.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.GET;
    public readonly access   : undefined = undefined;   // S2S (INTERNAL audience) — no RBAC role
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.INTERNAL;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "listInternalRegistrationCampaigns",
        summary:     "List campaigns (S2S)",
        description: "Lists campaigns, optionally filtered by accountId/brandId/status (paged — ?count/?start; returns { records, page }).",
        tags:        [ "Registration" ],
    };

    constructor( query? : GetInternalRegistrationCampaigns.Query ) { super( query ?? {} ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null
    {
        return {
            type: "object", additionalProperties: false,
            properties: {
                accountId: { type: "string" },
                brandId:   { type: "string" },
                status:    { type: "string", enum: Object.values( Registration.CampaignStatus ) },
                count:     { type: "number" },
                start:     { type: "string" },
            },
        };
    }
    public getBodySchema(): RestfulEndpoint.Schema | null { return null; }
}

export namespace GetInternalRegistrationCampaigns
{
    export const URI : string = apiPath( "registration", 1, "/internal/campaigns" );

    export interface Query extends Paging.Request { accountId? : string; brandId? : string; status? : Registration.CampaignStatus; }

    export interface Response extends Paging.Result<Registration.Campaign> {}

    export enum Error
    {
        BAD_REQUEST           = NetworkUtils.Status.BAD_REQUEST,
        INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR,
    }
}

export default GetInternalRegistrationCampaigns;
// eof
