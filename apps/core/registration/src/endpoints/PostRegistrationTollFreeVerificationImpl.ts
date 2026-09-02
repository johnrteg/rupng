//
import { PostRegistrationTollFreeVerification, PhoneNumber } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";

import RegistrationService from "../services/RegistrationService";

//
// Submit toll-free verification (TFV) for an owned toll-free number (registration-4.x). Async — lands
// SUBMITTED here; the real decision arrives via a carrier webhook (not yet wired, unverified per-carrier
// payload shape) or a staff correction.
//
export class PostRegistrationTollFreeVerificationImpl extends PostRegistrationTollFreeVerification
{
    private service : RegistrationService;
    constructor( service : RegistrationService ) { super(); this.service = service; }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId || !auth.accountId ) return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };

        const body : PostRegistrationTollFreeVerification.Body | null = this.body;
        if( !body ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "TFV details are required" } };

        const updated : Type.Result<PhoneNumber.PhoneNumber> = await this.service.domain.submitTollFreeVerification( auth.accountId, body.id, {
            businessName: body.businessName, businessWebsite: body.businessWebsite, useCase: body.useCase,
            optInWorkflow: body.optInWorkflow, monthlyVolume: body.monthlyVolume,
        } );
        if( !updated.ok )
        {
            const notFound : boolean = updated.error.includes( "not found" );
            return { status: notFound ? NetworkUtils.Status.NOT_FOUND : NetworkUtils.Status.BAD_REQUEST, data: { message: updated.error } };
        }
        return { status: NetworkUtils.Status.OK, data: updated.data };
    }
}

export default PostRegistrationTollFreeVerificationImpl;
// eof
