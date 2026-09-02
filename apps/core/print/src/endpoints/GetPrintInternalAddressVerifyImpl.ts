//
import { GetPrintInternalAddressVerify, Print } from "@repo/api";
import { NetworkUtils, type Type } from "@repo/common";
import { RestfulEndpoint } from "@repo/endpoint";

import PrintService from "../services/PrintService";

//
// S2S address verify (print-2.1) — e.g. contact-import list hygiene.
//
export class GetPrintInternalAddressVerifyImpl extends GetPrintInternalAddressVerify
{
    private service : PrintService;
    constructor( service : PrintService ) { super(); this.service = service; }

    public async execute( _auth : RestfulEndpoint.Authentication ) : Promise<RestfulEndpoint.Response>
    {
        const query : GetPrintInternalAddressVerify.Query = this.query;
        const address : Print.Address = { line1: query.line1, line2: query.line2, city: query.city, region: query.region, postalCode: query.postalCode, country: query.country };

        const verified : Type.Result<Print.AddressVerifyResult> = await this.service.verifyAddress( { accountId: query.accountId, address, ncoa: query.ncoa } );
        if( !verified.ok ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: verified.error ?? "address verification failed" } };
        return { status: NetworkUtils.Status.OK, data: verified.data };
    }
}

export default GetPrintInternalAddressVerifyImpl;
// eof
