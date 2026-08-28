//
import { Application, Service, Ports, Register, Dynamo, Sqs, CloudWatch, Ecs } from "@repo/services";
import { ObjectUtils, type Type } from "@repo/common";
import { MonitorConfig } from "@repo/api";

//
// MonitorService — the monitor domain's Service BASE (not deployed alone). Holds the shared
// domain wiring (the cross-service AWS read facades + a short-TTL in-process cache) so the
// concrete role (MonitorMainService) inherits it. v1 reads other services' resources LIVE by
// physical identifier — no owned tables/queues, no Firehose/OpenSearch pipeline (see SPECS.md
// for that later phase).
//
export class MonitorService extends Service
{
    private _dynamo?     : Dynamo;
    private _sqs?        : Sqs;
    private _cloudwatch? : CloudWatch;
    private _ecs?        : Ecs;
    private readonly widgetCache : Map<string, MonitorService.CacheEntry> = new Map();

    ////////////////////////////////////////////////////////////////////////////////////////////
    constructor( role : MonitorService.Role )
    {
        // super( serviceId, role, defaultLocalPort ) — env PORT overrides the default when set.
        super( Register.Service.MONITOR, role, MonitorService.PORT[ role ] );

        // stamp the running version from package.json (walks up from bin/services at runtime)
        const pkg : Application.PackageInfo = this.loadPackageInfo( __dirname );
        this.setVersion( pkg.version );
        this.log.info( "version", { name: pkg.name, version: pkg.version } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Seed the runtime config on a fresh environment so the service (and the Console Config tab)
     *  have usable defaults from first boot. */
    protected override async init() : Promise<void>
    {
        super.init();
        const seeded : Type.Result<MonitorConfig.Config> = await this.appConfig.ensureSeeded( "config", "settings", MonitorConfig.DEFAULT );
        if( seeded.ok ) this.log.info( "monitor config ready" );
        else this.log.warn( "monitor config seed failed — using DEFAULT until deployed", { error: seeded.error } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** DynamoDB facade — `describeTable` reads a table this service doesn't own. Lazy + cached. */
    public get dynamo() : Dynamo { return this._dynamo ??= new Dynamo( this.cloud ); }

    /** SQS facade — `attributesByUrl` reads a queue this service doesn't own. Lazy + cached. */
    public get sqs() : Sqs { return this._sqs ??= new Sqs( this.cloud ); }

    /** CloudWatch facade — metric reads for LAMBDA_JOB/API_TARGET widgets. Lazy + cached. */
    public get cloudwatch() : CloudWatch { return this._cloudwatch ??= new CloudWatch(); }

    /** ECS facade — service task-count reads for ECS_SERVICE widgets. Lazy + cached. */
    public get ecs() : Ecs { return this._ecs ??= new Ecs(); }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** The live runtime config (AppConfig config/settings), deep-filled from DEFAULT so an older/partial
     *  hosted row tolerates schema drift. Exposed so endpoint impls (which can't reach the protected
     *  `appConfig`) read the configured widget list. */
    public async monitorConfig() : Promise<MonitorConfig.Config>
    {
        const got : Type.Result<MonitorConfig.Config | undefined> = await this.appConfig.json<MonitorConfig.Config>( "config", "settings" );
        return got.ok && got.data ? ObjectUtils.withDefaults( got.data, MonitorConfig.DEFAULT ) : MonitorConfig.DEFAULT;
    }

    /** Validate + persist a new MonitorConfig — creates an AppConfig version, then deploys it. */
    public async saveConfig( config : MonitorConfig.Config, environment : string = process.env.APPCONFIG_ENV ?? "default" ) : Promise<Type.Result<void>>
    {
        const profileId : Type.Result<string> = await this.appConfig.profileId( "config", "settings" );
        if( !profileId.ok ) return { ok: false, error: profileId.error };
        const environmentId : Type.Result<string> = await this.appConfig.environmentId( "config", environment );
        if( !environmentId.ok ) return { ok: false, error: environmentId.error };

        const version : Type.Result<number> = await this.appConfig.createVersion( "config", profileId.data, JSON.stringify( config ) );
        if( !version.ok ) return { ok: false, error: version.error };
        const deployed : Type.Result<number> = await this.appConfig.deploy( "config", profileId.data, environmentId.data, version.data, { description: "monitor config update" } );
        if( !deployed.ok ) return { ok: false, error: deployed.error };
        return { ok: true, data: undefined };
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /**
     * Read-through cache for a widget's live query — a widget's `refreshIntervalSec` is also its
     * cache TTL, so a burst of dashboard polls within one interval hits this in-process cache
     * instead of re-querying AWS. v1 keeps this in-process (single MAIN instance today); a shared
     * Redis cache is a later-phase upgrade if monitor ever scales to multiple instances.
     */
    public async cachedWidgetRead<T>( widgetId : string, ttlSec : number, read : () => Promise<T> ) : Promise<T>
    {
        const cached : MonitorService.CacheEntry | undefined = this.widgetCache.get( widgetId );
        const now : number = Date.now();
        if( cached !== undefined && cached.expiresAt > now ) return cached.value as T;

        const value : T = await read();
        this.widgetCache.set( widgetId, { value, expiresAt: now + ttlSec * 1000 } );
        return value;
    }
}

export namespace MonitorService
{
    /** monitor is single-role today: MAIN serves the /monitor/* API. */
    export enum Role { MAIN = "main" }

    /** Default local port per role (also the manifest containerPort — one source, can't drift). */
    export const PORT : Record<Role, number> = { [ Role.MAIN ]: Ports.MONITOR.MAIN };

    /** One in-process cache entry for {@link MonitorService.cachedWidgetRead}. */
    export interface CacheEntry { value : unknown; expiresAt : number; }
}

export default MonitorService;
