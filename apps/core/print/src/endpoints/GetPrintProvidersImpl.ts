//
import { GetPrintProviders, PrintConfig } from "@repo/api";
import { NetworkUtils } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";

import PrintService from "../services/PrintService";

//
// List configured mail-fulfillment providers + address-verification sources (print-3.1/2.6). APPLICATION.
//
export class GetPrintProvidersImpl extends GetPrintProviders
{
    private service : PrintService;
    constructor( service : PrintService ) { super(); this.service = service; }

    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId ) return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };
        const config : PrintConfig.Config = await this.service.printConfig();
        return { status: NetworkUtils.Status.OK, data: { providers: config.providers, addressVerifiers: config.addressVerifiers } };
    }
}

export default GetPrintProvidersImpl;
// eof
