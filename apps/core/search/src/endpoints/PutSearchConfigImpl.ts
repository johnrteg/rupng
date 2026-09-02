//
import { PutSearchConfig, SearchConfig } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";

import SearchService from "../services/SearchService";

//
// Set the search service's runtime config. ROOT. Validates against `SearchConfig.SCHEMA` before persisting.
//
export class PutSearchConfigImpl extends PutSearchConfig
{
    private service : SearchService;
    constructor( service : SearchService ) { super(); this.service = service; }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId ) return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };

        const body : PutSearchConfig.Body | null = this.body;
        if( !body || !SearchConfig.validate.is( body.config ) )
            return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "invalid search config" } };

        const saved : Type.Result<void> = await this.service.saveConfig( body.config );
        if( !saved.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "could not save config" } };
        return { status: NetworkUtils.Status.OK, data: { config: body.config } };
    }
}

export default PutSearchConfigImpl;
// eof
