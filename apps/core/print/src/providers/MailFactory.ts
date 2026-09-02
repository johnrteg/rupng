//
import { Print } from "@repo/api";

import { MailProvider } from "./MailProvider";
import { FakeMailAdapter } from "./adapters/FakeMailAdapter";
import { PostGridMailAdapter } from "./adapters/PostGridMailAdapter";
import { LobMailAdapter } from "./adapters/LobMailAdapter";

//
// MailFactory — the registry of mail-fulfillment adapters (print-3.1/9.5), mirroring VoiceFactory
// (apps/core/voice/src/providers/VoiceFactory.ts): a `Map<Provider, make>` seeded with the built-ins and
// extended via `register()`. Adding a partner (print-3.1) = register an adapter; no call site changes.
//
export class MailFactory
{
    private readonly registry : Map<Print.Provider, () => MailProvider> = new Map<Print.Provider, () => MailProvider>( [
        [ Print.Provider.POSTGRID, () => new PostGridMailAdapter() ],
        [ Print.Provider.LOB,      () => new LobMailAdapter() ],
        [ Print.Provider.FAKE,     () => new FakeMailAdapter() ],
    ] );

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Register (or replace) an adapter — add a provider without editing call sites. */
    public register( provider : Print.Provider, make : () => MailProvider ) : void { this.registry.set( provider, make ); }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Instantiate one provider's adapter, or undefined if none is registered. */
    public get( provider : Print.Provider ) : MailProvider | undefined
    {
        const make : ( () => MailProvider ) | undefined = this.registry.get( provider );
        return make ? make() : undefined;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Every registered provider id (for listing/enablement). */
    public providers() : Array<Print.Provider> { return [ ...this.registry.keys() ]; }
}

export default MailFactory;
// eof
