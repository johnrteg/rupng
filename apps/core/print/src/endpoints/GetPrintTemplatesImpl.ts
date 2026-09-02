//
import { GetPrintTemplates, Print } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";

import PrintService from "../services/PrintService";

//
// List the account's non-archived print templates (print-1.1).
//
export class GetPrintTemplatesImpl extends GetPrintTemplates
{
    private service : PrintService;
    constructor( service : PrintService ) { super(); this.service = service; }

    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId || !auth.accountId ) return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };

        const found : Type.Result<Array<Print.Template>> = await this.service.listTemplates( auth.accountId );
        if( !found.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "could not list templates" } };
        return { status: NetworkUtils.Status.OK, data: { templates: found.data } };
    }
}

export default GetPrintTemplatesImpl;
// eof
