//
import { PostRegistrationNudge } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";

import RegistrationService from "../services/RegistrationService";

//
// Nudge a stuck in-flight registration (registration-11.7) — re-pokes TCR out-of-band of the poll cadence and
// optionally flags that the account should be reminded to finish KYC/remediation. It deliberately does NOT
// change status: a nudge accelerates progress, it doesn't fabricate it, so the response is just `nudged`.
//
// Staff-facing; the target account comes from the acting-account header, same convention as the override.
//
export class PostRegistrationNudgeImpl extends PostRegistrationNudge
{
    private service : RegistrationService;
    constructor( service : RegistrationService ) { super(); this.service = service; }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId ) return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };
        if( !auth.accountId ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "an acting account (X-Account) is required" } };

        const body : PostRegistrationNudge.Body | null = this.body;
        const hasBrand : boolean = body?.brandId !== undefined && body.brandId.length > 0;
        const hasCampaign : boolean = body?.campaignId !== undefined && body.campaignId.length > 0;
        if( hasBrand === hasCampaign ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "exactly one of brandId/campaignId is required" } };

        const nudged : Type.Result<boolean> = await this.service.domain.nudge(
            auth.accountId,
            { brandId: hasBrand ? body?.brandId : undefined, campaignId: hasCampaign ? body?.campaignId : undefined },
            body?.notifyAccount === true );
        if( !nudged.ok ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: nudged.error } };

        return { status: NetworkUtils.Status.OK, data: { nudged: nudged.data } };
    }
}

export default PostRegistrationNudgeImpl;
// eof
