//
import { Texting } from "@repo/api";

import { SmsProvider, SmsContext } from "../SmsProvider";

//
// SinchSmsAdapter — the real Sinch SMS API (XMS, v1) adapter (texting-3.1). Bearer-token REST auth, scoped
// under the account's `servicePlanId` path segment.
//
// SIMPLIFICATION: Sinch's delivery-report callback has no standard HMAC signature in this platform's
// integration — `verifySignature` accepts unconditionally, a documented gap (same posture as Infobip's).
//
// `ctx.statusCallbackUrl` is UNUSED here — Sinch's delivery-report callback URL is configured on the
// Service Plan Id (Sinch Dashboard), not per-batch. Paste `TextingService.statusUrl(Texting.Provider.SINCH)`
// into that Service Plan's callback URL field.
//
export class SinchSmsAdapter implements SmsProvider
{
    public readonly provider : Texting.Provider = Texting.Provider.SINCH;
    public readonly capabilities : Set<Texting.MessageType> = new Set( [ Texting.MessageType.SMS, Texting.MessageType.MMS ] );

    ////////////////////////////////////////////////////////////////////////////////////////////
    public async send( req : Texting.OutboundRequest, ctx : SmsContext ) : Promise<Texting.AdapterSendResult>
    {
        const secret : SinchCredential | undefined = ctx.secret as SinchCredential | undefined;
        if( !secret?.servicePlanId || !secret.apiToken ) return { ok: false };

        try
        {
            const response : Response = await fetch( `https://us.sms.api.sinch.com/xms/v1/${ secret.servicePlanId }/batches`, {
                method:  "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${ secret.apiToken }` },
                body:    JSON.stringify( { from: req.from, to: [ req.to ], body: req.body } ),
            } );
            const parsed : { id? : string } = await response.json() as { id? : string };
            if( !response.ok || !parsed.id ) return { ok: false, rawCode: `sinch send failed (${ response.status })` };
            return { ok: true, messageId: parsed.id, segments: 1 };
        }
        catch( error ) { return { ok: false, rawCode: String( error ) }; }
    }

    // Sinch's delivery-report `code` (under `status`) → the platform's normalized `ErrCode` (texting-6.5).
    // Starter set; an unmapped code still surfaces via `providerCode` for the operator.
    private static readonly ERR_CODE_MAP : Record<string, Texting.ErrCode> =
    {
        "1": Texting.ErrCode.TEMP,           // unable to deliver — expired/transient
        "2": Texting.ErrCode.NOCARRIER,      // unrecognized destination network
        "3": Texting.ErrCode.SPAM,           // rejected by network
        "5": Texting.ErrCode.OVER_CAPACITY,  // system/throughput failure
        "11": Texting.ErrCode.DND,           // recipient blocked/opted out
    };

    ////////////////////////////////////////////////////////////////////////////////////////////
    public normalizeStatus( payload : Record<string, unknown> ) : Texting.NormalizedEvent
    {
        const status : Record<string, unknown> = ( payload.status as Record<string, unknown> ) ?? {};
        const rawCode : string | undefined = status.code !== undefined ? String( status.code ) : undefined;
        const MAP : Record<string, Texting.DeliveryStatus> =
        {
            Queued: Texting.DeliveryStatus.QUEUED, Dispatched: Texting.DeliveryStatus.SENT,
            Delivered: Texting.DeliveryStatus.DELIVERED, Failed: Texting.DeliveryStatus.FAILED, Expired: Texting.DeliveryStatus.FAILED,
        };
        return {
            kind:               "dlr",
            from:               String( payload.from ?? "" ),
            to:                 String( payload.recipient ?? "" ),
            providerMessageId:  payload.batch_id !== undefined ? String( payload.batch_id ) : undefined,
            status:             MAP[ String( status.code ?? "" ) ] ?? Texting.DeliveryStatus.UNKNOWN,
            errCode:            rawCode !== undefined ? SinchSmsAdapter.ERR_CODE_MAP[ rawCode ] : undefined,
            providerCode:       rawCode,   // verbatim Sinch code, even when it didn't map to an ErrCode
            receivedAt:         new Date().toISOString(),
        };
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public verifySignature() : boolean { return true; }
}

/** Sinch's stored secret shape — `{servicePlanId, apiToken}`. */
interface SinchCredential { servicePlanId : string; apiToken : string; }

export default SinchSmsAdapter;
// eof
