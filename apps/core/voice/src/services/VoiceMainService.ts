//
import { RequestContext, Sqs } from "@repo/services";
import type { Type } from "@repo/common";
import type { Message } from "@aws-sdk/client-sqs";
import { Voice } from "@repo/api";

import VoiceService from "./VoiceService";

import PostVoiceCallsImpl from "../endpoints/PostVoiceCallsImpl";
import PostVoiceCallsBulkImpl from "../endpoints/PostVoiceCallsBulkImpl";
import PostVoiceCallsTestImpl from "../endpoints/PostVoiceCallsTestImpl";
import GetVoiceCallsLogImpl from "../endpoints/GetVoiceCallsLogImpl";
import GetVoiceCallImpl from "../endpoints/GetVoiceCallImpl";
import GetVoiceNumbersImpl from "../endpoints/GetVoiceNumbersImpl";
import GetVoiceConfigImpl from "../endpoints/GetVoiceConfigImpl";
import PutVoiceConfigImpl from "../endpoints/PutVoiceConfigImpl";
import GetVoiceProvidersImpl from "../endpoints/GetVoiceProvidersImpl";
import PutVoiceProviderImpl from "../endpoints/PutVoiceProviderImpl";
import PostVoiceWebhookControlImpl from "../endpoints/PostVoiceWebhookControlImpl";
import PostVoiceWebhookStatusImpl from "../endpoints/PostVoiceWebhookStatusImpl";
import GetVoiceFlowsImpl from "../endpoints/GetVoiceFlowsImpl";
import PostVoiceFlowImpl from "../endpoints/PostVoiceFlowImpl";
import PostVoiceInternalFlowImpl from "../endpoints/PostVoiceInternalFlowImpl";
import GetVoiceFlowImpl from "../endpoints/GetVoiceFlowImpl";
import PatchVoiceFlowImpl from "../endpoints/PatchVoiceFlowImpl";
import DeleteVoiceFlowImpl from "../endpoints/DeleteVoiceFlowImpl";
import PostVoiceFlowPreviewImpl from "../endpoints/PostVoiceFlowPreviewImpl";
import GetVoiceCallRecordingImpl from "../endpoints/GetVoiceCallRecordingImpl";
import GetVoiceCallTranscriptImpl from "../endpoints/GetVoiceCallTranscriptImpl";
import PostVoiceInternalEraseImpl from "../endpoints/PostVoiceInternalEraseImpl";
import PostVoiceWebhookRecordingImpl from "../endpoints/PostVoiceWebhookRecordingImpl";
import GetVoiceDlqImpl from "../endpoints/GetVoiceDlqImpl";
import PostVoiceDlqRequeueImpl from "../endpoints/PostVoiceDlqRequeueImpl";
import GetVoiceDispatchStateImpl from "../endpoints/GetVoiceDispatchStateImpl";
import PostVoiceDispatchSuspendImpl from "../endpoints/PostVoiceDispatchSuspendImpl";
import PostVoiceDispatchResumeImpl from "../endpoints/PostVoiceDispatchResumeImpl";

//
// MAIN role — the /voice/* API (call enqueue + call-log + config + provider admin) + the provider webhooks.
// Also DRAINS the voice-send + voice-status queues locally (so the send path works end-to-end without a
// separate Job runtime). In a deploy, VoiceCallWorker / VoiceStatusJob Lambdas own the queues (same
// VoiceService code) and MAIN is just the API + webhooks. Same shape as
// apps/core/email/src/services/EmailMainService.ts.
//
export class VoiceMainService extends VoiceService
{
    private stopping : boolean = false;

    ////////////////////////////////////////////////////////////////////////////////////////////
    constructor()
    {
        super( VoiceService.Role.MAIN );
        void this.startSendConsumer();
        void this.startStatusConsumer();
        void this.startRecordingConsumer();
        void this.startDispatchLoop();
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // REPLACES the base's `formbody`-only registration (not in addition — both would claim the same content
    // types) — captures true raw bytes for the provider webhooks' `Webhook.hmacSha256RawBody`/signature
    // checks while still producing the same parsed `request.body` shape every endpoint already expects.
    protected override addServerRegister() : void { this.enableRawBodyCapture(); }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Register the voice endpoint impls (after the inherited /health + /version). */
    protected override async registerEndpoints() : Promise<void>
    {
        await super.registerEndpoints();          // keeps /health + /version
        this.register( new PostVoiceCallsImpl( this ) );
        this.register( new PostVoiceCallsBulkImpl( this ) );
        this.register( new PostVoiceCallsTestImpl( this ) );
        this.register( new GetVoiceCallsLogImpl( this ) );
        this.register( new GetVoiceCallImpl( this ) );
        this.register( new GetVoiceNumbersImpl( this ) );
        this.register( new GetVoiceConfigImpl( this ) );
        this.register( new PutVoiceConfigImpl( this ) );
        this.register( new GetVoiceProvidersImpl( this ) );
        this.register( new PutVoiceProviderImpl( this ) );
        this.register( new PostVoiceWebhookControlImpl( this ) );
        this.register( new PostVoiceWebhookStatusImpl( this ) );
        this.register( new GetVoiceFlowsImpl( this ) );
        this.register( new PostVoiceFlowImpl( this ) );
        this.register( new PostVoiceInternalFlowImpl( this ) );
        this.register( new GetVoiceFlowImpl( this ) );
        this.register( new PatchVoiceFlowImpl( this ) );
        this.register( new DeleteVoiceFlowImpl( this ) );
        this.register( new PostVoiceFlowPreviewImpl( this ) );
        this.register( new GetVoiceCallRecordingImpl( this ) );
        this.register( new GetVoiceCallTranscriptImpl( this ) );
        this.register( new PostVoiceInternalEraseImpl( this ) );
        this.register( new PostVoiceWebhookRecordingImpl( this ) );
        this.register( new GetVoiceDlqImpl( this ) );
        this.register( new PostVoiceDlqRequeueImpl( this ) );
        this.register( new GetVoiceDispatchStateImpl( this ) );
        this.register( new PostVoiceDispatchSuspendImpl( this ) );
        this.register( new PostVoiceDispatchResumeImpl( this ) );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // SQS voice-send poll loop (dev drain of VoiceCallWorker) — gate + resolve + dial off the request path.
    // Each message re-enters the RequestContext from its transaction-id so the call's logs stay correlated to
    // the enqueuing request.
    private async startSendConsumer() : Promise<void>
    {
        this.log.info( "voice send consumer started (SQS voice-send)" );
        while( !this.stopping )
        {
            try
            {
                const received : Type.Result<Array<Message>> = await this.sqs.receive( "voice-send", 10, 10 );
                if( !received.ok ) { await this.delay( 5000 ); continue; }
                for( const message of received.data )
                    await RequestContext.run( { transactionId: Sqs.transactionId( message ) }, async () : Promise<void> =>
                    {
                        try
                        {
                            this.log.trace( "message received (SQS voice-send)", { messageId: message.MessageId } );
                            const job = JSON.parse( message.Body ?? "{}" ) as { request? : Voice.SendRequest };
                            if( job.request ) await this.processSend( job.request );
                            if( message.ReceiptHandle ) await this.sqs.delete( "voice-send", message.ReceiptHandle );
                        }
                        catch( err ) { this.log.warn( "voice send failed (will redeliver)", { error: String( err ) } ); }
                    } );
            }
            catch( error ) { this.log.warn( "voice send receive failed — backing off", { error: String( error ) } ); await this.delay( 5000 ); }
        }
        this.log.info( "voice send consumer stopped" );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // SQS voice-status poll loop (dev drain of VoiceStatusJob) — normalize + apply inbound provider status
    // events to the call-log (+ opt-out suppression).
    private async startStatusConsumer() : Promise<void>
    {
        this.log.info( "voice status consumer started (SQS voice-status)" );
        while( !this.stopping )
        {
            try
            {
                const received : Type.Result<Array<Message>> = await this.sqs.receive( "voice-status", 10, 10 );
                if( !received.ok ) { await this.delay( 5000 ); continue; }
                for( const message of received.data )
                    await RequestContext.run( { transactionId: Sqs.transactionId( message ) }, async () : Promise<void> =>
                    {
                        try
                        {
                            this.log.trace( "message received (SQS voice-status)", { messageId: message.MessageId } );
                            const job = JSON.parse( message.Body ?? "{}" ) as { accountId? : string; callId? : string; provider? : Voice.Provider; payload? : Record<string, unknown> };
                            if( job.accountId && job.callId && job.provider && job.payload ) await this.processStatus( job.accountId, job.callId, job.provider, job.payload );
                            if( message.ReceiptHandle ) await this.sqs.delete( "voice-status", message.ReceiptHandle );
                        }
                        catch( err ) { this.log.warn( "voice status failed (will redeliver)", { error: String( err ) } ); }
                    } );
            }
            catch( error ) { this.log.warn( "voice status receive failed — backing off", { error: String( error ) } ); await this.delay( 5000 ); }
        }
        this.log.info( "voice status consumer stopped" );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // SQS voice-recording poll loop (dev drain of a VoiceRecordingJob) — download + store (+ optionally
    // transcribe) a completed recording.
    private async startRecordingConsumer() : Promise<void>
    {
        this.log.info( "voice recording consumer started (SQS voice-recording)" );
        while( !this.stopping )
        {
            try
            {
                const received : Type.Result<Array<Message>> = await this.sqs.receive( "voice-recording", 10, 10 );
                if( !received.ok ) { await this.delay( 5000 ); continue; }
                for( const message of received.data )
                    await RequestContext.run( { transactionId: Sqs.transactionId( message ) }, async () : Promise<void> =>
                    {
                        try
                        {
                            this.log.trace( "message received (SQS voice-recording)", { messageId: message.MessageId } );
                            const job = JSON.parse( message.Body ?? "{}" ) as { accountId? : string; callId? : string; provider? : Voice.Provider; payload? : Record<string, unknown> };
                            if( job.accountId && job.callId && job.provider && job.payload ) await this.processRecording( job.accountId, job.callId, job.provider, job.payload );
                            if( message.ReceiptHandle ) await this.sqs.delete( "voice-recording", message.ReceiptHandle );
                        }
                        catch( err ) { this.log.warn( "voice recording failed (will redeliver)", { error: String( err ) } ); }
                    } );
            }
            catch( error ) { this.log.warn( "voice recording receive failed — backing off", { error: String( error ) } ); await this.delay( 5000 ); }
        }
        this.log.info( "voice recording consumer stopped" );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // SELF-SCHEDULED dispatch loop (voice-11.4 / SPECS.md gap #8) — drives the `WorkQueue` governor: each round
    // pulls the next paced batch (fair-share + connect-rate/concurrency caps) and places those calls, then
    // sleeps until `nextWakeAt()` says something could change (a token refill, a minute-bin rollover) instead of
    // polling on a fixed interval (DISPATCH.md's "self-scheduled precise wake-ups"). A floor + ceiling keep this
    // safe if the computed wake time is degenerate (e.g. clock skew) — never busy-loops, never sleeps forever.
    // SINGLE-FLIGHT (DISPATCH.md gap #13): a Redis lock (SET NX PX) ensures only ONE replica's round actually
    // dispatches at a time — `dispatch()`'s conditional job-claim already made a double-dispatch harmless, but
    // this stops every replica in an autoscaled fleet from redundantly reading/racing the same round. Best-effort
    // (skip the round, not fatal) — a crash mid-round self-heals via the lock's own TTL, no held-forever lock.
    private async startDispatchLoop() : Promise<void>
    {
        this.log.info( "voice dispatch loop started (WorkQueue governor)" );
        while( !this.stopping )
        {
            try
            {
                if( await this.acquireDispatchLock() )
                {
                    try { await this.dispatchPending(); }
                    finally { await this.releaseDispatchLock(); }
                }
                const wakeAt : Type.ISODateTime = await this.workQueue.nextWakeAt();
                const waitMs : number = Math.min( 30000, Math.max( 250, new Date( wakeAt ).getTime() - Date.now() ) );
                await this.delay( waitMs );
            }
            catch( error ) { this.log.warn( "voice dispatch round failed — backing off", { error: String( error ) } ); await this.delay( 5000 ); }
        }
        this.log.info( "voice dispatch loop stopped" );
    }

    // logical key for the dispatch single-flight lock + its TTL — short enough that a crashed holder's lock
    // self-clears well within one dispatch cycle, long enough to cover a normal round (batch of ≤20 dials).
    private static readonly DISPATCH_LOCK_KEY : string = "wq:voice:dispatch:lock";
    private static readonly DISPATCH_LOCK_TTL_MS : number = 10000;

    // acquire the round's single-flight lock — `SET key value PX ttl NX` is atomic, so exactly one concurrent
    // replica ever sees "OK" for a given lock window.
    private async acquireDispatchLock() : Promise<boolean>
    {
        const acquired : string | null = await this.cache.client.set( VoiceMainService.DISPATCH_LOCK_KEY, this.id, "PX", VoiceMainService.DISPATCH_LOCK_TTL_MS, "NX" );
        return acquired === "OK";
    }

    // release ONLY if this replica still holds it (its id matches) — never clear a lock another replica has
    // since re-acquired after our TTL lapsed.
    private async releaseDispatchLock() : Promise<void>
    {
        const holder : string | null = await this.cache.client.get( VoiceMainService.DISPATCH_LOCK_KEY );
        if( holder === this.id ) await this.cache.client.del( VoiceMainService.DISPATCH_LOCK_KEY );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Stop the poll loops before the base closes the HTTP server (so the process can exit on SIGINT). */
    protected override async aboutToQuit() : Promise<void>
    {
        this.stopping = true;
        await super.aboutToQuit();
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    private delay( ms : number ) : Promise<void> { return new Promise( ( resolve ) => setTimeout( resolve, ms ) ); }
}

export default VoiceMainService;
// eof
