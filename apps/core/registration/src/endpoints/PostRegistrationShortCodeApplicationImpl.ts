//
import { PostRegistrationShortCodeApplication, PhoneNumber } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";

import RegistrationService from "../services/RegistrationService";

//
// Submit a short-code request (registration-4.x) — lands SUBMITTED for staff to progress
// (PatchRegistrationShortCodeApplicationImpl); no carrier self-serve order api exists to call here.
//
export class PostRegistrationShortCodeApplicationImpl extends PostRegistrationShortCodeApplication
{
    private service : RegistrationService;
    constructor( service : RegistrationService ) { super(); this.service = service; }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId || !auth.accountId ) return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };

        const body : PostRegistrationShortCodeApplication.Body | null = this.body;
        if( !body ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "an application body is required" } };

        const created : Type.Result<PhoneNumber.ShortCodeApplication> = await this.service.domain.submitShortCodeApplication( auth.accountId, {
            preference: body.preference, vanityCode: body.vanityCode, useCase: body.useCase, campaignId: body.campaignId,
        } );
        if( !created.ok ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: created.error } };
        return { status: NetworkUtils.Status.OK, data: created.data };
    }
}

export default PostRegistrationShortCodeApplicationImpl;
// eof
