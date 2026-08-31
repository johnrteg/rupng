//
import { Report } from "@repo/api";

import { Destination } from "./Destination";
import { DownloadDestination } from "./DownloadDestination";
import { EmailDestination } from "./EmailDestination";
import { WebhookDestination } from "./WebhookDestination";

//
// DestinationFactory — the registry of destination handlers, keyed by `Report.DestinationKind`. Mirrors
// VoiceFactory / GeneratorFactory's `Map<key, make>` + `register()`/`get()` shape.
//
export class DestinationFactory
{
    private readonly registry : Map<Report.DestinationKind, () => Destination> = new Map<Report.DestinationKind, () => Destination>( [
        [ Report.DestinationKind.DOWNLOAD, () => new DownloadDestination() ],
        [ Report.DestinationKind.EMAIL,    () => new EmailDestination() ],
        [ Report.DestinationKind.WEBHOOK,  () => new WebhookDestination() ],
    ] );

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Register (or replace) a destination handler — add a kind without editing call sites. */
    public register( kind : Report.DestinationKind, make : () => Destination ) : void { this.registry.set( kind, make ); }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Instantiate one destination kind's handler, or undefined if none is registered. */
    public get( kind : Report.DestinationKind ) : Destination | undefined
    {
        const make : ( () => Destination ) | undefined = this.registry.get( kind );
        return make ? make() : undefined;
    }
}

export default DestinationFactory;
// eof
