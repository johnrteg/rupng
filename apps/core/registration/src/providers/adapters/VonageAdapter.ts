//
import { Registration } from "@repo/api";
import { ResultUtils, type Type } from "@repo/common";

import { CarrierProvider, CarrierContext, CarrierPairingStatus } from "../CarrierProvider";

//
// VonageAdapter — a SCAFFOLD pending the real Vonage (Nexmo) Numbers/10DLC API integration
// (registration-6.1). Registered in `CarrierFactory` so the provider is selectable end-to-end the moment the
// API plumbing lands, but every operation deliberately reports a failed Result today.
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
}

export default VonageAdapter;
// eof
