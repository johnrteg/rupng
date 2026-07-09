//
import { ResultUtils, type Type } from "@repo/common";
import { Scanner } from "./Scanner";

//
// NoopScanner — the pass-through stub (Scanner.Provider.NONE). Reports every file clean; used when scanning is
// disabled or a provider has no adapter. Kept as a real adapter (not a null) so the ingest path is identical
// whether or not scanning is on — only the verdict differs. `engine: "noop"` marks that no real inspection ran.
//
export class NoopScanner implements Scanner
{
    public readonly provider : Scanner.Provider = Scanner.Provider.NONE;

    /** Always clean — no real inspection is performed. */
    public scan( _bytes : Uint8Array, _filename? : string ) : Promise<Type.Result<Scanner.Verdict>>
    {
        return Promise.resolve( ResultUtils.ok( { clean: true, engine: "noop" } ) );
    }
}

export default NoopScanner;
