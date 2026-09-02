//
import { PostPrintInternalErase } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";

import PrintService from "../services/PrintService";

//
// S2S forget hook (print-7.1) — purges address + merge data in every mailpiece addressed to a contact.
//
export class PostPrintInternalEraseImpl extends PostPrintInternalErase
{
    private service : PrintService;
    constructor( service : PrintService ) { super(); this.service = service; }

    public async execute( _auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        const body : PostPrintInternalErase.Body | null = this.body;
        if( !body?.accountId || !body.contactId ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "accountId and contactId are required" } };

        const erased : Type.Result<number> = await this.service.eraseContact( body.accountId, body.contactId );
        if( !erased.ok ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "erase failed" } };
        return { status: NetworkUtils.Status.OK, data: { erased: erased.data } };
    }
}

export default PostPrintInternalEraseImpl;
// eof
