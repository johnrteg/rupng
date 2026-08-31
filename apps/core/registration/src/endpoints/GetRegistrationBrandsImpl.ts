//
import { GetRegistrationBrands, Registration, Paging } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";

import RegistrationService from "../services/RegistrationService";

//
// Staff cross-account brand listing (registration-12.2). Reads every partition — a scan is correct here
// because there is no tenant to key by, and the brand table is one row per registered account, not per
// message. An explicit `accountId` filter narrows to a single partition read instead.
//
export class GetRegistrationBrandsImpl extends GetRegistrationBrands
{
    private service : RegistrationService;
    constructor( service : RegistrationService ) { super(); this.service = service; }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId ) return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };
        const query : GetRegistrationBrands.Query = this.query ?? {};

        // a named account is a partition query; otherwise sweep every account
        const found : Type.Result<Array<Registration.Brand>> = query.accountId
            ? await this.service.domain.listBrands( query.accountId )
            : await this.service.domain.scanBrands();
        if( !found.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "could not list brands" } };

        const brands : Array<Registration.Brand> = found.data
            .filter( ( brand : Registration.Brand ) : boolean => !query.status || brand.status === query.status )
            .sort( ( first : Registration.Brand, second : Registration.Brand ) : number => second.createdAt.localeCompare( first.createdAt ) );

        const paged : Paging.Result<Registration.Brand> = Paging.paginate( brands, query );
        return { status: NetworkUtils.Status.OK, data: paged };
    }
}

export default GetRegistrationBrandsImpl;
// eof
