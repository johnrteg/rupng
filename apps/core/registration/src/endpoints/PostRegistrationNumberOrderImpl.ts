//
import { PostRegistrationNumberOrder, PhoneNumber } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";

import RegistrationService from "../services/RegistrationService";

//
// Order ONE specific searched number (registration-4.x). A LONG_CODE order requires an approved campaignId —
// enforced in the domain, not just the schema (see RegistrationDomain.orderNumber).
//
export class PostRegistrationNumberOrderImpl extends PostRegistrationNumberOrder
{
    private service : RegistrationService;
    constructor( service : RegistrationService ) { super(); this.service = service; }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId || !auth.accountId ) return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };

        const body : PostRegistrationNumberOrder.Body | null = this.body;
        if( !body ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "an order body is required" } };

        const ordered : Type.Result<PhoneNumber.PhoneNumber> = await this.service.domain.orderNumber(
            auth.accountId, body.number, body.numberType, body.carrier, body.campaignId );
        if( !ordered.ok )
        {
            const notFound : boolean = ordered.error.includes( "campaign not found" );
            return { status: notFound ? NetworkUtils.Status.NOT_FOUND : NetworkUtils.Status.BAD_REQUEST, data: { message: ordered.error } };
        }
        return { status: NetworkUtils.Status.OK, data: ordered.data };
    }
}

export default PostRegistrationNumberOrderImpl;
// eof
