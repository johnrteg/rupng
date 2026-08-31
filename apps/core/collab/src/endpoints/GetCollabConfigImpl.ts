//
import { GetCollabConfig, CollabConfig } from "@repo/api";
import { NetworkUtils } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";

import CollabService from "../services/CollabService";

//
// Read the collab service's runtime config. ROOT.
//
export class GetCollabConfigImpl extends GetCollabConfig
{
    private service : CollabService;
    constructor( service : CollabService ) { super(); this.service = service; }

    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId ) return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };
        const config : CollabConfig.Config = await this.service.collabConfig();
        return { status: NetworkUtils.Status.OK, data: { config } };
    }
}

export default GetCollabConfigImpl;
// eof
