//
import type { Type } from "@repo/common";

//
// Scanner — the platform's pluggable malware/file-scan contract (SHARED service, media-5). One adapter per
// provider (ClamAV, heuristic, noop), resolved by the {@link ScanFactory} from a service's scan config. Any
// service that ingests bytes (media uploads, contact imports, future importers) scans BEFORE promoting the
// bytes to usable; a threat quarantines them. Adapters NEVER throw — they return a Result so an unreachable
// engine is a handled failure the caller can fail-closed on (keep the item pending + redeliver), not a crash
// that silently drops the gate. Config is neutral (a plain shape) so it isn't coupled to any one service's
// config model.
//
export interface Scanner
{
    /** The provider this adapter implements (matches the config value that selected it). */
    readonly provider : Scanner.Provider;

    /** Scan the given bytes. `ok:true` with a {@link Scanner.Verdict}; `ok:false` when the engine couldn't be
     *  reached / errored (the caller decides fail-open vs fail-closed). Never throws. */
    scan( bytes : Uint8Array, filename? : string ) : Promise<Type.Result<Scanner.Verdict>>;
}

export namespace Scanner
{
    /** The available scan engines — a closed set, one adapter per value in the {@link ScanFactory}. String
     *  values match each service's scan-config provider field so a config maps by value. */
    export enum Provider
    {
        NONE      = "none",       // no real scan (pass-through stub)
        CLAMAV    = "clamav",     // ClamAV signature engine (clamd daemon), via the `clamscan` npm
        HEURISTIC = "heuristic",  // zero-infra magic-byte / EICAR checks (first-line, not full AV)
    }

    /** The outcome of a scan — `clean:false` means a detection (the item is quarantined). */
    export interface Verdict
    {
        clean             : boolean;
        engine            : string;    // the engine that produced the verdict (e.g. "clamav" / "heuristic")
        threat?           : string;    // the signature/threat name when not clean
        signatureVersion? : string;    // the engine's signature DB version, when known
    }

    /** Connection to a ClamAV `clamd` daemon (host/port + timeout). */
    export interface Clamd { host : string; port : number; timeoutMs? : number; }

    /** The scan policy a service passes to the factory. `provider` is a plain string (a service's own
     *  provider enum maps to it by value); `clamd` is only read for the CLAMAV provider. */
    export interface Config
    {
        enabled    : boolean;
        provider   : string;
        failClosed? : boolean;      // read by the CALLER (not the factory) — quarantine/hold vs advance on engine error
        clamd?     : Clamd;
    }
}

export default Scanner;
