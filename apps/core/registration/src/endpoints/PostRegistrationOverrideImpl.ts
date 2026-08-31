//
import { PostRegistrationOverride } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";

import RegistrationService from "../services/RegistrationService";
import { RegistrationDomain } from "../domain/RegistrationDomain";

//
// Staff break-glass status override (registration-11.6) — ROOT only, audited, reason REQUIRED. The override
// sets `overridden: true` on the entity and appends a history entry marked the same way, and it is
// explicitly NOT authoritative: the next reconcile compares it against TCR and re-flags a contradiction (TCR
// stays the source of truth).
//
// The target ACCOUNT comes from the acting-account header (`auth.accountId`), per the platform's `X-Account`
// convention — a staff caller sets it to the account being corrected. The contract carries no accountId of
// its own, so this is the mechanism rather than an omission.
//
export class PostRegistrationOverrideImpl extends PostRegistrationOverride
{
    private service : RegistrationService;
    constructor( service : RegistrationService ) { super(); this.service = service; }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId ) return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };
        if( !auth.accountId ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "an acting account (X-Account) is required" } };

        const body : PostRegistrationOverride.Body | null = this.body;
        if( !body ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "an override body is required" } };
        if( !body.reason || body.reason.trim().length === 0 )
            return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "a reason is required for a status override" } };

        const hasBrand : boolean = body.brandId !== undefined && body.brandId.length > 0;
        const hasCampaign : boolean = body.campaignId !== undefined && body.campaignId.length > 0;
        if( hasBrand === hasCampaign ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "exactly one of brandId/campaignId is required" } };

        const applied : Type.Result<RegistrationDomain.EntityResult> = await this.service.domain.override(
            auth.accountId,
            { brandId: hasBrand ? body.brandId : undefined, campaignId: hasCampaign ? body.campaignId : undefined },
            body.status, body.reason );
        if( !applied.ok ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: applied.error } };

        return { status: NetworkUtils.Status.OK, data: applied.data };
    }
}

export default PostRegistrationOverrideImpl;
// eof
