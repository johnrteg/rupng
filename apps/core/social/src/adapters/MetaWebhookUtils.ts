//
import { createHmac, timingSafeEqual } from "node:crypto";

//
// MetaWebhookUtils — signature verification shared by FacebookAdapter + InstagramAdapter (both ride
// the same Meta Graph API webhook mechanism: `X-Hub-Signature-256: sha256=<hmac>` over the raw body).
//
// CAVEAT: this verifies against `JSON.stringify(payload)`, not the ORIGINAL raw request bytes — Meta's
// HMAC is computed over the exact bytes it sent, which can differ from a re-serialized JSON string
// (key order, whitespace). Correct verification needs the raw body captured before JSON parsing (e.g.
// a fastify `rawBody` hook) — a follow-up; this is a best-effort approximation for now.
//
export namespace MetaWebhookUtils
{
    /** Verify a Meta webhook's `X-Hub-Signature-256` header against the (re-serialized) payload. */
    export function verifySignature( rawBody : string, headers : Record<string, string>, appSecret : string ) : boolean
    {
        const header : string | undefined = headers[ "x-hub-signature-256" ] ?? headers[ "X-Hub-Signature-256" ];
        if( !header?.startsWith( "sha256=" ) ) return false;

        const expected : Buffer = createHmac( "sha256", appSecret ).update( rawBody, "utf8" ).digest();
        const provided : Buffer = Buffer.from( header.slice( "sha256=".length ), "hex" );
        if( expected.length !== provided.length ) return false;

        return timingSafeEqual( expected, provided );
    }
}

export default MetaWebhookUtils;
