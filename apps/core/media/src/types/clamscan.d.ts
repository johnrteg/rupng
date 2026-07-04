//
// Minimal ambient declaration for the `clamscan` npm (no bundled or @types typings) — just the slice the
// ClamAvScanner uses: init a daemon-backed engine and stream bytes to it for a verdict.
//
declare module "clamscan"
{
    interface ClamScanResult { file : string | null; isInfected : boolean | null; viruses : Array<string>; }

    interface ClamScanEngine
    {
        scanStream( stream : import( "node:stream" ).Readable ) : Promise<ClamScanResult>;
    }

    export default class NodeClam
    {
        init( options : object ) : Promise<ClamScanEngine>;
    }
}
