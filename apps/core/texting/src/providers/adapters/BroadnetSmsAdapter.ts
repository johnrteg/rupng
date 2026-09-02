//
import { Texting } from "@repo/api";

import { SmsProvider, SmsContext } from "../SmsProvider";

//
// BroadnetSmsAdapter — the real Broadnet HTTP SMS adapter (texting-3.1). Username/password REST auth
// (Broadnet's SMS Gateway HTTP API), a common shape among the European CPaaS aggregators. Returns the
// vendor's message id on success.
//
// SIMPLIFICATION: Broadnet has no documented outbound-webhook HMAC scheme in this platform's integration —
// `verifySignature` accepts unconditionally, a documented gap (same posture as Bandwidth's).
//
// `ctx.statusCallbackUrl` is UNUSED here — Broadnet's delivery-receipt callback URL is configured account-
// wide (Broadnet portal), not per-message. Paste `TextingService.statusUrl(Texting.Provider.BROADNET)`
// into that account setting.
//
export class BroadnetSmsAdapter implements SmsProvider
{
    public readonly provider : Texting.Provider = Texting.Provider.BROADNET;
    public readonly capabilities : Set<Texting.MessageType> = new Set( [ Texting.MessageType.SMS, Texting.MessageType.MMS ] );
    private static readonly API_BASE : string = "https://api.broadnet.eu/broadnet_sms/messages/sms/send";

    ////////////////////////////////////////////////////////////////////////////////////////////
    public async send( req : Texting.OutboundRequest, ctx : SmsContext ) : Promise<Texting.AdapterSendResult>
    {
        const secret : BroadnetCredential | undefined = ctx.secret as BroadnetCredential | undefined;
        if( !secret?.username || !secret.password ) return { ok: false };

        try
        {
            const response : Response = await fetch( BroadnetSmsAdapter.API_BASE, {
                method:  "POST",
                headers: { "Content-Type": "application/json" },
                body:    JSON.stringify( {
                    userName: secret.username, password: secret.password,
                    messageText: req.body, recipients: [ req.to ], originator: req.from,
                } ),
            } );
            const parsed : { jobId? : string; statusCode? : number } = await response.json() as { jobId? : string; statusCode? : number };
            if( !response.ok || !parsed.jobId ) return { ok: false, rawCode: `broadnet send failed (${ response.status })` };
            return { ok: true, messageId: parsed.jobId, segments: 1 };
        }
        catch( error ) { return { ok: false, rawCode: String( error ) }; }
    }

    // Broadnet's SMPP-style status string (the delivery-receipt `stat` field) → the platform's normalized
    // `ErrCode` (texting-6.5) for the non-delivered outcomes. Starter set; an unmapped code still surfaces
    // via `providerCode` for the operator.
    private static readonly ERR_CODE_MAP : Record<string, Texting.ErrCode> =
    {
        REJECTD: Texting.ErrCode.BAD,           // rejected — malformed/invalid destination
        UNDELIV: Texting.ErrCode.UNREACHABLE,   // carrier could not deliver
        EXPIRED: Texting.ErrCode.TEMP,          // validity period expired — treat as transient
    };

    ////////////////////////////////////////////////////////////////////////////////////////////
    public normalizeStatus( payload : Record<string, unknown> ) : Texting.NormalizedEvent
    {
        const MAP : Record<string, Texting.DeliveryStatus> =
        {
            DELIVRD: Texting.DeliveryStatus.DELIVERED, SENT: Texting.DeliveryStatus.SENT,
            UNDELIV: Texting.DeliveryStatus.UNDELIVERED, EXPIRED: Texting.DeliveryStatus.FAILED, REJECTD: Texting.DeliveryStatus.FAILED,
        };
        const rawStatus : string = String( payload.status ?? "" );
        return {
            kind:               "dlr",
            from:               String( payload.originator ?? "" ),
            to:                 String( payload.recipient ?? "" ),
            providerMessageId:  payload.jobId !== undefined ? String( payload.jobId ) : undefined,
            status:             MAP[ rawStatus ] ?? Texting.DeliveryStatus.UNKNOWN,
            errCode:            BroadnetSmsAdapter.ERR_CODE_MAP[ rawStatus ],
            providerCode:       rawStatus || undefined,   // verbatim Broadnet status, even when it didn't map to an ErrCode
            receivedAt:         new Date().toISOString(),
        };
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public verifySignature() : boolean { return true; }
}

/** Broadnet's stored secret shape — `{username, password}`. */
interface BroadnetCredential { username : string; password : string; }

export default BroadnetSmsAdapter;
// eof
