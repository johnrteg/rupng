//
import { Registration } from "@repo/api";
import { ResultUtils, type Type } from "@repo/common";

import { CarrierProvider, CarrierContext, CarrierPairingStatus } from "../CarrierProvider";

//
// BandwidthAdapter — a SCAFFOLD pending the real Bandwidth Dashboard/Numbers API integration
// (registration-6.1). Registered in `CarrierFactory` so the provider is selectable end-to-end (config,
// campaign `provider` field, Console) the moment the API plumbing lands, but every operation deliberately
// reports a failed Result today.
//
// It does NOT fabricate success. A carrier adapter that pretended to provision numbers would drive a campaign
// to ACTIVE with phone numbers that don't exist — a compliance-relevant lie (registration-4.1 gates ACTIVE on
// real association), not a harmless dev convenience. Only `FakeCarrierAdapter` is allowed to succeed offline.
//
export class BandwidthAdapter implements CarrierProvider
{
    public readonly provider : Registration.CarrierProvider = Registration.CarrierProvider.BANDWIDTH;

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
}

export default BandwidthAdapter;
// eof
