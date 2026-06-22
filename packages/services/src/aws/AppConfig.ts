//
// AWS AppConfig facade — runtime config + feature flags via the AppConfig Data API.
// Keyed by cloud-spec LOGICAL appConfig keys (CloudResolver -> application id). The session
// token + poll token are managed internally; a poll returns "" when nothing changed.
//
import { AppConfigDataClient, StartConfigurationSessionCommand, GetLatestConfigurationCommand } from "@aws-sdk/client-appconfigdata";
import type { StartConfigurationSessionCommandOutput, GetLatestConfigurationCommandOutput } from "@aws-sdk/client-appconfigdata";
import type { CloudResolver, ResourceKey } from "@repo/cloud-spec";
import { ClientUtils } from "./ClientUtils";

/**
 * AWS AppConfig facade — runtime configuration + feature flags via the AppConfig **Data API**
 * (`@aws-sdk/client-appconfigdata`), addressed by cloud-spec LOGICAL appConfig keys.
 *
 * **Use it for** values you want to change *without a redeploy* — feature flags, tunables,
 * kill switches, sampling rates. **Not for** secrets (use Secrets Manager / KMS) or static
 * build-time config (env vars). It manages the configuration session + rolling poll token for
 * you; the intended pattern is to poll on an interval and cache the last value.
 */
export class AppConfig
{
    private _client? : AppConfigDataClient;
    private readonly tokens : Map<string, string> = new Map();   // cacheKey -> next poll token

    /** @param cloud the owning service's resolver — maps logical appConfig keys to application ids. */
    constructor( private readonly cloud : CloudResolver ) {}

    /** The raw `AppConfigDataClient` — escape hatch. Created lazily and cached. */
    get client() : AppConfigDataClient { return this._client ??= ClientUtils.createClient( AppConfigDataClient ); }

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
     * @param environment  AppConfig environment (defaults to `ENVIRONMENT`).
     */
    async latest( appConfigKey : ResourceKey, profile : string, environment : string = process.env.ENVIRONMENT ?? "dev" ) : Promise<string>
    {
        const cacheKey : string = `${appConfigKey}/${environment}/${profile}`;
        let token : string | undefined = this.tokens.get( cacheKey );

        if( token === undefined )
        {
            const session : StartConfigurationSessionCommandOutput = await this.client.send( new StartConfigurationSessionCommand( {
                ApplicationIdentifier          : this.cloud.appConfigId( appConfigKey ),
                EnvironmentIdentifier          : environment,
                ConfigurationProfileIdentifier : profile,
            } ) );
            token = session.InitialConfigurationToken;
            if( token === undefined ) throw new Error( `AppConfig: no session token for ${cacheKey}` );
        }

        const res : GetLatestConfigurationCommandOutput = await this.client.send( new GetLatestConfigurationCommand( { ConfigurationToken: token } ) );
        if( res.NextPollConfigurationToken ) this.tokens.set( cacheKey, res.NextPollConfigurationToken );

        return res.Configuration ? new TextDecoder().decode( res.Configuration ) : "";
    }

    /**
     * Latest configuration parsed as JSON (e.g. a freeform settings document or a feature-flag
     * set). Returns `undefined` when unchanged/empty — keep your last value and replace only on
     * a defined result.
     * @typeParam T the expected shape of the configuration document.
     */
    async json<T>( appConfigKey : ResourceKey, profile : string, environment? : string ) : Promise<T | undefined>
    {
        const raw : string = await this.latest( appConfigKey, profile, environment );
        return raw ? ( JSON.parse( raw ) as T ) : undefined;
    }
}
