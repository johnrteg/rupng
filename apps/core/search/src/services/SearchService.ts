//
import { Application, Service, Ports, Register, Search, Cache, Sqs } from "@repo/services";
import { SearchConfig } from "@repo/api";
import { Access, RestfulEndpoint } from "@repo/endpoint";
import { ObjectUtils, ResultUtils, type Type } from "@repo/common";

//
// SearchService — the domain base every concrete search role extends (mirrors AnalyticsService /
// VoiceService). Holds the shared domain wiring (the OpenSearch + Redis + SQS facades, the runtime
// config reader) AND the platform's security-critical shared piece: the mandatory RBAC query filter
// (search-3.1/3.2/3.3) that every read against OpenSearch MUST apply. Keeping that filter-building
// logic in ONE place (here, not duplicated per endpoint) is what makes it non-bypassable — no endpoint
// impl constructs its own account/role clause from scratch. NOT deployed alone.
//
export class SearchService extends Service
{
    private _search? : Search;
    private _cache?  : Cache;
    private _sqs?    : Sqs;

    ////////////////////////////////////////////////////////////////////////////////////////////
    constructor( role : SearchService.Role )
    {
        super( Register.Service.SEARCH, role, SearchService.PORT[ role ] );
        const pkg : Application.PackageInfo = this.loadPackageInfo( __dirname );
        this.setVersion( pkg.version );
        this.log.info( "version", { name: pkg.name, version: pkg.version } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** OpenSearch facade — the platform-shared cluster (`uses: [{ kind: SEARCH }]`, logical key
     *  `"search"`); every searchable doc type lives in {@link SearchService.INDEX}. */
    public get search() : Search { return this._search ??= new Search( this.cloud ); }
    /** Redis facade — the recent-search result cache (search-2.2), TTL from {@link SearchConfig.Config}. */
    public get cache() : Cache { return this._cache ??= new Cache( this.cloud, "cache" ); }
    /** SQS facade — the `search-reindex` request queue (`PostSearchInternalReindexImpl` enqueues here). */
    public get sqs() : Sqs { return this._sqs ??= new Sqs( this.cloud ); }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Seed the runtime config on a fresh environment so the service (and the Console Config tab) have
     *  usable defaults from first boot — same pattern as voice/media. */
    protected override async init() : Promise<void>
    {
        super.init();
        const seeded : Type.Result<SearchConfig.Config> = await this.appConfig.ensureSeeded( "config", "settings", SearchConfig.DEFAULT );
        if( seeded.ok ) this.log.info( "search config ready" );
        else this.log.warn( "search config seed failed — using DEFAULT until deployed", { error: seeded.error } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** The live runtime config (AppConfig `config/settings`), deep-filled from DEFAULT so an
     *  older/partial hosted row tolerates schema drift. Exposed so endpoint impls (which can't reach
     *  the protected `appConfig`) read indexedTypes/weights/cacheTtlSeconds/audit. */
    public async searchConfig() : Promise<SearchConfig.Config>
    {
        const got : Type.Result<SearchConfig.Config | undefined> = await this.appConfig.json<SearchConfig.Config>( "config", "settings" );
        this.log.trace( "config read: config/settings", { found: got.ok && got.data !== undefined } );
        return got.ok && got.data ? ObjectUtils.withDefaults( got.data, SearchConfig.DEFAULT ) : SearchConfig.DEFAULT;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Persist a new config version + deploy it (AppConfig control plane) — the PUT-config write path. */
    public async saveConfig( config : SearchConfig.Config, environment : string = process.env.APPCONFIG_ENV ?? "default" ) : Promise<Type.Result<void>>
    {
        const profileId : Type.Result<string> = await this.appConfig.profileId( "config", "settings" );
        if( !profileId.ok ) return { ok: false, error: profileId.error };
        const environmentId : Type.Result<string> = await this.appConfig.environmentId( "config", environment );
        if( !environmentId.ok ) return { ok: false, error: environmentId.error };

        const version : Type.Result<number> = await this.appConfig.createVersion( "config", profileId.data, JSON.stringify( config ) );
        if( !version.ok ) return { ok: false, error: version.error };
        const deployed : Type.Result<number> = await this.appConfig.deploy( "config", profileId.data, environmentId.data, version.data, { description: "search config update" } );
        if( !deployed.ok ) return { ok: false, error: deployed.error };
        return { ok: true, data: undefined };
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /**
     * THE security-critical, non-bypassable RBAC query filter (search-3.1/3.2/3.3) — the ONE place
     * this clause is built, so it can't drift per-endpoint. Returns the OpenSearch bool-query
     * `filter` clauses that MUST be ANDed onto every query: `accountId` pinned to the caller's acting
     * account, and `minAccess` restricted to the set of roles the caller's CURRENT role satisfies
     * (search-3.4: no cross-account search — `accountId` is always pinned, never omitted/widened).
     * Fails closed — `auth.accountId`/`auth.role` missing means "no query filter can be built",
     * never "search everything".
     */
    public rbacFilter( auth : RestfulEndpoint.Authentication ) : Type.Result<Array<Record<string, unknown>>>
    {
        if( !auth.accountId ) return ResultUtils.err( "no acting account (X-Account) — cannot scope a search" );
        if( !auth.role )      return ResultUtils.err( "no resolved role — cannot scope a search" );

        // every role whose combined-ladder rank is AT MOST the caller's own rank is a minAccess floor
        // the caller satisfies (Access.isAllowed semantics, inverted into the doc-side value set)
        const callerRole : Access.Role = auth.role as Access.Role;
        const allowedMinAccess : Array<Access.Role> = Access.LADDER.filter(
            ( candidate : Access.Role ) : boolean => Access.isAllowed( callerRole, candidate ) );

        return ResultUtils.ok( [
            { term:  { accountId: auth.accountId } },
            { terms: { minAccess: allowedMinAccess } },
        ] );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /**
     * The shared text-match clause (search-2.3/2.3.1) — phonetic + case-insensitive fuzzy match by
     * default, or (when `exact`) a verbatim case-insensitive phrase match against the `.exact`
     * sub-field. Shared by {@link GetSearchImpl}/{@link GetSearchSuggestImpl} so the two endpoints'
     * query DSL can't drift apart. NOTE (documented gap): this assumes `title`/`text`/`title.exact`/
     * `text.exact` field + analyzer mappings exist on the index — no index-mapping/analyzer-creation
     * step is built in this pass (SPECS gap, see SearchReindexJob), so until an operator or a
     * later migration creates those mappings, OpenSearch's dynamic default mapping applies (a plain
     * `standard` analyzer on `title`/`text`, no phonetic filter, no `.exact` keyword sub-field) —
     * the query DSL below is written for the INTENDED mapping and degrades to a plain
     * case-sensitive-ish text match until that mapping step lands.
     */
    public textClause( q : string, exact : boolean ) : Record<string, unknown>
    {
        if( exact )
        {
            return {
                bool: {
                    should: [
                        { match_phrase: { "title.exact": q } },
                        { match_phrase: { "text.exact":  q } },
                    ],
                    minimum_should_match: 1,
                },
            };
        }
        return {
            bool: {
                should: [
                    { match: { title: { query: q, fuzziness: "AUTO" } } },
                    { match: { text:  { query: q, fuzziness: "AUTO" } } },
                ],
                minimum_should_match: 1,
            },
        };
    }
}

export namespace SearchService
{
    export enum Role { MAIN = "main" }   // the one HTTP role — SearchQueryService (the indexer is a Consumer, not a Role here)

    export const PORT : Record<Role, number> =
    {
        [ Role.MAIN ] : Ports.SEARCH.MAIN,
    };

    /** The single shared OpenSearch index every doc type is indexed into (`type` field discriminates). */
    export const INDEX : string = "search-docs";
}

export default SearchService;
// eof
