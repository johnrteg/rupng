//
// AuditHashChain — the pure hash-chain math (audit-3.2), shared by BOTH hierarchies that need it:
// `AuditSinkJob` (via `AuditJob`, which extends `Job`) to STAMP a new record, and `AuditQueryService`
// (via `AuditService`, which extends `Service`) to VERIFY a range on read/export. `Job` and `Service`
// don't share a common ancestor below `Application`, so this lives as plain functions rather than a
// method on either domain base — one canonical implementation, used both places.
//
import { createHash } from "crypto";
import { Audit } from "./AuditModel";

export namespace AuditHashChain
{
    /** Zero-padded seq for lexicographic sort — `sk = "EVT#<seq:012>"`. */
    export function eventSk( seq : number ) : string
    {
        return `EVT#${ String( seq ).padStart( 12, "0" ) }`;
    }

    /** Canonicalize an event for hashing — stable (sorted) key order so the SAME event always hashes
     *  the SAME way regardless of property insertion order. */
    export function canonicalize( event : Audit.Event ) : string
    {
        return JSON.stringify( event, Object.keys( event ).sort() );
    }

    /** `hash = sha256(prevHash + canonical(event))` — this record's chain link. */
    export function hashOf( prevHash : string, event : Audit.Event ) : string
    {
        return createHash( "sha256" ).update( prevHash + canonicalize( event ) ).digest( "hex" );
    }
}

export default AuditHashChain;
// eof
