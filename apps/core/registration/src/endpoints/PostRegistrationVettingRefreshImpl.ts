//
import { PostRegistrationVettingRefresh } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";

import RegistrationService from "../services/RegistrationService";

//
// Refresh a brand's external vetting (registration-11.3). ASYNC by construction — an EVP run takes minutes to
// days, so this validates, enqueues, and returns 202 with a job pointer; `RegistrationVettingJob` orders the
// run, mirrors the score, and re-publishes trust-score → MPS if the score changes tier (registration-7.2).
//
export class PostRegistrationVettingRefreshImpl extends PostRegistrationVettingRefresh
{
    private service : RegistrationService;
    constructor( service : RegistrationService ) { super(); this.service = service; }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId || !auth.accountId ) return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };

        const queued : Type.Result<string> = await this.service.domain.refreshVetting( auth.accountId, this.query.brandId );
        if( !queued.ok ) return { status: NetworkUtils.Status.NOT_FOUND, data: { message: queued.error } };
        return { status: NetworkUtils.Status.ACCEPTED, data: { queued: true, jobId: queued.data } };
    }
}

export default PostRegistrationVettingRefreshImpl;
// eof
