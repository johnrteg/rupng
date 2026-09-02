//
import { Print } from "@repo/api";

import { AddressVerifierProvider } from "./AddressVerifierProvider";
import { FakeAddressVerifierAdapter } from "./adapters/FakeAddressVerifierAdapter";
import { UspsAddressVerifierAdapter } from "./adapters/UspsAddressVerifierAdapter";
import { MelissaAddressVerifierAdapter } from "./adapters/MelissaAddressVerifierAdapter";
import { SmartyStreetsAddressVerifierAdapter } from "./adapters/SmartyStreetsAddressVerifierAdapter";

//
// AddressVerifierFactory — the registry of address-verification sources (print-2.6/9.6), a SEPARATE typed
// registry from `MailFactory` (see `AddressVerifierProvider`'s header). PostGrid/Lob CAN also act as
// AddressVerifier sources per SPECS.md — not registered here yet (a documented extension); `usps` /
// `melissa` / `smartystreets` / `fake` are the sources wired today.
//
export class AddressVerifierFactory
{
    private readonly registry : Map<Print.AddressVerifierId, () => AddressVerifierProvider> = new Map<Print.AddressVerifierId, () => AddressVerifierProvider>( [
        [ Print.AddressVerifierId.USPS,          () => new UspsAddressVerifierAdapter() ],
        [ Print.AddressVerifierId.MELISSA,        () => new MelissaAddressVerifierAdapter() ],
        [ Print.AddressVerifierId.SMARTYSTREETS,  () => new SmartyStreetsAddressVerifierAdapter() ],
        [ Print.AddressVerifierId.FAKE,           () => new FakeAddressVerifierAdapter() ],
    ] );

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Register (or replace) an adapter — add a source without editing call sites. */
    public register( id : Print.AddressVerifierId, make : () => AddressVerifierProvider ) : void { this.registry.set( id, make ); }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Instantiate one source's adapter, or undefined if none is registered. */
    public get( id : Print.AddressVerifierId ) : AddressVerifierProvider | undefined
    {
        const make : ( () => AddressVerifierProvider ) | undefined = this.registry.get( id );
        return make ? make() : undefined;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Every registered source id (for listing/enablement). */
    public sources() : Array<Print.AddressVerifierId> { return [ ...this.registry.keys() ]; }
}

export default AddressVerifierFactory;
// eof
