//
// NangoBroker — the default {@link OAuthBroker}, wrapping a **self-hosted Nango** server over its REST
// API (via @repo/endpoint's RestfulService — never raw fetch). Self-hosted means tokens live in OUR
// infra (consistent with the KMS-vault posture), and Nango handles the per-provider OAuth quirks +
// token refresh for the long tail.
//
// NOTE: targets Nango's documented REST API; verify endpoints against the deployed Nango version when
// it's stood up. All operational failures are returned as Type.Result (no throw).
//
import { RestfulService } from "@repo/endpoint";
import { ResultUtils } from "@repo/common";
import type { Type } from "@repo/common";

import { OAuthBroker, OAuth } from "../OAuthBroker";

/** Minimal shape of a Nango connection response (only the bits we map). */
interface NangoConnection
{
    created_at?  : string;
    credentials? : { access_token? : string; expires_at? : string; raw? : { scope? : string } };
    metadata?    : Type.JsonObject;
}

/**
 * {@link OAuthBroker} backed by Nango. Construct with the server `host` + `secretKey` (from Secrets
 * Manager in the cloud, env locally). Reach {@link client} for any Nango call this wrapper doesn't cover.
 */
export class NangoBroker implements OAuthBroker
{
    readonly mode : OAuth.Mode = OAuth.Mode.NANGO;

    private readonly secretKey : string;
    private readonly http      : RestfulService;

    /** @param config `host` (Nango base URL) + `secretKey`; both default from `NANGO_HOST` / `NANGO_SECRET_KEY`. */
    constructor( config : OAuth.Config = {} )
    {
        const host : string = config.host ?? process.env.NANGO_HOST ?? "http://localhost:3003";
        this.secretKey = config.secretKey ?? process.env.NANGO_SECRET_KEY ?? "";
        this.http      = new RestfulService( host );
    }

    /** Escape hatch — the shared HTTP client pointed at the Nango server (for calls not wrapped here). */
    get client() : RestfulService { return this.http; }

    /** Bearer auth for Nango's management API. */
    private auth( extra : Record<string, string> = {} ) : Record<string, string>
    {
        return { Authorization: `Bearer ${this.secretKey}`, ...extra };
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** @inheritDoc */
    async startConnect( provider : string, connectionKey : string, opts : OAuth.ConnectOptions = {} ) : Promise<Type.Result<OAuth.ConnectSession>>
    {
        const reply : RestfulService.Reply = await this.http.post( "/connect/sessions", null, {
            end_user             : { id: connectionKey },
            allowed_integrations : [ provider ],
            integrations_config_defaults : opts.scopes ? { [ provider ]: { connection_config: { scopes: opts.scopes } } } : undefined,
        }, this.auth() );

        if( !reply.ok ) return ResultUtils.err<OAuth.ConnectSession>( `Nango startConnect failed: ${RestfulService.error( reply )}`, reply.status );
        const data : { token? : string; expires_at? : string } = ( reply.data?.data ?? reply.data ?? {} ) as { token? : string; expires_at? : string };
        if( data.token === undefined ) return ResultUtils.err<OAuth.ConnectSession>( "Nango startConnect: no session token in response" );
        return ResultUtils.ok( { token: data.token, expiresAt: data.expires_at } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** @inheritDoc */
    async getToken( provider : string, connectionKey : string ) : Promise<Type.Result<OAuth.Token>>
    {
        const connection : Type.Result<NangoConnection> = await this.fetchConnection( provider, connectionKey );
        if( !connection.ok ) return connection;

        const accessToken : string | undefined = connection.data.credentials?.access_token;
        if( accessToken === undefined ) return ResultUtils.err<OAuth.Token>( `Nango getToken: no access token for ${provider}/${connectionKey}` );
        return ResultUtils.ok( { accessToken, expiresAt: connection.data.credentials?.expires_at } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** @inheritDoc */
    async getConnection( provider : string, connectionKey : string ) : Promise<Type.Result<OAuth.Connection>>
    {
        const connection : Type.Result<NangoConnection> = await this.fetchConnection( provider, connectionKey );
        if( !connection.ok ) return connection;

        const scopes : string | undefined = connection.data.credentials?.raw?.scope;
        return ResultUtils.ok( {
            provider,
            connectionKey,
            createdAt : connection.data.created_at,
            scopes    : scopes ? scopes.split( " " ) : undefined,
            metadata  : connection.data.metadata,
        } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** @inheritDoc — routes through Nango's proxy, which injects the provider auth. */
    async proxy<T = unknown>( provider : string, connectionKey : string, request : OAuth.ProxyRequest ) : Promise<Type.Result<T>>
    {
        const path    : string                      = `/proxy${request.endpoint.startsWith( "/" ) ? "" : "/"}${request.endpoint}`;
        const headers : Record<string, string>      = this.auth( { "Provider-Config-Key": provider, "Connection-Id": connectionKey, ...request.headers } );
        const params  : Type.JsonObject | undefined = request.params;

        const reply : RestfulService.Reply =
            request.method === "GET"  ? await this.http.get( path, params, headers ) :
            request.method === "PUT"  ? await this.http.put( path, params, request.data, headers ) :
            request.method === "DELETE" ? await this.http.delete( path, params, request.data, headers ) :
                                        await this.http.post( path, params, request.data, headers );   // POST / PATCH

        if( !reply.ok ) return ResultUtils.err<T>( `Nango proxy ${request.method} ${request.endpoint} failed: ${RestfulService.error( reply )}`, reply.status );
        return ResultUtils.ok( reply.data as T );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** @inheritDoc */
    async disconnect( provider : string, connectionKey : string ) : Promise<Type.Result<void>>
    {
        const reply : RestfulService.Reply = await this.http.delete( `/connection/${encodeURIComponent( connectionKey )}`, { provider_config_key: provider }, {}, this.auth() );
        // 404 = already gone → treat as success (idempotent).
        if( !reply.ok && reply.status !== 404 ) return ResultUtils.err<void>( `Nango disconnect failed: ${RestfulService.error( reply )}`, reply.status );
        return ResultUtils.ok( undefined );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Fetch a connection (with a refreshed token) — shared by {@link getToken} / {@link getConnection}. */
    private async fetchConnection( provider : string, connectionKey : string ) : Promise<Type.Result<NangoConnection>>
    {
        const reply : RestfulService.Reply = await this.http.get(
            `/connection/${encodeURIComponent( connectionKey )}`,
            { provider_config_key: provider, refresh_token: true },
            this.auth(),
        );
        if( !reply.ok ) return ResultUtils.err<NangoConnection>( `Nango getConnection failed: ${RestfulService.error( reply )}`, reply.status );
        return ResultUtils.ok( reply.data as NangoConnection );
    }
}

export default NangoBroker;
