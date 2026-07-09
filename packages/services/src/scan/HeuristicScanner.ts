//
import { ResultUtils, type Type } from "@repo/common";
import { Scanner } from "./Scanner";

//
// HeuristicScanner — a zero-infrastructure, first-line malware check (Scanner.Provider.HEURISTIC). NOT a full
// antivirus (that's ClamAV), but a REAL scan that runs anywhere with no daemon/service: it detects the
// industry-standard EICAR antivirus test file and flags executables uploaded as content (a PE/ELF/Mach-O or
// shell script has no business being an image/video/audio/document/contact import). Good enough to exercise
// the whole quarantine path + catch the obvious cases; switch to ClamAV for signature-grade coverage.
//
export class HeuristicScanner implements Scanner
{
    public readonly provider : Scanner.Provider = Scanner.Provider.HEURISTIC;

    // the canonical EICAR test-file marker (the standard string every AV flags) — a substring match anywhere
    // in the head of the file identifies the test file (the full file is 68 bytes)
    private static readonly EICAR_MARKER : string = "EICAR-STANDARD-ANTIVIRUS-TEST-FILE";

    // how many leading bytes to inspect for the EICAR marker (it lives at the very start of a test file)
    private static readonly HEAD_BYTES : number = 1024;

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Inspect the bytes. Never throws — always returns ok:true with a verdict (there's no external engine to
     *  be unreachable). Clean unless the EICAR marker or an executable signature is found. */
    public scan( bytes : Uint8Array, _filename? : string ) : Promise<Type.Result<Scanner.Verdict>>
    {
        // 1. EICAR test file — the universal "is scanning wired?" probe; treat as a detection
        const head : string = Buffer.from( bytes.slice( 0, HeuristicScanner.HEAD_BYTES ) ).toString( "latin1" );
        if( head.includes( HeuristicScanner.EICAR_MARKER ) )
            return Promise.resolve( ResultUtils.ok( { clean: false, engine: "heuristic", threat: "Eicar-Test-Signature" } ) );

        // 2. executable magic bytes — a content upload that's actually a binary/script is suspicious
        const executable : string | undefined = HeuristicScanner.executableKind( bytes );
        if( executable )
            return Promise.resolve( ResultUtils.ok( { clean: false, engine: "heuristic", threat: `Heuristic.Executable.${ executable }` } ) );

        // otherwise: no first-line indicators
        return Promise.resolve( ResultUtils.ok( { clean: true, engine: "heuristic" } ) );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // classify the leading magic bytes as a known executable format, or undefined when it isn't one
    private static executableKind( bytes : Uint8Array ) : string | undefined
    {
        if( bytes.length < 4 ) return undefined;
        const b0 : number = bytes[ 0 ], b1 : number = bytes[ 1 ], b2 : number = bytes[ 2 ], b3 : number = bytes[ 3 ];
        if( b0 === 0x4d && b1 === 0x5a ) return "PE";                                      // "MZ" — Windows PE/DOS
        if( b0 === 0x7f && b1 === 0x45 && b2 === 0x4c && b3 === 0x46 ) return "ELF";        // 0x7F "ELF" — Linux
        if( b0 === 0x23 && b1 === 0x21 ) return "Script";                                  // "#!" — shell script shebang
        // Mach-O (macOS) — 32/64-bit + universal ("fat") binaries, big/little endian
        const macho : Array<Array<number>> = [ [ 0xfe, 0xed, 0xfa, 0xce ], [ 0xfe, 0xed, 0xfa, 0xcf ], [ 0xcf, 0xfa, 0xed, 0xfe ], [ 0xca, 0xfe, 0xba, 0xbe ] ];
        if( macho.some( ( magic : Array<number> ) : boolean => magic[ 0 ] === b0 && magic[ 1 ] === b1 && magic[ 2 ] === b2 && magic[ 3 ] === b3 ) ) return "MachO";
        return undefined;
    }
}

export default HeuristicScanner;
