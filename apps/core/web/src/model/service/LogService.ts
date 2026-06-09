//

export class LogService
{
    public level : LogService.Level = LogService.Level.INFO;

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
    public debug( ...args : any[] ) : void
    {
        if( this.level <= LogService.Level.DEBUG )
            console.debug( this.prefix( "DEBUG" ), ...args );
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////////////////
    public info( ...args : any[] ) : void
    {
        if( this.level <= LogService.Level.INFO )
            console.log( this.prefix( "INFO" ), ...args );
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////////////////
    public warn( ...args : any[] ) : void
    {
        if( this.level <= LogService.Level.WARNING )
            console.warn( this.prefix( "WARN" ), ...args );
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////////////////
    public error( ...args : any[] ) : void
    {
        if( this.level <= LogService.Level.ERROR )
            console.error( this.prefix( "ERROR" ), ...args );
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////////////////
    private prefix( label : string ) : string
    {
        return `[${new Date().toISOString()}] [${label}]`;
    }
}

export namespace LogService
{
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