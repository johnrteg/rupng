//
import { RestfulEndpoint, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";

//
// The SMS/MMS provider's ASYNC delivery-receipt (DLR) webhook (texting-6.0). ACK-fast → enqueue for
// TextingMainService's DLR worker to normalize. MVP cut: DLR only — inbound (MO) messages,
// opt-out (STOP/START/HELP), and the dedicated TextingWebhookService split (SPECS.md's high-volume,
// provider-facing tier) are deferred, same posture as print's single-role webhook intake.
// `access` is undefined — the provider's signature IS the auth, verified inside `execute()`.
//
export class PostTextingWebhook extends RestfulEndpoint< PostTextingWebhook.Query, PostTextingWebhook.Body, PostTextingWebhook.Response >
{
    public readonly uri      : string = PostTextingWebhook.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : undefined = undefined;   // provider-signature verified, not RBAC
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    constructor( provider? : string, body? : PostTextingWebhook.Body ) { super( { provider: provider ?? "" }, body ); }

    public getMappings(): Array<RestfulEndpoint.FieldMap>
    {
        return [
            { field: "provider", location: RestfulEndpoint.AttrLocation.URI, required: true },
            // signature headers the real CPaaS adapters verify against (texting-6.0) — Twilio/SignalWire
            // share the same HMAC-SHA1-over-URL scheme; Telnyx's Ed25519 scheme needs both of its own.
            // Bandwidth/Broadnet/Infobip/Sinch/Vonage have no signature header (documented adapter gap).
            { field: "x-twilio-signature",        location: RestfulEndpoint.AttrLocation.HEADER, required: false },
            { field: "telnyx-signature-ed25519",  location: RestfulEndpoint.AttrLocation.HEADER, required: false },
            { field: "telnyx-timestamp",          location: RestfulEndpoint.AttrLocation.HEADER, required: false },
        ];
    }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    // the provider's own DLR-webhook payload shape (varies per vendor) — passed through as-is
    public getBodySchema(): RestfulEndpoint.Schema | null { return { type: "object", additionalProperties: true }; }
}

export namespace PostTextingWebhook
{
    export const URI : string = apiPath( "texting", 1, "/webhook/:provider" );
    export interface Query
    {
        provider : string;
        "x-twilio-signature"?       : string;
        "telnyx-signature-ed25519"? : string;
        "telnyx-timestamp"?         : string;
    }
    export interface Body extends RestfulEndpoint.NonAuthRequest { [ key : string ] : unknown; }
    export interface Response { received : true; }
    export enum Error { BAD_REQUEST = NetworkUtils.Status.BAD_REQUEST, FORBIDDEN = NetworkUtils.Status.FORBIDDEN }
}

export default PostTextingWebhook;
// eof
