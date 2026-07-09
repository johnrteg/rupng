//
import { randomUUID } from "node:crypto";
import type { FastifyRequest } from "fastify";

import { Application, FakeService, Ports, Register } from "@repo/services";
import { RestfulEndpoint } from "@repo/endpoint";
import { NetworkUtils } from "@repo/common";

//
// FakeEmailService — the DEV-ONLY simulated email provider (a "fake ESP"). Extends the shared `FakeService`
// base (fake-key auth, in-memory message store, behavior knobs) and adds the vendor-shaped HTTP API: a send
// endpoint, an inbox (list/get), and control endpoints (issue key / reset / metrics / config). Every route is
// fake-key authed via `secured()` and served as a RAW route — the platform Authorizer/Kafka are never touched.
// See apps/core/email/specs/FAKE_PROVIDER.md.
//
export class FakeEmailService extends FakeService
{
    // idempotency memo (accountId|key → messageId) so a repeat send returns the same id (like a real ESP)
    private readonly idempotency : Map<string, string> = new Map<string, string>();

    ////////////////////////////////////////////////////////////////////////////////////////////
    constructor()
    {
        super( Register.Service.FAKE_EMAIL, FakeEmailService.Role.MAIN, Ports.FAKE_EMAIL.MAIN );
        const pkg : Application.PackageInfo = this.loadPackageInfo( __dirname );
        this.setVersion( pkg.version );
        this.log.info( "version", { name: pkg.name, version: pkg.version } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Register the fake ESP routes (after the inherited /health + /version). All are fake-key authed raw
     *  routes — no RestfulEndpoint contract, no platform auth. */
    protected override async registerEndpoints() : Promise<void>
    {
        await super.registerEndpoints();          // keeps /health + /version

        // vendor-shaped send + inbox
        this.post( "/v1/messages",     this.secured( ( request : FastifyRequest, ctx : FakeService.Ctx ) : Promise<RestfulEndpoint.Response> => this.handleSend( request, ctx ) ) );
        this.get(  "/v1/messages",     this.secured( ( request : FastifyRequest, ctx : FakeService.Ctx ) : Promise<RestfulEndpoint.Response> => this.handleList( request, ctx ) ) );
        this.get(  "/v1/messages/:id", this.secured( ( request : FastifyRequest, ctx : FakeService.Ctx ) : Promise<RestfulEndpoint.Response> => this.handleGet( request, ctx ) ) );

        // control plane
        this.post( "/v1/_control/keys",  this.secured( ( request : FastifyRequest, ctx : FakeService.Ctx ) : Promise<RestfulEndpoint.Response> => this.handleIssueKey( request, ctx ) ) );
        this.get(  "/v1/_control/keys",  this.secured( ( _request : FastifyRequest, _ctx : FakeService.Ctx ) : Promise<RestfulEndpoint.Response> => this.handleListKeys() ) );
        this.post( "/v1/_control/reset", this.secured( ( _request : FastifyRequest, ctx : FakeService.Ctx ) : Promise<RestfulEndpoint.Response> => this.handleReset( ctx ) ) );
        this.get(  "/v1/_metrics",       this.secured( ( _request : FastifyRequest, ctx : FakeService.Ctx ) : Promise<RestfulEndpoint.Response> => this.handleMetrics( ctx ) ) );

        // behavior config (the Console's read/write surface)
        this.get(  "/v1/config", this.secured( ( _request : FastifyRequest, _ctx : FakeService.Ctx ) : Promise<RestfulEndpoint.Response> => this.handleGetConfig() ) );
        this.put(  "/v1/config", this.secured( ( request : FastifyRequest, _ctx : FakeService.Ctx ) : Promise<RestfulEndpoint.Response> => this.handleSetConfig( request ) ) );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // POST /v1/messages — accept a send: connection gate → validation limits → PER-RECIPIENT delivery outcomes
    // (with bounce categories) → store → ESP reply with the accepted/rejected breakdown.
    private async handleSend( request : FastifyRequest, ctx : FakeService.Ctx ) : Promise<RestfulEndpoint.Response>
    {
        // connection-level knobs (outage / rate-limit / slow / latency) can short-circuit before we read recipients
        const gate : RestfulEndpoint.Response | undefined = await this.connectionGate( ctx.accountId );
        if( gate !== undefined ) return gate;

        const body : FakeEmailService.SendBody = ( request.body ?? {} ) as FakeEmailService.SendBody;
        const to : Array<string> = Array.isArray( body.to ) ? body.to : [];
        if( to.length === 0 ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "at least one recipient (to) is required" } };

        // validation limits — reject an oversize body (413) or too many recipients (400) when enabled
        const behavior : FakeService.Behavior = this.behavior();
        if( behavior.limits.enabled )
        {
            const sizeBytes : number = JSON.stringify( { html: body.html, text: body.text, headers: body.headers } ).length;
            if( behavior.limits.maxSizeBytes > 0 && sizeBytes > behavior.limits.maxSizeBytes )
                return { status: NetworkUtils.Status.REQUEST_ENTITY_TOO_LONG, data: { message: `message too large (${ sizeBytes } > ${ behavior.limits.maxSizeBytes } bytes)` } };
            if( behavior.limits.maxRecipients > 0 && to.length > behavior.limits.maxRecipients )
                return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: `too many recipients (${ to.length } > ${ behavior.limits.maxRecipients })` } };
        }

        // idempotency — a repeat key returns the same id, no second store
        const memo : string = `${ ctx.accountId }|${ body.idempotencyKey ?? "" }`;
        if( body.idempotencyKey && this.idempotency.has( memo ) )
            return { status: NetworkUtils.Status.ACCEPTED, data: { id: this.idempotency.get( memo ), status: "accepted", deduped: true } };

        // evaluate EACH recipient — malformed → rejected; INVALID outcome → rejected; else accepted (bounces
        // carry a reason category). This models a real ESP's per-recipient partial result.
        const id : string = randomUUID();
        const now : string = new Date().toISOString();
        const accepted : Array<string> = [];
        const rejected : Array<{ email : string; reason : string }> = [];
        const events : Array<FakeService.Event> = [ { type: "accepted", at: now } ];
        const outcomes : Array<FakeService.Delivery> = [];

        for( const address of to )
        {
            // a malformed address is rejected outright
            if( !address.includes( "@" ) ) { rejected.push( { email: address, reason: "malformed address" } ); events.push( { type: "rejected", at: now, detail: address } ); continue; }

            const outcome : FakeService.Delivery = this.deliveryOutcome( address );
            outcomes.push( outcome );
            if( outcome === FakeService.Delivery.INVALID ) { rejected.push( { email: address, reason: "invalid recipient" } ); events.push( { type: "invalid", at: now, detail: address } ); continue; }

            accepted.push( address );
            // a bounce carries its reason category (magic address or the config default)
            const bounce : boolean = outcome === FakeService.Delivery.HARD_BOUNCE || outcome === FakeService.Delivery.SOFT_BOUNCE;
            const detail : string = bounce ? `${ address } (${ this.bounceCategoryFor( address ) })` : address;
            events.push( { type: outcome, at: now, detail } );
        }

        // the record's headline outcome = the first computed outcome (drives the inbox chip)
        const primary : FakeService.Delivery = outcomes[ 0 ] ?? FakeService.Delivery.INVALID;
        const record : FakeService.Record =
        {
            id, accountId: ctx.accountId, at: now, to, summary: body.subject, delivery: primary, events,
            payload: { from: body.from, to, subject: body.subject, html: body.html, text: body.text, headers: body.headers },
            raw:     FakeEmailService.toMime( body, id, now ),   // the emitted wire-format MIME source (for "raw" viewing)
        };
        this.record( ctx.accountId, record );
        if( body.idempotencyKey ) this.idempotency.set( memo, id );

        return { status: NetworkUtils.Status.ACCEPTED, data: { id, status: "accepted", delivery: primary, accepted, rejected } };
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // GET /v1/messages — the inbox listing (optionally filtered by delivery outcome), newest first.
    private async handleList( request : FastifyRequest, ctx : FakeService.Ctx ) : Promise<RestfulEndpoint.Response>
    {
        const query : { status? : string } = ( request.query ?? {} ) as { status? : string };
        const records : Array<FakeService.Record> = this.messages( ctx.accountId )
            .filter( ( entry : FakeService.Record ) : boolean => !query.status || entry.delivery === query.status );
        return { status: NetworkUtils.Status.OK, data: { records } };
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // GET /v1/messages/:id — one stored message (for detail / assertions).
    private async handleGet( request : FastifyRequest, ctx : FakeService.Ctx ) : Promise<RestfulEndpoint.Response>
    {
        const id : string = ( ( request.params ?? {} ) as { id? : string } ).id ?? "";
        const message : FakeService.Record | undefined = this.message( ctx.accountId, id );
        if( message === undefined ) return { status: NetworkUtils.Status.NOT_FOUND, data: { message: "not found" } };
        return { status: NetworkUtils.Status.OK, data: { message } };
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // POST /v1/_control/keys — mint a per-account fake key (the marketplace-install / provisioning hook).
    private async handleIssueKey( request : FastifyRequest, ctx : FakeService.Ctx ) : Promise<RestfulEndpoint.Response>
    {
        const body : { accountId? : string; label? : string } = ( request.body ?? {} ) as { accountId? : string; label? : string };
        const info : FakeService.KeyInfo = this.issueKey( body.accountId ?? ctx.accountId, body.label );
        return { status: NetworkUtils.Status.OK, data: { key: info.key, accountId: info.accountId, label: info.label } };
    }

    // GET /v1/_control/keys — list issued keys.
    private async handleListKeys() : Promise<RestfulEndpoint.Response>
    {
        return { status: NetworkUtils.Status.OK, data: { keys: this.listKeys() } };
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // POST /v1/_control/reset — clear the caller account's inbox.
    private async handleReset( ctx : FakeService.Ctx ) : Promise<RestfulEndpoint.Response>
    {
        this.resetAccount( ctx.accountId );
        return { status: NetworkUtils.Status.OK, data: { reset: true } };
    }

    // GET /v1/_metrics — counts by delivery outcome + the complaint rate (Gmail/Yahoo bulk-sender signal).
    private async handleMetrics( ctx : FakeService.Ctx ) : Promise<RestfulEndpoint.Response>
    {
        const metrics : Record<string, number> = this.metricsFor( ctx.accountId );
        const total : number = Object.values( metrics ).reduce( ( sum : number, count : number ) : number => sum + count, 0 );
        const complaintRate : number = total > 0 ? ( metrics[ FakeService.Delivery.COMPLAINT ] ?? 0 ) / total : 0;
        return { status: NetworkUtils.Status.OK, data: { metrics, total, complaintRate } };
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // GET /v1/config — the current behavior knobs.
    private async handleGetConfig() : Promise<RestfulEndpoint.Response>
    {
        return { status: NetworkUtils.Status.OK, data: { config: this.behavior() } };
    }

    // PUT /v1/config — replace the behavior knobs (dev tool; no strict schema).
    private async handleSetConfig( request : FastifyRequest ) : Promise<RestfulEndpoint.Response>
    {
        const body : { config? : FakeService.Behavior } = ( request.body ?? {} ) as { config? : FakeService.Behavior };
        if( body.config === undefined ) return { status: NetworkUtils.Status.BAD_REQUEST, data: { message: "config is required" } };
        this.setBehavior( body.config );
        return { status: NetworkUtils.Status.OK, data: { config: this.behavior() } };
    }
}

export namespace FakeEmailService
{
    export enum Role { MAIN = "main" }
    export const PORT : Record<Role, number> = { [ Role.MAIN ]: Ports.FAKE_EMAIL.MAIN };

    /** The vendor-shaped send body (the email service's FAKE adapter posts this — the `Email.Outbound` shape). */
    export interface SendBody
    {
        from?           : string;
        to?             : Array<string>;
        cc?             : Array<string>;
        bcc?            : Array<string>;
        subject?        : string;
        html?           : string;
        text?           : string;
        headers?        : Record<string, string>;
        idempotencyKey? : string;
    }

    /** Build the emitted RFC822/MIME source for a send — the raw text of the email "file" an ESP would transmit.
     *  A message with both html + text becomes multipart/alternative; a single body is one part. */
    export function toMime( body : SendBody, id : string, at : string ) : string
    {
        const to : Array<string> = body.to ?? [];
        // headers (standard + any caller-supplied custom headers)
        const headers : Array<string> = [];
        headers.push( `From: ${ body.from ?? "" }` );
        headers.push( `To: ${ to.join( ", " ) }` );
        if( body.cc && body.cc.length > 0 ) headers.push( `Cc: ${ body.cc.join( ", " ) }` );
        headers.push( `Subject: ${ body.subject ?? "" }` );
        headers.push( `Date: ${ new Date( at ).toUTCString() }` );
        headers.push( `Message-ID: <${ id }@fake-email.local>` );
        headers.push( "MIME-Version: 1.0" );
        for( const [ name, value ] of Object.entries( body.headers ?? {} ) ) headers.push( `${ name }: ${ value }` );

        const html : string = body.html ?? "";
        const text : string = body.text ?? "";

        // both bodies → multipart/alternative (text first, html second — clients pick the richest they render)
        if( html !== "" && text !== "" )
        {
            const boundary : string = `----=_fake_${ id }`;
            const parts : Array<string> = [
                `--${ boundary }`, "Content-Type: text/plain; charset=utf-8", "Content-Transfer-Encoding: 7bit", "", text,
                `--${ boundary }`, "Content-Type: text/html; charset=utf-8", "Content-Transfer-Encoding: 7bit", "", html,
                `--${ boundary }--`, "",
            ];
            headers.push( `Content-Type: multipart/alternative; boundary="${ boundary }"` );
            return `${ headers.join( "\r\n" ) }\r\n\r\n${ parts.join( "\r\n" ) }`;
        }

        // a single body — html if present, else text
        const single : string = html !== "" ? html : text;
        headers.push( `Content-Type: ${ html !== "" ? "text/html" : "text/plain" }; charset=utf-8` );
        headers.push( "Content-Transfer-Encoding: 7bit" );
        return `${ headers.join( "\r\n" ) }\r\n\r\n${ single }`;
    }
}

export default FakeEmailService;
// eof
