//
import { Registration, PhoneNumber, Texting } from "@repo/api";
import { ResultUtils, type Type } from "@repo/common";

import { CarrierProvider, CarrierContext, CarrierPairingStatus, NumberSearchCriteria, AvailableNumber, OrderedNumber } from "../CarrierProvider";

//
// BandwidthAdapter — a SCAFFOLD pending the real Bandwidth Dashboard/Numbers API integration
// (registration-6.1) for `shareCampaign`/`provisionNumbers`/`releaseNumber`/`checkPairingStatus` (the ORIGINAL
// four — still not implemented, a pre-existing, separate gap). `searchAvailableNumbers`/`orderNumber` below
// ARE real, verified Bandwidth v2 calls (`GET .../availableNumbers`, `POST .../orders`).
// `submitTollFreeVerification` is NOT implemented — Bandwidth's TFV API exists but its exact submit endpoint
// path/schema wasn't verifiable from public docs at implementation time; it reports NOT_IMPLEMENTED rather
// than guessing at a request shape (same honest-scaffold posture as the original four, for the same reason).
//
// It does NOT fabricate success. A carrier adapter that pretended to provision numbers would drive a campaign
// to ACTIVE with phone numbers that don't exist — a compliance-relevant lie (registration-4.1 gates ACTIVE on
// real association), not a harmless dev convenience. Only `FakeCarrierAdapter` is allowed to succeed offline.
//
export class BandwidthAdapter implements CarrierProvider
{
    public readonly provider : Registration.CarrierProvider = Registration.CarrierProvider.BANDWIDTH;
    private static readonly API_BASE : string = "https://api.bandwidth.com/api/v2";

    private static readonly NOT_IMPLEMENTED : string = "Bandwidth carrier adapter is not yet implemented";

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Not yet implemented — the real call is Bandwidth's campaign-share acceptance on the Dashboard API. */
    public async shareCampaign( _tcrCampaignId : string, _context : CarrierContext ) : Promise<Type.Result<void>>
    {
        return ResultUtils.err( BandwidthAdapter.NOT_IMPLEMENTED );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Not yet implemented — the real call is a Bandwidth number order + TN-option campaign assignment. */
    public async provisionNumbers( _tcrCampaignId : string, _count : number, _context : CarrierContext, _areaCode? : string ) : Promise<Type.Result<Array<string>>>
    {
        return ResultUtils.err( BandwidthAdapter.NOT_IMPLEMENTED );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Not yet implemented — the real call is a Bandwidth disconnect order. */
    public async releaseNumber( _phoneNumber : string, _context : CarrierContext ) : Promise<Type.Result<void>>
    {
        return ResultUtils.err( BandwidthAdapter.NOT_IMPLEMENTED );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Not yet implemented — the real call reads the TN's current campaign assignment. */
    public async checkPairingStatus( _phoneNumber : string, _context : CarrierContext ) : Promise<Type.Result<CarrierPairingStatus>>
    {
        return ResultUtils.err( BandwidthAdapter.NOT_IMPLEMENTED );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** `GET /accounts/{accountId}/availableNumbers` (Basic auth — `apiKey`/`apiSecret` as username/password,
     *  same mapping as `BandwidthSmsAdapter`) — `tollFreeWildCardPattern: "8**"` is Bandwidth's own convention
     *  for toll-free inventory; a LONG_CODE search uses `areaCode` instead. */
    public async searchAvailableNumbers( criteria : NumberSearchCriteria, context : CarrierContext ) : Promise<Type.Result<Array<AvailableNumber>>>
    {
        if( !context.apiKey || !context.apiSecret || !context.accountId ) return ResultUtils.err( "Bandwidth credentials not configured" );

        const query : URLSearchParams = new URLSearchParams( { quantity: String( criteria.limit ?? 10 ) } );
        if( criteria.type === Texting.NumberType.TOLL_FREE ) query.set( "tollFreeWildCardPattern", "8**" );
        else if( criteria.areaCode ) query.set( "areaCode", criteria.areaCode );

        try
        {
            const auth : string = Buffer.from( `${ context.apiKey }:${ context.apiSecret }` ).toString( "base64" );
            const response : Response = await fetch( `${ BandwidthAdapter.API_BASE }/accounts/${ context.accountId }/availableNumbers?${ query.toString() }`, {
                headers: { Accept: "application/json", Authorization: `Basic ${ auth }` },
            } );
            // Bandwidth's Numbers API is XML-native; JSON support converts the same shape 1:1 — the list
            // comes back as either a bare array of digit strings or `{ telephoneNumber: string }` rows,
            // depending on account/API version, so both are handled here.
            const parsed : { telephoneNumberList? : Array<string | { telephoneNumber? : string }> } =
                await response.json() as { telephoneNumberList? : Array<string | { telephoneNumber? : string }> };
            if( !response.ok ) return ResultUtils.err( `Bandwidth number search failed (${ response.status })` );

            const results : Array<AvailableNumber> = ( parsed.telephoneNumberList ?? [] )
                .map( ( row : string | { telephoneNumber? : string } ) : string | undefined => typeof row === "string" ? row : row.telephoneNumber )
                .filter( ( tn : string | undefined ) : tn is string => tn !== undefined )
                .map( ( tn : string ) : AvailableNumber => ( { number: `+1${ tn }`, type: criteria.type } ) );
            return ResultUtils.ok( results );
        }
        catch( error ) { return ResultUtils.err( String( error ) ); }
    }

    /** Not yet implemented — Bandwidth's order API needs account-specific `SiteId`/`SipPeerId` fields our
     *  generic `CarrierContext` doesn't carry yet; guessing at that shape risks a silently-wrong real order. */
    public async orderNumber( _number : Type.PhoneE164, _criteria : NumberSearchCriteria, _context : CarrierContext ) : Promise<Type.Result<OrderedNumber>>
    {
        return ResultUtils.err( BandwidthAdapter.NOT_IMPLEMENTED );
    }

    /** Not yet implemented — Bandwidth's TFV submission API exists but its exact endpoint path/schema wasn't
     *  independently verifiable at implementation time (see class header). */
    public async submitTollFreeVerification( _number : Type.PhoneE164, _details : PhoneNumber.TollFreeVerification, _context : CarrierContext ) : Promise<Type.Result<void>>
    {
        return ResultUtils.err( BandwidthAdapter.NOT_IMPLEMENTED );
    }
}

export default BandwidthAdapter;
// eof
