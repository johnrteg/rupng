//
import { Application, Service, Ports, Register, Dynamo, Kafka, Sqs, Events } from "@repo/services";
import { ObjectUtils, type Type } from "@repo/common";
import { PostInstallation, GetInstallationToken, DeleteInstallation, SocialConfig, SocialPost, SocialAccount } from "@repo/api";

import { MarketplaceClient } from "../clients/MarketplaceClient";
import { SocialPipeline } from "../pipeline/SocialPipeline";

//
// SocialService — the social domain's Service BASE (not deployed alone). Holds the shared domain
// wiring (DynamoDB + Kafka + SQS facades, the marketplace S2S client, version) so the concrete role
// (SocialMainService) inherits it. Social owns no connection secrets (SPECS.md §7.2) — OAuth tokens
// live in marketplace's vault; this base only calls marketplace's internal installations API.
//
export class SocialService extends Service
{
    private _dynamo?      : Dynamo;
    private _kafka?       : Kafka;
    private _sqs?         : Sqs;
    private _marketplace? : MarketplaceClient;

    ////////////////////////////////////////////////////////////////////////////////////////////
    constructor( role : SocialService.Role )
    {
        // super( serviceId, role, defaultLocalPort ) — env PORT overrides the default when set.
        super( Register.Service.SOCIAL, role, SocialService.PORT[ role ] );

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
        const seeded : Type.Result<SocialConfig.Config> = await this.appConfig.ensureSeeded( "config", "settings", SocialConfig.DEFAULT );
        if( seeded.ok ) this.log.info( "social config ready" );
        else this.log.warn( "social config seed failed — using DEFAULT until deployed", { error: seeded.error } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** DynamoDB facade — the source of truth for connected destinations + posts. Lazy + cached. */
    public get dynamo() : Dynamo { return this._dynamo ??= new Dynamo( this.cloud ); }

    /** Kafka facade — CRUD event emission (social.* topics), best-effort. Lazy + cached. */
    public get kafka() : Kafka { return this._kafka ??= new Kafka( this.cloud ); }

    /** SQS facade — the publish pipeline's work queue. Lazy + cached. */
    public get sqs() : Sqs { return this._sqs ??= new Sqs( this.cloud ); }

    /** S2S client to marketplace's internal installations API. Lazy + cached — shared shape with
     *  `SocialJob` (see `pipelineDeps`), the same way `MediaJob`/`MediaService` share `MediaPipeline`. */
    public get marketplace() : MarketplaceClient { return this._marketplace ??= new MarketplaceClient(); }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Create a marketplace installation for `integrationId` (the platform) and start its connect flow. */
    public async connectMarketplace( accountId : Type.UUID, integrationId : string, installedBy : Type.UUID, scopes? : Array<string> ) : Promise<Type.Result<PostInstallation.Response>>
    {
        return this.marketplace.connect( accountId, integrationId, installedBy, scopes );
    }

    /** Resolve a fresh access token for a marketplace installation. */
    public async marketplaceToken( installationId : Type.UUID ) : Promise<Type.Result<GetInstallationToken.Response>>
    {
        return this.marketplace.token( installationId );
    }

    /** Uninstall a marketplace installation (revoke + purge). */
    public async disconnectMarketplace( installationId : Type.UUID ) : Promise<Type.Result<DeleteInstallation.Response>>
    {
        return this.marketplace.disconnect( installationId );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** The facades the shared `SocialPipeline` needs — supplied here (dev consumers) or by `SocialJob`. */
    public pipelineDeps() : SocialPipeline.Deps
    {
        return { dynamo: this.dynamo, sqs: this.sqs, kafka: this.kafka, log: this.log, marketplace: this.marketplace };
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** The live runtime config (AppConfig config/settings), deep-filled from DEFAULT so an older/partial
     *  hosted row tolerates schema drift. Exposed so endpoint impls (which can't reach the protected
     *  `appConfig`) read the poll/refresh/quota policy. */
    public async socialConfig() : Promise<SocialConfig.Config>
    {
        const got : Type.Result<SocialConfig.Config | undefined> = await this.appConfig.json<SocialConfig.Config>( "config", "settings" );
        return got.ok && got.data ? ObjectUtils.withDefaults( got.data, SocialConfig.DEFAULT ) : SocialConfig.DEFAULT;
    }

    /** Validate + persist a new SocialConfig — creates an AppConfig version, then deploys it. */
    public async saveConfig( config : SocialConfig.Config, environment : string = process.env.APPCONFIG_ENV ?? "default" ) : Promise<Type.Result<void>>
    {
        const profileId : Type.Result<string> = await this.appConfig.profileId( "config", "settings" );
        if( !profileId.ok ) return { ok: false, error: profileId.error };
        const environmentId : Type.Result<string> = await this.appConfig.environmentId( "config", environment );
        if( !environmentId.ok ) return { ok: false, error: environmentId.error };

        const version : Type.Result<number> = await this.appConfig.createVersion( "config", profileId.data, JSON.stringify( config ) );
        if( !version.ok ) return { ok: false, error: version.error };
        const deployed : Type.Result<number> = await this.appConfig.deploy( "config", profileId.data, environmentId.data, version.data, { description: "social config update" } );
        if( !deployed.ok ) return { ok: false, error: deployed.error };
        return { ok: true, data: undefined };
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Allocate the next per-post sequential audit-trail seq (starts at 1). Mirrors campaign's
     *  `nextRef` — atomic + monotonic via `Dynamo.increment`, independent of the audit rows themselves. */
    public async nextAuditSeq( postId : Type.UUID ) : Promise<Type.Result<number>>
    {
        return this.dynamo.increment( "post_counters", { postId, kind: "audit" }, "n" );
    }

    /** Append one entry to a post's audit trail. Best-effort — a failed audit write is logged, not
     *  surfaced to the caller (the lifecycle transition it's recording already succeeded). */
    public async appendAudit( postId : Type.UUID, action : SocialPost.AuditAction, by : Type.UUID, detail? : string ) : Promise<void>
    {
        const seq : Type.Result<number> = await this.nextAuditSeq( postId );
        if( !seq.ok ) { this.log.warn( "audit seq allocation failed", { postId, action, error: seq.error } ); return; }

        const entry : SocialPost.ReviewAudit = { postId, seq: seq.data, action, by, at: new Date().toISOString(), detail };
        const wrote : Type.Result<void> = await this.dynamo.put( "post_audit", { ...entry } );
        if( !wrote.ok ) this.log.warn( "audit write failed", { postId, action, error: wrote.error } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Emit a `social.account` CRUD event, best-effort (a failed publish is logged, never surfaced —
     *  the write it's reporting on already succeeded). Mirrors `MediaService.publishAsset`. */
    public async emitAccountEvent( verb : Events.Verb, connection : SocialAccount.Entity ) : Promise<void>
    {
        const published : Type.Result<void> = await this.kafka.publishEvent( Events.envelope( {
            object: Events.Object.SOCIAL_ACCOUNT, verb, accountId: connection.accountId,
            target: { type: "social.account", id: connection.id },
            data:   { id: connection.id, accountId: connection.accountId, platform: connection.platform, status: connection.status },
        } ) );
        if( !published.ok ) this.log.warn( "social.account event publish failed", { connectionId: connection.id, verb, error: published.error } );
    }

    /** Emit a `social.post` CRUD event, best-effort. The publish-outcome UPDATE (status →
     *  PUBLISHED/FAILED) is emitted from `SocialPipeline` instead, since that transition happens in the
     *  worker, not here. */
    public async emitPostEvent( verb : Events.Verb, post : SocialPost.Entity ) : Promise<void>
    {
        const published : Type.Result<void> = await this.kafka.publishEvent( Events.envelope( {
            object: Events.Object.SOCIAL_POST, verb, accountId: post.accountId,
            target: { type: "social.post", id: post.id },
            data:   { id: post.id, accountId: post.accountId, status: post.status, targetCount: post.targets.length },
        } ) );
        if( !published.ok ) this.log.warn( "social.post event publish failed", { postId: post.id, verb, error: published.error } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** The marketplace integration id (the OAuth broker's `provider` key) for a social platform. Today
     *  the platform enum value doubles as the integration id — kept as a lookup so the two can diverge
     *  later (e.g. if marketplace registers "meta" once for both facebook + instagram). */
    public static integrationIdFor( platform : string ) : string { return platform; }
}

export namespace SocialService
{
    /** social is single-role today: MAIN serves the /social/* API. */
    export enum Role { MAIN = "main" }

    /** Default local port per role (also the manifest containerPort — one source, can't drift). */
    export const PORT : Record<Role, number> = { [ Role.MAIN ]: Ports.SOCIAL.MAIN };
}

export default SocialService;
