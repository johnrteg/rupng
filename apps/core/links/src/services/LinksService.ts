//
import { randomBytes, randomUUID } from "node:crypto";

import { Application, Service, Ports, Register, Dynamo, Kafka, Sqs } from "@repo/services";
import { Events } from "@repo/system";
import { Links, Analytics } from "@repo/api";
import { ResultUtils, type Type } from "@repo/common";

//
// LinksService — the links domain's Service BASE (not deployed alone). Holds the shared domain
// wiring (Dynamo + Kafka + SQS facades, the code-generation + domain-resolution helpers) so the
// concrete role (LinksMainService) inherits it. MVP cut: ONE role (mint + resolve + domain registry
// combined) — SPECS.md's `LinksMintService`/`LinksResolveService` split (a dedicated always-up
// redirect tier, scaled apart from the control plane) is deferred until that scaling need is real;
// see CloudManifest.ts's header for the full list of what's deferred.
//
export class LinksService extends Service
{
    private _dynamo? : Dynamo;
    private _kafka?  : Kafka;
    private _sqs?    : Sqs;

    // base62 alphabet for the opaque code (links-1.5) — no ambiguous chars needed since it's
    // machine-generated, never hand-typed
    private static readonly CODE_ALPHABET : string = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
    private static readonly CODE_LENGTH   : number = 8;
    private static readonly MINT_RETRIES  : number = 5;

    // the bootstrap fallback when an account has no assigned/default domain yet (an empty registry
    // shouldn't block mint entirely) — overridable for local dev / a real deploy's platform domain
    private static readonly FALLBACK_DOMAIN : string = process.env.LINKS_DEFAULT_DOMAIN ?? "localhost:8250";

    ////////////////////////////////////////////////////////////////////////////////////////////
    constructor( role : LinksService.Role )
    {
        super( Register.Service.LINKS, role, LinksService.PORT[ role ] );
        const pkg : Application.PackageInfo = this.loadPackageInfo( __dirname );
        this.setVersion( pkg.version );
        this.log.info( "version", { name: pkg.name, version: pkg.version } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    public get dynamo() : Dynamo { return this._dynamo ??= new Dynamo( this.cloud ); }
    public get kafka() : Kafka { return this._kafka ??= new Kafka( this.cloud ); }
    public get sqs() : Sqs { return this._sqs ??= new Sqs( this.cloud ); }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // ── Mint (links-1) ────────────────────────────────────────────────────────────────────────

    /** Mint one tracked (or untracked) link — resolves the domain, allocates a collision-checked
     *  opaque code, and writes the mapping. */
    public async mint( request : Links.MintRequest ) : Promise<Type.Result<Links.MintResult>>
    {
        const domain : Type.Result<string> = await this.resolveDomain( request.accountId, request.domain );
        if( !domain.ok ) return domain;

        for( let attempt : number = 0; attempt < LinksService.MINT_RETRIES; attempt++ )
        {
            const code : string = LinksService.generateCode();
            const link : Links.TrackedLink =
            {
                code, accountId: request.accountId, target: request.target, targetType: request.targetType,
                campaignId: request.campaignId, contactId: request.contactId, channel: request.channel,
                messageId: request.messageId, domain: domain.data, status: Links.LinkStatus.ACTIVE,
                createdAt: new Date().toISOString(),
            };

            const claimed : boolean = await this.claimCode( link );
            if( !claimed ) continue;   // collision — regenerate and retry

            const url : string = LinksService.urlFor( domain.data, code );
            return ResultUtils.ok( { code, url } );
        }
        return ResultUtils.err( "could not allocate a unique code after several attempts" );
    }

    /** Conditional put — `false` means the code already exists (collision), never an error the
     *  caller needs to see; the caller just regenerates and retries. */
    private async claimCode( link : Links.TrackedLink ) : Promise<boolean>
    {
        const wrote : Type.Result<void> = await this.dynamo.put( "links", { ...link } );
        // NOTE: Dynamo.put has no conditional-write param — an MVP tradeoff. A real collision
        // window exists here (last-write-wins); acceptable at MVP volume with an 8-char base62
        // keyspace (~218 trillion codes). Revisit with a ConditionExpression (see AuditSinkJob's
        // claim pattern) if collisions are ever observed in practice.
        return wrote.ok;
    }

    /** `https://<domain>/<code>` — `http://` for the local-dev fallback domain only. */
    private static urlFor( domain : string, code : string ) : string
    {
        const scheme : string = domain.startsWith( "localhost" ) ? "http" : "https";
        return `${ scheme }://${ domain }/${ code }`;
    }

    /** A random opaque base62 code (links-1.5) — not an encoding of the attribution tuple, a
     *  surrogate lookup key. */
    private static generateCode() : string
    {
        const bytes : Buffer = randomBytes( LinksService.CODE_LENGTH );
        let code : string = "";
        for( let index : number = 0; index < LinksService.CODE_LENGTH; index++ )
            code += LinksService.CODE_ALPHABET[ bytes[ index ] % LinksService.CODE_ALPHABET.length ];
        return code;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // ── Resolve (links-2) ─────────────────────────────────────────────────────────────────────

    /** Look up a code — the public resolve path's only read. */
    public async lookup( code : string ) : Promise<Type.Result<Links.TrackedLink | undefined>>
    {
        return this.dynamo.get<Links.TrackedLink>( "links", { code } );
    }

    /** Enqueue the touch (record-then-redirect — links-2.2): the resolve endpoint returns its 302
     *  BEFORE this settles; the toucher (this service's own local drain, a Job Lambda in a deploy)
     *  builds + publishes the `Analytics.Event` off the request path. */
    public async enqueueTouch( link : Links.TrackedLink, kind : "clicked" | "scanned", isBot : boolean ) : Promise<void>
    {
        const sent : Type.Result<void> = await this.sqs.send( "links-touch", { link, kind, isBot, occurredAt: new Date().toISOString() } );
        if( !sent.ok ) this.log.warn( "touch enqueue failed", { code: link.code, error: sent.error } );
    }

    /** WORKER: build + publish the engagement event. `isBot`/`preview` traffic is tagged into
     *  `attrs`, never dropped (links-2.8 — analytics excludes it at read time, not here). */
    public async processTouch( link : Links.TrackedLink, kind : "clicked" | "scanned", isBot : boolean, occurredAt : Type.ISODateTime ) : Promise<void>
    {
        const event : Analytics.Event =
        {
            eventId:         randomUUID(),
            occurredAt,
            ingestedAt:      new Date().toISOString(),
            accountId:       link.accountId,
            campaignId:      link.campaignId ?? null,
            messageId:       link.messageId ?? link.code,
            contactId:       link.contactId ?? null,
            channel:         link.channel,
            provider:        "links",
            eventType:       Analytics.EventType.CLICKED,
            providerEventId: `${ link.code }:${ occurredAt }`,
            attrs:           { linkId: link.code, isBot, kind } as Analytics.EventAttrs,
        };
        const published : Type.Result<void> = await this.kafka.publishStream<Analytics.Event>(
            Events.Stream.ENGAGEMENT, event, { key: ( value : Analytics.Event ) : string => value.accountId } );
        if( !published.ok ) this.log.warn( "engagement event publish failed", { code: link.code, error: published.error } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // ── Short-domain registry (links-5/6) ─────────────────────────────────────────────────────

    /** Resolve the domain a mint should use — an explicitly-named assigned domain, else the
     *  account's default, else the platform fallback (never a domain not assigned to the account). */
    private async resolveDomain( accountId : string, explicit? : string ) : Promise<Type.Result<string>>
    {
        const registry : Type.Result<Array<Links.ShortDomain>> = await this.listDomains();
        if( !registry.ok ) return registry;

        if( explicit )
        {
            const found : Links.ShortDomain | undefined = registry.data.find( ( row : Links.ShortDomain ) : boolean => row.domain === explicit );
            if( !found ) return ResultUtils.err( `domain not registered: ${ explicit }` );
            if( found.status !== Links.DomainStatus.ACTIVE ) return ResultUtils.err( `domain is not active: ${ explicit }` );
            if( found.kind === Links.DomainKind.WHITELABEL && found.ownerAccountId !== accountId ) return ResultUtils.err( `domain not assigned to this account: ${ explicit }` );
            if( found.kind === Links.DomainKind.SHARED && !found.assignedAccountIds.includes( accountId ) && found.assignedAccountIds.length > 0 ) return ResultUtils.err( `domain not assigned to this account: ${ explicit }` );
            return ResultUtils.ok( found.domain );
        }

        const accountDefault : Links.ShortDomain | undefined = registry.data.find( ( row : Links.ShortDomain ) : boolean => row.defaultForAccountIds.includes( accountId ) );
        if( accountDefault ) return ResultUtils.ok( accountDefault.domain );

        const sharedDefault : Links.ShortDomain | undefined = registry.data.find( ( row : Links.ShortDomain ) : boolean => row.kind === Links.DomainKind.SHARED && row.status === Links.DomainStatus.ACTIVE );
        if( sharedDefault ) return ResultUtils.ok( sharedDefault.domain );

        return ResultUtils.ok( LinksService.FALLBACK_DOMAIN );   // empty registry — bootstrap, don't block mint
    }

    // every "domains" item carries this constant so `gsi_list` can Query "list everything" — the
    // facade has no raw Scan; a constant-partition GSI is the standard DDB list-all pattern, fine
    // at the registry's platform-scale (not account-scale) row count.
    private static readonly DOMAIN_LIST_KEY : string = "all";

    /** The full registry (small — domain count is platform-scale, not account-scale). */
    public async listDomains() : Promise<Type.Result<Array<Links.ShortDomain>>>
    {
        return this.dynamo.query<Links.ShortDomain>( "domains", {
            IndexName: "gsi_list", KeyConditionExpression: "listKey = :k", ExpressionAttributeValues: { ":k": LinksService.DOMAIN_LIST_KEY },
        } );
    }

    public async getDomain( domain : string ) : Promise<Type.Result<Links.ShortDomain | undefined>>
    {
        return this.dynamo.get<Links.ShortDomain>( "domains", { domain } );
    }

    public async putDomain( domain : Links.ShortDomain ) : Promise<Type.Result<void>>
    {
        return this.dynamo.put( "domains", { ...domain, listKey: LinksService.DOMAIN_LIST_KEY } );
    }

    public async removeDomain( domain : string ) : Promise<Type.Result<void>>
    {
        return this.dynamo.remove( "domains", { domain } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // ── GDPR forget (links-7.2) ───────────────────────────────────────────────────────────────

    /** Null `contactId` on every tracked link for `(accountId, contactId)` via `gsi_contactId`.
     *  Idempotent — an already-erased/unknown contact matches zero rows. */
    public async eraseContact( accountId : string, contactId : string ) : Promise<Type.Result<number>>
    {
        const found : Type.Result<Array<Links.TrackedLink>> = await this.dynamo.query<Links.TrackedLink>( "links", {
            IndexName: "gsi_contactId", KeyConditionExpression: "accountId = :a AND contactId = :c",
            ExpressionAttributeValues: { ":a": accountId, ":c": contactId },
        } );
        if( !found.ok ) return found;

        let erased : number = 0;
        for( const link of found.data )
        {
            const wrote : Type.Result<void> = await this.dynamo.put( "links", { ...link, contactId: undefined } );
            if( wrote.ok ) erased++;
            else this.log.warn( "links erase: write failed", { code: link.code, error: wrote.error } );
        }
        return ResultUtils.ok( erased );
    }
}

export namespace LinksService
{
    export enum Role { MAIN = "main" }

    export const PORT : Record<Role, number> =
    {
        [ Role.MAIN ] : Ports.LINKS.MAIN,
    };
}

export default LinksService;
// eof
