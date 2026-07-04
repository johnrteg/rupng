//
import { ResultUtils, type Type } from "@repo/common";
import { MediaConfig } from "@repo/api";
import type { MalwareScanner } from "./MalwareScanner";

//
// NoopScanner — the pass-through stub (MediaConfig.ScanProvider.NONE). Reports every file clean; used in dev
// or wherever a real engine isn't wired. Kept as a real adapter (not a null) so the pipeline path is identical
// whether or not scanning is on — only the verdict differs.
//
export class NoopScanner implements MalwareScanner
{
    public readonly provider : MediaConfig.ScanProvider = MediaConfig.ScanProvider.NONE;

    /** Always clean — no real inspection is performed. */
    public scan( _bytes : Uint8Array, _filename? : string ) : Promise<Type.Result<MalwareScanner.Verdict>>
    {
        return Promise.resolve( ResultUtils.ok( { clean: true, engine: "noop" } ) );
    }
}

export default NoopScanner;
