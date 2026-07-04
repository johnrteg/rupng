//
import { Readable } from "node:stream";
import { ResultUtils, type Type } from "@repo/common";
import { MediaConfig } from "@repo/api";
import NodeClam from "clamscan";
import type { MalwareScanner } from "./MalwareScanner";

/** The clamscan engine handle (from NodeClam.init) — the slice of its API we use. */
type ClamEngine = { scanStream( stream : Readable ) : Promise<{ isInfected : boolean | null; viruses : Array<string> }> };

//
// ClamAvScanner — scans bytes against a ClamAV `clamd` daemon (a sidecar/container) via the `clamscan` npm.
// The daemon holds the loaded signature DB; we stream the bytes to it and read back an infected/clean verdict.
// The `clamscan` module + `clamd` are optional at runtime, so the module is dynamically imported and the
// engine handle is created lazily + cached; any failure (module missing, daemon unreachable) surfaces as an
// `ok:false` Result so the pipeline can fail-closed — this adapter never throws.
//
export class ClamAvScanner implements MalwareScanner
{
    public readonly provider : MediaConfig.ScanProvider = MediaConfig.ScanProvider.CLAMAV;

    // the initialized clamscan engine handle, created once on first scan and reused
    private engine : ClamEngine | undefined;

    ////////////////////////////////////////////////////////////////////////////////////////////
    constructor( private readonly clamd : MediaConfig.ClamdConnection ) {}

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Lazily create + cache the clamscan engine bound to our `clamd` (daemon path, no local-binary fallback). */
    private async getEngine() : Promise<ClamEngine>
    {
        if( this.engine ) return this.engine;
        const initialized : ClamEngine = await new NodeClam().init( {
            clamdscan: { host: this.clamd.host, port: this.clamd.port, timeout: this.clamd.timeoutMs ?? 30000, localFallback: false },
            clamscan:  { active: false },   // force the daemon path (no local binary fallback)
            removeInfected: false, debugMode: false,
        } );
        this.engine = initialized;
        return this.engine;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Stream the bytes to clamd and map its result to a Verdict. A null `isInfected` (indeterminate) is a
     *  failure — surfaced as `ok:false` so the caller fail-closes rather than treating "unknown" as clean. */
    public scan( bytes : Uint8Array, _filename? : string ) : Promise<Type.Result<MalwareScanner.Verdict>>
    {
        return ResultUtils.from( async () : Promise<MalwareScanner.Verdict> =>
        {
            const engine : ClamEngine = await this.getEngine();
            const outcome : { isInfected : boolean | null; viruses : Array<string> } = await engine.scanStream( Readable.from( Buffer.from( bytes ) ) );
            if( outcome.isInfected === null ) throw new Error( "clamav returned an indeterminate result" );
            return { clean: !outcome.isInfected, engine: "clamav", threat: outcome.viruses?.[ 0 ] };
        } );
    }
}

export default ClamAvScanner;
