//
// FakeService — the base for the "fake provider" category of services (a simulated external vendor: a fake ESP,
// fake SMS gateway, …). It reuses the platform `Service` HTTP server / health / version / logging, but is a
// deliberate LEAF: NO Kafka, NO cross-service events, NO platform Authorizer/JWT. It authenticates ONLY by a
// hard-coded / issued fake API key, and it carries the shared SaaS-simulator machinery every fake needs — a
// fake-key registry, an in-memory message store (per account), and a set of behavior KNOBS (delivery outcomes,
// rate-limit / timeout / outage) evaluated on each send. A concrete channel — e.g. `FakeEmailService` — supplies
// the vendor-shaped routes + payload mapping and reads/writes the behavior config.
//
// DEV ONLY. These services never run in prod; they exist so the real send path (HTTP call, auth, retry/DLQ,
// idempotency, delivery outcomes) can be exercised offline. See apps/core/email/specs/FAKE_PROVIDER.md.
//
import type { FastifyRequest } from 'fastify';
import { randomUUID } from 'crypto';

import { RestfulEndpoint } from '@repo/endpoint';
import { NetworkUtils } from '@repo/common';
import type { Register } from '@repo/system';

import { Service } from './Service';

export abstract class FakeService extends Service
{
    // the always-accepted default key (zero-config testing); plus per-account keys issued at runtime
    private readonly keys : Map<string, FakeService.KeyInfo> = new Map<string, FakeService.KeyInfo>();

    // the service-wide behavior "personality" (console-editable) — seeded ALL-OFF = clean pass-through sink
    private behaviorConfig : FakeService.Behavior = { ...FakeService.DEFAULT_BEHAVIOR };

    // the in-memory message store, partitioned by account (keys roll up to an account)
    private readonly store : Map<string, Array<FakeService.Record>> = new Map<string, Array<FakeService.Record>>();

    // rate-limit window — recent send timestamps (ms) per account
    private readonly rateWindow : Map<string, Array<number>> = new Map<string, Array<number>>();

    ////////////////////////////////////////////////////////////////////////////////////////////
    constructor( service : Register.Service, role? : string, port? : number )
    {
        super( service, role, port );
        // seed the well-known default key → the shared "default" tenant
        this.keys.set( FakeService.DEFAULT_KEY, { key: FakeService.DEFAULT_KEY, accountId: FakeService.DEFAULT_ACCOUNT, createdAt: new Date().toISOString(), active: true } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // ── fake API keys ─────────────────────────────────────────────────────────────────────────

    /** Mint a per-account fake key (the marketplace-install / provisioning hook). */
    protected issueKey( accountId : string, label? : string ) : FakeService.KeyInfo
    {
        const info : FakeService.KeyInfo = { key: `fake-${ randomUUID() }`, accountId, label, createdAt: new Date().toISOString(), active: true };
        this.keys.set( info.key, info );
        return info;
    }

    /** Revoke a key (the default key can't be revoked). */
    protected revokeKey( key : string ) : boolean
    {
        if( key === FakeService.DEFAULT_KEY ) return false;
        return this.keys.delete( key );
    }

    /** All issued keys (for the control API / console). */
    protected listKeys() : Array<FakeService.KeyInfo> { return [ ...this.keys.values() ]; }

    /** The account a key belongs to, or undefined if unknown/inactive. */
    protected accountForKey( key : string ) : string | undefined
    {
        const info : FakeService.KeyInfo | undefined = this.keys.get( key );
        return info !== undefined && info.active ? info.accountId : undefined;
    }

    // pull the Bearer token off a request
    private bearer( request : FastifyRequest ) : string | undefined
    {
        const header : string = String( ( request.headers as Record<string, unknown> ).authorization ?? "" );
        return header.startsWith( "Bearer " ) ? header.slice( 7 ).trim() : undefined;
    }

    /** Wrap a handler with fake-key auth — resolves the caller's account from the Bearer key, or returns 401.
     *  Use with the raw-route helpers (`this.post(uri, this.secured(...))`) so the platform Authorizer is never
     *  touched (that's the whole point of a fake leaf). */
    protected secured( handler : FakeService.Handler ) : Service.RequestCallbackAsync
    {
        return async ( request : FastifyRequest ) : Promise<RestfulEndpoint.Response> =>
        {
            // resolve the key → account (missing/wrong/inactive key → 401, exactly like a real ESP)
            const key : string | undefined = this.bearer( request );
            const accountId : string | undefined = key ? this.accountForKey( key ) : undefined;
            if( key === undefined || accountId === undefined ) return { status: NetworkUtils.Status.UNAUTHORIZED, data: { message: "invalid or missing API key" } };
            return handler( request, { accountId, key } );
        };
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // ── behavior config (the "personality" knobs) ───────────────────────────────────────────────

    /** The current behavior config. */
    protected behavior() : FakeService.Behavior { return this.behaviorConfig; }

    /** Replace the behavior config (the console's PUT-config write). */
    protected setBehavior( next : FakeService.Behavior ) : void { this.behaviorConfig = next; }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // ── connection-level gate (evaluated before recipients) ─────────────────────────────────────

    /** Apply the connection-level knobs (unavailability, rate limit, slow/timeout) for an account. Returns a
     *  short-circuit failure to send back, or undefined to proceed (after any injected delay). */
    protected async connectionGate( accountId : string ) : Promise<RestfulEndpoint.Response | undefined>
    {
        const behavior : FakeService.Behavior = this.behaviorConfig;

        // outage window → 503
        if( behavior.unavailable.enabled ) return { status: NetworkUtils.Status.SERVICE_UNAVAIL, data: { message: "fake: service unavailable" } };

        // rate limit → 429 with Retry-After
        if( behavior.rateLimit.enabled && behavior.rateLimit.perMinute > 0 )
        {
            const now : number = Date.now();
            const recent : Array<number> = ( this.rateWindow.get( accountId ) ?? [] ).filter( ( at : number ) : boolean => now - at < 60_000 );
            if( recent.length >= behavior.rateLimit.perMinute ) return { status: NetworkUtils.Status.TOO_MANY_REQUESTS, data: { message: "fake: rate limit exceeded", retryAfterSeconds: 60 } };
            recent.push( now );
            this.rateWindow.set( accountId, recent );
        }

        // slow response → hold the reply long enough to exceed the client timeout
        if( behavior.timeout.enabled && behavior.timeout.seconds > 0 ) await this.delay( behavior.timeout.seconds * 1000 );

        // realistic latency jitter on every accepted send (a distribution, not a hang)
        if( behavior.latency.enabled && behavior.latency.maxMs > 0 )
        {
            const span : number = Math.max( 0, behavior.latency.maxMs - behavior.latency.minMs );
            await this.delay( behavior.latency.minMs + Math.floor( Math.random() * ( span + 1 ) ) );
        }

        return undefined;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** The bounce reason category for an address — a magic address forces it, else the config default. */
    protected bounceCategoryFor( address : string ) : string
    {
        return FakeService.magicBounceCategory( address ) ?? this.behaviorConfig.bounceCategory;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // ── delivery outcome (per recipient) ────────────────────────────────────────────────────────

    /** The delivery outcome for one recipient — a magic address forces a deterministic result; otherwise the
     *  delivery-percentage knobs decide (evaluated in priority order; the remainder is DELIVERED). */
    protected deliveryOutcome( address : string ) : FakeService.Delivery
    {
        const magic : FakeService.Delivery | undefined = FakeService.magicOutcome( address );
        if( magic !== undefined ) return magic;

        const behavior : FakeService.Behavior = this.behaviorConfig;
        const roll : number = Math.random() * 100;
        // priority order: hard bounce → complaint → soft bounce → deferred → invalid → delivered
        if( behavior.hardBounce.enabled && roll < behavior.hardBounce.percent ) return FakeService.Delivery.HARD_BOUNCE;
        if( behavior.complaint.enabled && roll < behavior.complaint.percent ) return FakeService.Delivery.COMPLAINT;
        if( behavior.softBounce.enabled && roll < behavior.softBounce.percent ) return FakeService.Delivery.SOFT_BOUNCE;
        if( behavior.deferred.enabled && roll < behavior.deferred.percent ) return FakeService.Delivery.DEFERRED;
        if( behavior.invalid.enabled && roll < behavior.invalid.percent ) return FakeService.Delivery.INVALID;
        return FakeService.Delivery.DELIVERED;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // ── message store (per account, in-memory) ──────────────────────────────────────────────────

    /** Store a message record for an account (pruned to the configured max, newest kept). */
    protected record( accountId : string, entry : FakeService.Record ) : void
    {
        const list : Array<FakeService.Record> = this.store.get( accountId ) ?? [];
        list.push( entry );
        // bound the store — drop the oldest beyond maxMessages
        const max : number = this.behaviorConfig.maxMessages;
        while( max > 0 && list.length > max ) list.shift();
        this.store.set( accountId, list );
    }

    /** List an account's messages, newest first (TTL-pruned on read). */
    protected messages( accountId : string ) : Array<FakeService.Record>
    {
        const ttlMs : number = this.behaviorConfig.ttlSeconds * 1000;
        const now : number = Date.now();
        const live : Array<FakeService.Record> = ( this.store.get( accountId ) ?? [] )
            .filter( ( entry : FakeService.Record ) : boolean => ttlMs <= 0 || now - Date.parse( entry.at ) < ttlMs );
        this.store.set( accountId, live );
        return [ ...live ].reverse();
    }

    /** One message by id for an account. */
    protected message( accountId : string, id : string ) : FakeService.Record | undefined
    {
        return ( this.store.get( accountId ) ?? [] ).find( ( entry : FakeService.Record ) : boolean => entry.id === id );
    }

    /** Clear an account's inbox. */
    protected resetAccount( accountId : string ) : void { this.store.delete( accountId ); this.rateWindow.delete( accountId ); }

    /** Count by delivery outcome for an account (the metrics surface). */
    protected metricsFor( accountId : string ) : Record<string, number>
    {
        const counts : Record<string, number> = {};
        for( const entry of this.store.get( accountId ) ?? [] ) counts[ entry.delivery ] = ( counts[ entry.delivery ] ?? 0 ) + 1;
        return counts;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Small sleep helper (used by the slow/timeout knob + subclasses). */
    protected delay( ms : number ) : Promise<void> { return new Promise( ( resolve ) => setTimeout( resolve, ms ) ); }
}

export namespace FakeService
{
    /** The always-accepted default key + the tenant it maps to. */
    export const DEFAULT_KEY : string = "0000-00-0000";
    export const DEFAULT_ACCOUNT : string = "default";

    /** An issued fake key. */
    export interface KeyInfo { key : string; accountId : string; label? : string; createdAt : string; active : boolean; }

    /** The auth context a secured handler receives. */
    export interface Ctx { accountId : string; key : string; }

    /** A fake-key-authed route handler. */
    export type Handler = ( request : FastifyRequest, ctx : Ctx ) => Promise<RestfulEndpoint.Response>;

    /** A per-recipient delivery result. */
    export enum Delivery
    {
        DELIVERED   = "delivered",
        HARD_BOUNCE = "hard-bounce",
        SOFT_BOUNCE = "soft-bounce",
        COMPLAINT   = "complaint",
        DEFERRED    = "deferred",
        INVALID     = "invalid",
    }

    /** An event on a stored message (accepted / delivered / bounced / open / click / unsubscribe …). */
    export interface Event { type : string; at : string; detail? : string; }

    /** A stored message (channel-agnostic — the vendor payload rides in `payload`). */
    export interface Record
    {
        id       : string;
        accountId : string;
        at       : string;
        to       : Array<string>;
        summary? : string;                 // a human label (e.g. the email subject)
        delivery : Delivery;
        events   : Array<Event>;
        payload  : unknown;                // the raw channel request (rendered html/text/headers for email)
        raw?     : string;                 // the emitted wire-format source (e.g. the RFC822/MIME email text)
    }

    // ── behavior knobs (each independently on/off + a parameter; DEFAULT = all off) ──────────────
    export interface Toggle { enabled : boolean; }
    export interface RateKnob extends Toggle { perMinute : number; }
    export interface TimeoutKnob extends Toggle { seconds : number; }
    export interface PctKnob extends Toggle { percent : number; }
    export interface EngagementKnob extends Toggle { percent : number; delayMinSec : number; delayMaxSec : number; }
    export interface LatencyKnob extends Toggle { minMs : number; maxMs : number; }
    export interface LimitsKnob extends Toggle { maxSizeBytes : number; maxRecipients : number; }

    /** A bounce reason category (RFC-ish classification a real ESP reports). */
    export enum BounceCategory { MAILBOX_FULL = "mailbox-full", NO_SUCH_USER = "no-such-user", BLOCKED = "blocked", CONTENT = "content" }

    export interface Behavior
    {
        // connection-level
        rateLimit   : RateKnob;
        timeout     : TimeoutKnob;                 // force-exceed the client timeout (a hang)
        unavailable : Toggle;
        latency     : LatencyKnob;                 // realistic per-send jitter (distinct from the force-timeout)
        // delivery-level (per recipient)
        hardBounce  : PctKnob;
        softBounce  : PctKnob;
        complaint   : PctKnob;
        deferred    : PctKnob;
        invalid     : PctKnob;
        bounceCategory : string;                   // default bounce category when not forced by a magic address
        // validation limits (reject oversize / too-many-recipient sends)
        limits      : LimitsKnob;
        // engagement (per delivered recipient) — modeled now; async dispatch is a later addition
        open        : EngagementKnob;
        click       : EngagementKnob;
        unsubscribe : EngagementKnob;
        // storage + webhook
        ttlSeconds  : number;
        maxMessages : number;
        webhookEnabled : boolean;
        webhookUrl  : string;
    }

    /** The seeded default — EVERYTHING OFF: full delivery, no bounces/complaints, no engagement, no webhooks,
     *  no rate-limit/timeout/outage. A clean no-surprise sink until an operator tunes it. */
    export const DEFAULT_BEHAVIOR : Behavior =
    {
        rateLimit:   { enabled: false, perMinute: 10 },
        timeout:     { enabled: false, seconds: 10 },
        unavailable: { enabled: false },
        latency:     { enabled: false, minMs: 50, maxMs: 500 },
        hardBounce:  { enabled: false, percent: 10 },
        softBounce:  { enabled: false, percent: 5 },
        complaint:   { enabled: false, percent: 2 },
        deferred:    { enabled: false, percent: 5 },
        invalid:     { enabled: false, percent: 5 },
        bounceCategory: BounceCategory.MAILBOX_FULL,
        limits:      { enabled: false, maxSizeBytes: 10485760, maxRecipients: 1000 },
        open:        { enabled: false, percent: 40, delayMinSec: 60, delayMaxSec: 900 },
        click:       { enabled: false, percent: 10, delayMinSec: 120, delayMaxSec: 1800 },
        unsubscribe: { enabled: false, percent: 5,  delayMinSec: 60,  delayMaxSec: 900 },
        ttlSeconds:  86400,        // 24h
        maxMessages: 1000,
        webhookEnabled: false,
        webhookUrl:  "http://localhost:9000/webhook/email/fake",
    };

    /** Map a magic recipient address (reserved `@fake.test` local parts, or a `+tag` subaddress) to a forced
     *  deterministic outcome — else undefined (fall through to the probability knobs). */
    export function magicOutcome( address : string ) : Delivery | undefined
    {
        const tag : string = magicTag( address );
        // category addresses (mailbox-full / no-such-user / blocked / content) are all hard bounces
        if( tag === "bounce" || tag === "hard-bounce" || tag === "mailbox-full" || tag === "no-such-user" || tag === "blocked" || tag === "content" ) return Delivery.HARD_BOUNCE;
        if( tag === "soft-bounce" ) return Delivery.SOFT_BOUNCE;
        if( tag === "complaint" ) return Delivery.COMPLAINT;
        if( tag === "defer" ) return Delivery.DEFERRED;
        if( tag === "invalid" ) return Delivery.INVALID;
        return undefined;
    }

    /** The forced bounce CATEGORY for a magic address, else undefined (fall back to the config default). */
    export function magicBounceCategory( address : string ) : string | undefined
    {
        const tag : string = magicTag( address );
        if( tag === "mailbox-full" ) return BounceCategory.MAILBOX_FULL;
        if( tag === "no-such-user" ) return BounceCategory.NO_SUCH_USER;
        if( tag === "blocked" ) return BounceCategory.BLOCKED;
        if( tag === "content" ) return BounceCategory.CONTENT;
        return undefined;
    }

    // the local-part tag of an address (the part after a `+`, or the whole local part), lower-cased
    function magicTag( address : string ) : string
    {
        const local : string = address.toLowerCase().split( "@" )[ 0 ] ?? "";
        return local.includes( "+" ) ? local.slice( local.indexOf( "+" ) + 1 ) : local;
    }
}

export default FakeService;
// eof
