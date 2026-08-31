//
import { PostRegistrationCheckSync } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";

import RegistrationService from "../services/RegistrationService";
import { RegistrationDomain } from "../domain/RegistrationDomain";

//
// On-demand force-reconcile one registration with TCR now (registration-11.8). SYNCHRONOUS, unlike the other
// lifecycle ops: it's a small, bounded, single-entity TCR read plus a projection update, so making the caller
// poll for a job result would be worse than just waiting for it.
//
// It calls exactly the same `reconcileOne` the poll sweep runs — the whole point of registration-11.8 is
// "the poll-sweep reconcile, on request", so there is one implementation, not a second one that can drift.
//
export class PostRegistrationCheckSyncImpl extends PostRegistrationCheckSync
{
    private service : RegistrationService;
    constructor( service : RegistrationService ) { super(); this.service = service; }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId ) return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };
        if( !auth.accountId ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "an acting account (X-Account) is required" } };

        const body : PostRegistrationCheckSync.Body | null = this.body;
        const hasBrand : boolean = body?.brandId !== undefined && body.brandId.length > 0;
        const hasCampaign : boolean = body?.campaignId !== undefined && body.campaignId.length > 0;
        if( hasBrand === hasCampaign ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "exactly one of brandId/campaignId is required" } };

        const synced : Type.Result<RegistrationDomain.EntityResult> = await this.service.domain.checkSync(
            auth.accountId,
            { brandId: hasBrand ? body?.brandId : undefined, campaignId: hasCampaign ? body?.campaignId : undefined } );
        if( !synced.ok ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: synced.error } };

        return { status: NetworkUtils.Status.OK, data: synced.data };
    }
}

export default PostRegistrationCheckSyncImpl;
// eof
