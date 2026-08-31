//
import { RestfulEndpoint, apiPath } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";

//
// The provider's SYNCHRONOUS call-control webhook (voice-2.1/3.2) - "what do I play next?" The impl verifies
// the provider's signature, resolves the call's message from the call-log, and replies with the next IVR step
// rendered in the provider's own dialect (TwiML for Twilio) - the one shape-delta from every other channel's
// fire-and-forget webhooks (SPECS.md). `accountId`+`callId` are embedded in the webhook URL we hand the
// provider at dial time (the call-log table's key) so the impl can resolve the call directly, without a
// provider-specific call identifier in the payload or a reverse-lookup index. APP audience (edge-reachable,
// not published in public docs); `access` is undefined - the provider's signature IS the auth, verified inside
// `execute()`, not the RBAC ladder.
//
export class PostVoiceWebhookControl extends RestfulEndpoint< PostVoiceWebhookControl.Query, PostVoiceWebhookControl.Body, string >
{
    public readonly uri      : string = PostVoiceWebhookControl.URI;
    public readonly method   : NetworkUtils.Method = NetworkUtils.Method.POST;
    public readonly access   : undefined = undefined;   // provider-signature verified, not RBAC
    public readonly timeout  : number | undefined = undefined;
    public readonly audience : RestfulEndpoint.Audience = RestfulEndpoint.Audience.APP;

    constructor( provider? : string, accountId? : string, callId? : string, body? : PostVoiceWebhookControl.Body )
    { super( { provider: provider ?? "", accountId: accountId ?? "", callId: callId ?? "" }, body ); }

    public getMappings(): Array<RestfulEndpoint.FieldMap>
    {
        return [
            { field: "provider",  location: RestfulEndpoint.AttrLocation.URI, required: true },
            { field: "accountId", location: RestfulEndpoint.AttrLocation.URI, required: true },
            { field: "callId",    location: RestfulEndpoint.AttrLocation.URI, required: true },
            // Twilio's request-signature header, lifted into `query` so the impl can verify it without needing
            // raw request access. Add a sibling mapping here for each further provider's own signature header.
            { field: "x-twilio-signature", location: RestfulEndpoint.AttrLocation.HEADER, required: false },
        ];
    }
    public getQuerySchema(): RestfulEndpoint.Schema | null { return null; }
    // the provider's own call-control callback payload shape (varies per vendor) - passed through as-is
    public getBodySchema(): RestfulEndpoint.Schema | null { return { type: "object", additionalProperties: true }; }
}

export namespace PostVoiceWebhookControl
{
    export const URI : string = apiPath( "voice", 1, "/webhook/:provider/control/:accountId/:callId" );
    export interface Query { provider : string; accountId : string; callId : string; "x-twilio-signature"? : string; }
    export interface Body extends RestfulEndpoint.NonAuthRequest { [ key : string ] : unknown; }
    export enum Error { BAD_REQUEST = NetworkUtils.Status.BAD_REQUEST, FORBIDDEN = NetworkUtils.Status.FORBIDDEN }
}

export default PostVoiceWebhookControl;
// eof
