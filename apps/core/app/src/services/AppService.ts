//
import { Application, Service, Ports, Register, Kafka } from "@repo/services";
import { GetBootstrap } from "@repo/api";

//
// common app (BFF) server base — the domain base every concrete app role extends.
// Holds the shared domain code (aggregation client, Host→account + tenant guard, flag
// merge, sanitizeHtml, notices repo, ticket factory, telemetry scrub) as it lands; see
// SPECS.md "Service & Job topology". NOT deployed alone (health-only if instantiated).
//
export class AppService extends Service
{
    // name/version of this app, read from apps/core/app/package.json at startup
    //protected pkg : Application.PackageInfo;

    // Kafka facade — the app BFF consumes upstream entity events (account.account, auth.user) to keep
    // its read models / caches warm. Lazy + cached.
    private _kafka? : Kafka;
    public get kafka() : Kafka { return this._kafka ??= new Kafka( this.cloud ); }

    ///////////////////////////////////////////////////////////////////////////////////////
    constructor( role : AppService.Role )
    {
        
        // identity = Register.Service.APP (+ role → "app:main"); default to this role's port in the APP block
        // for local dev; a deploy's env PORT overrides it
        super( Register.Service.APP, role, AppService.PORT[ role ] );

        // __dirname resolves to apps/core/app/bin/services at runtime; loadPackageInfo walks
        // up to the nearest package.json (apps/core/app/package.json)
        const pkg : Application.PackageInfo = this.loadPackageInfo( __dirname );
        this.setVersion( pkg.version );

        this.log.info( "version", { name: pkg.name, version: pkg.version } );
    }

    ///////////////////////////////////////////////////////////////////////////////////////
    protected async init() : Promise<void>
    {
        super.init();
    }

    ///////////////////////////////////////////////////////////////////////////////////////
    /**
     * The PUBLIC bootstrap blob (`GetBootstrap.Config`) — read live from AppConfig (profile "web").
     * Falls back to `GetBootstrap.SEED` if it isn't deployed yet / is unreadable. Live read for now;
     * a Redis cache will front this later. This is the WEB config — distinct from the (authed) AppService
     * config wired later.
     */
    public async getWebConfig() : Promise<GetBootstrap.Config>
    {
        const result = await this.appConfig.json<GetBootstrap.Config>( "config", "web" );
        if ( result.ok && result.data !== undefined ) return result.data;
        if ( !result.ok ) this.log.warn( "web config read failed — serving SEED", { error: result.error } );
        return GetBootstrap.SEED;
    }
}

export namespace AppService
{
    export enum Role
    {
        MAIN   = "main",     // authed BFF — UI aggregation, full flags, notices, support glue, ops
        PUBLIC = "public"    // public, edge-fronted — /app/bootstrap, public flags, rate-limited intake
    }

    // role → its absolute port in the APP block. The numbers live ONLY in @repo/services Ports;
    // the manifest's containerPort references the SAME constants, so the two can never drift.
    export const PORT : Record<Role, number> =
    {
        [ Role.MAIN ]   : Ports.APP.MAIN,
        [ Role.PUBLIC ] : Ports.APP.PUBLIC,
    };

    export interface Config
    {
    }

    export const InitConfig : Config = {};
}

export default AppService;
