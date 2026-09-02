//
import { RequestContext, Sqs } from "@repo/services";
import type { Type } from "@repo/common";
import type { Message } from "@aws-sdk/client-sqs";
import { Print } from "@repo/api";

import PrintService from "./PrintService";

import PostPrintMailpiecesImpl from "../endpoints/PostPrintMailpiecesImpl";
import PostPrintMailpiecesBatchImpl from "../endpoints/PostPrintMailpiecesBatchImpl";
import GetPrintMailpiecesImpl from "../endpoints/GetPrintMailpiecesImpl";
import GetPrintMailpieceImpl from "../endpoints/GetPrintMailpieceImpl";
import GetPrintMailpieceTrackingImpl from "../endpoints/GetPrintMailpieceTrackingImpl";
import PostPrintProofImpl from "../endpoints/PostPrintProofImpl";
import PostPrintMailpieceApproveImpl from "../endpoints/PostPrintMailpieceApproveImpl";
import PostPrintCostPreviewImpl from "../endpoints/PostPrintCostPreviewImpl";
import GetPrintTemplatesImpl from "../endpoints/GetPrintTemplatesImpl";
import PostPrintTemplatesImpl from "../endpoints/PostPrintTemplatesImpl";
import PatchPrintTemplateImpl from "../endpoints/PatchPrintTemplateImpl";
import DeletePrintTemplateImpl from "../endpoints/DeletePrintTemplateImpl";
import PostPrintAddressVerifyImpl from "../endpoints/PostPrintAddressVerifyImpl";
import PostPrintAddressVerifyBatchImpl from "../endpoints/PostPrintAddressVerifyBatchImpl";
import GetPrintProvidersImpl from "../endpoints/GetPrintProvidersImpl";
import PutPrintProviderImpl from "../endpoints/PutPrintProviderImpl";
import PostPrintWebhookImpl from "../endpoints/PostPrintWebhookImpl";
import GetPrintInternalAddressVerifyImpl from "../endpoints/GetPrintInternalAddressVerifyImpl";
import PostPrintInternalEraseImpl from "../endpoints/PostPrintInternalEraseImpl";
import GetPrintConfigImpl from "../endpoints/GetPrintConfigImpl";
import PutPrintConfigImpl from "../endpoints/PutPrintConfigImpl";
import GetPrintDlqImpl from "../endpoints/GetPrintDlqImpl";
import PostPrintDlqRequeueImpl from "../endpoints/PostPrintDlqRequeueImpl";
import GetPrintDispatchStateImpl from "../endpoints/GetPrintDispatchStateImpl";
import PostPrintDispatchSuspendImpl from "../endpoints/PostPrintDispatchSuspendImpl";
import PostPrintDispatchResumeImpl from "../endpoints/PostPrintDispatchResumeImpl";

//
// MAIN role — the /print/* API (mailpiece submit + templates + address verify + config/provider admin) + the
// mail-fulfillment provider's tracking webhook. Also DRAINS the print-render / print-submit-adjacent dispatch /
// print-tracking queues locally (so the full render→verify→submit→track path works end-to-end without a
// separate Job runtime). In a deploy, PrintRenderJob / PrintTrackingJob Lambdas own the queues (same
// PrintService code) and MAIN is just the API + webhook + the paced dispatch loop. Same shape as
// apps/core/voice/src/services/VoiceMainService.ts.
//
export class PrintMainService extends PrintService
{
    private stopping : boolean = false;

    ////////////////////////////////////////////////////////////////////////////////////////////
    constructor()
    {
        super( PrintService.Role.MAIN );
        void this.startRenderConsumer();
        void this.startTrackingConsumer();
        void this.startDispatchLoop();
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // REPLACES the base's `formbody`-only registration — captures true raw bytes for the mail-fulfillment
    // provider's webhook HMAC signature check while still producing the parsed `request.body` shape every
    // endpoint already expects (same as voice's control/status webhooks).
    protected override addServerRegister() : void { this.enableRawBodyCapture(); }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Register the print endpoint impls (after the inherited /health + /version). */
    protected override async registerEndpoints() : Promise<void>
    {
        await super.registerEndpoints();
        this.register( new PostPrintMailpiecesImpl( this ) );
        this.register( new PostPrintMailpiecesBatchImpl( this ) );
        this.register( new GetPrintMailpiecesImpl( this ) );
        this.register( new GetPrintMailpieceImpl( this ) );
        this.register( new GetPrintMailpieceTrackingImpl( this ) );
        this.register( new PostPrintProofImpl( this ) );
        this.register( new PostPrintMailpieceApproveImpl( this ) );
        this.register( new PostPrintCostPreviewImpl( this ) );
        this.register( new GetPrintTemplatesImpl( this ) );
        this.register( new PostPrintTemplatesImpl( this ) );
        this.register( new PatchPrintTemplateImpl( this ) );
        this.register( new DeletePrintTemplateImpl( this ) );
        this.register( new PostPrintAddressVerifyImpl( this ) );
        this.register( new PostPrintAddressVerifyBatchImpl( this ) );
        this.register( new GetPrintProvidersImpl( this ) );
        this.register( new PutPrintProviderImpl( this ) );
        this.register( new PostPrintWebhookImpl( this ) );
        this.register( new GetPrintInternalAddressVerifyImpl( this ) );
        this.register( new PostPrintInternalEraseImpl( this ) );
        this.register( new GetPrintConfigImpl( this ) );
        this.register( new PutPrintConfigImpl( this ) );
        this.register( new GetPrintDlqImpl( this ) );
        this.register( new PostPrintDlqRequeueImpl( this ) );
        this.register( new GetPrintDispatchStateImpl( this ) );
        this.register( new PostPrintDispatchSuspendImpl( this ) );
        this.register( new PostPrintDispatchResumeImpl( this ) );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // SQS print-render poll loop (dev drain of PrintRenderJob) — merge + verify + PDF proof, off the request path.
    private async startRenderConsumer() : Promise<void>
    {
        this.log.info( "print render consumer started (SQS print-render)" );
        while( !this.stopping )
        {
            try
            {
                const received : Type.Result<Array<Message>> = await this.sqs.receive( "print-render", 10, 10 );
                if( !received.ok ) { await this.delay( 5000 ); continue; }
                for( const message of received.data )
                    await RequestContext.run( { transactionId: Sqs.transactionId( message ) }, async () : Promise<void> =>
                    {
                        try
                        {
                            this.log.trace( "message received (SQS print-render)", { messageId: message.MessageId } );
                            const job = JSON.parse( message.Body ?? "{}" ) as { mailId? : string; accountId? : string };
                            if( job.mailId && job.accountId ) await this.processRender( job.accountId, job.mailId );
                            if( message.ReceiptHandle ) await this.sqs.delete( "print-render", message.ReceiptHandle );
                        }
                        catch( err ) { this.log.warn( "print render failed (will redeliver)", { error: String( err ) } ); }
                    } );
            }
            catch( error ) { this.log.warn( "print render receive failed — backing off", { error: String( error ) } ); await this.delay( 5000 ); }
        }
        this.log.info( "print render consumer stopped" );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // SQS print-tracking poll loop (dev drain of PrintTrackingJob) — normalize + apply an inbound provider
    // tracking event.
    private async startTrackingConsumer() : Promise<void>
    {
        this.log.info( "print tracking consumer started (SQS print-tracking)" );
        while( !this.stopping )
        {
            try
            {
                const received : Type.Result<Array<Message>> = await this.sqs.receive( "print-tracking", 10, 10 );
                if( !received.ok ) { await this.delay( 5000 ); continue; }
                for( const message of received.data )
                    await RequestContext.run( { transactionId: Sqs.transactionId( message ) }, async () : Promise<void> =>
                    {
                        try
                        {
                            this.log.trace( "message received (SQS print-tracking)", { messageId: message.MessageId } );
                            const job = JSON.parse( message.Body ?? "{}" ) as { provider? : Print.Provider; payload? : Record<string, unknown> };
                            if( job.provider && job.payload ) await this.processTracking( job.provider, job.payload );
                            if( message.ReceiptHandle ) await this.sqs.delete( "print-tracking", message.ReceiptHandle );
                        }
                        catch( err ) { this.log.warn( "print tracking failed (will redeliver)", { error: String( err ) } ); }
                    } );
            }
            catch( error ) { this.log.warn( "print tracking receive failed — backing off", { error: String( error ) } ); await this.delay( 5000 ); }
        }
        this.log.info( "print tracking consumer stopped" );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // SELF-SCHEDULED dispatch loop (print-9.4) — drives the `WorkQueue` governor: each round pulls the next
    // paced batch and submits those mailpieces, then sleeps until `nextWakeAt()`. SINGLE-FLIGHT via a Redis
    // lock so only one replica's round actually dispatches at a time (same pattern as voice's dispatch loop).
    private async startDispatchLoop() : Promise<void>
    {
        this.log.info( "print dispatch loop started (WorkQueue governor)" );
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
            catch( error ) { this.log.warn( "print dispatch round failed — backing off", { error: String( error ) } ); await this.delay( 5000 ); }
        }
        this.log.info( "print dispatch loop stopped" );
    }

    private static readonly DISPATCH_LOCK_KEY : string = "wq:print:dispatch:lock";
    private static readonly DISPATCH_LOCK_TTL_MS : number = 10000;

    private async acquireDispatchLock() : Promise<boolean>
    {
        const acquired : string | null = await this.cache.client.set( PrintMainService.DISPATCH_LOCK_KEY, this.id, "PX", PrintMainService.DISPATCH_LOCK_TTL_MS, "NX" );
        return acquired === "OK";
    }

    private async releaseDispatchLock() : Promise<void>
    {
        const holder : string | null = await this.cache.client.get( PrintMainService.DISPATCH_LOCK_KEY );
        if( holder === this.id ) await this.cache.client.del( PrintMainService.DISPATCH_LOCK_KEY );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Stop the poll loops before the base closes the HTTP server. */
    protected override async aboutToQuit() : Promise<void>
    {
        this.stopping = true;
        await super.aboutToQuit();
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    private delay( ms : number ) : Promise<void> { return new Promise( ( resolve ) => setTimeout( resolve, ms ) ); }
}

export default PrintMainService;
// eof
