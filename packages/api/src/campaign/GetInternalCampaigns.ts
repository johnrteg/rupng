//
import { RestfulEndpoint, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { Campaign } from "./model/Campaign";
import { Paging } from "../model/Paging";

//
// S2S: list an EXPLICIT account's campaigns (paged, `{ records, page }` envelope). INTERNAL audience — no
// user session/X-Account on an S2S call, so the caller passes `accountId` explicitly instead of relying on
// ambient account-context. First consumer: the `report` service, which never reads campaign's own DB directly.
//
export class GetInternalCampaigns extends RestfulEndpoint< GetInternalCampaigns.Query, undefined, GetInternalCampaigns.Response >
{
    public readonly uri      : string = GetInternalCampaigns.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.GET;
    public readonly access   : undefined = undefined;   // S2S (INTERNAL audience) — no RBAC role
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.INTERNAL;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "listInternalCampaigns",
        summary:     "List an account's campaigns (S2S)",
        description: "Lists the given account's campaigns (paged — ?count / ?start; returns { records, page }).",
        tags:        [ "Campaign" ],
    };

    constructor( query? : GetInternalCampaigns.Query ) { super( query ?? { accountId: "" } ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null
    {
        return {
            type: "object", additionalProperties: false, required: [ "accountId" ],
            properties: {
                accountId: { type: "string" },
                status:    { type: "string", enum: Object.values( Campaign.Status ) },
                count:     { type: "number" },
                start:     { type: "string" },
            },
        };
    }
    public getBodySchema():  RestfulEndpoint.Schema | null { return null; }
}

export namespace GetInternalCampaigns
{
    export const URI : string = apiPath( "campaign", 1, "/internal/campaigns" );

    export interface Query extends Paging.Request
    {
        accountId : string;
        status?   : Campaign.Status;
    }

    export interface Response extends Paging.Result<Campaign.Entity> {}

    export enum Error
    {
        BAD_REQUEST           = NetworkUtils.Status.BAD_REQUEST,
        INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR,
    }
}

export default GetInternalCampaigns;
// eof
