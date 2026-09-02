//
import { GetPrintDlq, Print } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";

import PrintService from "../services/PrintService";

//
// List dead-lettered print messages (print-9). APPLICATION.
//
export class GetPrintDlqImpl extends GetPrintDlq
{
    private service : PrintService;
    constructor( service : PrintService ) { super(); this.service = service; }

    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId ) return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };
        const found : Type.Result<Array<Print.DlqItem>> = await this.service.listDlq( this.query.queue );
        if( !found.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "could not list the DLQ" } };
        return { status: NetworkUtils.Status.OK, data: { items: found.data } };
    }
}

export default GetPrintDlqImpl;
// eof
