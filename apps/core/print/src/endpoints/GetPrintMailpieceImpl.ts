//
import { GetPrintMailpiece, Print } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";

import PrintService from "../services/PrintService";

//
// Get one mailpiece's detail — status, cost, address verification stamp (print-8.1).
//
export class GetPrintMailpieceImpl extends GetPrintMailpiece
{
    private service : PrintService;
    constructor( service : PrintService ) { super(); this.service = service; }

    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId || !auth.accountId ) return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };

        const found : Type.Result<Print.Mailpiece | undefined> = await this.service.getMailpiece( auth.accountId, this.query.id );
        if( !found.ok ) return { status: NetworkUtils.Status.INTERNAL_SERVER_ERROR, data: { message: "could not read the mailpiece" } };
        if( found.data === undefined ) return { status: NetworkUtils.Status.NOT_FOUND, data: { message: "mailpiece not found" } };
        return { status: NetworkUtils.Status.OK, data: { mailpiece: found.data } };
    }
}

export default GetPrintMailpieceImpl;
// eof
