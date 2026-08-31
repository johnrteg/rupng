//
import { RestfulEndpoint, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";

//
// TCR's own webhook intake path (registration-3.1/5.0/9.0) — brand identity/vetting + campaign
// submission/vetting/operations-status callbacks. The impl verifies TCR's signature, ACKs fast (200), and
// enqueues the raw event for a worker to normalize into the reconciled projection. No RBAC — secured via the
// `Webhook` helper at the impl layer (mirrors PostVoiceWebhookStatus's posture).
//
export class PostRegistrationWebhookTcr extends RestfulEndpoint< PostRegistrationWebhookTcr.Query, PostRegistrationWebhookTcr.Body, PostRegistrationWebhookTcr.Response >
{
    public readonly uri      : string = PostRegistrationWebhookTcr.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : undefined = undefined;   // provider-signature verified, not RBAC
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    constructor( body? : PostRegistrationWebhookTcr.Body ) { super( {}, body ); }
    // the HMAC header has to be MAPPED to reach the impl — headers are only surfaced through a FieldMap
    // (same shape as PostSocialWebhook's `x-hub-signature-256`), never off the raw request
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return [
        { field: "x-tcr-signature", location: RestfulEndpoint.AttrLocation.HEADER, required: false },
    ]; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    // TCR's own payload shape — not ours to model; validated loosely, the impl parses what it needs
    public getBodySchema(): RestfulEndpoint.Schema | null { return { type: "object", additionalProperties: true }; }
}

export namespace PostRegistrationWebhookTcr
{
    export const URI : string = apiPath( "registration", 1, "/webhook/tcr" );
    export interface Query { "x-tcr-signature"? : string; }
    export interface Body extends RestfulEndpoint.NonAuthRequest { [ key : string ] : unknown; }
    export interface Response { ok : boolean; }
    export enum Error { BAD_REQUEST = NetworkUtils.Status.BAD_REQUEST, FORBIDDEN = NetworkUtils.Status.FORBIDDEN }
}

export default PostRegistrationWebhookTcr;
// eof
