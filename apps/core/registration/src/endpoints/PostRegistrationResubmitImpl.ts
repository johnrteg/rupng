//
import { PostRegistrationResubmit } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";

import RegistrationService from "../services/RegistrationService";

//
// Resubmit a rejected brand or campaign after editing (registration-3.2/11.4 — the remediation loop). The
// EDIT is applied synchronously (so the account immediately sees what it corrected in the projection); the
// external re-push to TCR is enqueued and this returns 202.
//
export class PostRegistrationResubmitImpl extends PostRegistrationResubmit
{
    private service : RegistrationService;
    constructor( service : RegistrationService ) { super(); this.service = service; }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId || !auth.accountId ) return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };

        const body : PostRegistrationResubmit.Body | null = this.body;
        if( !body ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "a resubmit body is required" } };

        // exactly-one-of is checked HERE, not in the schema — Ajv `oneOf` across sibling optional properties
        // is brittle, and the contract's own comment defers this check to the impl
        const hasBrand : boolean = body.brandId !== undefined && body.brandId.length > 0;
        const hasCampaign : boolean = body.campaignId !== undefined && body.campaignId.length > 0;
        if( hasBrand === hasCampaign ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "exactly one of brandId/campaignId is required" } };

        const queued : Type.Result<string> = await this.service.domain.resubmit(
            auth.accountId,
            { brandId: hasBrand ? body.brandId : undefined, campaignId: hasCampaign ? body.campaignId : undefined },
            body.fields as Record<string, unknown> );
        if( !queued.ok ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: queued.error } };

        return { status: NetworkUtils.Status.ACCEPTED, data: { queued: true, jobId: queued.data } };
    }
}

export default PostRegistrationResubmitImpl;
// eof
