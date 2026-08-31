//
import { GetInternalRegistrationBrands, Registration, Paging } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";

import RegistrationService from "../services/RegistrationService";

//
// S2S: list brands, optionally filtered by accountId/status (registration-12.2). INTERNAL audience — there is
// no user session or X-Account on an S2S call, so the account comes from the query and there is no RBAC check
// to make. First consumer: the `report` service, which reads through this rather than touching registration's
// tables (the no-cross-service-DB-reads boundary).
//
export class GetInternalRegistrationBrandsImpl extends GetInternalRegistrationBrands
{
    private service : RegistrationService;
    constructor( service : RegistrationService ) { super(); this.service = service; }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public async execute( _auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        const query : GetInternalRegistrationBrands.Query = this.query ?? {};

        // a named account is a single-partition query; otherwise sweep every account
        const found : Type.Result<Array<Registration.Brand>> = query.accountId
            ? await this.service.domain.listBrands( query.accountId )
            : await this.service.domain.scanBrands();
        if( !found.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "brands read failed" } };

        const brands : Array<Registration.Brand> = found.data
            .filter( ( brand : Registration.Brand ) : boolean => !query.status || brand.status === query.status )
            .sort( ( first : Registration.Brand, second : Registration.Brand ) : number => second.createdAt.localeCompare( first.createdAt ) );

        const paged : Paging.Result<Registration.Brand> = Paging.paginate( brands, query );
        return { status: NetworkUtils.Status.OK, data: paged };
    }
}

export default GetInternalRegistrationBrandsImpl;
// eof
