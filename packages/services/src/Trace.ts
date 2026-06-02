//

export class Trace
{
    private name : string;
    private id : string;

    ///////////////////////////////////////////////////////////////////////
    constructor( name : string, id : string )
    {
        this.name = name;
        this.id = id;
    }

    /////////////////////////////////////////////////////////////////////////////////////
    private header( level : Trace.Level ) : Trace.Data
    {
        let level_name : string = "UNKNOWN";
        switch( level )
        {
            case Trace.Level.INFO:    level_name = "INFO"; break;
            case Trace.Level.WARNING: level_name = "WARN"; break;
            case Trace.Level.ERROR:   level_name = "ERROR"; break;
        }
        return { level : level_name, time: new Date().toISOString(), name : this.name, id : this.id };
    }

    /////////////////////////////////////////////////////////////////////////////////////
    public info( message: string, ...args: unknown[] ) : void
    {
        console.log( JSON.stringify( this.header(Trace.Level.INFO) ), message, ...args );
    }

    /////////////////////////////////////////////////////////////////////////////////////
    public warn( message: string, ...args: unknown[] ) : void
    {
        console.log( JSON.stringify( this.header(Trace.Level.WARNING) ), message, ...args );
    }

    /////////////////////////////////////////////////////////////////////////////////////
    public error( message: string, ...args: unknown[] ) : void
    {
        console.log( JSON.stringify( this.header(Trace.Level.ERROR) ), message, ...args );
    }
}

export namespace Trace
{
    export interface Data
    {
        level : string;
        time  : string; // iso
        name  : string;
        id    : string;
    }
    export enum Level
    {
        INFO = 1,
        WARNING = 2,
        ERROR = 3
    }
}

export default Trace;