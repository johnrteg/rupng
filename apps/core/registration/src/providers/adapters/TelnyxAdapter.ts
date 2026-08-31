//
import { Registration } from "@repo/api";
import { ResultUtils, type Type } from "@repo/common";

import { CarrierProvider, CarrierContext, CarrierPairingStatus } from "../CarrierProvider";

//
// TelnyxAdapter — a SCAFFOLD pending the real Telnyx v2 Messaging/Numbers API integration
// (registration-6.1). Registered in `CarrierFactory` so the provider is selectable end-to-end the moment the
// API plumbing lands, but every operation deliberately reports a failed Result today.
//
// It does NOT fabricate success — see BandwidthAdapter's header for why a pretending carrier adapter is a
// compliance problem rather than a dev convenience. Only `FakeCarrierAdapter` is allowed to succeed offline.
//
export class TelnyxAdapter implements CarrierProvider
{
    public readonly provider : Registration.CarrierProvider = Registration.CarrierProvider.TELNYX;

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
}

export default TelnyxAdapter;
// eof
