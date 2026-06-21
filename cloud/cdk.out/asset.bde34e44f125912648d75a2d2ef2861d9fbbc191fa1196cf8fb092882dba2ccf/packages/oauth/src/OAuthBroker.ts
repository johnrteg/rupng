//
// OAuthBroker — the platform's OAuth-broker capability contract. Runs the delegated-access dance for
// 3rd-party providers (authorize → token → refresh → revoke) and lets callers act as an account against
// a provider's API, WITHOUT the account ever handling raw tokens.
//
// HYBRID by design: the default implementation wraps **Nango** (self-hosted, so tokens stay in our infra)
// for the long tail; high-value providers can later get a hand-built native adapter behind this SAME
// interface (see OAuthFactory). Operational failures are RETURNED as Type.Result — never thrown.
//
import type { Type } from "@repo/common";

/**
 * The OAuth-broker capability. One broker instance serves many `provider`s; each method takes the
 * **provider key** (the integration, e.g. `"hubspot"`) and a **connectionKey** (our stable id for an
 * account's connection — typically the marketplace installation id).
 *
 * All methods return a {@link Type.Result} — `ok:false` on an operational failure (provider down, bad
 * config, revoked grant), never a throw. Pair with the marketplace credential model: marketplace owns
 * *which* integrations an account has; the broker owns *the tokens + refresh*.
 */
export interface OAuthBroker
{
    /** Which implementation backs this broker (for logging / routing). */
    readonly mode : OAuth.Mode;

    /**
     * Begin a connect flow. Returns a short-lived **session token** the **frontend** hands to the OAuth
     * UI (e.g. `@nangohq/frontend`) to run the authorize → callback dance; on success the broker stores
     * the connection under `connectionKey`. The account never sees raw tokens.
     */
    startConnect( provider : string, connectionKey : string, opts? : OAuth.ConnectOptions ) : Promise<Type.Result<OAuth.ConnectSession>>;

    /** A **fresh** access token for the connection — auto-refreshed by the broker before expiry. */
    getToken( provider : string, connectionKey : string ) : Promise<Type.Result<OAuth.Token>>;

    /** Connection metadata (created-at, scopes, provider config) — not the secret itself. */
    getConnection( provider : string, connectionKey : string ) : Promise<Type.Result<OAuth.Connection>>;

    /**
     * Call the provider's API **with auth injected** by the broker (no token handling at the call site).
     * The typed `T` is the provider's response body.
     */
    proxy<T = unknown>( provider : string, connectionKey : string, request : OAuth.ProxyRequest ) : Promise<Type.Result<T>>;

    /** Disconnect: revoke upstream where supported and delete the stored connection (idempotent). */
    disconnect( provider : string, connectionKey : string ) : Promise<Type.Result<void>>;
}

export namespace OAuth
{
    /** Which broker implementation handled the call. */
    export enum Mode
    {
        NANGO  = "nango",       // wrapped Nango (long tail; self-hosted)
        NATIVE = "native",      // hand-built adapter for a high-value provider
    }

    /** HTTP verb for {@link OAuthBroker.proxy}. */
    export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

    /** A fresh access token. */
    export interface Token
    {
        accessToken : string;
        expiresAt?  : Type.ISODateTime;     // when it expires (the broker refreshes before this)
    }

    /** Connection metadata (no secret). */
    export interface Connection
    {
        provider      : string;             // the provider/integration key
        connectionKey : string;             // our stable connection id
        scopes?       : Array<string>;
        createdAt?    : Type.ISODateTime;
        metadata?     : Type.JsonObject;    // provider/connection config (non-secret)
    }

    /** A short-lived session for the frontend to launch the OAuth UI. */
    export interface ConnectSession
    {
        token      : string;                // hand to the frontend OAuth SDK
        expiresAt? : Type.ISODateTime;
    }

    /** Options when starting a connect flow. */
    export interface ConnectOptions
    {
        scopes?   : Array<string>;          // override/extend the integration's default scopes
        metadata? : Type.JsonObject;        // connection config to persist (e.g. a Shopify shop domain)
    }

    /** A provider-API call routed through the broker's proxy (auth injected). */
    export interface ProxyRequest
    {
        method   : HttpMethod;
        endpoint : string;                  // provider path, e.g. "/crm/v3/objects/contacts"
        params?  : Type.JsonObject;         // query string
        data?    : Type.Json;               // request body
        headers? : Record<string, string>;  // extra headers (auth is injected by the broker)
    }

    /** Connection config for a broker implementation (e.g. {@link NangoBroker}). */
    export interface Config
    {
        host?      : string;                // broker base URL (self-hosted Nango); default from env
        secretKey? : string;                // broker secret — from Secrets Manager in cloud, env locally
    }
}

export default OAuthBroker;
