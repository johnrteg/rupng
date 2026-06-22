//

export class Trace
{
    private name : string;
    private id : string;          // correlation id — currently process-scoped; see TODO below
    private minLevel : Trace.Level;

    // TODO(monitor): `id` will become the per-request TRANSACTION ID, not a single app id.
    // Add a child-logger factory (e.g. `forRequest( transactionId )`) that returns a Trace with
    // the same name/level but a request-scoped id, so concurrent requests stay distinguishable in
    // the logs the monitor service ingests. Wired from Application — see Application.ts constructor.

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
    private write( level : Trace.Level, message : string, args : unknown[] ) : void
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

        if( args.length > 0 )record.args = args.map( Trace.serializeArg );

        const line : string = JSON.stringify( record );

        if( level >= Trace.Level.WARNING )
            console.error( line );
        else
            console.log( line );
    }

    /////////////////////////////////////////////////////////////////////////////////////
    public info( message: string, ...args: unknown[] ) : void
    {
        this.write( Trace.Level.INFO, message, args );
    }

    /////////////////////////////////////////////////////////////////////////////////////
    public warn( message: string, ...args: unknown[] ) : void
    {
        this.write( Trace.Level.WARNING, message, args );
    }

    /////////////////////////////////////////////////////////////////////////////////////
    public error( message: string, ...args: unknown[] ) : void
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
        id      : string;
        message : string;
        args?   : unknown[];
    }
    export enum Level
    {
        INFO = 1,
        WARNING = 2,
        ERROR = 3
    }
}

export default Trace;
