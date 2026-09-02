//
import { randomUUID } from "node:crypto";

import { Print } from "@repo/api";

import { MailProvider, MailSubmission, MailContext, MailSubmitResult, MailNormalizedTracking } from "../MailProvider";

//
// FakeMailAdapter — a DEV-ONLY simulated mail-fulfillment provider (mirrors FakeVoiceAdapter). Resolves fully
// IN-PROCESS: there's no real press run, so `submit` immediately returns a synthetic provider ref + cost
// estimate — no async tracking webhook ever arrives for a fake piece (the fake `PrintScheduleJob`/console can
// simulate one for manual testing, but the adapter itself never generates it).
//
export class FakeMailAdapter implements MailProvider
{
    public readonly provider : Print.Provider = Print.Provider.FAKE;

    // illustrative flat per-piece rate by type — arbitrary, for exercising the cost-preview/submit path offline
    private static readonly RATE_CENTS : Record<Print.MailpieceType, number> =
    {
        [ Print.MailpieceType.POSTCARD ]:    55,
        [ Print.MailpieceType.LETTER ]:      120,
        [ Print.MailpieceType.SELF_MAILER ]: 95,
        [ Print.MailpieceType.CHECK ]:       200,
    };

    ////////////////////////////////////////////////////////////////////////////////////////////
    // never throws — a simulated submission can't fail transport.
    public async submit( piece : MailSubmission, ctx : MailContext ) : Promise<MailSubmitResult>
    {
        return { ok: true, providerRefId: `fake-${ randomUUID() }`, costEstimateCents: FakeMailAdapter.RATE_CENTS[ piece.type ] };
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // fake pieces never receive a real tracking webhook; implemented for interface conformance / manual testing.
    public trackingNormalize( payload : Record<string, unknown> ) : MailNormalizedTracking
    {
        const status : Print.TrackingStatus = ( payload.status as Print.TrackingStatus ) ?? Print.TrackingStatus.IN_PRODUCTION;
        return { mailId: payload.mailId as string | undefined, status, occurredAt: new Date().toISOString() };
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** No real transport to forge — always accepted. */
    public verifySignature() : boolean { return true; }
}

export default FakeMailAdapter;
// eof
