//
import { GetRegistrationVettingStatus } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";

import RegistrationService from "../services/RegistrationService";
import { RegistrationDomain } from "../domain/RegistrationDomain";

//
// Read a brand's vetting/trust-score state plus its campaigns' per-carrier operations status
// (registration-11.2) — purely the reconciled projection. It deliberately does NOT trigger a refresh, so a
// support tool or a dashboard can poll it freely without ordering (and being billed for) EVP runs.
//
export class GetRegistrationVettingStatusImpl extends GetRegistrationVettingStatus
{
    private service : RegistrationService;
    constructor( service : RegistrationService ) { super(); this.service = service; }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId || !auth.accountId ) return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };

        const status : Type.Result<RegistrationDomain.VettingStatus> = await this.service.domain.vettingStatus( auth.accountId, this.query.brandId );
        if( !status.ok ) return { status: NetworkUtils.Status.NOT_FOUND, data: { message: status.error } };
        return { status: NetworkUtils.Status.OK, data: status.data };
    }
}

export default GetRegistrationVettingStatusImpl;
// eof
