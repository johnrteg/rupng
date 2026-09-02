//
import { Job, Register, Dynamo, S3 } from "@repo/services";
import type { Type } from "@repo/common";
import { Audit } from "../AuditModel";
import { AuditHashChain } from "../AuditHashChain";

//
// AuditJob — the domain base every concrete audit Job extends (mirrors AuditService on the HTTP side).
// Holds the shared facades (hot DDB + S3 archive) + the hash-chain STAMPING logic (audit-3.2) — the
// single most correctness-critical piece of the whole service, so it lives ONCE here. (Verifying a
// chain on read is the mirror operation, needed by `AuditService` instead — see `AuditHashChain`, the
// pure-function module both domain bases share, since `Job` and `Service` don't share an ancestor
// below `Application`.)
//
export abstract class AuditJob<TEvent = unknown, TResult = void> extends Job<TEvent, TResult>
{
    private _dynamo? : Dynamo;
    private _s3?      : S3;

    ///////////////////////////////////////////////////////////////////////////////////////
    constructor( jobName : string )
    {
        super( Register.Service.AUDIT, jobName );
    }

    ///////////////////////////////////////////////////////////////////////////////////////
    protected get dynamo() : Dynamo { return this._dynamo ??= new Dynamo( this.cloud ); }
    protected get s3()     : S3     { return this._s3     ??= new S3( this.cloud ); }

    ///////////////////////////////////////////////////////////////////////////////////////
    /** Zero-padded seq sort key — re-exported for callers that only need the key, not the hashing. */
    public static eventSk( seq : number ) : string { return AuditHashChain.eventSk( seq ); }

    ///////////////////////////////////////////////////////////////////////////////////////
    /** Structural validation of an inbound envelope (audit-2.1) — the minimal required fields every
     *  sink needs. Never throws; a malformed message is a `Type.Result` failure the caller logs + skips. */
    protected validate( input : unknown ) : Type.Result<Audit.Event>
    {
        const e = input as Partial<Audit.Event> | null | undefined;
        if( !e || typeof e !== "object" )
            return { ok: false, error: "not an object" };
        if( !e.eventId || !e.occurredAt || !e.accountId || !e.actor || !e.action || !e.target || !e.source || !e.outcome )
            return { ok: false, error: "missing required envelope field" };
        return { ok: true, data: e as Audit.Event };
    }

    ///////////////////////////////////////////////////////////////////////////////////////
    /**
     * Stamp an inbound event with its tenant's next `seq` + hash-chain link (audit-3.2). The single
     * most correctness-critical function in the service:
     *   1. `seq` is allocated via `Dynamo.increment` — an ATOMIC server-side `ADD`, so concurrent
     *      messages for the SAME account never collide on seq (no read-modify-write race).
     *   2. the PRIOR record's hash is read by seq-1's item key. Because seq allocation and item
     *      persistence are two separate steps, a highly-concurrent burst can allocate seq N+1 and
     *      look up seq N before seq N's writer has finished persisting — so this retries briefly
     *      (bounded) rather than assuming a missing predecessor means genesis.
     *   3. `hash = sha256(prevHash + canonical(event))` chains this record to the one before it —
     *      any gap / edit / reorder is detectable by recomputing the chain on verify-on-read.
     */
    protected async stamp( accountId : Type.ID, event : Audit.Event, retentionClass : Audit.RetentionClass ) : Promise<Type.Result<Audit.StoredEvent>>
    {
        const seqResult : Type.Result<number> = await this.dynamo.increment( "events", { accountId, sk: "SEQ" }, "n" );
        if( !seqResult.ok ) return seqResult;
        const seq : number = seqResult.data;

        let prevHash : string = "";
        if( seq > 1 )
        {
            // bounded retry — see step 2 above. 5 attempts / 100ms is generous for an in-region write
            // that's already "in flight", not a real outage backoff.
            for( let attempt : number = 0; attempt < 5; attempt++ )
            {
                const prior : Type.Result<Audit.StoredEvent | undefined> = await this.dynamo.get<Audit.StoredEvent>( "events", { accountId, sk: AuditHashChain.eventSk( seq - 1 ) } );
                if( prior.ok && prior.data ) { prevHash = prior.data.hash; break; }
                if( attempt < 4 ) await new Promise( ( resolve ) => setTimeout( resolve, 100 ) );
                else this.log.warn( "stamp: predecessor not found after retries — chain gap risk", { accountId, seq } );
            }
        }

        const stamped : Audit.StoredEvent =
        {
            ...event,
            seq,
            ingestedAt:     new Date().toISOString(),
            retentionClass,
            prevHash,
            hash: AuditHashChain.hashOf( prevHash, event ),
        };
        return { ok: true, data: stamped };
    }
}

export default AuditJob;
