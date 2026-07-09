//
import { randomUUID } from "node:crypto";

import { ObjectUtils, type Type } from "@repo/common";
import { RestfulEndpoint, Access } from "@repo/endpoint";
import { Browse, BrowseConfig, Media } from "@repo/api";

import MediaService from "./MediaService";
import { MediaPipeline } from "../pipeline/MediaPipeline";
import { BrowseFactory } from "../browse/BrowseFactory";
import { BrowseProvider, BrowseContext, BrowseAcquisition } from "../browse/BrowseProvider";

import GetBrowseProvidersImpl from "../endpoints/GetBrowseProvidersImpl";
import PostBrowseSearchImpl from "../endpoints/PostBrowseSearchImpl";
import PostBrowseImportImpl from "../endpoints/PostBrowseImportImpl";

//
// BROWSE role — the /media/browse/* asset marketplace (media-12..17). Fans out a normalized search across the
// enabled providers (factory adapters), imports acquisitions into the media plane as ordinary library assets
// with `source.origin = provider`. Separate role from MAIN so provider fan-out scales independently, but it
// shares the media plane (S3 + DDB + the scan/process pipeline).
//
export class MediaBrowseService extends MediaService
{
    private readonly factory : BrowseFactory = new BrowseFactory();

    /////////////////////////////////////////////////////////////////////
    constructor() { super( MediaService.Role.BROWSE ); }

    /////////////////////////////////////////////////////////////////////
    protected override async registerEndpoints() : Promise<void>
    {
        await super.registerEndpoints();          // keeps /health + /version
        this.register( new GetBrowseProvidersImpl( this ) );
        this.register( new PostBrowseSearchImpl( this ) );
        this.register( new PostBrowseImportImpl( this ) );
    }

    /////////////////////////////////////////////////////////////////////
    /** Seed the Browse policy (AppConfig `config/browse`) alongside the media settings. */
    protected override async init() : Promise<void>
    {
        await super.init();   // seeds MediaConfig at config/settings
        const seeded : Type.Result<BrowseConfig.Config> = await this.appConfig.ensureSeeded( "config", "browse", BrowseConfig.DEFAULT );
        if( seeded.ok ) this.log.info( "browse config ready" );
        else this.log.warn( "browse config seed failed — using DEFAULT until deployed", { error: seeded.error } );
    }

    /////////////////////////////////////////////////////////////////////
    /** The live Browse policy (enablement, per-type, limits), falling back to DEFAULT. */
    public async browseConfig() : Promise<BrowseConfig.Config>
    {
        const got : Type.Result<BrowseConfig.Config | undefined> = await this.appConfig.json<BrowseConfig.Config>( "config", "browse" );
        // deep-fill from DEFAULT so an older hosted config (seeded before the `providers` map / newer providers)
        // tolerates drift — else a stale doc yields an empty provider list even with keys configured.
        return got.ok && got.data ? ObjectUtils.withDefaults( got.data, BrowseConfig.DEFAULT ) : BrowseConfig.DEFAULT;
    }

    /////////////////////////////////////////////////////////////////////
    /** Resolve a provider's request credential from Secrets Manager (`browse-<provider>`, root-managed;
     *  identical on LocalStack and AWS). A secret may be a plain string (single-key providers, e.g. Pexels)
     *  or a JSON object of named credentials (multi-key providers, e.g. Unsplash `{ appId, accessKey,
     *  secretKey }` — only `accessKey` is used for public read-only search). Returns the primary credential
     *  string, or null when unset — the provider is then excluded from listing/search. */
    private async resolveKey( provider : Browse.Provider ) : Promise<string | null>
    {
        // secrets.get never throws — it returns ok:false (facade wraps the fetch AND the ARN resolution), so
        // no try/catch is needed here: an unset/unresolved secret is simply ok:false / undefined data.
        const got : Type.Result<string | undefined> = await this.secrets.get( `browse-${ provider }` );
        // distinguish the two failure modes so an empty provider list is diagnosable:
        //  • ok:false  → the ARN couldn't be resolved (the SECRET_BROWSE_<PROVIDER> env isn't injected into
        //    this role — redeploy the media stack + restart the role so its env carries the secret ARN), or the fetch failed.
        //  • ok:true but no data → the secret exists but is empty (set the key in the Console Secrets tab).
        if( !got.ok )    { this.log.warn( "browse.key unresolved — secret ARN not in env / fetch failed", { provider, secret: `browse-${ provider }`, error: got.error } ); return null; }
        if( !got.data )  { this.log.info( "browse.key empty — secret has no value", { provider, secret: `browse-${ provider }` } ); return null; }
        return this.primaryCredential( got.data );
    }

    /////////////////////////////////////////////////////////////////////
    // A secret value is either a raw key string or a JSON credential object; when JSON, pick the field the
    // adapter needs (accessKey → apiKey → key → accessToken → token), else fall back to the raw string.
    private primaryCredential( value : string ) : string | null
    {
        const trimmed : string = value.trim();
        if( !trimmed.startsWith( "{" ) ) return trimmed;
        try
        {
            const parsed : Record<string, unknown> = JSON.parse( trimmed ) as Record<string, unknown>;
            for( const field of [ "accessKey", "apiKey", "key", "accessToken", "token" ] )
            {
                const candidate : unknown = parsed[ field ];
                if( typeof candidate === "string" && candidate.length > 0 ) return candidate;
            }
            return null;
        }
        catch { return trimmed; }   // not valid JSON — treat the whole value as the key
    }

    /////////////////////////////////////////////////////////////////////
    /** Browse providers that need NO credential (public APIs) — always usable; their `apiKey` is "". */
    private static readonly KEYLESS_PROVIDERS : ReadonlySet<Browse.Provider> = new Set<Browse.Provider>( [ Browse.Provider.SVGL, Browse.Provider.ICONIFY ] );

    /** The API key for a provider: "" for a KEYLESS (public) provider, the resolved secret for a keyed one, or
     *  null when a keyed provider's secret is unset (→ excluded from listing / search / import). */
    private async apiKeyFor( provider : Browse.Provider ) : Promise<string | null>
    {
        if( MediaBrowseService.KEYLESS_PROVIDERS.has( provider ) ) return "";
        return this.resolveKey( provider );
    }

    /////////////////////////////////////////////////////////////////////
    /** The providers enabled (by config) AND resolvable (have a key), scoped to their enabled kinds. Each
     *  exclusion is LOGGED (no silent drops) so an empty list is diagnosable — the usual cause is a missing
     *  key (the `browse-<provider>` secret unset, or its ARN not injected into this role's env). */
    public async listProviders() : Promise<Array<Browse.ProviderInfo>>
    {
        const config : BrowseConfig.Config = await this.browseConfig();
        const infos : Array<Browse.ProviderInfo> = [];
        for( const provider of this.factory.providers() )
        {
            const policy : BrowseConfig.ProviderPolicy | undefined = config.providers[ provider ];
            const adapter : BrowseProvider | undefined = this.factory.get( provider );
            if( !policy?.enabled ) { this.log.info( "browse.provider skipped — not enabled in config", { provider, hasPolicy: !!policy } ); continue; }
            if( !adapter )         { this.log.info( "browse.provider skipped — no adapter registered", { provider } ); continue; }
            const key : string | null = await this.apiKeyFor( provider );
            if( key === null )     { this.log.info( "browse.provider skipped — no API key resolved", { provider, secret: `browse-${ provider }` } ); continue; }
            this.log.info( "browse.provider available", { provider } );
            infos.push( adapter.info( policy.enabledKinds ) );
        }
        return infos;
    }

    /////////////////////////////////////////////////////////////////////
    /** Normalized fan-out search (media-13.4): query every enabled+keyed+kind-matching provider concurrently,
     *  bounded by the per-provider timeout, then merge. A slow/failed provider is reported, not fatal. */
    public async search( query : Browse.Query ) : Promise<{ results : Array<Browse.Result>; providers : Array<Browse.ProviderStatus> }>
    {
        const config : BrowseConfig.Config = await this.browseConfig();
        const wantKinds : Array<Media.Kind> = ( query.kinds && query.kinds.length ) ? query.kinds : [ Media.Kind.IMAGE, Media.Kind.VIDEO, Media.Kind.AUDIO ];
        const wantProviders : Array<Browse.Provider> = ( query.providers && query.providers.length ) ? query.providers : this.factory.providers();

        // build one task per usable provider (enabled, keyed, serves a requested kind)
        const tasks : Array<{ provider : Browse.Provider; run : () => Promise<Array<Browse.Result>> }> = [];
        for( const provider of wantProviders )
        {
            const policy : BrowseConfig.ProviderPolicy | undefined = config.providers[ provider ];
            const adapter : BrowseProvider | undefined = this.factory.get( provider );
            if( !policy?.enabled || !adapter ) continue;
            const enabledKinds : Array<Media.Kind> = policy.enabledKinds;
            const matchKinds : Array<Media.Kind> = wantKinds.filter( ( k ) => enabledKinds.includes( k ) );
            if( matchKinds.length === 0 ) continue;
            const apiKey : string | null = await this.apiKeyFor( provider );
            if( apiKey === null ) continue;
            const ctx : BrowseContext = { apiKey, limits: config.limits };
            tasks.push( { provider, run: () => this.withTimeout( adapter.search( { ...query, kinds: matchKinds }, ctx ), config.limits.perProviderTimeoutMs, provider ) } );
        }

        const settled : Array<PromiseSettledResult<Array<Browse.Result>>> = await Promise.allSettled( tasks.map( ( t ) => t.run() ) );
        const results : Array<Browse.Result> = [];
        const statuses : Array<Browse.ProviderStatus> = [];
        settled.forEach( ( outcome, index ) =>
        {
            const provider : Browse.Provider = tasks[ index ].provider;
            if( outcome.status === "fulfilled" ) { results.push( ...outcome.value ); statuses.push( { provider, ok: true, count: outcome.value.length } ); }
            else { this.log.warn( "browse provider failed", { provider, error: String( outcome.reason ) } ); statuses.push( { provider, ok: false, count: 0, error: String( outcome.reason ) } ); }
        } );
        return { results, providers: statuses };
    }

    /////////////////////////////////////////////////////////////////////
    /** Import (download-free) a provider asset into the account library (media-15): fetch the licensed bytes,
     *  create a `source.origin = provider` Media.Asset, and run the standard scan → process pipeline. Returns
     *  `{ status, asset? }` for the impl to translate. */
    public async importAsset( auth : RestfulEndpoint.Authentication, provider : Browse.Provider, externalId : string ) : Promise<{ status : number; asset? : Media.Asset }>
    {
        const accountId : string | undefined = auth.accountId;
        if( !accountId ) return { status: 400 };

        const config : BrowseConfig.Config = await this.browseConfig();
        const policy : BrowseConfig.ProviderPolicy | undefined = config.providers[ provider ];
        const adapter : BrowseProvider | undefined = this.factory.get( provider );
        if( !policy?.enabled || !adapter ) return { status: 400 };
        const apiKey : string | null = await this.apiKeyFor( provider );
        if( apiKey === null ) return { status: 400 };

        const acquisition : BrowseAcquisition | null = await adapter.acquire( externalId, { apiKey, limits: config.limits } );
        if( !acquisition ) return { status: 404 };

        // resolve the bytes (inline or fetched server-side from the provider's licensed URL)
        let bytes : Uint8Array | undefined = acquisition.bytes;
        if( !bytes && acquisition.fetchUrl )
        {
            try
            {
                const response : Response = await fetch( acquisition.fetchUrl );
                if( !response.ok ) return { status: 502 };
                bytes = new Uint8Array( await response.arrayBuffer() );
            }
            catch { return { status: 502 }; }
        }
        if( !bytes ) return { status: 502 };

        const result : Browse.Result = acquisition.result;
        const now : string = new Date().toISOString();
        const guid : string = randomUUID();
        const extension : string = this.extensionFor( result, acquisition.fetchUrl );
        const mime : string = this.mimeFor( result.kind, extension );

        // the envelope's sole ORIGINAL item — the imported bytes; the pipeline derives the rest
        const original : Media.Item = {
            id: randomUUID(), usage: Media.Usage.ORIGINAL, kind: result.kind, mime, extension,
            size: bytes.length, version: 1, status: Media.Status.SCANNING, createdAt: now, modifiedAt: now,
        };
        const asset : Media.Asset = {
            accountId, guid,
            name:       this.filenameFor( result, extension ),
            kind:       result.kind,
            tier:       Media.Tier.PROTECTED, accessRole: Access.AccountRole.USER, status: Media.Status.SCANNING,
            scope:      Media.Scope.ACCOUNT, campaignIds: [], tags: result.tags ?? [], items: [ original ],
            source:     {
                origin: Media.SourceOrigin.PROVIDER, provider, externalId, sourceUrl: result.sourceUrl,
                license: result.license, cost: result.cost, acquiredAt: now, acquiredBy: auth.userId,
            },
            createdBy: auth.userId, createdAt: now, modifiedAt: now,
        };

        const put : Type.Result<void> = await this.s3.put( "media", MediaPipeline.itemKey( asset, original ), Buffer.from( bytes ), mime );
        if( !put.ok ) return { status: 500 };
        const wrote : Type.Result<void> = await this.dynamo.put( "media", { ...asset } );
        if( !wrote.ok ) return { status: 500 };
        await this.sqs.send( "media-scan", { accountId, guid } );   // → scan → process (variants + probe + poster)
        void this.assetCreated( asset, auth.userId );               // media.asset created (best-effort)
        return { status: 202, asset };
    }

    /////////////////////////////////////////////////////////////////////
    // bound a provider call by the per-provider timeout (a slow provider is excluded, not fatal)
    private withTimeout<T>( work : Promise<T>, ms : number, provider : Browse.Provider ) : Promise<T>
    {
        return Promise.race( [ work, new Promise<T>( ( _resolve, reject ) => setTimeout( () => reject( new Error( `${ provider } timed out after ${ ms }ms` ) ), ms ) ) ] );
    }

    /////////////////////////////////////////////////////////////////////
    // best-effort extension from the licensed URL, else a per-kind default
    private extensionFor( result : Browse.Result, fetchUrl? : string ) : string
    {
        const path : string = ( fetchUrl ?? result.downloadUrl ?? "" ).split( "?" )[ 0 ];
        const dot : number = path.lastIndexOf( "." );
        const ext : string = dot >= 0 ? path.slice( dot + 1 ).toLowerCase() : "";
        if( ext && ext.length <= 4 ) return ext;
        return result.kind === Media.Kind.VIDEO ? "mp4" : result.kind === Media.Kind.AUDIO ? "mp3" : "jpg";
    }

    private mimeFor( kind : Media.Kind, ext : string ) : string
    {
        if( kind === Media.Kind.VIDEO ) return ext === "mov" ? "video/quicktime" : ext === "webm" ? "video/webm" : "video/mp4";
        if( kind === Media.Kind.AUDIO ) return ext === "wav" ? "audio/wav" : ext === "m4a" ? "audio/mp4" : "audio/mpeg";
        return ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : ext === "gif" ? "image/gif" : "image/jpeg";
    }

    private filenameFor( result : Browse.Result, extension : string ) : string
    {
        const base : string = ( result.title || `${ result.provider }-${ result.externalId }` ).replace( /[^A-Za-z0-9._-]+/g, "-" ).slice( 0, 80 );
        return base.endsWith( `.${ extension }` ) ? base : `${ base }.${ extension }`;
    }
}

export default MediaBrowseService;
