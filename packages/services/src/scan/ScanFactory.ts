//
import { Scanner } from "./Scanner";
import { NoopScanner } from "./NoopScanner";
import { ClamAvScanner } from "./ClamAvScanner";
import { HeuristicScanner } from "./HeuristicScanner";

//
// ScanFactory — resolves the active {@link Scanner} from a service's scan config (media-5), mirroring the
// Browse/AI factories: one place maps a provider value to its adapter. Adding an engine (VirusTotal, YARA, …)
// is a single new adapter + case here. When scanning is disabled — or the provider has no adapter — it falls
// back to the pass-through NoopScanner so the ingest path is unchanged. SHARED across every service that scans
// ingested bytes (media, contacts, future importers).
//
export class ScanFactory
{
    // default clamd endpoint when a CLAMAV config omits one
    private static readonly DEFAULT_CLAMD : Scanner.Clamd = { host: "localhost", port: 3310, timeoutMs: 30000 };

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** The scanner for the given scan config: the configured provider's adapter when scanning is enabled, else
     *  the pass-through NoopScanner. `config.provider` is matched by value against {@link Scanner.Provider}. */
    public static forConfig( config : Scanner.Config ) : Scanner
    {
        if( !config.enabled ) return new NoopScanner();
        switch( config.provider )
        {
            case Scanner.Provider.CLAMAV:
                return new ClamAvScanner( config.clamd ?? ScanFactory.DEFAULT_CLAMD );
            case Scanner.Provider.HEURISTIC:
                return new HeuristicScanner();
            case Scanner.Provider.NONE:
            default:
                return new NoopScanner();   // unknown/unset provider → safe pass-through (never blocks ingest silently)
        }
    }
}

export default ScanFactory;
