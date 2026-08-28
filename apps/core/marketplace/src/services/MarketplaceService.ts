//
import { Application, Service, Ports, Register, Dynamo, Sqs, Kafka, Events } from "@repo/services";
import { OAuthFactory } from "@repo/oauth";
import { Marketplace } from "@repo/api";
import type { Type } from "@repo/common";

import { HealthPipeline } from "../pipeline/HealthPipeline";
import { UsagePipeline } from "../pipeline/UsagePipeline";

//
// MarketplaceService — the marketplace domain's Service BASE (not deployed alone). Holds the shared
// domain wiring (DynamoDB facade, the OAuth broker, version) so the concrete role
// (MarketplaceMainService) inherits it. Marketplace is a control plane, not a connector runtime: it
// owns the catalog/installation record + the credential vault (via `@repo/oauth`'s broker); the
// actual talking-to-3rd-parties lives in the connector runtime (a later addition).
//
export class MarketplaceService extends Service
{
    private _dynamo? : Dynamo;
    private _sqs?    : Sqs;
    private _kafka?  : Kafka;

    ////////////////////////////////////////////////////////////////////////////////////////////
    constructor( role : MarketplaceService.Role )
    {
        // super( serviceId, role, defaultLocalPort ) — env PORT overrides the default when set.
        super( Register.Service.MARKETPLACE, role, MarketplaceService.PORT[ role ] );

        // stamp the running version from package.json (walks up from bin/services at runtime)
        const pkg : Application.PackageInfo = this.loadPackageInfo( __dirname );
        this.setVersion( pkg.version );
        this.log.info( "version", { name: pkg.name, version: pkg.version } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** DynamoDB facade — the source of truth for installations. Lazy + cached. */
    public get dynamo() : Dynamo { return this._dynamo ??= new Dynamo( this.cloud ); }

    /** SQS facade — the outbound-action work queue. Lazy + cached. */
    public get sqs() : Sqs { return this._sqs ??= new Sqs( this.cloud ); }

    /** Kafka facade — CRUD event emission (marketplace.* topics), best-effort. Lazy + cached. */
    public get kafka() : Kafka { return this._kafka ??= new Kafka( this.cloud ); }

    /**
     * The OAuth broker for a given provider (integration id) — a native adapter if one is registered,
     * else the shared self-hosted Nango broker (the long tail). See `@repo/oauth`'s `OAuthFactory`.
     */
    public oauthFor( provider : string ) : ReturnType<typeof OAuthFactory.for> { return OAuthFactory.for( provider ); }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Allocate the next per-installation sequential audit-trail seq (starts at 1). Mirrors
     *  campaign's `nextRef` / social's `nextAuditSeq` — atomic + monotonic via `Dynamo.increment`. */
    public async nextAuditSeq( installationId : Type.UUID ) : Promise<Type.Result<number>>
    {
        return this.dynamo.increment( "installation_counters", { installationId, kind: "audit" }, "n" );
    }

    /** Append one entry to an installation's audit trail (marketplace-2.6/12.2). Best-effort — a
     *  failed audit write is logged, not surfaced (the lifecycle transition already succeeded). */
    public async appendAudit( installationId : Type.UUID, action : Marketplace.InstallationAuditAction, by : Type.UUID, detail? : string ) : Promise<void>
    {
        const seq : Type.Result<number> = await this.nextAuditSeq( installationId );
        if( !seq.ok ) { this.log.warn( "audit seq allocation failed", { installationId, action, error: seq.error } ); return; }

        const entry : Marketplace.InstallationAudit = { installationId, seq: seq.data, action, by, at: new Date().toISOString(), detail };
        const wrote : Type.Result<void> = await this.dynamo.put( "installation_audit", { ...entry } );
        if( !wrote.ok ) this.log.warn( "audit write failed", { installationId, action, error: wrote.error } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** The facades the shared `HealthPipeline` needs — supplied here (dev consumers) or by
     *  `MarketplaceHealthJob`. */
    public pipelineDeps() : HealthPipeline.Deps { return { dynamo: this.dynamo, log: this.log }; }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Report usage deltas for the current period (marketplace-8.1) — see `UsagePipeline`, shared
     *  with `MarketplaceActionJob`. */
    public async reportUsage( accountId : Type.UUID, integrationId : string, instanceId : string | undefined, deltas : Partial<Pick<Marketplace.UsageMeter, "calls" | "syncs" | "actions" | "records">> ) : Promise<Type.Result<void>>
    {
        return UsagePipeline.report( { dynamo: this.dynamo }, accountId, integrationId, instanceId, deltas );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Emit a `marketplace.integration` CRUD event, best-effort. Only CREATED (enable) and DELETED
     *  (uninstall) are wired — those are the only verbs `Events.ts`'s ACCESS map registers for this
     *  object; pause/resume/connect stay internal-only for now rather than emitting an unregistered verb. */
    public async emitInstallationEvent( verb : Events.Verb, installation : Marketplace.Installation ) : Promise<void>
    {
        const published : Type.Result<void> = await this.kafka.publishEvent( Events.envelope( {
            object: Events.Object.MARKETPLACE_INTEGRATION, verb, accountId: installation.accountId,
            target: { type: "marketplace.integration", id: installation.installationId },
            data:   { id: installation.installationId, accountId: installation.accountId, integrationId: installation.integrationId, status: installation.status },
        } ) );
        if( !published.ok ) this.log.warn( "marketplace.integration event publish failed", { installationId: installation.installationId, verb, error: published.error } );
    }
}

export namespace MarketplaceService
{
    /** marketplace is single-role today: MAIN serves the internal installations API. */
    export enum Role { MAIN = "main" }

    /** Default local port per role (also the manifest containerPort — one source, can't drift). */
    export const PORT : Record<Role, number> = { [ Role.MAIN ]: Ports.MARKETPLACE.MAIN };
}

export default MarketplaceService;
