//
import { Registration, PhoneNumber, Texting } from "@repo/api";
import { ResultUtils, type Type } from "@repo/common";

import { CarrierProvider, CarrierContext, CarrierPairingStatus, NumberSearchCriteria, AvailableNumber, OrderedNumber } from "../CarrierProvider";

//
// VonageAdapter — a SCAFFOLD pending the real Vonage (Nexmo) Numbers/10DLC API integration (registration-6.1)
// for `shareCampaign`/`provisionNumbers`/`releaseNumber`/`checkPairingStatus` (the ORIGINAL four — still not
// implemented, a pre-existing, separate gap). `searchAvailableNumbers`/`orderNumber` below ARE real, verified
// calls against Vonage's long-stable legacy Numbers API (`GET /number/search`, `POST /number/buy` on
// `rest.nexmo.com`, `api_key`/`api_secret` query auth — same credential/auth style already used by
// `VonageSmsAdapter`'s legacy SMS API in the texting service).
//
// `submitTollFreeVerification` is NOT implemented — Vonage's newer TFN registration API
// (`api-eu.vonage.com/tfn/v1/registrations`) exists, but its exact request schema/auth wasn't independently
// verifiable at implementation time; it reports NOT_IMPLEMENTED rather than guessing (same posture as Bandwidth's).
//
// It does NOT fabricate success — see BandwidthAdapter's header for why a pretending carrier adapter is a
// compliance problem rather than a dev convenience. Only `FakeCarrierAdapter` is allowed to succeed offline.
//
export class VonageAdapter implements CarrierProvider
{
    public readonly provider : Registration.CarrierProvider = Registration.CarrierProvider.VONAGE;

    private static readonly NOT_IMPLEMENTED : string = "Vonage carrier adapter is not yet implemented";

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Not yet implemented — the real call accepts the TCR campaign share on Vonage's 10DLC API. */
    public async shareCampaign( _tcrCampaignId : string, _context : CarrierContext ) : Promise<Type.Result<void>>
    {
        return ResultUtils.err( VonageAdapter.NOT_IMPLEMENTED );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Not yet implemented — the real call buys numbers and links them to the campaign's brand. */
    public async provisionNumbers( _tcrCampaignId : string, _count : number, _context : CarrierContext, _areaCode? : string ) : Promise<Type.Result<Array<string>>>
    {
        return ResultUtils.err( VonageAdapter.NOT_IMPLEMENTED );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Not yet implemented — the real call cancels the number. */
    public async releaseNumber( _phoneNumber : string, _context : CarrierContext ) : Promise<Type.Result<void>>
    {
        return ResultUtils.err( VonageAdapter.NOT_IMPLEMENTED );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Not yet implemented — the real call reads the number's campaign linkage. */
    public async checkPairingStatus( _phoneNumber : string, _context : CarrierContext ) : Promise<Type.Result<CarrierPairingStatus>>
    {
        return ResultUtils.err( VonageAdapter.NOT_IMPLEMENTED );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** `GET /number/search` — `type=landline-toll-free` for TOLL_FREE, `type=mobile-lvn`/`landline` for
     *  LONG_CODE (US long codes are `landline`/`mobile-lvn` in Vonage's own type vocabulary); `country=US`. */
    public async searchAvailableNumbers( criteria : NumberSearchCriteria, context : CarrierContext ) : Promise<Type.Result<Array<AvailableNumber>>>
    {
        if( !context.apiKey || !context.apiSecret ) return ResultUtils.err( "Vonage credentials not configured" );

        const type : string = criteria.type === Texting.NumberType.TOLL_FREE ? "landline-toll-free" : "landline";
        const query : URLSearchParams = new URLSearchParams( {
            api_key: context.apiKey, api_secret: context.apiSecret, country: "US", type, size: String( criteria.limit ?? 10 ),
            ...( criteria.areaCode ? { search_pattern: "0", pattern: criteria.areaCode } : {} ),
        } );

        try
        {
            const response : Response = await fetch( `https://rest.nexmo.com/number/search?${ query.toString() }` );
            const parsed : { numbers? : Array<{ msisdn? : string; cost? : string }> } = await response.json() as { numbers? : Array<{ msisdn? : string; cost? : string }> };
            if( !response.ok ) return ResultUtils.err( `Vonage number search failed (${ response.status })` );

            const results : Array<AvailableNumber> = ( parsed.numbers ?? [] )
                .filter( ( row : { msisdn? : string } ) : boolean => row.msisdn !== undefined )
                .map( ( row : { msisdn? : string; cost? : string } ) : AvailableNumber => ( {
                    number: `+${ row.msisdn }`, type: criteria.type,
                    monthlyPriceCents: row.cost !== undefined ? Math.round( parseFloat( row.cost ) * 100 ) : undefined,
                } ) );
            return ResultUtils.ok( results );
        }
        catch( error ) { return ResultUtils.err( String( error ) ); }
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** `POST /number/buy` — `error-code: "200"` is Vonage's own success marker on this legacy endpoint (it
     *  replies `200 OK` even on a logical failure, so the body's own code is the real signal). */
    public async orderNumber( number : Type.PhoneE164, _criteria : NumberSearchCriteria, context : CarrierContext ) : Promise<Type.Result<OrderedNumber>>
    {
        if( !context.apiKey || !context.apiSecret ) return ResultUtils.err( "Vonage credentials not configured" );

        try
        {
            const form : URLSearchParams = new URLSearchParams( {
                api_key: context.apiKey, api_secret: context.apiSecret, country: "US", msisdn: number.replace( "+", "" ),
            } );
            const response : Response = await fetch( "https://rest.nexmo.com/number/buy", {
                method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form.toString(),
            } );
            const parsed : { ["error-code"]? : string; ["error-code-label"]? : string } = await response.json() as { ["error-code"]? : string; ["error-code-label"]? : string };
            if( !response.ok || parsed[ "error-code" ] !== "200" ) return ResultUtils.err( `Vonage number buy failed: ${ parsed[ "error-code-label" ] ?? response.status }` );
            return ResultUtils.ok( { number } );
        }
        catch( error ) { return ResultUtils.err( String( error ) ); }
    }

    /** Not yet implemented — Vonage's newer TFN registration API exists but its exact request schema/auth
     *  wasn't independently verifiable at implementation time (see class header). */
    public async submitTollFreeVerification( _number : Type.PhoneE164, _details : PhoneNumber.TollFreeVerification, _context : CarrierContext ) : Promise<Type.Result<void>>
    {
        return ResultUtils.err( VonageAdapter.NOT_IMPLEMENTED );
    }
}

export default VonageAdapter;
// eof
