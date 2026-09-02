//
import { GetRegistrationMyBrand, Registration } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";

import RegistrationService from "../services/RegistrationService";

//
// The caller's own brand, if any (brand-per-account) — the entry point every registration UI needs before it
// can know whether to show "create a brand" or the brand's status.
//
export class GetRegistrationMyBrandImpl extends GetRegistrationMyBrand
{
    private service : RegistrationService;
    constructor( service : RegistrationService ) { super(); this.service = service; }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId || !auth.accountId ) return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };

        const found : Type.Result<Array<Registration.Brand>> = await this.service.domain.listBrands( auth.accountId );
        if( !found.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "could not read the brand" } };
        return { status: NetworkUtils.Status.OK, data: { brand: found.data[ 0 ] } };
    }
}

export default GetRegistrationMyBrandImpl;
// eof
