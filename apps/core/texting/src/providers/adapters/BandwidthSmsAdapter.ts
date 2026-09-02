//
import { Texting } from "@repo/api";

import { SmsProvider, SmsContext } from "../SmsProvider";

//
// BandwidthSmsAdapter — the real Bandwidth Messaging v2 adapter (texting-3.1). HTTP Basic auth
// (username/password), the account's `accountId` + `applicationId` are path/body params (not header auth).
// One instance serves both `bandwidth` and its dupe-account variant `bandwidth3` (distinct credentials,
// same wire dialect) — the constructor tags which `Texting.Provider` this instance reports.
//
// SIMPLIFICATION: Bandwidth's messaging webhooks aren't signed (no HMAC/shared-secret scheme) — Bandwidth's
// own guidance is IP allowlisting at the network layer, which this platform doesn't do per-adapter.
// `verifySignature` accepts unconditionally, same documented gap as print's carrier webhooks.
//
// `ctx.statusCallbackUrl` is UNUSED here — Bandwidth's DLR webhook is configured on the Messaging
// Application object (Bandwidth Dashboard), not per-message. Paste
// `TextingService.statusUrl(Texting.Provider.BANDWIDTH)` (or `.BANDWIDTH3`) into that Application's callback URL.
//
export class BandwidthSmsAdapter implements SmsProvider
{
    public readonly provider : Texting.Provider;
    public readonly capabilities : Set<Texting.MessageType> = new Set( [ Texting.MessageType.SMS, Texting.MessageType.MMS ] );

    constructor( provider : Texting.Provider = Texting.Provider.BANDWIDTH ) { this.provider = provider; }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public async send( req : Texting.OutboundRequest, ctx : SmsContext ) : Promise<Texting.AdapterSendResult>
    {
        const secret : BandwidthCredential | undefined = ctx.secret as BandwidthCredential | undefined;
        if( !secret?.accountId || !secret.username || !secret.password || !secret.applicationId ) return { ok: false };

        try
        {
            const authorization : string = `Basic ${ Buffer.from( `${ secret.username }:${ secret.password }` ).toString( "base64" ) }`;
            const response : Response = await fetch( `https://messaging.bandwidth.com/api/v2/users/${ secret.accountId }/messages`, {
                method:  "POST",
                headers: { "Content-Type": "application/json", Authorization: authorization },
                body:    JSON.stringify( {
                    to:            [ req.to ],
                    from:          req.from,
                    text:          req.body,
                    applicationId: secret.applicationId,
                    ...( req.mediaUrls && req.mediaUrls.length > 0 ? { media: req.mediaUrls } : {} ),
                } ),
            } );
            const parsed : { id? : string } = await response.json() as { id? : string };
            if( !response.ok || !parsed.id ) return { ok: false, rawCode: `bandwidth send failed (${ response.status })` };
            return { ok: true, messageId: parsed.id, segments: 1 };
        }
        catch( error ) { return { ok: false, rawCode: String( error ) }; }
    }

    // Bandwidth's numeric `errorCode` → the platform's normalized `ErrCode` (texting-6.5). Starter set; an
    // unmapped code still surfaces via `providerCode` for the operator.
    private static readonly ERR_CODE_MAP : Record<string, Texting.ErrCode> =
    {
        "4404": Texting.ErrCode.BAD,             // invalid destination number
        "4405": Texting.ErrCode.UNREACHABLE,     // carrier could not deliver
        "4470": Texting.ErrCode.SPAM,            // carrier filtered as spam
        "4480": Texting.ErrCode.LANDLINE,        // destination is not SMS-capable
    };

    ////////////////////////////////////////////////////////////////////////////////////////////
    // Bandwidth posts an ARRAY of events per webhook call; the caller hands processDlr ONE event at a time
    // (texting-6.0's fan-out is done upstream), so this normalizes a single event object.
    public normalizeStatus( payload : Record<string, unknown> ) : Texting.NormalizedEvent
    {
        const message : Record<string, unknown> = ( payload.message as Record<string, unknown> ) ?? {};
        const eventType : string = String( payload.type ?? "" );

        const MAP : Record<string, Texting.DeliveryStatus> =
        {
            "message-received": Texting.DeliveryStatus.DELIVERED,
            "message-delivered": Texting.DeliveryStatus.DELIVERED,
            "message-sending": Texting.DeliveryStatus.SENT,
            "message-failed": Texting.DeliveryStatus.FAILED,
        };
        const rawCode : string | undefined = payload.errorCode !== undefined ? String( payload.errorCode ) : undefined;

        return {
            kind:               "dlr",
            from:               String( message.from ?? "" ),
            to:                 String( ( ( message.to as Array<string> ) ?? [] )[ 0 ] ?? "" ),
            providerMessageId:  message.id !== undefined ? String( message.id ) : undefined,
            status:             MAP[ eventType ] ?? Texting.DeliveryStatus.UNKNOWN,
            errCode:            rawCode !== undefined ? BandwidthSmsAdapter.ERR_CODE_MAP[ rawCode ] : undefined,
            providerCode:       rawCode,   // verbatim Bandwidth code, even when it didn't map to an ErrCode
            receivedAt:         new Date().toISOString(),
        };
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public verifySignature() : boolean { return true; }
}

/** Bandwidth's stored secret shape — `{accountId, username, password, applicationId}`. */
interface BandwidthCredential { accountId : string; username : string; password : string; applicationId : string; }

export default BandwidthSmsAdapter;
// eof
