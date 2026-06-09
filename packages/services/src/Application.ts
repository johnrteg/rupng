//
import * as os from 'os';

import * as fs from 'fs';

import * as path from 'path';

import { randomUUID, UUID } from 'crypto';

import { Trace }    from './Trace';

import { CloudResolver, Environment } from '@repo/cloud-spec';
import { AppConfig }   from './aws/AppConfig';
import { Kms }         from './aws/Kms';


export class Application
{
    protected   id      : UUID;
    public      log       : Trace;
    protected   nbr_cpus  : number;
    protected   readonly serviceName : string;

    // Lazily-created cloud access. The base carries only what's common to EVERY Service and
    // Job (the resolver + config + keys); concrete services wire the facades they need.
    private _cloud?     : CloudResolver;
    private _appConfig? : AppConfig;
    private _kms?       : Kms;

    ////////////////////////////////////////////////////////////////////////
    constructor( name : string )
    {
        this.serviceName = name;
        this.id         = randomUUID();
        this.log        = new Trace( name, this.id );
        this.nbr_cpus   = os.cpus().length;

        this.bindCallbacks();
    }

    // TODO(monitor): transaction-id (request) correlation — a cross-cutting capability the
    // monitor service depends on (see apps/core/monitor/SPECS.md "Tracing & correlation").
    // Today `this.id` / `Trace.id` is ONE process-level UUID; there is no per-request id.
    // Add to this base so every service threads it automatically (no per-service code):
    //   1. Inbound (Service): read `x-transactionid` from the request (API Gateway injects it via
    //      integration mapping); FALL BACK to a generated id when absent.
    //   2. Inbound (Job): read the transaction id off the SQS message attribute / event detail.
    //   3. Per-request logger: spawn a child Trace carrying that id so every log line correlates
    //      (the current single app-scoped Trace can't distinguish concurrent requests).
    //   4. Outbound: propagate the id on every downstream call — HTTP header, SQS message
    //      attribute, EventBridge detail — so the chain stays linked across services.
    // The job-run ledger (monitor) and X-Ray (`X-Amzn-Trace-Id`) both key off this id.

    //
    // cloud access (lazy) — pass cloud-spec LOGICAL keys; facades resolve physical ids
    // from the env vars the /cloud build injected. Drop to `<facade>.client` for raw SDK.
    //
    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////
    /** Runtime resolver: cloud-spec logical resource keys -> physical ids. */
    protected get cloud() : CloudResolver
    {
        return this._cloud ??= new CloudResolver( ( process.env.ENVIRONMENT as Environment ) ?? Environment.DEV, this.serviceName );
    }

    /** AppConfig facade — runtime config + feature flags. Common to all services + jobs. */
    protected get appConfig() : AppConfig { return this._appConfig ??= new AppConfig( this.cloud ); }

    /** KMS facade — encrypt/decrypt + envelope data keys. Common to all services + jobs. */
    protected get kms() : Kms { return this._kms ??= new Kms( this.cloud ); }

    //
    // Everything else (S3, SQS, SNS, Secrets, EventBridge, Kafka, Dynamo, …) is wired by the
    // concrete Service/Job that needs it, e.g.:
    //
    //   import { S3 } from "@repo/services";
    //   class MediaService extends Service {
    //       private _s3? : S3;
    //       protected get s3() : S3 { return this._s3 ??= new S3( this.cloud ); }
    //   }
    //
    // A facade that proves common to most services can migrate up here (or to Service/Job).
    //

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
    // Overridable hook for binding instance callbacks. Long-running subclasses (Service) bind
    // their signal handlers here; the base does nothing so short-lived contexts (Job/Lambda)
    // don't install process-level handlers.
    protected bindCallbacks() : void
    {
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////
    // allow inherited servies to perform clean up on exit
    // like cleaning up database connections
    protected async aboutToQuit() : Promise<void>
    {
    }

    ///////////////////////////////////////////////////////////////////////////////////
    public readJsonFile<T = any>( path : string, default_value: T ) : T
    {
        try
        {
            if( fs.existsSync( path ) )
                return JSON.parse( fs.readFileSync( path, "utf8") );

            this.log.error( "readJsonFile path not found", { path: path, cwd: process.cwd() } );
        }
        catch( err : any )
        {
            // file exists but contained malformed JSON (or could not be read) - fall back
            this.log.error( "readJsonFile parse failed", { path: path, err: err } );
        }

        return default_value;
    }

    ///////////////////////////////////////////////////////////////////////////////////
    // Loads the nearest package.json by walking up from the caller's directory. Subclasses
    // pass their own __dirname so resolution is relative to the concrete app's compiled
    // location (not this base file), and works whether called from bin/ or a nested folder:
    //
    //   this.pkg = this.loadPackageInfo( __dirname );
    //
    public loadPackageInfo( fromDir : string ) : Application.PackageInfo
    {
        const fallback : Application.PackageInfo = { name: 'unknown', version: '0.0.0' };

        let dir : string = fromDir;
        while( true )
        {
            const candidate : string = path.join( dir, 'package.json' );
            if( fs.existsSync( candidate ) )
                return this.readJsonFile<Application.PackageInfo>( candidate, fallback );

            const parent : string = path.dirname( dir );
            if( parent === dir ) break;     // reached the filesystem root
            dir = parent;
        }

        this.log.error( "loadPackageInfo: no package.json found", { fromDir: fromDir } );
        return fallback;
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
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////////////////
    protected async start() : Promise<void>
    {
    }

    /////////////////////////////////////////////////////////////////////////////////////////////
    public async run() : Promise<void>
    {
        try
        {
            this.log.info("RUN");
            await this.config();
            await this.init();
            await this.start();
        }
        catch( err : any )
        {
            // log a single consistent diagnostic, then re-throw so the caller decides recovery
            // (Job propagates to AWS; Service fails fast and exits). The base never swallows or
            // exits here, so it stays free of any process-lifecycle assumptions.
            this.log.error("run: bootstrap failed", err );
            throw err;
        }
    }

}

export namespace Application
{
    export const ID_DIVIDER : string = ':';

    // extended by inherited services
    export interface Config
    {
    }

    // a subset of package.json fields; the index signature keeps any other fields accessible
    export interface PackageInfo
    {
        name    : string;
        version : string;
        [key: string]: any;
    }
}

export default Application;
// eof