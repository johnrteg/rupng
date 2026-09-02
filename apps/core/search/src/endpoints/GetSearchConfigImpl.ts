//
import { GetSearchConfig, SearchConfig } from "@repo/api";
import { NetworkUtils } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";

import SearchService from "../services/SearchService";

//
// Read the search service's runtime config. ROOT (search-4.0/5.3).
//
export class GetSearchConfigImpl extends GetSearchConfig
{
    private service : SearchService;
    constructor( service : SearchService ) { super(); this.service = service; }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId ) return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };
        const config : SearchConfig.Config = await this.service.searchConfig();
        return { status: NetworkUtils.Status.OK, data: { config } };
    }
}

export default GetSearchConfigImpl;
// eof
