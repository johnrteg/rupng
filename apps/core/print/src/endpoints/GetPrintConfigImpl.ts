//
import { GetPrintConfig, PrintConfig } from "@repo/api";
import { NetworkUtils } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";

import PrintService from "../services/PrintService";

//
// Read the print service's runtime config. ROOT.
//
export class GetPrintConfigImpl extends GetPrintConfig
{
    private service : PrintService;
    constructor( service : PrintService ) { super(); this.service = service; }

    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId ) return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };
        const config : PrintConfig.Config = await this.service.printConfig();
        return { status: NetworkUtils.Status.OK, data: { config } };
    }
}

export default GetPrintConfigImpl;
// eof
