//
import { GetInternalRegistrationCampaigns, Registration, Paging } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";

import RegistrationService from "../services/RegistrationService";

//
// S2S: list campaigns, optionally filtered by accountId/brandId/status. INTERNAL audience (see
// GetInternalRegistrationBrandsImpl's note on why there's no RBAC check here). Picks the narrowest available
// read: an accountId is a partition query, a bare brandId uses the `byBrand` GSI, neither is a sweep.
//
export class GetInternalRegistrationCampaignsImpl extends GetInternalRegistrationCampaigns
{
    private service : RegistrationService;
    constructor( service : RegistrationService ) { super(); this.service = service; }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public async execute( _auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        const query : GetInternalRegistrationCampaigns.Query = this.query ?? {};

        const found : Type.Result<Array<Registration.Campaign>> = await this.readCampaigns( query );
        if( !found.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "campaigns read failed" } };

        const campaigns : Array<Registration.Campaign> = found.data
            .filter( ( campaign : Registration.Campaign ) : boolean => !query.brandId || campaign.brandId === query.brandId )
            .filter( ( campaign : Registration.Campaign ) : boolean => !query.status || campaign.status === query.status )
            .sort( ( first : Registration.Campaign, second : Registration.Campaign ) : number => second.createdAt.localeCompare( first.createdAt ) );

        const paged : Paging.Result<Registration.Campaign> = Paging.paginate( campaigns, query );
        return { status: NetworkUtils.Status.OK, data: paged };
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // pick the narrowest read the filters allow — this is the difference between one partition query and a
    // full sweep on a report that runs on a schedule
    private readCampaigns( query : GetInternalRegistrationCampaigns.Query ) : Promise<Type.Result<Array<Registration.Campaign>>>
    {
        if( query.accountId ) return this.service.domain.listCampaigns( query.accountId );
        if( query.brandId ) return this.service.domain.campaignsByBrand( query.brandId );
        return this.service.domain.scanCampaigns();
    }
}

export default GetInternalRegistrationCampaignsImpl;
// eof
