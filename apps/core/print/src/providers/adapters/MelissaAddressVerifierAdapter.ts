//
import { Print } from "@repo/api";

import { AddressVerifierProvider, AddressVerifierContext, CassResult, NcoaResult } from "../AddressVerifierProvider";

//
// MelissaAddressVerifierAdapter — Melissa Address Object + Personator/NCOALink APIs (print-2.6). Declares BOTH
// capabilities — a licensed NCOALink source. UNVERIFIED at author time — follows Melissa's documented REST
// shape; adjust once wired to a real license key.
//
export class MelissaAddressVerifierAdapter implements AddressVerifierProvider
{
    public readonly id : Print.AddressVerifierId = Print.AddressVerifierId.MELISSA;
    public readonly capabilities : ReadonlyArray<Print.Capability> = [ Print.Capability.CASS, Print.Capability.NCOA ];

    private static readonly BASE_URL : string = "https://address.melissadata.net/v3/WEB/GlobalAddress/doGlobalAddress";

    ////////////////////////////////////////////////////////////////////////////////////////////
    public async verifyCass( address : Print.Address, ctx : AddressVerifierContext ) : Promise<CassResult>
    {
        const licenseKey : string | undefined = ctx.secret?.licenseKey as string | undefined;
        if( licenseKey === undefined ) return { ok: false, error: "no Melissa credential configured" };

        try
        {
            const query : URLSearchParams = new URLSearchParams( {
                id: licenseKey, format: "json", a1: address.line1, a2: address.line2 ?? "",
                loc: address.city, admarea: address.region, postal: address.postalCode, ctry: address.country,
            } );
            const response : Response = await fetch( `${ MelissaAddressVerifierAdapter.BASE_URL }?${ query.toString() }` );
            const body : { Records? : Array<Record<string, string>> } = await response.json() as { Records? : Array<Record<string, string>> };
            const record : Record<string, string> | undefined = body.Records?.[ 0 ];
            if( !response.ok || record === undefined ) return { ok: false, error: `Melissa verify failed (${ response.status })` };

            const deliverable : boolean = ( record.Results ?? "" ).includes( "AV25" );   // "USPS deliverable" result code
            const standardized : Print.Address =
            {
                name: address.name, line1: record.AddressLine1 ?? address.line1, line2: record.AddressLine2,
                city: record.Locality ?? address.city, region: record.AdministrativeArea ?? address.region,
                postalCode: record.PostalCode ?? address.postalCode, country: record.CountryISO3166_1_Alpha2 ?? address.country,
            };
            return { ok: true, standardized, deliverability: deliverable ? Print.Deliverability.DELIVERABLE : Print.Deliverability.UNKNOWN };
        }
        catch( error ) { return { ok: false, error: String( error ) }; }
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // Melissa's Personator NCOALink product is a separate call; not yet wired — reports unresolved rather than
    // fabricating a move-update result.
    public async verifyNcoa() : Promise<NcoaResult> { return { ok: false, error: "Melissa NCOALink integration not yet wired (print-2.6 follow-up)" }; }
}

export default MelissaAddressVerifierAdapter;
// eof
