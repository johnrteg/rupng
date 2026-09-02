//
import twilio, { validateRequest } from "twilio";

import { Texting } from "@repo/api";

import { SmsProvider, SmsContext } from "../SmsProvider";

//
// TwilioSmsAdapter — the real Twilio Programmable Messaging adapter (texting-3.1). Mirrors voice's
// TwilioVoiceAdapter: `send` places the message via the REST API (`mediaUrls` fan out to Twilio's
// MediaUrl[0..N] for MMS); `normalizeStatus` maps Twilio's `MessageStatus` DLR-webhook vocabulary onto the
// platform's UDF `DeliveryStatus`; `verifySignature` wraps the `twilio` package's own HMAC-SHA1 request
// signature (never reimplemented by hand). The credential ({accountSid, authToken}) is resolved per-call
// via `ctx.secret` so the adapter itself stays stateless — see `SmsContext`'s doc for why.
//
export class TwilioSmsAdapter implements SmsProvider
{
    public readonly provider : Texting.Provider;
    public readonly capabilities : Set<Texting.MessageType> = new Set( [ Texting.MessageType.SMS, Texting.MessageType.MMS ] );

    // `provider` defaults to TWILIO but a caller can tag this instance TWILIO's dupe-account variant
    // (there is none today, but this mirrors BandwidthSmsAdapter/TelnyxSmsAdapter's *3 pattern for symmetry).
    constructor( provider : Texting.Provider = Texting.Provider.TWILIO ) { this.provider = provider; }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // send via the Twilio REST API. Never throws — a client/API error becomes a retryable-classified failure.
    public async send( req : Texting.OutboundRequest, ctx : SmsContext ) : Promise<Texting.AdapterSendResult>
    {
        const secret : TwilioCredential | undefined = ctx.secret as TwilioCredential | undefined;
        if( !secret?.accountSid || !secret.authToken ) return { ok: false };

        try
        {
            const client : ReturnType<typeof twilio> = twilio( secret.accountSid, secret.authToken );
            const created : { sid : string; numSegments? : string } = await client.messages.create( {
                to:   req.to,
                from: req.from,
                ...( req.body !== undefined ? { body: req.body } : {} ),
                ...( req.mediaUrls && req.mediaUrls.length > 0 ? { mediaUrl: req.mediaUrls } : {} ),
                ...( ctx.statusCallbackUrl ? { statusCallback: ctx.statusCallbackUrl } : {} ),
            } );
            return { ok: true, messageId: created.sid, segments: created.numSegments ? Number( created.numSegments ) : 1 };
        }
        catch( error ) { return { ok: false, rawCode: String( error ) }; }
    }

    // Twilio's numeric `ErrorCode` → the platform's normalized `ErrCode` (texting-6.5). Starter set covering
    // the common SMS failure codes; an unmapped code still surfaces via `providerCode` for the operator.
    private static readonly ERR_CODE_MAP : Record<string, Texting.ErrCode> =
    {
        "21610": Texting.ErrCode.DND,           // recipient sent STOP (Twilio's own Advanced Opt-Out)
        "30003": Texting.ErrCode.UNREACHABLE,    // unreachable destination handset
        "30004": Texting.ErrCode.SPAM,           // message blocked (carrier content/spam filtering)
        "30005": Texting.ErrCode.BAD,            // unknown destination handset
        "30006": Texting.ErrCode.LANDLINE,       // landline or unreachable carrier
        "30007": Texting.ErrCode.SPAM,           // carrier violation (spam filtering)
        "30022": Texting.ErrCode.OVER_CAPACITY,  // rate limit exceeded
    };

    ////////////////////////////////////////////////////////////////////////////////////////////
    // Twilio's status-callback vocabulary → the platform's canonical DeliveryStatus (texting-3.3 UDF).
    public normalizeStatus( payload : Record<string, unknown> ) : Texting.NormalizedEvent
    {
        const MAP : Record<string, Texting.DeliveryStatus> =
        {
            queued: Texting.DeliveryStatus.QUEUED, accepted: Texting.DeliveryStatus.QUEUED,
            sending: Texting.DeliveryStatus.SENT, sent: Texting.DeliveryStatus.SENT,
            delivered: Texting.DeliveryStatus.DELIVERED,
            undelivered: Texting.DeliveryStatus.UNDELIVERED,
            failed: Texting.DeliveryStatus.FAILED,
        };
        const messageStatus : string = String( payload.MessageStatus ?? "" );
        const errorCode : string | undefined = payload.ErrorCode !== undefined ? String( payload.ErrorCode ) : undefined;
        return {
            kind:               "dlr",
            from:               String( payload.From ?? "" ),
            to:                 String( payload.To ?? "" ),
            providerMessageId:  payload.MessageSid !== undefined ? String( payload.MessageSid ) : undefined,
            status:             MAP[ messageStatus ] ?? Texting.DeliveryStatus.UNKNOWN,
            errCode:            errorCode !== undefined ? TwilioSmsAdapter.ERR_CODE_MAP[ errorCode ] : undefined,
            providerCode:       errorCode,   // verbatim Twilio code, even when it didn't map to an ErrCode
            receivedAt:         new Date().toISOString(),
        };
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // Twilio's HMAC-SHA1 request signature (`X-Twilio-Signature`) over the full webhook URL + form params.
    public verifySignature( headers : Record<string, string | undefined>, url : string, body : Record<string, unknown>, ctx : SmsContext ) : boolean
    {
        const secret : TwilioCredential | undefined = ctx.secret as TwilioCredential | undefined;
        if( !secret?.authToken ) return false;
        const signature : string = headers[ "x-twilio-signature" ] ?? "";
        return validateRequest( secret.authToken, signature, url, body as Record<string, string> );
    }
}

/** The shape of Twilio's stored secret — `{accountSid, authToken}` (`Providers.CATALOG`'s "twilio" entry). */
interface TwilioCredential { accountSid : string; authToken : string; }

export default TwilioSmsAdapter;
// eof
