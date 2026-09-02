//
import { Texting, TextingConfig } from "@repo/api";

import { SmsProvider } from "./SmsProvider";
import { FakeSmsAdapter } from "./adapters/FakeSmsAdapter";
import { TwilioSmsAdapter } from "./adapters/TwilioSmsAdapter";
import { TelnyxSmsAdapter } from "./adapters/TelnyxSmsAdapter";
import { BandwidthSmsAdapter } from "./adapters/BandwidthSmsAdapter";
import { BroadnetSmsAdapter } from "./adapters/BroadnetSmsAdapter";
import { InfobipSmsAdapter } from "./adapters/InfobipSmsAdapter";
import { SignalwireSmsAdapter } from "./adapters/SignalwireSmsAdapter";
import { SinchSmsAdapter } from "./adapters/SinchSmsAdapter";
import { VonageSmsAdapter } from "./adapters/VonageSmsAdapter";

//
// SmsFactory — the registry of transport adapters (texting-3.2), mirroring email's EmailFactory /
// print's MailFactory: a `Map<Provider, make>` seeded with the built-ins and extended via
// `register()`. Adding a provider = register an adapter; no call site changes. `bandwidth3`/`telnyx3`
// (a distinct account/config of the same vendor) reuse their base vendor's adapter class, tagged with the
// dupe-account `Provider` value via the constructor — same wire dialect, different resolved credential.
//
export class SmsFactory
{
    private readonly registry : Map<Texting.Provider, () => SmsProvider> = new Map<Texting.Provider, () => SmsProvider>( [
        [ Texting.Provider.FAKE,       () => new FakeSmsAdapter() ],
        [ Texting.Provider.TWILIO,     () => new TwilioSmsAdapter() ],
        [ Texting.Provider.TELNYX,     () => new TelnyxSmsAdapter() ],
        [ Texting.Provider.TELNYX3,    () => new TelnyxSmsAdapter( Texting.Provider.TELNYX3 ) ],
        [ Texting.Provider.BANDWIDTH,  () => new BandwidthSmsAdapter() ],
        [ Texting.Provider.BANDWIDTH3, () => new BandwidthSmsAdapter( Texting.Provider.BANDWIDTH3 ) ],
        [ Texting.Provider.BROADNET,   () => new BroadnetSmsAdapter() ],
        [ Texting.Provider.INFOBIP,    () => new InfobipSmsAdapter() ],
        [ Texting.Provider.SIGNALWIRE, () => new SignalwireSmsAdapter() ],
        [ Texting.Provider.SINCH,      () => new SinchSmsAdapter() ],
        [ Texting.Provider.VONAGE,     () => new VonageSmsAdapter() ],
    ] );

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Register (or replace) an adapter — add a provider without editing call sites. */
    public register( provider : Texting.Provider, make : () => SmsProvider ) : void { this.registry.set( provider, make ); }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Instantiate one provider's adapter, or undefined if none is registered. */
    public get( provider : Texting.Provider ) : SmsProvider | undefined
    {
        const make : ( () => SmsProvider ) | undefined = this.registry.get( provider );
        return make ? make() : undefined;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Pick the ENABLED provider that can actually carry this `RcsContent` — capability AND `rcsLimits`
     *  (a multi-card carousel disqualifies an adapter with `carousel:false`, an oversized suggestion row
     *  disqualifies one under `maxSuggestions`, …). `config.defaultProvider` wins ties; falls through to
     *  the next qualifying enabled provider otherwise. Returns undefined when NONE qualify — the caller
     *  (`TextingService.processSend`) falls back to the plain-SMS `body`, same fallback philosophy as an
     *  unreachable-RCS-device. */
    public selectForRcs( content : Texting.RcsContent, config : TextingConfig.Config ) : Texting.Provider | undefined
    {
        const enabled : Array<Texting.Provider> = Object.values( config.providers )
            .filter( ( entry : TextingConfig.ProviderEntry ) : boolean => entry.enabled )
            .map( ( entry : TextingConfig.ProviderEntry ) : Texting.Provider => entry.provider );

        const ordered : Array<Texting.Provider> = enabled.includes( config.defaultProvider )
            ? [ config.defaultProvider, ...enabled.filter( ( provider : Texting.Provider ) : boolean => provider !== config.defaultProvider ) ]
            : enabled;

        return ordered.find( ( provider : Texting.Provider ) : boolean => this.fitsRcs( provider, content ) );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // does this ONE provider's adapter + rcsLimits actually accommodate the content (card count, carousel
    // support, suggestions-per-card)? undefined `rcsLimits` (no RCS wiring yet) never qualifies.
    private fitsRcs( provider : Texting.Provider, content : Texting.RcsContent ) : boolean
    {
        const adapter : SmsProvider | undefined = this.get( provider );
        if( adapter === undefined || !adapter.capabilities.has( Texting.MessageType.RCS ) || adapter.rcsLimits === undefined ) return false;

        const cards : Array<Texting.RcsCard> = content.cards ?? [ content ];
        if( cards.length > 1 && !adapter.rcsLimits.carousel ) return false;
        if( adapter.rcsLimits.maxCards !== undefined && cards.length > adapter.rcsLimits.maxCards ) return false;

        const maxSuggestions : number | undefined = adapter.rcsLimits.maxSuggestions;
        if( maxSuggestions === undefined ) return true;
        return !cards.some( ( card : Texting.RcsCard ) : boolean =>
            ( ( card.suggestedReplies?.length ?? 0 ) + ( card.suggestedActions?.length ?? 0 ) ) > maxSuggestions );
    }
}

export default SmsFactory;
// eof
