//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";
import { Campaign } from "./model/Campaign";

//
// Create a campaign (draft). Server assigns id / accountId / status (DRAFT) / ownerId / timestamps.
// USER-gated, first-party. Channels/strategies/plans may be supplied now or added via PATCH.
//
export class PostCampaign extends RestfulEndpoint< {}, PostCampaign.Body, PostCampaign.Response >
{
    public readonly uri      : string = PostCampaign.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : Access.Role = Access.AccountRole.USER;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.PUBLIC;   // public API (OpenAPI docs)

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "createCampaign",
        summary:     "Create a campaign",
        description: "Creates a campaign in draft state under the acting account.",
        tags:        [ "Campaign" ],
    };

    constructor( body? : PostCampaign.Body ) { super( {}, body ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return []; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null
    {
        return {
            type: "object", additionalProperties: true, required: [ "name" ],
            properties: {
                name:      { type: "string", minLength: 1 },
                objective: { type: "string" },
                channels:  { type: "array" },
                audience:  { type: "object", additionalProperties: true },
                budget:    { type: "object", additionalProperties: true },
            },
        };
    }
    public getResponseSchema(): RestfulEndpoint.Schema | null
    {
        return { type: "object", description: "The created campaign (draft).", properties: {
            id:     { type: "string", description: "New campaign id." },
            name:   { type: "string", description: "Display name." },
            status: { type: "string", description: "Lifecycle state (draft)." },
        } };
    }
}

export namespace PostCampaign
{
    export const URI : string = apiPath( "campaign", 1, "/campaigns" );

    export interface Body extends RestfulEndpoint.AuthRequest, Campaign.CreateCampaign {}
    export interface Response extends Campaign.Entity {}

    export enum Error
    {
        BAD_REQUEST           = NetworkUtils.Status.BAD_REQUEST,
        UNAUTHORIZED          = NetworkUtils.Status.UNAUTHORIZED,
        INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR,
    }
}

export default PostCampaign;
