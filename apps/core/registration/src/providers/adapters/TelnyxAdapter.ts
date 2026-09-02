//
import { Registration, PhoneNumber, Texting } from "@repo/api";
import { ResultUtils, type Type } from "@repo/common";

import { CarrierProvider, CarrierContext, CarrierPairingStatus, NumberSearchCriteria, AvailableNumber, OrderedNumber } from "../CarrierProvider";

//
// TelnyxAdapter — a SCAFFOLD pending the real Telnyx v2 Messaging/Numbers API integration (registration-6.1)
// for `shareCampaign`/`provisionNumbers`/`releaseNumber`/`checkPairingStatus` (the ORIGINAL four campaign-
// share/bulk-provision operations — still not implemented, a pre-existing, separate gap). The THREE newer
// operations below (`searchAvailableNumbers`/`orderNumber`/`submitTollFreeVerification`) ARE real, verified
// Telnyx v2 API calls — `GET /v2/available_phone_numbers`, `POST /v2/number_orders`,
// `POST /v2/messaging_tollfree/verification/requests`.
//
// The original four still do NOT fabricate success — see BandwidthAdapter's header for why a pretending
// carrier adapter is a compliance problem rather than a dev convenience. Only `FakeCarrierAdapter` is allowed
// to succeed offline for those.
//
export class TelnyxAdapter implements CarrierProvider
{
    public readonly provider : Registration.CarrierProvider = Registration.CarrierProvider.TELNYX;
    private static readonly API_BASE : string = "https://api.telnyx.com/v2";

    private static readonly NOT_IMPLEMENTED : string = "Telnyx carrier adapter is not yet implemented";

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Not yet implemented — the real call accepts the TCR campaign share on Telnyx's brand/campaign API. */
    public async shareCampaign( _tcrCampaignId : string, _context : CarrierContext ) : Promise<Type.Result<void>>
    {
        return ResultUtils.err( TelnyxAdapter.NOT_IMPLEMENTED );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Not yet implemented — the real call is a Telnyx number-order + messaging-profile assignment. */
    public async provisionNumbers( _tcrCampaignId : string, _count : number, _context : CarrierContext, _areaCode? : string ) : Promise<Type.Result<Array<string>>>
    {
        return ResultUtils.err( TelnyxAdapter.NOT_IMPLEMENTED );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Not yet implemented — the real call deletes the phone-number resource. */
    public async releaseNumber( _phoneNumber : string, _context : CarrierContext ) : Promise<Type.Result<void>>
    {
        return ResultUtils.err( TelnyxAdapter.NOT_IMPLEMENTED );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Not yet implemented — the real call reads the number's messaging-profile/campaign linkage. */
    public async checkPairingStatus( _phoneNumber : string, _context : CarrierContext ) : Promise<Type.Result<CarrierPairingStatus>>
    {
        return ResultUtils.err( TelnyxAdapter.NOT_IMPLEMENTED );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** `GET /v2/available_phone_numbers` — `filter[phone_number_type]` distinguishes local (long code) from
     *  toll-free inventory; `filter[national_destination_code]` is the area code. */
    public async searchAvailableNumbers( criteria : NumberSearchCriteria, context : CarrierContext ) : Promise<Type.Result<Array<AvailableNumber>>>
    {
        if( !context.apiKey ) return ResultUtils.err( "Telnyx api key not configured" );

        const phoneNumberType : string = criteria.type === Texting.NumberType.TOLL_FREE ? "toll-free" : "local";
        const query : URLSearchParams = new URLSearchParams( {
            "filter[country_code]": "US", "filter[phone_number_type]": phoneNumberType, "filter[limit]": String( criteria.limit ?? 10 ),
            ...( criteria.areaCode ? { "filter[national_destination_code]": criteria.areaCode } : {} ),
        } );

        try
        {
            const response : Response = await fetch( `${ TelnyxAdapter.API_BASE }/available_phone_numbers?${ query.toString() }`, {
                headers: { Accept: "application/json", Authorization: `Bearer ${ context.apiKey }` },
            } );
            const parsed : { data? : Array<{ phone_number? : string; cost_information? : { monthly_cost? : string } }> } =
                await response.json() as { data? : Array<{ phone_number? : string; cost_information? : { monthly_cost? : string } }> };
            if( !response.ok ) return ResultUtils.err( `Telnyx number search failed (${ response.status })` );

            const results : Array<AvailableNumber> = ( parsed.data ?? [] )
                .filter( ( row : { phone_number? : string } ) : boolean => row.phone_number !== undefined )
                .map( ( row : { phone_number? : string; cost_information? : { monthly_cost? : string } } ) : AvailableNumber => ( {
                    number: row.phone_number as string, type: criteria.type,
                    monthlyPriceCents: row.cost_information?.monthly_cost !== undefined ? Math.round( parseFloat( row.cost_information.monthly_cost ) * 100 ) : undefined,
                } ) );
            return ResultUtils.ok( results );
        }
        catch( error ) { return ResultUtils.err( String( error ) ); }
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** `POST /v2/number_orders` — orders exactly one number; `messaging_profile_id` binds it to the campaign's
     *  Telnyx messaging profile when ordering a LONG_CODE (TOLL_FREE orders omit it — TFV is separate). */
    public async orderNumber( number : Type.PhoneE164, criteria : NumberSearchCriteria, context : CarrierContext ) : Promise<Type.Result<OrderedNumber>>
    {
        if( !context.apiKey ) return ResultUtils.err( "Telnyx api key not configured" );

        try
        {
            const response : Response = await fetch( `${ TelnyxAdapter.API_BASE }/number_orders`, {
                method:  "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${ context.apiKey }` },
                body:    JSON.stringify( {
                    phone_numbers: [ { phone_number: number } ],
                    ...( criteria.type === Texting.NumberType.LONG_CODE && context.accountId ? { messaging_profile_id: context.accountId } : {} ),
                } ),
            } );
            const parsed : { data? : { id? : string } } = await response.json() as { data? : { id? : string } };
            if( !response.ok || !parsed.data?.id ) return ResultUtils.err( `Telnyx number order failed (${ response.status })` );
            return ResultUtils.ok( { number, carrierOrderId: parsed.data.id } );
        }
        catch( error ) { return ResultUtils.err( String( error ) ); }
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** `POST /v2/messaging_tollfree/verification/requests` — the real business-attestation submit; the
     *  decision (VERIFIED/REJECTED) arrives later via Telnyx's webhook or the poll sweep, never in this reply. */
    public async submitTollFreeVerification( number : Type.PhoneE164, details : PhoneNumber.TollFreeVerification, context : CarrierContext ) : Promise<Type.Result<void>>
    {
        if( !context.apiKey ) return ResultUtils.err( "Telnyx api key not configured" );

        try
        {
            const response : Response = await fetch( `${ TelnyxAdapter.API_BASE }/messaging_tollfree/verification/requests`, {
                method:  "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${ context.apiKey }` },
                body:    JSON.stringify( {
                    phoneNumbers: [ number ], businessName: details.businessName, corporateWebsite: details.businessWebsite,
                    messageVolume: String( details.monthlyVolume ), optInWorkflow: details.optInWorkflow, useCase: details.useCase,
                } ),
            } );
            if( !response.ok ) return ResultUtils.err( `Telnyx TFV submit failed (${ response.status })` );
            return ResultUtils.ok( undefined );
        }
        catch( error ) { return ResultUtils.err( String( error ) ); }
    }
}

export default TelnyxAdapter;
// eof
