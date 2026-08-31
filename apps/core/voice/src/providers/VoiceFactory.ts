//
import { Voice } from "@repo/api";

import { VoiceProvider } from "./VoiceProvider";
import { FakeVoiceAdapter } from "./adapters/FakeVoiceAdapter";
import { TwilioVoiceAdapter } from "./adapters/TwilioVoiceAdapter";

//
// VoiceFactory — the registry of telephony adapters (voice-3.3), mirroring EmailFactory
// (apps/core/email/src/providers/EmailFactory.ts): a `Map<Provider, make>` seeded with the built-ins and
// extended via `register()`. Adding a provider = register an adapter; no call site changes.
//
export class VoiceFactory
{
    private readonly registry : Map<Voice.Provider, () => VoiceProvider> = new Map<Voice.Provider, () => VoiceProvider>( [
        [ Voice.Provider.TWILIO, () => new TwilioVoiceAdapter() ],
        [ Voice.Provider.FAKE,   () => new FakeVoiceAdapter() ],
        // Telnyx / Vonage / Bandwidth / SignalWire / Sinch / Infobip / Plivo land next (SPECS.md voice-3.1).
    ] );

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Register (or replace) an adapter — add a provider without editing call sites. */
    public register( provider : Voice.Provider, make : () => VoiceProvider ) : void { this.registry.set( provider, make ); }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Instantiate one provider's adapter, or undefined if none is registered. */
    public get( provider : Voice.Provider ) : VoiceProvider | undefined
    {
        const make : ( () => VoiceProvider ) | undefined = this.registry.get( provider );
        return make ? make() : undefined;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Every registered provider id (for listing/enablement). */
    public providers() : Array<Voice.Provider> { return [ ...this.registry.keys() ]; }
}

export default VoiceFactory;
// eof
