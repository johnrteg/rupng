//
// Webhook — a composable helper for inbound provider webhooks (Twilio call-status, Meta Graph API, etc.).
// Composed as a member, exactly like the AWS facades / `WorkQueue` — not a base class to extend. Every
// provider-facing service was hand-rolling this from scratch (voice's three Twilio webhooks, social's Meta
// webhook), each with its own copy of "verify → enqueue → ack" and its own signature-verification bugs. This
// centralizes the mechanism; each service still owns its provider-specific auth strategy + payload shape.
//
// TWO SUPPORTED MODES, because both are real:
//   • async / ack-fast (the common case) — `handle()`: verify → enqueue → generic 200 ack. Real processing
//     happens downstream, off the queue, by whatever consumer already exists for that queue (a `Job` Lambda
//     in production, optionally also drained locally by the owning service's MAIN role for dev — the SAME
//     Service/Job split every other queue in this platform already uses; this helper's job stops at "verified
//     + durably queued").
//   • sync / inline — call `verify()` ALONE: some provider protocols are a blocking request/response (Twilio's
//     call-control webhook must return TwiML synchronously to know what to say/dial next). There's no queue
//     step for that; the caller verifies, then processes inline and returns its own response.
//
// Deliberately NOT included (kept lean): payload-shape validation. `Validation.compile` lives in `@repo/api`,
// a layer ABOVE `@repo/services` — pulling it in here would invert that dependency direction for a "nice to
// have" cheap gate, not a hard requirement (per the design decision, real validation belongs in the queue
// consumer anyway, not inline before the ack). A caller that wants a pre-enqueue sanity check runs its own
// check on `request.body` before calling `enqueue`/`handle`.
//
import { createHmac, timingSafeEqual } from "node:crypto";

import type { CloudResolver, ResourceKey } from "@repo/cloud-manifest";
import type { Type } from "@repo/common";

import { Sqs } from "./aws/Sqs";
import type { Trace } from "./Trace";

export class Webhook
{
    private readonly sqs : Sqs;

    ///////////////////////////////////////////////////////////////////////////////////////////
    /**
     * @param cloud   the owning service's resolver — maps logical queue keys to physical urls.
     * @param options `auth` (required) — the provider-specific signature-verification strategy; `log`
     *                (optional) — the owning service's `Trace`, for structured `webhook.*` log lines
     *                (this platform's stand-in for metrics — no CloudWatch `putMetricData` exists to emit
     *                real metrics to; `monitor` parses these structured lines instead).
     */
    constructor( cloud : CloudResolver, private readonly options : Webhook.Options )
    {
        this.sqs = new Sqs( cloud );
    }

    ///////////////////////////////////////////////////////////////////////////////////////////
    /** Verify ONLY — the first step in either mode. Never throws (a throwing `auth.verify` is treated as a
     *  rejection, not a 500) so a bad signature always resolves to `false`, never an unhandled exception. */
    public async verify( request : Webhook.Request ) : Promise<boolean>
    {
        const start : number = Date.now();
        let verified : boolean;
        try { verified = await this.options.auth.verify( request ); }
        catch( error : unknown ) { this.options.log?.warn( "webhook.verify threw", { error: String( error ) } ); verified = false; }

        const latencyMs : number = Date.now() - start;
        if( verified ) this.options.log?.info( "webhook.verified", { latencyMs } );
        else           this.options.log?.warn( "webhook.rejected", { latencyMs } );
        return verified;
    }

    ///////////////////////////////////////////////////////////////////////////////////////////
    /** Offload to SQS — the async-mode second step. Assumes `verify()` already passed; this method doesn't
     *  re-check auth, it just queues (so `handle()` and a caller doing its own verify-then-enqueue behave
     *  identically). */
    public async enqueue( queueKey : ResourceKey, payload : object ) : Promise<Type.Result<void>>
    {
        const sent : Type.Result<void> = await this.sqs.send( queueKey, payload );
        if( sent.ok ) this.options.log?.info( "webhook.enqueued", { queue: queueKey } );
        else          this.options.log?.warn( "webhook.enqueue failed", { queue: queueKey, error: sent.error } );
        return sent;
    }

    ///////////////////////////////////////////////////////////////////////////////////////////
    /** Convenience sugar for the common async/ack-fast case: `verify` + `enqueue`, mapped to a small result
     *  the caller turns into its `RestfulEndpoint.Response`. NOT for sync-mode webhooks (Twilio-control-style)
     *  — those call `verify()` alone and process inline; see the class doc. */
    public async handle( request : Webhook.Request, queueKey : ResourceKey ) : Promise<Webhook.Result>
    {
        const verified : boolean = await this.verify( request );
        if( !verified ) return { ok: false, status: 403 };

        const sent : Type.Result<void> = await this.enqueue( queueKey, request.body as object );
        if( !sent.ok ) return { ok: false, status: 500 };
        return { ok: true, status: 200 };
    }
}

export namespace Webhook
{
    /** The inputs a signature check needs — provider-agnostic, so every `Auth` strategy takes the same shape. */
    export interface Request
    {
        headers  : Record<string, string | undefined>;
        url      : string;                  // the reconstructed webhook URL (some schemes, e.g. Twilio, sign over it)
        body     : unknown;                 // the already-parsed body (JSON object / form fields)
        rawBody? : Uint8Array;               // TRUE raw bytes, if the service called `Service.enableRawBodyCapture()`
    }

    /** A pluggable signature-verification strategy. Implement this directly for a provider whose scheme
     *  doesn't fit a built-in (e.g. Twilio's HMAC-SHA1-over-URL+params — wrap the existing, already-correct
     *  `twilio` package's `validateRequest` rather than reimplementing it). */
    export interface Auth { verify( request : Request ) : boolean | Promise<boolean>; }

    export interface Options { auth : Auth; log? : Trace; }

    /** `handle()`'s result — `ok`/`status` map directly onto a `RestfulEndpoint.Response`. */
    export interface Result { ok : boolean; status : number; }

    ///////////////////////////////////////////////////////////////////////////////////////////
    /**
     * Built-in strategy for the common Meta/Stripe/GitHub-style scheme: `HMAC-SHA256` over the TRUE raw
     * request body, hex-encoded, in a header shaped `<prefix><hex>` (default `sha256=<hex>`, Meta's exact
     * convention). REQUIRES `request.rawBody` — the caller's service must have called
     * `Service.enableRawBodyCapture()`; without it this always returns `false` (fails closed, never silently
     * falls back to a re-serialized approximation — that was the exact bug this fixes, see social's prior
     * `MetaWebhookUtils`).
     */
    export function hmacSha256RawBody( secret : string, headerName : string = "x-hub-signature-256", prefix : string = "sha256=" ) : Auth
    {
        return {
            verify( request : Request ) : boolean
            {
                if( request.rawBody === undefined ) return false;
                const header : string | undefined = request.headers[ headerName ] ?? request.headers[ headerName.toUpperCase() ];
                if( !header?.startsWith( prefix ) ) return false;

                const expected : Buffer = createHmac( "sha256", secret ).update( request.rawBody ).digest();
                const provided : Buffer = Buffer.from( header.slice( prefix.length ), "hex" );
                if( expected.length !== provided.length ) return false;
                return timingSafeEqual( expected, provided );
            },
        };
    }
}

export default Webhook;
// eof
