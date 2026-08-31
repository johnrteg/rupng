//
import { GetRegistrationCampaign, Registration } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";

import RegistrationService from "../services/RegistrationService";

//
// Fetch one campaign by id (registration-2.0) — the reconciled TCR projection, scoped to the caller's account
// partition so a campaignId from another tenant simply doesn't resolve.
//
export class GetRegistrationCampaignImpl extends GetRegistrationCampaign
{
    private service : RegistrationService;
    constructor( service : RegistrationService ) { super(); this.service = service; }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId || !auth.accountId ) return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };

        const found : Type.Result<Registration.Campaign | undefined> = await this.service.domain.getCampaign( auth.accountId, this.query.campaignId );
        if( !found.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "could not read the campaign" } };
        if( found.data === undefined ) return { status: NetworkUtils.Status.NOT_FOUND, data: { message: "campaign not found" } };
        return { status: NetworkUtils.Status.OK, data: found.data };
    }
}

export default GetRegistrationCampaignImpl;
// eof
