//
// ResultUtils — build and run {@link Type.Result} values. This is the ONE place a try/catch lives:
// wrap a throwing call in `from`/`attempt` and callers get a typed `{ ok, data } | { ok, error }`
// back instead of an exception they have to remember to catch.
//
import type { Type } from "../Types";

export namespace ResultUtils
{
    /** A successful result carrying the typed `data`. */
    export function ok<T>( data : T ) : Type.Result<T>
    {
        return { ok: true, data };
    }

    /** A failed result with a human-readable `error` (and the optional original `cause`). */
    export function err<T = never>( error : string, cause? : unknown ) : Type.Result<T>
    {
        return { ok: false, error, cause };
    }

    /** Normalize any thrown value to a message (Error → `.message`, else `String(value)`). */
    export function message( cause : unknown ) : string
    {
        return cause instanceof Error ? cause.message : String( cause );
    }

    /**
     * Run an **async** function and capture the outcome as a {@link Type.Result} — the throw never
     * escapes. The result's `data` is typed as the function's resolved value.
     * @example const r = await ResultUtils.from( () => client.send( cmd ) ); if ( r.ok ) use( r.data );
     */
    export async function from<T>( fn : () => Promise<T> ) : Promise<Type.Result<T>>
    {
        try { return { ok: true, data: await fn() }; }
        catch ( cause : unknown ) { return { ok: false, error: message( cause ), cause }; }
    }

    /** Run a **synchronous** function and capture the outcome as a {@link Type.Result}. */
    export function attempt<T>( fn : () => T ) : Type.Result<T>
    {
        try { return { ok: true, data: fn() }; }
        catch ( cause : unknown ) { return { ok: false, error: message( cause ), cause }; }
    }
}

export default ResultUtils;
