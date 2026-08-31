//
import { RestfulEndpoint, Access, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";

//
// Refresh a brand's external vetting (registration-11.3) — re-runs/re-pulls the EVP (Aegis/WMC/Campaign
// Verify) check, recomputes the trust score, and re-publishes trust-score → MPS (registration-7.2). Async —
// enqueues the RegistrationVettingJob and returns 202 immediately, mirroring PostVoiceCalls's "queued" shape.
//
export class PostRegistrationVettingRefresh extends RestfulEndpoint< PostRegistrationVettingRefresh.Query, PostRegistrationVettingRefresh.Body, PostRegistrationVettingRefresh.Response >
{
    public readonly uri      : string = PostRegistrationVettingRefresh.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : Access.Role = Access.AccountRole.ACCOUNT;
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    public readonly docs : RestfulEndpoint.Docs =
    {
        operationId: "refreshRegistrationVetting",
        summary:     "Refresh brand vetting",
        description: "Re-runs the brand's external vetting check + recomputes the trust score. Async — returns 202 with a job pointer.",
        tags:        [ "Registration" ],
    };

    constructor( brandId? : string, body? : PostRegistrationVettingRefresh.Body ) { super( { brandId: brandId ?? "" }, body ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return [ { field: "brandId", location: RestfulEndpoint.AttrLocation.URI, required: true } ]; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null { return { type: "object", additionalProperties: true, properties: {} }; }
}

export namespace PostRegistrationVettingRefresh
{
    export const URI : string = apiPath( "registration", 1, "/brand/:brandId/vetting-refresh" );
    export interface Query { brandId : string; }
    export interface Body extends RestfulEndpoint.AuthRequest {}
    export interface Response { queued : boolean; jobId? : string; }
    export enum Error
    {
        UNAUTHORIZED = NetworkUtils.Status.UNAUTHORIZED,
        NOT_FOUND    = NetworkUtils.Status.NOT_FOUND,
    }
}

export default PostRegistrationVettingRefresh;
// eof
