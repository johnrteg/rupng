//
import { PostPrintAddressVerify, Print } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";

import PrintService from "../services/PrintService";

//
// CASS (+ optional NCOA) address verification (print-2.1/2.2/2.7/2.8).
//
export class PostPrintAddressVerifyImpl extends PostPrintAddressVerify
{
    private service : PrintService;
    constructor( service : PrintService ) { super(); this.service = service; }

    public async execute( auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        if( !auth.userId || !auth.accountId ) return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "sign in required" } };
        const body : PostPrintAddressVerify.Body | null = this.body;
        if( !body?.address ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "address is required" } };

        // the session's own accountId, never a client-supplied one
        const verified : Type.Result<Print.AddressVerifyResult> = await this.service.verifyAddress( { ...body, accountId: auth.accountId } );
        if( !verified.ok ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: verified.error ?? "address verification failed" } };
        return { status: NetworkUtils.Status.OK, data: verified.data };
    }
}

export default PostPrintAddressVerifyImpl;
// eof
