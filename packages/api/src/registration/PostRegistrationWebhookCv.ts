//
import { RestfulEndpoint, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";

//
// Campaign Verify's webhook intake path (registration-11.3) — CV's political-brand vetting callbacks, bridged
// into TCR's own vetting via an imported token. The impl verifies CV's signature, ACKs fast (200), and
// enqueues the raw event for a worker to normalize into the reconciled projection. No RBAC — secured via the
// `Webhook` helper at the impl layer (mirrors PostVoiceWebhookStatus's posture).
//
export class PostRegistrationWebhookCv extends RestfulEndpoint< PostRegistrationWebhookCv.Query, PostRegistrationWebhookCv.Body, PostRegistrationWebhookCv.Response >
{
    public readonly uri      : string = PostRegistrationWebhookCv.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : undefined = undefined;   // provider-signature verified, not RBAC
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    constructor( body? : PostRegistrationWebhookCv.Body ) { super( {}, body ); }
    // the HMAC header has to be MAPPED to reach the impl — see PostRegistrationWebhookTcr's note
    public getMappings(): Array<RestfulEndpoint.FieldMap> { return [
        { field: "x-cv-signature", location: RestfulEndpoint.AttrLocation.HEADER, required: false },
    ]; }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    // Campaign Verify's own payload shape — not ours to model; validated loosely, the impl parses what it needs
    public getBodySchema(): RestfulEndpoint.Schema | null { return { type: "object", additionalProperties: true }; }
}

export namespace PostRegistrationWebhookCv
{
    export const URI : string = apiPath( "registration", 1, "/webhook/cv" );
    export interface Query { "x-cv-signature"? : string; }
    export interface Body extends RestfulEndpoint.NonAuthRequest { [ key : string ] : unknown; }
    export interface Response { ok : boolean; }
    export enum Error { BAD_REQUEST = NetworkUtils.Status.BAD_REQUEST, FORBIDDEN = NetworkUtils.Status.FORBIDDEN }
}

export default PostRegistrationWebhookCv;
// eof
