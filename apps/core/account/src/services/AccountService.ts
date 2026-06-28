//
import { Application, Service, Ports, Register, Dynamo, Kafka } from "@repo/services";
import { AccountConfig } from "@repo/api";

//
// common account server base — accounts, hierarchy, membership, plans/pricing, subscriptions,
// invoicing, usage, and the block list. Every concrete role extends this.
//
export class AccountService extends Service
{
    // AWS facades this service owns (resolved against this service's CloudManifest):
    private _dynamo? : Dynamo;
    private _kafka?  : Kafka;

    ///////////////////////////////////////////////////////////////////////////////////////
    constructor( role : AccountService.Role )
    {
        // identity = Register.Service.ACCOUNT (+ role → "account:main"); default to this role's port in
        // the ACCOUNT block for local dev; a deploy's env PORT overrides it
        super( Register.Service.ACCOUNT, role, AccountService.PORT[ role ] );

        // __dirname resolves to apps/core/account/bin/services at runtime; loadPackageInfo walks up to
        // the nearest package.json (apps/core/account/package.json)
        const pkg : Application.PackageInfo = this.loadPackageInfo( __dirname );
        this.setVersion( pkg.version );
        this.log.info( "version", { name: pkg.name, version: pkg.version } );
    }

    ///////////////////////////////////////////////////////////////////////////////////////
    /** Dynamo facade — the account tables (keyed by the logical table keys in CloudManifest). Lazy + cached. */
    public get dynamo() : Dynamo { return this._dynamo ??= new Dynamo( this.cloud ); }

    /** Kafka facade — consumes auth.user, publishes account.account events. Lazy + cached. */
    public get kafka() : Kafka { return this._kafka ??= new Kafka( this.cloud ); }

    ///////////////////////////////////////////////////////////////////////////////////////
    protected async init() : Promise<void>
    {
        super.init();

        // Ensure the runtime config (AppConfig config/settings) exists — seed a fresh environment with
        // AccountConfig.SEED so the service (and the Console Config tab) have usable defaults.
        const seeded = await this.appConfig.ensureSeeded( "config", "settings", AccountConfig.SEED );
        if( seeded.ok ) this.log.info( "account config ready" );
        else this.log.warn( "account config seed failed — using SEED until deployed", { error: seeded.error } );
    }
}

export namespace AccountService
{
    export enum Role
    {
        MAIN = "main",   // authed BFF — account CRUD, members, plans, subscriptions, billing ops
        READ = "read",   // read-only — lookups, entitlement resolution (scales independently)
    }

    // role → its absolute port in the ACCOUNT block. The numbers live ONLY in @repo/services Ports;
    // the manifest's containerPort references the SAME constants, so the two can never drift.
    export const PORT : Record<Role, number> =
    {
        [ Role.MAIN ] : Ports.ACCOUNT.MAIN,
        [ Role.READ ] : Ports.ACCOUNT.READ,
    };
}

export default AccountService;
