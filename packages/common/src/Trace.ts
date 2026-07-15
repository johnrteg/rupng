//
// Structured, level-tagged logger shared by Node services AND the browser web app (it only uses
// console + JSON, so it's environment-agnostic). Emits ONE parseable JSON record per event so log
// consumers (the monitor service, the console's Trace LogView) can color + filter by level. Lives in
// @repo/common so every layer formats logs identically; @repo/services re-exports it for back-compat.
//

export class Trace
{
    private name : string;
    private id : string;          // the PROCESS/service-instance id (stable for the running service)
    private minLevel : Trace.Level;

    // Request correlation: rather than a per-request child logger threaded through every call site, the
    // shared logger reads the current request's transaction id from an ambient CONTEXT PROVIDER (set by the
    // runtime — @repo/services wires it to an AsyncLocalStorage). Every log line then carries `txn` = the
    // transaction id for that request/event, so logs correlate across services (console trace / CloudWatch
    // Logs Insights). Browser-safe: no node deps here; the provider is optional and defaults to none.
    private static contextProvider? : () => Trace.Context | undefined;

    /** Install the ambient request-context source (the runtime does this once, e.g. from Application). */
    public static setContextProvider( provider : () => Trace.Context | undefined ) : void
    {
        Trace.contextProvider = provider;
    }

    ///////////////////////////////////////////////////////////////////////
    constructor( name : string, id : string, minLevel : Trace.Level = Trace.Level.INFO )
    {
        this.name     = name;
        this.id       = id;
        this.minLevel = minLevel;
    }

    /////////////////////////////////////////////////////////////////////////////////////
    private static label( level : Trace.Level ) : string
    {
        switch( level )
        {
            case Trace.Level.INFO:    return "INFO";
            case Trace.Level.WARNING: return "WARN";
            case Trace.Level.ERROR:   return "ERROR";
            default:                  return "UNKNOWN";
        }
    }

    /////////////////////////////////////////////////////////////////////////////////////
    // Error fields are non-enumerable, so they vanish under JSON.stringify - pull out the
    // useful parts explicitly so they survive in the structured record.
    private static serializeArg( arg : unknown ) : unknown
    {
        if( arg instanceof Error )
            return { name: arg.name, message: arg.message, stack: arg.stack };
        return arg;
    }

    /////////////////////////////////////////////////////////////////////////////////////
    // Emits one parseable JSON record per event. INFO -> stdout; WARN/ERROR -> stderr so
    // operators can split and alert on the two streams.
    private write( level : Trace.Level, message : string, args : Array<unknown> ) : void
    {
        if( level < this.minLevel ) return;

        const record : Trace.Data =
        {
            level   : Trace.label( level ),
            time    : new Date().toISOString(),
            name    : this.name,
            id      : this.id,
            message : message,
        };

        // stamp the current request/event transaction id (when the runtime provides one) so log lines correlate
        const context : Trace.Context | undefined = Trace.contextProvider?.();
        if( context?.transactionId ) record.txn = context.transactionId;

        if( args.length > 0 )record.args = args.map( Trace.serializeArg );

        const line : string = JSON.stringify( record );

        if( level >= Trace.Level.WARNING )
            console.error( line );
        else
            console.log( line );
    }

    /////////////////////////////////////////////////////////////////////////////////////
    public info( message: string, ...args: Array<unknown> ) : void
    {
        this.write( Trace.Level.INFO, message, args );
    }

    /////////////////////////////////////////////////////////////////////////////////////
    public warn( message: string, ...args: Array<unknown> ) : void
    {
        this.write( Trace.Level.WARNING, message, args );
    }

    /////////////////////////////////////////////////////////////////////////////////////
    public error( message: string, ...args: Array<unknown> ) : void
    {
        this.write( Trace.Level.ERROR, message, args );
    }
}

export namespace Trace
{
    export interface Data
    {
        level   : string;
        time    : string; // iso
        name    : string;
        id      : string;         // process / service-instance id
        txn?    : string;         // request/event transaction id (correlation across services) when in a request context
        message : string;
        args?   : Array<unknown>;
    }

    /** Ambient per-request context the logger reads (supplied by the runtime via {@link setContextProvider}). */
    export interface Context
    {
        transactionId? : string;
    }
    export enum Level
    {
        INFO = 1,
        WARNING = 2,
        ERROR = 3
    }
}

export default Trace;
