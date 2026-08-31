//
import { Registration } from "@repo/api";

import { CarrierProvider } from "./CarrierProvider";
import { FakeCarrierAdapter } from "./adapters/FakeCarrierAdapter";
import { BandwidthAdapter } from "./adapters/BandwidthAdapter";
import { TelnyxAdapter } from "./adapters/TelnyxAdapter";
import { VonageAdapter } from "./adapters/VonageAdapter";

//
// CarrierFactory — the registry of carrier (CNP) adapters (registration-6.1), mirroring VoiceFactory
// (apps/core/voice/src/providers/VoiceFactory.ts): a `Map<CarrierProvider, make>` seeded with the built-ins
// and extended via `register()`. Adding a carrier = a new enum value + a new adapter; no call site changes.
//
export class CarrierFactory
{
    private readonly registry : Map<Registration.CarrierProvider, () => CarrierProvider> = new Map<Registration.CarrierProvider, () => CarrierProvider>( [
        [ Registration.CarrierProvider.FAKE,      () => new FakeCarrierAdapter() ],
        [ Registration.CarrierProvider.BANDWIDTH, () => new BandwidthAdapter() ],
        [ Registration.CarrierProvider.TELNYX,    () => new TelnyxAdapter() ],
        [ Registration.CarrierProvider.VONAGE,    () => new VonageAdapter() ],
    ] );

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Register (or replace) an adapter — add a carrier without editing call sites. */
    public register( provider : Registration.CarrierProvider, make : () => CarrierProvider ) : void { this.registry.set( provider, make ); }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Instantiate one carrier's adapter, or undefined if none is registered. */
    public get( provider : Registration.CarrierProvider ) : CarrierProvider | undefined
    {
        const make : ( () => CarrierProvider ) | undefined = this.registry.get( provider );
        return make ? make() : undefined;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Every registered carrier id (for listing/enablement). */
    public providers() : Array<Registration.CarrierProvider> { return [ ...this.registry.keys() ]; }
}

export default CarrierFactory;
// eof
