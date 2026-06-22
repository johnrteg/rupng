//
import { Application, Service, Ports, Register } from "@repo/services";

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
        maxUploadSize : { texting : number };
    }

    export const InitConfig : Config = { maxUploadSize : { texting : 750_000 } };
}

export default AppService;
