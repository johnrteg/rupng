//
import { Print } from "@repo/api";

import { AddressVerifierProvider, AddressVerifierContext, CassResult, NcoaResult } from "../AddressVerifierProvider";

//
// SmartyStreetsAddressVerifierAdapter — SmartyStreets (Smarty) US Street Address API (print-2.6). Declares
// BOTH capabilities — a licensed NCOALink source (via Smarty's separate list-processing product). UNVERIFIED
// at author time — follows Smarty's documented REST shape; adjust once wired to a real auth-id/token pair.
//
export class SmartyStreetsAddressVerifierAdapter implements AddressVerifierProvider
{
    public readonly id : Print.AddressVerifierId = Print.AddressVerifierId.SMARTYSTREETS;
    public readonly capabilities : ReadonlyArray<Print.Capability> = [ Print.Capability.CASS, Print.Capability.NCOA ];

    private static readonly BASE_URL : string = "https://us-street.api.smarty.com/street-address";

    ////////////////////////////////////////////////////////////////////////////////////////////
    public async verifyCass( address : Print.Address, ctx : AddressVerifierContext ) : Promise<CassResult>
    {
        const authId : string | undefined = ctx.secret?.authId as string | undefined;
        const authToken : string | undefined = ctx.secret?.authToken as string | undefined;
        if( authId === undefined || authToken === undefined ) return { ok: false, error: "no SmartyStreets credential configured" };

        try
        {
            const query : URLSearchParams = new URLSearchParams( {
                "auth-id": authId, "auth-token": authToken, street: address.line1, street2: address.line2 ?? "",
                city: address.city, state: address.region, zipcode: address.postalCode,
            } );
            const response : Response = await fetch( `${ SmartyStreetsAddressVerifierAdapter.BASE_URL }?${ query.toString() }` );
            const body : Array<{ delivery_line_1? : string; delivery_line_2? : string; components? : Record<string, string>; analysis? : { dpv_match_code? : string; vacant? : string } }>
                = await response.json() as Array<{ delivery_line_1? : string; delivery_line_2? : string; components? : Record<string, string>; analysis? : { dpv_match_code? : string; vacant? : string } }>;
            const match = body[ 0 ];
            if( !response.ok || match === undefined ) return { ok: false, error: `SmartyStreets verify failed (${ response.status })`, deliverability: Print.Deliverability.UNDELIVERABLE };

            const standardized : Print.Address =
            {
                name: address.name, line1: match.delivery_line_1 ?? address.line1, line2: match.delivery_line_2,
                city: match.components?.city_name ?? address.city, region: match.components?.state_abbreviation ?? address.region,
                postalCode: match.components?.zipcode ?? address.postalCode, country: "US",
            };
            const deliverable : boolean = match.analysis?.dpv_match_code === "Y";
            return { ok: true, standardized, deliverability: deliverable ? Print.Deliverability.DELIVERABLE : Print.Deliverability.UNDELIVERABLE, vacant: match.analysis?.vacant === "Y" };
        }
        catch( error ) { return { ok: false, error: String( error ) }; }
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // Smarty's NCOALink is a separate batch list-processing product, not this synchronous lookup API — not yet
    // wired; reports unresolved rather than fabricating a move-update result.
    public async verifyNcoa() : Promise<NcoaResult> { return { ok: false, error: "SmartyStreets NCOALink list-processing integration not yet wired (print-2.6 follow-up)" }; }
}

export default SmartyStreetsAddressVerifierAdapter;
// eof
