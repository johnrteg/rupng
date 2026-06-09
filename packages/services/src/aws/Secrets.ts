//
// Secrets Manager facade — fetch secret values, keyed by cloud-spec LOGICAL secret keys.
//
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import type { GetSecretValueCommandOutput } from "@aws-sdk/client-secrets-manager";
import type { CloudResolver, ResourceKey } from "@repo/cloud-spec";
import { ResultUtils } from "@repo/common";
import type { Type } from "@repo/common";
import { ClientUtils } from "./ClientUtils";

/**
 * Secrets Manager facade — read secret values over `@aws-sdk/client-secrets-manager`,
 * addressed by cloud-spec LOGICAL secret keys (e.g. `"db"`).
 *
 * **Use for** credentials and long-lived secrets (DB passwords, third-party API keys) — values
 * that rotate and must never sit in env vars or code. For non-secret, change-without-redeploy
 * config/flags use {@link AppConfig} instead.
 *
 * **Cache the result** in module scope / for the connection's lifetime — fetching per request
 * adds latency and cost. Refetch on rotation (or a TTL), not on every call. Reach through
 * `.client` to write/rotate secrets.
 */
export class Secrets
{
    private _client? : SecretsManagerClient;

    ////////////////////////////////////////////////////////////////////////////////
    /** @param cloud the owning service's resolver — maps logical secret keys to secret ARNs. */
    constructor( private readonly cloud : CloudResolver ) {}

    ////////////////////////////////////////////////////////////////////////////////
    /** The raw `SecretsManagerClient` — escape hatch (put/rotate/describe). Lazy + cached. */
    get client() : SecretsManagerClient { return this._client ??= ClientUtils.createClient( SecretsManagerClient ); }

    ////////////////////////////////////////////////////////////////////////////////
    /** Resolve a cloud-spec logical secret key (e.g. `"db"`) to its physical secret ARN. */
    arn( key : ResourceKey ) : string { return this.cloud.secretArn( key ); }

    ////////////////////////////////////////////////////////////////////////////////
    /**
     * Fetch a secret's current string value.
     * @param secretKey logical secret key.
     * @returns the secret string, or `undefined` if it has no string value.
     */
    async get( secretKey : ResourceKey ) : Promise<Type.Result<string | undefined>>
    {
        return ResultUtils.from( async () : Promise<string | undefined> =>
        {
            const result : GetSecretValueCommandOutput = await this.client.send( new GetSecretValueCommand( { SecretId: this.arn( secretKey ) } ) );
            return result.SecretString;
        } );
    }

    ////////////////////////////////////////////////////////////////////////////////
    /**
     * Fetch and parse a JSON secret — e.g. DB credentials `{ username, password, host, … }`.
     * @typeParam T the expected shape of the parsed secret.
     * @returns the parsed object, or `undefined` if the secret is empty.
     */
    async getJson<T>( secretKey : ResourceKey ) : Promise<Type.Result<T | undefined>>
    {
        const result : Type.Result<string | undefined> = await this.get( secretKey );
        if( !result.ok ) return result;
        return ResultUtils.attempt( () => result.data ? ( JSON.parse( result.data ) as T ) : undefined );
    }
}
