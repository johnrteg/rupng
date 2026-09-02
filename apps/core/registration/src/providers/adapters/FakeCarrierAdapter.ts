//
import { Registration, PhoneNumber } from "@repo/api";
import { ResultUtils, type Type } from "@repo/common";

import { CarrierProvider, CarrierContext, CarrierPairingStatus, NumberSearchCriteria, AvailableNumber, OrderedNumber } from "../CarrierProvider";

//
// FakeCarrierAdapter — a DEV-ONLY simulated carrier (mirrors FakeVoiceAdapter,
// apps/core/voice/src/providers/adapters/FakeVoiceAdapter.ts). Every operation resolves IN-PROCESS and
// SUCCEEDS: there is no carrier to reach, so there is nothing to fail on. This is what lets the whole
// registration state machine — submit → approve → provision → NUMBER_ASSOCIATED → ACTIVE — be exercised
// end-to-end offline, which is exactly why `RegistrationConfig.DEFAULT` seeds only this provider.
//
// It is the ONLY adapter that fabricates success. The real carrier adapters are honest scaffolds that report
// "not yet implemented" rather than pretending — a fake success from a real provider id would be a
// compliance-relevant lie (a campaign would go ACTIVE with numbers that don't exist).
//
export class FakeCarrierAdapter implements CarrierProvider
{
    public readonly provider : Registration.CarrierProvider = Registration.CarrierProvider.FAKE;

    // a fixed NANP prefix for synthesized numbers — 555-01xx is the reserved fictitious range, so a fake
    // number can never collide with a dialable one if it leaks into a log or a test fixture
    private static readonly DEFAULT_AREA_CODE : string = "555";
    private static readonly EXCHANGE : string = "555";

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** No real carrier to share with — the share is always accepted. */
    public async shareCampaign( _tcrCampaignId : string, _context : CarrierContext ) : Promise<Type.Result<void>>
    {
        return ResultUtils.ok( undefined );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Synthesize `count` E.164-shaped numbers in the reserved fictitious range. Always fully satisfies the
     *  request (a real carrier may not) so the happy path is deterministic in dev. */
    public async provisionNumbers( _tcrCampaignId : string, count : number, _context : CarrierContext, areaCode? : string ) : Promise<Type.Result<Array<string>>>
    {
        const prefix : string = areaCode ?? FakeCarrierAdapter.DEFAULT_AREA_CODE;
        const numbers : Array<string> = [];

        // a sequential line number keeps the batch unique within one call; the timestamp seed keeps
        // successive calls from handing back the same set
        const seed : number = Date.now() % 10_000;
        for( let index : number = 0; index < Math.max( 0, count ); index += 1 )
        {
            const line : string = String( ( seed + index ) % 10_000 ).padStart( 4, "0" );
            numbers.push( `+1${ prefix }${ FakeCarrierAdapter.EXCHANGE }${ line }` );
        }
        return ResultUtils.ok( numbers );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Nothing to release — always succeeds (and is therefore trivially idempotent). */
    public async releaseNumber( _phoneNumber : string, _context : CarrierContext ) : Promise<Type.Result<void>>
    {
        return ResultUtils.ok( undefined );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** A simulated number is always considered correctly paired, so the reconciliation sweep never reports
     *  drift against the fake carrier. */
    public async checkPairingStatus( _phoneNumber : string, _context : CarrierContext ) : Promise<Type.Result<CarrierPairingStatus>>
    {
        return ResultUtils.ok( CarrierPairingStatus.OK );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Synthesize a small, deterministic inventory in the reserved fictitious range — always "has" numbers,
     *  so the search UX is exercisable offline. */
    public async searchAvailableNumbers( criteria : NumberSearchCriteria, _context : CarrierContext ) : Promise<Type.Result<Array<AvailableNumber>>>
    {
        const prefix : string = criteria.areaCode ?? FakeCarrierAdapter.DEFAULT_AREA_CODE;
        const limit : number = Math.max( 1, criteria.limit ?? 5 );
        const results : Array<AvailableNumber> = [];
        const seed : number = Date.now() % 10_000;
        for( let index : number = 0; index < limit; index += 1 )
        {
            const line : string = String( ( seed + index ) % 10_000 ).padStart( 4, "0" );
            results.push( { number: `+1${ prefix }${ FakeCarrierAdapter.EXCHANGE }${ line }`, type: criteria.type, monthlyPriceCents: 100 } );
        }
        return ResultUtils.ok( results );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** No real carrier to order from — the requested number is always "acquired" instantly. */
    public async orderNumber( number : Type.PhoneE164, _criteria : NumberSearchCriteria, _context : CarrierContext ) : Promise<Type.Result<OrderedNumber>>
    {
        return ResultUtils.ok( { number, carrierOrderId: `fake-order-${ Date.now() }` } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** No real carrier review to submit to — TFV is instantly accepted (the CALLER still marks it VERIFIED
     *  via the domain, this adapter only reports the submit itself succeeded). */
    public async submitTollFreeVerification( _number : Type.PhoneE164, _details : PhoneNumber.TollFreeVerification, _context : CarrierContext ) : Promise<Type.Result<void>>
    {
        return ResultUtils.ok( undefined );
    }
}

export default FakeCarrierAdapter;
// eof
