//
import { Application, Service, Ports, Register, Dynamo, S3 } from "@repo/services";
import { ObjectUtils, type Type } from "@repo/common";
import { AuditConfig } from "@repo/api";

import { Audit } from "../AuditModel";
import { AuditHashChain } from "../AuditHashChain";

//
// AuditService — the audit domain's Service BASE (not deployed alone). Holds the shared domain wiring
// (hot DDB + S3 archive facades, the retention-policy reader, the hash-chain VERIFY — the read-side
// mirror of `AuditJob.stamp`) so the concrete role (`AuditQueryService`) inherits it. Audit is shaped
// by its one hard rule: a single writer (`AuditSinkJob`), read-only everywhere else — so this base
// deliberately has NO write method onto the `events`/`legal_holds` tables beyond legal-hold placement.
//
export class AuditService extends Service
{
    private _dynamo? : Dynamo;
    private _s3?      : S3;

    ////////////////////////////////////////////////////////////////////////////////////////////
    constructor( role : AuditService.Role )
    {
        super( Register.Service.AUDIT, role, AuditService.PORT[ role ] );

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
        const seeded : Type.Result<AuditConfig.Config> = await this.appConfig.ensureSeeded( "config", "settings", AuditConfig.DEFAULT );
        if( seeded.ok ) this.log.info( "audit config ready" );
        else this.log.warn( "audit config seed failed — using DEFAULT until deployed", { error: seeded.error } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Widen `Application.audit()` (protected) to public — every read/export/legal-hold endpoint impl
     *  holds a `AuditQueryService` reference (composition, not inheritance) and needs to call it, e.g.
     *  to record that a read of the trail happened (audit-5.2) or that an export/legal-hold action did. */
    public override async audit( input : Application.AuditInput ) : Promise<void>
    {
        return super.audit( input );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** DynamoDB facade — the hot, queryable trail + legal holds. Lazy + cached. */
    public get dynamo() : Dynamo { return this._dynamo ??= new Dynamo( this.cloud ); }

    /** S3 facade — the WORM archive (read path: export-over-archive is a later Athena addition; today's
     *  export reads the hot store only — see `PostAuditExportImpl`). Lazy + cached. */
    public get s3() : S3 { return this._s3 ??= new S3( this.cloud ); }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** This service's retention policy (its `config/settings` AppConfig profile), deep-filled from
     *  `AuditConfig.DEFAULT` so a fresh/undeployed environment still resolves a sane default. */
    public async auditConfig() : Promise<AuditConfig.Config>
    {
        const got : Type.Result<AuditConfig.Config | undefined> = await this.appConfig.json<AuditConfig.Config>( "config", "settings" );
        return got.ok && got.data ? ObjectUtils.withDefaults( got.data, AuditConfig.DEFAULT ) : AuditConfig.DEFAULT;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Validate + persist a new AuditConfig — creates an AppConfig version, then deploys it. */
    public async saveConfig( config : AuditConfig.Config, environment : string = process.env.APPCONFIG_ENV ?? "default" ) : Promise<Type.Result<void>>
    {
        const profileId : Type.Result<string> = await this.appConfig.profileId( "config", "settings" );
        if( !profileId.ok ) return { ok: false, error: profileId.error };
        const environmentId : Type.Result<string> = await this.appConfig.environmentId( "config", environment );
        if( !environmentId.ok ) return { ok: false, error: environmentId.error };

        const version : Type.Result<number> = await this.appConfig.createVersion( "config", profileId.data, JSON.stringify( config ) );
        if( !version.ok ) return { ok: false, error: version.error };
        const deployed : Type.Result<number> = await this.appConfig.deploy( "config", profileId.data, environmentId.data, version.data, { description: "audit config update" } );
        if( !deployed.ok ) return { ok: false, error: deployed.error };
        return { ok: true, data: undefined };
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Recompute a tenant's hash chain over `[fromSeq, toSeq]` and report the first break, if any
     *  (audit-3.2). The read-side mirror of `AuditJob.stamp`'s write-side chaining. Never throws. */
    public async verifyChain( accountId : Type.ID, fromSeq : number, toSeq : number ) : Promise<Audit.ChainVerification>
    {
        let expectedPrevHash : string = "";
        if( fromSeq > 1 )
        {
            const priorResult : Type.Result<Audit.StoredEvent | undefined> = await this.dynamo.get<Audit.StoredEvent>( "events", { accountId, sk: AuditHashChain.eventSk( fromSeq - 1 ) } );
            if( priorResult.ok && priorResult.data ) expectedPrevHash = priorResult.data.hash;
        }

        for( let seq : number = fromSeq; seq <= toSeq; seq++ )
        {
            const got : Type.Result<Audit.StoredEvent | undefined> = await this.dynamo.get<Audit.StoredEvent>( "events", { accountId, sk: AuditHashChain.eventSk( seq ) } );
            if( !got.ok || !got.data ) return { accountId, fromSeq, toSeq, intact: false, brokenAt: seq };

            const recomputed : string = AuditHashChain.hashOf( got.data.prevHash, got.data );
            if( got.data.prevHash !== expectedPrevHash || got.data.hash !== recomputed )
                return { accountId, fromSeq, toSeq, intact: false, brokenAt: seq };

            expectedPrevHash = got.data.hash;
        }
        return { accountId, fromSeq, toSeq, intact: true };
    }
}

export namespace AuditService
{
    export enum Role { MAIN = "main" }

    export const PORT : Record<Role, number> = { [ Role.MAIN ]: Ports.AUDIT.MAIN };
}

export default AuditService;
// eof
