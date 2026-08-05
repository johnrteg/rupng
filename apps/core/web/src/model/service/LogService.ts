//
// Web logger. Delegates to the shared @repo/common `Trace` so the browser console emits the SAME
// structured JSON records as the Node services — which the console's in-app browser (Run tab) then
// colors + filters by level (and Claude can read). First arg = message; the rest become record args.
//
import { Trace } from "@repo/common";

export class LogService
{
    // Web's "per-service configuration" is the build-time VITE_LOG_LEVEL env var (like the backend's
    // CloudManifest `environment.LOG_LEVEL`) — defaults to INFO (trace off) when unset/unrecognized.
    public level : LogService.Level = LogService.levelFromEnv( ( import.meta as any ).env?.VITE_LOG_LEVEL );

    // Trace's own minLevel stays at INFO; LogService.level gates here so TRACE/NONE still work.
    private logger : Trace = new Trace( "web", "web" );

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
    public trace( ...args : Array<any> ) : void
    {
        if( this.level <= LogService.Level.TRACE )
            this.logger.trace( LogService.message( args ), ...args.slice( 1 ) );
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////////////////
    public info( ...args : Array<any> ) : void
    {
        if( this.level <= LogService.Level.INFO )
            this.logger.info( LogService.message( args ), ...args.slice( 1 ) );
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////////////////
    public warn( ...args : Array<any> ) : void
    {
        if( this.level <= LogService.Level.WARNING )
            this.logger.warn( LogService.message( args ), ...args.slice( 1 ) );
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////////////////
    public error( ...args : Array<any> ) : void
    {
        if( this.level <= LogService.Level.ERROR )
            this.logger.error( LogService.message( args ), ...args.slice( 1 ) );
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

    /** Parse the build-time `VITE_LOG_LEVEL` value into a {@link LogService.Level}; unrecognized/absent → INFO. */
    export function levelFromEnv( value : string | undefined ) : LogService.Level
    {
        switch( ( value ?? "" ).trim().toUpperCase() )
        {
            case "TRACE":   return LogService.Level.TRACE;
            case "INFO":    return LogService.Level.INFO;
            case "WARN":
            case "WARNING": return LogService.Level.WARNING;
            case "ERROR":   return LogService.Level.ERROR;
            case "NONE":    return LogService.Level.NONE;
            default:        return LogService.Level.INFO;
        }
    }

    export enum Level
    {
        TRACE   = 0,   // more verbose than INFO — routine activity, off by default
        INFO    = 1,
        WARNING = 2,
        ERROR   = 3,
        NONE    = 99    // silence everything
    }
}

export default LogService;
