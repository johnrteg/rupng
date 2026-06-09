//
// AWS AppConfig facade — runtime config + feature flags via the AppConfig Data API.
// Keyed by cloud-spec LOGICAL appConfig keys (CloudResolver -> application id). The session
// token + poll token are managed internally; a poll returns "" when nothing changed.
//
import { AppConfigDataClient, StartConfigurationSessionCommand, GetLatestConfigurationCommand } from "@aws-sdk/client-appconfigdata";
import type { StartConfigurationSessionCommandOutput, GetLatestConfigurationCommandOutput } from "@aws-sdk/client-appconfigdata";
import { AppConfigClient, ListHostedConfigurationVersionsCommand, CreateHostedConfigurationVersionCommand, StartDeploymentCommand, GetDeploymentCommand } from "@aws-sdk/client-appconfig";
import type { ListHostedConfigurationVersionsCommandOutput, CreateHostedConfigurationVersionCommandOutput, StartDeploymentCommandOutput, GetDeploymentCommandOutput } from "@aws-sdk/client-appconfig";
import type { CloudResolver, ResourceKey } from "@repo/cloud-spec";
import { ResultUtils } from "@repo/common";
import type { Type } from "@repo/common";
import { ClientUtils } from "./ClientUtils";

/**
 * AWS AppConfig facade — runtime configuration + feature flags via the AppConfig **Data API**
 * (`@aws-sdk/client-appconfigdata`), addressed by cloud-spec LOGICAL appConfig keys.
 *
 * **Use it for** values you want to change *without a redeploy* — feature flags, tunables,
 * kill switches, sampling rates. **Not for** secrets (use Secrets Manager / KMS) or static
 * build-time config (env vars). It manages the configuration session + rolling poll token for
 * you; the intended pattern is to poll on an interval and cache the last value.
 *
 * **AppConfig is the home for service-level configuration.** The control-plane methods below manage
 * its lifecycle (versions + deployments + rollback).
 *
 * > **Note — runtime-change notification (planned).** Rather than relying only on the poll interval,
 * > a configuration change is **broadcast over Kafka** so subscribing services refresh **immediately**
 * > on deploy/rollback instead of waiting for their next poll. Polling remains the durable fallback;
 * > the Kafka signal is the low-latency path. (Wiring TBD — captured here as the intended pattern.)
 */
export class AppConfig
{
    private _client? : AppConfigDataClient;
    private _admin?  : AppConfigClient;                          // control-plane client (versions/deployments), lazy
    private readonly tokens : Map<string, string> = new Map();   // cacheKey -> next poll token

    ////////////////////////////////////////////////////////////////////////////////
    /** @param cloud the owning service's resolver — maps logical appConfig keys to application ids. */
    constructor( private readonly cloud : CloudResolver ) {}

    ////////////////////////////////////////////////////////////////////////////////
    /** The raw `AppConfigDataClient` — escape hatch. Created lazily and cached. */
    get client() : AppConfigDataClient { return this._client ??= ClientUtils.createClient( AppConfigDataClient ); }

    ////////////////////////////////////////////////////////////////////////////////
    /**
     * The raw **control-plane** `AppConfigClient` — escape hatch for version/deployment management
     * (a different API from the data-plane {@link client}). Created lazily and cached.
     */
    get adminClient() : AppConfigClient { return this._admin ??= ClientUtils.createClient( AppConfigClient ); }

    ////////////////////////////////////////////////////////////////////////////////
    /**
     * Latest **raw** configuration string for a profile. Starts a session on first call, then
     * reuses the rolling poll token.
     *
     * **Important:** the Data API returns an **empty string when nothing changed** since your
     * last poll — so cache the last non-empty value and treat `""` as "unchanged", not "no
     * config". Use {@link json} for JSON / feature-flag profiles.
     *
     * @param appConfigKey logical appConfig key (-> application id).
     * @param profile      configuration profile name (e.g. `"settings"`, `"flags"`).
     * @param environment  AppConfig environment = the in-account **deploy target** (ring/region/cell),
     *                     NOT dev/staging/prod (that's the AWS account boundary). Defaults to
     *                     `APPCONFIG_ENV` ?? `"default"`. See SPECS.md → AppConfig configuration layout.
     */
    async latest( appConfigKey : ResourceKey, profile : string, environment : string = process.env.APPCONFIG_ENV ?? "default" ) : Promise<Type.Result<string>>
    {
        const cacheKey : string = `${appConfigKey}/${environment}/${profile}`;
        let token : string | undefined = this.tokens.get( cacheKey );

        // Start a session on first call (each SDK call wrapped — no throw); a missing token is an err.
        if( token === undefined )
        {
            const session : Type.Result<StartConfigurationSessionCommandOutput> = await ResultUtils.from( () => this.client.send( new StartConfigurationSessionCommand( {
                ApplicationIdentifier          : this.cloud.appConfigId( appConfigKey ),
                EnvironmentIdentifier          : environment,
                ConfigurationProfileIdentifier : profile,
            } ) ) );
            if( !session.ok ) return session;
            token = session.data.InitialConfigurationToken;
            if( token === undefined ) return ResultUtils.err( `AppConfig: no session token for ${cacheKey}` );
        }

        const polled : Type.Result<GetLatestConfigurationCommandOutput> = await ResultUtils.from( () => this.client.send( new GetLatestConfigurationCommand( { ConfigurationToken: token } ) ) );
        if( !polled.ok ) return polled;
        if( polled.data.NextPollConfigurationToken ) this.tokens.set( cacheKey, polled.data.NextPollConfigurationToken );

        return ResultUtils.ok( polled.data.Configuration ? new TextDecoder().decode( polled.data.Configuration ) : "" );
    }

    ////////////////////////////////////////////////////////////////////////////////
    /**
     * Latest configuration parsed as JSON (e.g. a freeform settings document or a feature-flag
     * set). Returns `undefined` when unchanged/empty — keep your last value and replace only on
     * a defined result.
     * @typeParam T the expected shape of the configuration document.
     */
    async json<T>( appConfigKey : ResourceKey, profile : string, environment? : string ) : Promise<Type.Result<T | undefined>>
    {
        const result : Type.Result<string> = await this.latest( appConfigKey, profile, environment );
        if( !result.ok ) return result;
        return ResultUtils.attempt( () => result.data ? ( JSON.parse( result.data ) as T ) : undefined );
    }

    //
    // ── Control plane: versions + deployments (the AppConfigClient API) ─────────────────────────
    //
    // NOTE: unlike the data-plane methods above (which accept profile / environment NAMES), the
    // control-plane calls below take AppConfig **IDs** — `profileId` (configuration profile id) and
    // `environmentId` — as AWS requires. `appConfigKey` is still a cloud-spec logical key (-> app id).
    //

    ////////////////////////////////////////////////////////////////////////////////
    /**
     * List the **hosted configuration versions** of a profile, **newest-first** (paginates internally,
     * returning every version). Each is identified by its `versionNumber`, which you pass to
     * {@link deploy} / {@link rollback}. Hosted-store profiles only.
     *
     * @param appConfigKey logical appConfig key (-> application id).
     * @param profileId    the **configuration profile id** (not its name).
     */
    async listVersions( appConfigKey : ResourceKey, profileId : string ) : Promise<Type.Result<Array<AppConfig.Version>>>
    {
        return ResultUtils.from( async () : Promise<Array<AppConfig.Version>> =>
        {
            const applicationId : string                = this.cloud.appConfigId( appConfigKey );
            const versions      : Array<AppConfig.Version> = [];
            let   nextToken     : string | undefined    = undefined;

            do
            {
                const page : ListHostedConfigurationVersionsCommandOutput = await this.adminClient.send( new ListHostedConfigurationVersionsCommand( {
                    ApplicationId          : applicationId,
                    ConfigurationProfileId : profileId,
                    NextToken              : nextToken,
                } ) );

                for( const item of page.Items ?? [] )
                    if( item.VersionNumber !== undefined )
                        versions.push( { versionNumber: item.VersionNumber, description: item.Description, contentType: item.ContentType } );

                nextToken = page.NextToken;
            }
            while( nextToken !== undefined );

            return versions;
        } );
    }

    ////////////////////////////////////////////////////////////////////////////////
    /**
     * Create a new **hosted configuration version** (the content that a later {@link deploy} rolls
     * out). Returns the new `versionNumber`. Hosted-store profiles only.
     *
     * @param appConfigKey logical appConfig key (-> application id).
     * @param profileId    the configuration profile id.
     * @param content      the configuration body (e.g. `JSON.stringify(doc)`).
     * @param contentType  MIME type (default `"application/json"`).
     */
    async createVersion( appConfigKey : ResourceKey, profileId : string, content : string, contentType : string = "application/json" ) : Promise<Type.Result<number>>
    {
        const created : Type.Result<CreateHostedConfigurationVersionCommandOutput> = await ResultUtils.from( () => this.adminClient.send( new CreateHostedConfigurationVersionCommand( {
            ApplicationId          : this.cloud.appConfigId( appConfigKey ),
            ConfigurationProfileId : profileId,
            Content                : new TextEncoder().encode( content ),
            ContentType            : contentType,
        } ) ) );
        if( !created.ok ) return created;
        if( created.data.VersionNumber === undefined ) return ResultUtils.err( `AppConfig: createVersion returned no VersionNumber for ${String( appConfigKey )}/${profileId}` );
        return ResultUtils.ok( created.data.VersionNumber );
    }

    ////////////////////////////////////////////////////////////////////////////////
    /**
     * **Deploy** a specific configuration `versionNumber` to an environment (`StartDeployment`).
     * Returns the `deploymentNumber` — poll {@link getDeploymentStatus} for progress. Defaults to the
     * predefined **`AppConfig.AllAtOnce`** strategy (immediate, no bake) which is ideal for a manual
     * rollout/rollback; pass `opts.strategyId` for a gradual strategy.
     *
     * @param appConfigKey  logical appConfig key (-> application id).
     * @param profileId     the configuration profile id.
     * @param environmentId the environment id to deploy to.
     * @param versionNumber the configuration version to roll out (see {@link listVersions}).
     * @param opts          optional `strategyId` + `description`.
     */
    async deploy( appConfigKey : ResourceKey, profileId : string, environmentId : string, versionNumber : number, opts : AppConfig.DeployOptions = {} ) : Promise<Type.Result<number>>
    {
        const started : Type.Result<StartDeploymentCommandOutput> = await ResultUtils.from( () => this.adminClient.send( new StartDeploymentCommand( {
            ApplicationId          : this.cloud.appConfigId( appConfigKey ),
            EnvironmentId          : environmentId,
            ConfigurationProfileId : profileId,
            ConfigurationVersion   : String( versionNumber ),
            DeploymentStrategyId   : opts.strategyId ?? "AppConfig.AllAtOnce",
            Description            : opts.description,
        } ) ) );
        if( !started.ok ) return started;
        if( started.data.DeploymentNumber === undefined ) return ResultUtils.err( `AppConfig: startDeployment returned no DeploymentNumber for ${String( appConfigKey )}/${profileId}` );
        return ResultUtils.ok( started.data.DeploymentNumber );
    }

    ////////////////////////////////////////////////////////////////////////////////
    /**
     * **Roll back** to an earlier configuration `versionNumber` — there is no distinct AppConfig
     * "rollback to a completed deployment" call, so this simply {@link deploy}s the older version
     * (immediately, via `AppConfig.AllAtOnce`). Pick the target from {@link listVersions}.
     *
     * @param appConfigKey  logical appConfig key (-> application id).
     * @param profileId     the configuration profile id.
     * @param environmentId the environment id to roll back.
     * @param versionNumber the earlier version to restore.
     * @param opts          optional `strategyId` + `description`.
     */
    async rollback( appConfigKey : ResourceKey, profileId : string, environmentId : string, versionNumber : number, opts : AppConfig.DeployOptions = {} ) : Promise<Type.Result<number>>
    {
        return this.deploy( appConfigKey, profileId, environmentId, versionNumber, {
            strategyId  : opts.strategyId ?? "AppConfig.AllAtOnce",
            description : opts.description ?? `rollback to version ${versionNumber}`,
        } );
    }

    ////////////////////////////////////////////////////////////////////////////////
    /**
     * Fetch a deployment's status (`GetDeployment`) — `state` (e.g. `DEPLOYING` / `COMPLETE` /
     * `ROLLING_BACK` / `ROLLED_BACK` / `REVERTED`), `percentageComplete`, and the targeted `version`.
     * Poll after {@link deploy} / {@link rollback} to confirm completion.
     *
     * @param appConfigKey     logical appConfig key (-> application id).
     * @param environmentId    the environment id.
     * @param deploymentNumber the number returned by {@link deploy} / {@link rollback}.
     */
    async getDeploymentStatus( appConfigKey : ResourceKey, environmentId : string, deploymentNumber : number ) : Promise<Type.Result<AppConfig.DeploymentStatus>>
    {
        return ResultUtils.from( async () : Promise<AppConfig.DeploymentStatus> =>
        {
            const deployment : GetDeploymentCommandOutput = await this.adminClient.send( new GetDeploymentCommand( {
                ApplicationId    : this.cloud.appConfigId( appConfigKey ),
                EnvironmentId    : environmentId,
                DeploymentNumber : deploymentNumber,
            } ) );
            return {
                deploymentNumber   : deployment.DeploymentNumber ?? deploymentNumber,
                state              : deployment.State ?? "UNKNOWN",
                percentageComplete : deployment.PercentageComplete ?? 0,
                version            : deployment.ConfigurationVersion,
            };
        } );
    }
}

export namespace AppConfig
{
    /** A hosted configuration version (from {@link AppConfig.listVersions}, newest-first). */
    export interface Version
    {
        versionNumber : number;     // pass to deploy() / rollback()
        description?  : string;
        contentType?  : string;
    }

    /** Options for {@link AppConfig.deploy} / {@link AppConfig.rollback}. */
    export interface DeployOptions
    {
        strategyId?  : string;      // AppConfig deployment strategy id (default "AppConfig.AllAtOnce" — immediate)
        description? : string;      // shown in the AppConfig console / audit
    }

    /** A deployment's status (from {@link AppConfig.getDeploymentStatus}). */
    export interface DeploymentStatus
    {
        deploymentNumber   : number;
        state              : string;       // DEPLOYING | BAKING | COMPLETE | ROLLING_BACK | ROLLED_BACK | REVERTED | …
        percentageComplete : number;       // 0–100
        version?           : string;       // the configuration version this deployment targets
    }
}
