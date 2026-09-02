//
import { PostRegistrationNumberRelease, PhoneNumber } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";

import RegistrationService from "../services/RegistrationService";

//
// Release an owned number back to the carrier (registration-4.x) — idempotent.
//
export class PostRegistrationNumberReleaseImpl extends PostRegistrationNumberRelease
{
    private service : RegistrationService;
    constructor( service : RegistrationService ) { super(); this.service = service; }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId || !auth.accountId ) return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };

        const body : PostRegistrationNumberRelease.Body | null = this.body;
        if( !body ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "an id is required" } };

        const released : Type.Result<PhoneNumber.PhoneNumber> = await this.service.domain.releaseNumber( auth.accountId, body.id );
        if( !released.ok )
        {
            const notFound : boolean = released.error.includes( "not found" );
            return { status: notFound ? NetworkUtils.Status.NOT_FOUND : NetworkUtils.Status.BAD_REQUEST, data: { message: released.error } };
        }
        return { status: NetworkUtils.Status.OK, data: released.data };
    }
}

export default PostRegistrationNumberReleaseImpl;
// eof
