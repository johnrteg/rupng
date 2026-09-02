//
import { randomUUID } from "node:crypto";

import { Texting } from "@repo/api";

import { SmsProvider, SmsContext } from "../SmsProvider";

//
// FakeSmsAdapter — a DEV-ONLY simulated CPaaS (mirrors FakeMailAdapter). Resolves fully IN-PROCESS:
// `send` immediately returns a synthetic provider message id — no real DLR webhook ever arrives for a
// fake message (a caller can POST one to /texting/webhook/fake to simulate a status update manually).
//
export class FakeSmsAdapter implements SmsProvider
{
    public readonly provider : Texting.Provider = Texting.Provider.FAKE;

    // simulates every channel, including RCS, so the send/DLR path is exercisable in dev without a real
    // RCS-capable vendor integration.
    public readonly capabilities : Set<Texting.MessageType> = new Set( [ Texting.MessageType.SMS, Texting.MessageType.MMS, Texting.MessageType.RCS ] );

    // no real vendor limits to simulate — unbounded carousel, so `SmsFactory.selectForRcs` treats FAKE as
    // qualifying for ANY `RcsContent` in dev, same as it actually sending it.
    public readonly rcsLimits : Texting.RcsLimits = { carousel: true };

    ////////////////////////////////////////////////////////////////////////////////////////////
    // never throws — a simulated send can't fail transport.
    public async send( req : Texting.OutboundRequest, _ctx : SmsContext ) : Promise<Texting.AdapterSendResult>
    {
        return { ok: true, messageId: `fake-${ randomUUID() }`, segments: 1 };
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // a manually-POSTed simulated DLR (see PostTextingWebhookImpl) — passes the status straight through.
    public normalizeStatus( payload : Record<string, unknown> ) : Texting.NormalizedEvent
    {
        return {
            kind:               "dlr",
            from:               ( payload.from as string ) ?? "",
            to:                 ( payload.to as string ) ?? "",
            providerMessageId:  payload.messageId as string | undefined,
            status:             ( payload.status as Texting.DeliveryStatus ) ?? Texting.DeliveryStatus.UNKNOWN,
            providerCode:       payload.code as string | undefined,
            receivedAt:         new Date().toISOString(),
        };
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** No real transport to forge — always accepted. */
    public verifySignature( _headers : Record<string, string | undefined>, _url : string, _body : Record<string, unknown> ) : boolean { return true; }
}

export default FakeSmsAdapter;
// eof
