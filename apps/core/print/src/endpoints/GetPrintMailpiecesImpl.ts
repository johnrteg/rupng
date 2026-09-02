//
import { GetPrintMailpieces, Print } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";

import PrintService from "../services/PrintService";

//
// List the account's mailpieces (print-8.1), optionally filtered by campaign/status.
//
export class GetPrintMailpiecesImpl extends GetPrintMailpieces
{
    private service : PrintService;
    constructor( service : PrintService ) { super(); this.service = service; }

    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId || !auth.accountId ) return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };

        const found : Type.Result<Array<Print.Mailpiece>> = await this.service.listMailpieces( auth.accountId, { campaignId: this.query.campaignId, status: this.query.status } );
        if( !found.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "could not list mailpieces" } };
        return { status: NetworkUtils.Status.OK, data: { mailpieces: found.data } };
    }
}

export default GetPrintMailpiecesImpl;
// eof
