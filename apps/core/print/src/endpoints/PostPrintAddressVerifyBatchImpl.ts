//
import { PostPrintAddressVerifyBatch, Print } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";

import PrintService from "../services/PrintService";

//
// S2S: batch address verification (print-2.1/2.7/2.8) — list hygiene (e.g. contact-import CASS pass).
//
export class PostPrintAddressVerifyBatchImpl extends PostPrintAddressVerifyBatch
{
    private service : PrintService;
    constructor( service : PrintService ) { super(); this.service = service; }

    public async execute( _auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        const body : PostPrintAddressVerifyBatch.Body | null = this.body;
        if( !body?.accountId || !Array.isArray( body.addresses ) || body.addresses.length === 0 )
            return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "accountId and addresses are required" } };

        const results : Array<Print.AddressVerifyResult> = [];
        for( const address of body.addresses )
        {
            const verified : Type.Result<Print.AddressVerifyResult> = await this.service.verifyAddress( { accountId: body.accountId, address, ncoa: body.ncoa } );
            if( verified.ok ) results.push( verified.data );
        }
        return { status: NetworkUtils.Status.OK, data: { results } };
    }
}

export default PostPrintAddressVerifyBatchImpl;
// eof
