//
import { RestfulEndpoint, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";

//
// Inbound provider webhook intake (comments/mentions/DMs) — Meta only (the push providers; X/TikTok/
// LinkedIn are polled — see SocialPollJob). Signature-verified in the impl (per-adapter
// `verifyWebhook`), not by JWT/RBAC — hence no `access` role. ACK-fast: ok:true just means "queued for
// normalize", not "processed".
//
export class PostSocialWebhook extends RestfulEndpoint< PostSocialWebhook.Query, PostSocialWebhook.Body, PostSocialWebhook.Response >
{
    public readonly uri      : string = PostSocialWebhook.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : undefined = undefined;   // signature-verified, not RBAC
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.PUBLIC;   // internet-reachable (the provider calls in)

    constructor( platform? : string, body? : PostSocialWebhook.Body ) { super( { platform: platform ?? "" }, body ); }
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return [
        { field: "platform",             location: RestfulEndpoint.AttrLocation.URI,    required: true },
        { field: "x-hub-signature-256",  location: RestfulEndpoint.AttrLocation.HEADER, required: false },
    ]; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    public getBodySchema(): RestfulEndpoint.Schema | null { return { type: "object", additionalProperties: true }; }
}

export namespace PostSocialWebhook
{
    export const URI : string = apiPath( "social", 1, "/webhooks/:platform" );

    export interface Query { platform : string; "x-hub-signature-256"? : string; }
    export interface Body extends RestfulEndpoint.NonAuthRequest { object? : string; entry? : Array<unknown>; }
    export interface Response { ok : boolean; }

    export enum Error
    {
        BAD_REQUEST           = NetworkUtils.Status.BAD_REQUEST,
        UNAUTHORIZED          = NetworkUtils.Status.UNAUTHORIZED,
        INTERNAL_SERVER_ERROR = NetworkUtils.Status.INTERNAL_SERVER_ERROR,
    }
}

export default PostSocialWebhook;
