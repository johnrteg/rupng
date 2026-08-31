//
import { GetRegistrationCampaigns, Registration, Paging } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";

import RegistrationService from "../services/RegistrationService";

//
// List the caller's account's campaigns (paged), optionally filtered by brand/status. A single-partition
// query — cross-account listing is the staff/S2S surface, not this one.
//
export class GetRegistrationCampaignsImpl extends GetRegistrationCampaigns
{
    private service : RegistrationService;
    constructor( service : RegistrationService ) { super(); this.service = service; }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId || !auth.accountId ) return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };
        const query : GetRegistrationCampaigns.Query = this.query ?? {};

        const found : Type.Result<Array<Registration.Campaign>> = await this.service.domain.listCampaigns( auth.accountId );
        if( !found.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "could not list campaigns" } };

        const campaigns : Array<Registration.Campaign> = found.data
            .filter( ( campaign : Registration.Campaign ) : boolean => !query.brandId || campaign.brandId === query.brandId )
            .filter( ( campaign : Registration.Campaign ) : boolean => !query.status || campaign.status === query.status )
            .sort( ( first : Registration.Campaign, second : Registration.Campaign ) : number => second.createdAt.localeCompare( first.createdAt ) );

        const paged : Paging.Result<Registration.Campaign> = Paging.paginate( campaigns, query );
        return { status: NetworkUtils.Status.OK, data: paged };
    }
}

export default GetRegistrationCampaignsImpl;
// eof
