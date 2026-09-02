//
import { Print } from "@repo/api";

import { AddressVerifierProvider, AddressVerifierContext, CassResult, NcoaResult } from "../AddressVerifierProvider";

//
// FakeAddressVerifierAdapter — a DEV-ONLY simulated verification source (mirrors FakeMailAdapter). Declares
// BOTH capabilities so the fake pipeline is fully testable offline without a real vendor. `verifyCass`
// "standardizes" by upper-casing the input (illustrative only — never a real USPS-parseable form); `verifyNcoa`
// never reports a move (no real move-update data exists to simulate against).
//
export class FakeAddressVerifierAdapter implements AddressVerifierProvider
{
    public readonly id : Print.AddressVerifierId = Print.AddressVerifierId.FAKE;
    public readonly capabilities : ReadonlyArray<Print.Capability> = [ Print.Capability.CASS, Print.Capability.NCOA ];

    ////////////////////////////////////////////////////////////////////////////////////////////
    // never throws — a simulated standardization can't fail transport. Deliverability is DELIVERABLE unless
    // the postal code is obviously malformed (illustrative check only).
    public async verifyCass( address : Print.Address ) : Promise<CassResult>
    {
        const deliverability : Print.Deliverability = /^\d{5}(-\d{4})?$/.test( address.postalCode )
            ? Print.Deliverability.DELIVERABLE : Print.Deliverability.UNKNOWN;
        const standardized : Print.Address =
        {
            ...address,
            line1: address.line1.toUpperCase(),
            line2: address.line2?.toUpperCase(),
            city:  address.city.toUpperCase(),
            region: address.region.toUpperCase(),
        };
        return { ok: true, standardized, deliverability, vacant: false, externalRefId: `fake-cass-${ Date.now() }` };
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // fake NCOA never has a real move-update database to consult — always reports "no move on file".
    public async verifyNcoa( address : Print.Address, ctx : AddressVerifierContext ) : Promise<NcoaResult>
    {
        return { ok: true, moved: false, deceased: false };
    }
}

export default FakeAddressVerifierAdapter;
// eof
