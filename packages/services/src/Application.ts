//
import * as os from 'os';

import * as fs from 'fs';

import { randomUUID, UUID } from 'crypto';

import { Trace }    from './Trace';



export class Application
{
    protected   id      : UUID;
    public      log       : Trace;
    protected   nbr_cpus  : number;

    ////////////////////////////////////////////////////////////////////////
    constructor( name : string )
    {
        this.id         = randomUUID();
        this.log        = new Trace( name, this.id );
        this.nbr_cpus   = os.cpus().length;
        
        this.bindCallbacks();
    }

    //
    // cloud services
    //
    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////
    protected async getSecret( key : string ) : Promise<string | undefined>
    {
        return undefined;
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////
    protected async getConfig() : Promise<Application.Config>
    {
        return {};
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////
    protected async setConfig( config : Application.Config ) : Promise<boolean>
    {
        return false;
    }

    // add:
    // config notification of change
    //

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////
    protected bindCallbacks() : void
    {
        this.onSignalShutdown   = this.onSignalShutdown.bind( this );
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////
    // allow inherited servies to perform clean up on exit
    // like cleaning up database connections
    protected async aboutToQuit() : Promise<void>
    {
    }

    ////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    private registerSignals() : void
    {
        process.on( 'SIGINT', this.onSignalShutdown );
        process.on( 'SIGTERM', this.onSignalShutdown );
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////
    private onSignalShutdown() : void
    {
        this.log.info('Application::onSignalShutdown (SIGINT or SIGTERM)');
        this.doShutdown();
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////
    private async doShutdown() : Promise<void>
    {
        try
        {
            await this.aboutToQuit();
            this.stop( 0 );
        }
        catch( err : any )
        {
            this.log.error("Error during shutdown", err );
            this.stop(1);
        }
        
    }

    /////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    private stop( code : number ) : void
    {
        this.log.info( "Service shutting down", { code: code } );
        process.exit( code );
    }

    ///////////////////////////////////////////////////////////////////////////////////
    public readJsonFile( path : string, default_value: any ) : any
    {
        if( fs.existsSync( path ) )
            return JSON.parse( fs.readFileSync( path, "utf8"));
        else
        {
            this.log.error( "readJsonFile path not found", { path: path, cwd: process.cwd() } );
            return default_value;
        }   
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////
    protected async config() : Promise<void>
    {
        await this.getConfig();
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////
    // initialize database connection or other states before everything else starts
    protected async init() : Promise<void>
    {
        this.registerSignals();
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////////////////
    protected async start() : Promise<void>
    {
    }

    /////////////////////////////////////////////////////////////////////////////////////////////
    public async run() : Promise<void>
    {
        this.log.info("RUN");
        await this.config();
        await this.init();
        await this.start();
    }

}

export namespace Application
{
    export const ID_DIVIDER : string = ':';

    // extended by inherited services
    export interface Config
    {
    }
}

export default Application;
// eof