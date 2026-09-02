//
import { validateRequest } from "twilio";

import { Texting } from "@repo/api";

import { SmsProvider, SmsContext } from "../SmsProvider";

//
// SignalwireSmsAdapter — the real SignalWire Compatibility API adapter (texting-3.1). SignalWire's REST API
// is a Twilio-compatible clone (same LaML/Messages resource shape, same HMAC-SHA1 request-signature scheme)
// hosted at a per-account "space" subdomain rather than api.twilio.com — so this reuses the `twilio` package's
// already-correct `validateRequest` for signature checks (same algorithm, different credential/URL) instead
// of reimplementing HMAC-SHA1 by hand, while calling the REST endpoint directly (no SDK client needed for
// a same-shaped POST).
//
export class SignalwireSmsAdapter implements SmsProvider
{
    public readonly provider : Texting.Provider = Texting.Provider.SIGNALWIRE;
    public readonly capabilities : Set<Texting.MessageType> = new Set( [ Texting.MessageType.SMS, Texting.MessageType.MMS ] );

    ////////////////////////////////////////////////////////////////////////////////////////////
    public async send( req : Texting.OutboundRequest, ctx : SmsContext ) : Promise<Texting.AdapterSendResult>
    {
        const secret : SignalwireCredential | undefined = ctx.secret as SignalwireCredential | undefined;
        if( !secret?.spaceUrl || !secret.projectId || !secret.token ) return { ok: false };

        try
        {
            const form : URLSearchParams = new URLSearchParams( { To: req.to, From: req.from, ...( req.body !== undefined ? { Body: req.body } : {} ) } );
            for( const mediaUrl of req.mediaUrls ?? [] ) form.append( "MediaUrl", mediaUrl );
            if( ctx.statusCallbackUrl ) form.set( "StatusCallback", ctx.statusCallbackUrl );

            const authorization : string = `Basic ${ Buffer.from( `${ secret.projectId }:${ secret.token }` ).toString( "base64" ) }`;
            const response : Response = await fetch( `https://${ secret.spaceUrl }/api/laml/2010-04-01/Accounts/${ secret.projectId }/Messages.json`, {
                method:  "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: authorization },
                body:    form.toString(),
            } );
            const parsed : { sid? : string; num_segments? : string } = await response.json() as { sid? : string; num_segments? : string };
            if( !response.ok || !parsed.sid ) return { ok: false, rawCode: `signalwire send failed (${ response.status })` };
            return { ok: true, messageId: parsed.sid, segments: parsed.num_segments ? Number( parsed.num_segments ) : 1 };
        }
        catch( error ) { return { ok: false, rawCode: String( error ) }; }
    }

    // SignalWire mirrors Twilio's numeric `ErrorCode` vocabulary (the compatibility layer) → the platform's
    // normalized `ErrCode` (texting-6.5). Starter set; an unmapped code still surfaces via `providerCode`.
    private static readonly ERR_CODE_MAP : Record<string, Texting.ErrCode> =
    {
        "30003": Texting.ErrCode.UNREACHABLE,
        "30005": Texting.ErrCode.BAD,
        "30006": Texting.ErrCode.LANDLINE,
        "30007": Texting.ErrCode.SPAM,
    };

    ////////////////////////////////////////////////////////////////////////////////////////////
    // SignalWire's status-callback vocabulary matches Twilio's `MessageStatus` (the compatibility layer).
    public normalizeStatus( payload : Record<string, unknown> ) : Texting.NormalizedEvent
    {
        const MAP : Record<string, Texting.DeliveryStatus> =
        {
            queued: Texting.DeliveryStatus.QUEUED, sending: Texting.DeliveryStatus.SENT, sent: Texting.DeliveryStatus.SENT,
            delivered: Texting.DeliveryStatus.DELIVERED, undelivered: Texting.DeliveryStatus.UNDELIVERED, failed: Texting.DeliveryStatus.FAILED,
        };
        const errorCode : string | undefined = payload.ErrorCode !== undefined ? String( payload.ErrorCode ) : undefined;
        return {
            kind:               "dlr",
            from:               String( payload.From ?? "" ),
            to:                 String( payload.To ?? "" ),
            providerMessageId:  payload.MessageSid !== undefined ? String( payload.MessageSid ) : undefined,
            status:             MAP[ String( payload.MessageStatus ?? "" ) ] ?? Texting.DeliveryStatus.UNKNOWN,
            errCode:            errorCode !== undefined ? SignalwireSmsAdapter.ERR_CODE_MAP[ errorCode ] : undefined,
            providerCode:       errorCode,   // verbatim SignalWire code, even when it didn't map to an ErrCode
            receivedAt:         new Date().toISOString(),
        };
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public verifySignature( headers : Record<string, string | undefined>, url : string, body : Record<string, unknown>, ctx : SmsContext ) : boolean
    {
        const secret : SignalwireCredential | undefined = ctx.secret as SignalwireCredential | undefined;
        if( !secret?.token ) return false;
        const signature : string = headers[ "x-twilio-signature" ] ?? "";
        return validateRequest( secret.token, signature, url, body as Record<string, string> );
    }
}

/** SignalWire's stored secret shape — `{spaceUrl, projectId, token}`. */
interface SignalwireCredential { spaceUrl : string; projectId : string; token : string; }

export default SignalwireSmsAdapter;
// eof
