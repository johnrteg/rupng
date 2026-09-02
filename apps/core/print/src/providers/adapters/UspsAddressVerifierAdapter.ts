//
import { Print } from "@repo/api";

import { AddressVerifierProvider, AddressVerifierContext, CassResult, NcoaResult } from "../AddressVerifierProvider";

//
// UspsAddressVerifierAdapter — USPS Web Tools / Address API (print-2.6). CASS/DPV standardization ONLY — USPS
// Web Tools has no NCOALink access, so `verifyNcoa` always fails closed (the factory should never route an
// NCOA request here anyway, given `capabilities`). UNVERIFIED at author time — follows USPS's documented
// Address API v3 shape; adjust once wired to a real registered Web Tools user id.
//
export class UspsAddressVerifierAdapter implements AddressVerifierProvider
{
    public readonly id : Print.AddressVerifierId = Print.AddressVerifierId.USPS;
    public readonly capabilities : ReadonlyArray<Print.Capability> = [ Print.Capability.CASS ];

    private static readonly BASE_URL : string = "https://apis.usps.com/addresses/v3/address";

    ////////////////////////////////////////////////////////////////////////////////////////////
    public async verifyCass( address : Print.Address, ctx : AddressVerifierContext ) : Promise<CassResult>
    {
        const userId : string | undefined = ( ctx.secret?.userId as string | undefined );
        if( userId === undefined ) return { ok: false, error: "no USPS Web Tools credential configured" };

        try
        {
            const query : URLSearchParams = new URLSearchParams( {
                streetAddress: address.line1, secondaryAddress: address.line2 ?? "",
                city: address.city, state: address.region, ZIPCode: address.postalCode,
            } );
            const response : Response = await fetch( `${ UspsAddressVerifierAdapter.BASE_URL }?${ query.toString() }`, {
                headers: { authorization: `Bearer ${ userId }` },
            } );
            const body : { address? : Record<string, string>; error? : { message? : string } } = await response.json() as { address? : Record<string, string>; error? : { message? : string } };
            if( !response.ok || body.address === undefined ) return { ok: false, error: body.error?.message ?? `USPS verify failed (${ response.status })` };

            const standardized : Print.Address =
            {
                name: address.name, line1: body.address.streetAddress, line2: body.address.secondaryAddress,
                city: body.address.city, region: body.address.state, postalCode: body.address.ZIPCode, country: "US",
            };
            return { ok: true, standardized, deliverability: Print.Deliverability.DELIVERABLE };
        }
        catch( error ) { return { ok: false, error: String( error ) }; }
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** USPS Web Tools is CASS-only — never has NCOALink access. */
    public async verifyNcoa() : Promise<NcoaResult> { return { ok: false, error: "USPS Web Tools has no NCOALink capability" }; }
}

export default UspsAddressVerifierAdapter;
// eof
