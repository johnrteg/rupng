//
// Web logger. Delegates to the shared @repo/common `Trace` so the browser console emits the SAME
// structured JSON records as the Node services — which the console's in-app browser (Run tab) then
// colors + filters by level (and Claude can read). First arg = message; the rest become record args.
//
import { Trace } from "@repo/common";

export class LogService
{
    public level : LogService.Level = LogService.Level.INFO;

    // Trace's own minLevel stays at INFO; LogService.level gates here so DEBUG/NONE still work.
    private trace : Trace = new Trace( "web", "web" );

    //////////////////////////////////////////////////////////////////////////////////////////////////////////////
    constructor()
    {
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////////////////
    public makeEmpty() : void
    {
        this.level = LogService.Level.INFO;
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////////////////
    public debug( ...args : Array<any> ) : void
    {
        // Trace has no DEBUG level — keep debug as a raw console line (verbose, not structured).
        if( this.level <= LogService.Level.DEBUG )
            console.debug( `[${new Date().toISOString()}] [DEBUG]`, ...args );
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////////////////
    public info( ...args : Array<any> ) : void
    {
        if( this.level <= LogService.Level.INFO )
            this.trace.info( LogService.message( args ), ...args.slice( 1 ) );
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////////////////
    public warn( ...args : Array<any> ) : void
    {
        if( this.level <= LogService.Level.WARNING )
            this.trace.warn( LogService.message( args ), ...args.slice( 1 ) );
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////////////////
    public error( ...args : Array<any> ) : void
    {
        if( this.level <= LogService.Level.ERROR )
            this.trace.error( LogService.message( args ), ...args.slice( 1 ) );
    }
}

export namespace LogService
{
    // First arg is the message (string); coerce non-strings so the record always has a message.
    export function message( args : Array<any> ) : string
    {
        const first : unknown = args[ 0 ];
        return typeof first === "string" ? first : ( first === undefined ? "" : JSON.stringify( first ) );
    }

    export enum Level
    {
        DEBUG   = 0,
        INFO    = 1,
        WARNING = 2,
        ERROR   = 3,
        NONE    = 99    // silence everything
    }
}

export default LogService;
