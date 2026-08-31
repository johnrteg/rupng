//
import { GetRegistrationBrand, Registration } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";

import RegistrationService from "../services/RegistrationService";

//
// Fetch one brand by id (registration-1.0) — the reconciled TCR projection. Scoped to the caller's account
// partition, so a brandId from another tenant simply doesn't resolve (tenant isolation is structural here,
// not a post-hoc ownership check).
//
export class GetRegistrationBrandImpl extends GetRegistrationBrand
{
    private service : RegistrationService;
    constructor( service : RegistrationService ) { super(); this.service = service; }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId || !auth.accountId ) return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };

        const found : Type.Result<Registration.Brand | undefined> = await this.service.domain.getBrand( auth.accountId, this.query.brandId );
        if( !found.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "could not read the brand" } };
        if( found.data === undefined ) return { status: NetworkUtils.Status.NOT_FOUND, data: { message: "brand not found" } };
        return { status: NetworkUtils.Status.OK, data: found.data };
    }
}

export default GetRegistrationBrandImpl;
// eof
