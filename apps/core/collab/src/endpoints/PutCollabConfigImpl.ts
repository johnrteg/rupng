//
import { PutCollabConfig, CollabConfig } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";

import CollabService from "../services/CollabService";

//
// Set the collab service's runtime config. ROOT. Validates against CollabConfig.SCHEMA before persisting.
//
export class PutCollabConfigImpl extends PutCollabConfig
{
    private service : CollabService;
    constructor( service : CollabService ) { super(); this.service = service; }

    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId ) return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };

        const body : PutCollabConfig.Body | null = this.body;
        if( !body || !CollabConfig.validate.is( body.config ) )
            return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "invalid collab config" } };

        const saved : Type.Result<void> = await this.service.saveConfig( body.config );
        if( !saved.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "could not save config" } };
        return { status: NetworkUtils.Status.OK, data: { config: body.config } };
    }
}

export default PutCollabConfigImpl;
// eof
