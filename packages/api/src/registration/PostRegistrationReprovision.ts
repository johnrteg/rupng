//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";

//
// Re-associate/re-provision numbers to a campaign (registration-11.5) — after release, provider switch, or a
// failed association; re-runs association toward ACTIVE. campaignId is both a path param (identifies the
// resource) and echoed in the body per RestfulEndpoint.AuthRequest convention. Async — returns 202.
//
export class PostRegistrationReprovision extends RestfulEndpoint< PostRegistrationReprovision.Query, PostRegistrationReprovision.Body, PostRegistrationReprovision.Response >
{
    public readonly uri      : string = PostRegistrationReprovision.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : Access.Role = Access.AccountRole.ACCOUNT;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "reprovisionRegistrationCampaign",
        summary:     "Reprovision a campaign's numbers",
        description: "Re-associates/re-provisions numbers to a campaign after release, provider switch, or a failed association. Async — returns 202.",
        tags:        [ "Registration" ],
    };

    constructor( campaignId? : string, body? : PostRegistrationReprovision.Body ) { super( { campaignId: campaignId ?? "" }, body ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return [ { field: "campaignId", location: RestfulEndpoint.AttrLocation.URI, required: true } ]; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null
    {
        return {
            type: "object", additionalProperties: true,
            properties: {
                provider: { type: "string" },
                areaCode: { type: "string" },
            },
        };
    }
}

export namespace PostRegistrationReprovision
{
    export const URI : string = apiPath( "registration", 1, "/campaign/:campaignId/reprovision" );
    export interface Query { campaignId : string; }
    export interface Body extends RestfulEndpoint.AuthRequest { provider? : string; areaCode? : string; }
    export interface Response { queued : boolean; jobId? : string; }
    export enum Error
    {
        UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED,
        NOT_FOUND    = NetworkUtils.Status.NOT_FOUND,
    }
}

export default PostRegistrationReprovision;
// eof
