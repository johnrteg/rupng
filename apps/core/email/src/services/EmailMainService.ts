//
import { RequestContext, Sqs } from "@repo/services";
import { Events } from "@repo/system";
import type { Type } from "@repo/common";
import type { Message } from "@aws-sdk/client-sqs";
import { Email } from "@repo/api";

import EmailService from "./EmailService";

import PostEmailSendImpl from "../endpoints/PostEmailSendImpl";
import GetEmailTemplatesImpl from "../endpoints/GetEmailTemplatesImpl";
import GetEmailTemplateImpl from "../endpoints/GetEmailTemplateImpl";
import PostEmailTemplateImpl from "../endpoints/PostEmailTemplateImpl";
import PatchEmailTemplateImpl from "../endpoints/PatchEmailTemplateImpl";
import DeleteEmailTemplateImpl from "../endpoints/DeleteEmailTemplateImpl";
import PostEmailTemplatePublishImpl from "../endpoints/PostEmailTemplatePublishImpl";
import PostEmailTemplatePreviewImpl from "../endpoints/PostEmailTemplatePreviewImpl";
import GetEmailTemplateVersionImpl from "../endpoints/GetEmailTemplateVersionImpl";
import PostEmailTemplateRevertImpl from "../endpoints/PostEmailTemplateRevertImpl";
import PostEmailPreviewImpl from "../endpoints/PostEmailPreviewImpl";
import GetEmailConfigImpl from "../endpoints/GetEmailConfigImpl";
import PutEmailConfigImpl from "../endpoints/PutEmailConfigImpl";
import PostEmailBatchImpl from "../endpoints/PostEmailBatchImpl";
import GetEmailBlastsImpl from "../endpoints/GetEmailBlastsImpl";
import PatchEmailBlastImpl from "../endpoints/PatchEmailBlastImpl";
import DeleteEmailBlastImpl from "../endpoints/DeleteEmailBlastImpl";
import GetEmailLogImpl from "../endpoints/GetEmailLogImpl";

//
// MAIN role — the /email/* API (send + template CRUD + config). Also DRAINS the email-send + email-feedback
// queues locally (so the send path works end-to-end without a separate Job runtime) and CONSUMES the
// transactional events that trigger system mail. In a deploy the EmailSendJob / EmailFeedbackJob Lambdas own
// the queues (same EmailService code) and MAIN is just the API + event consumer.
//
export class EmailMainService extends EmailService
{
    private stopping : boolean = false;

    ////////////////////////////////////////////////////////////////////////////////////////////
    constructor()
    {
        super( EmailService.Role.MAIN );
        void this.startSendConsumer();
        void this.startFeedbackConsumer();
        void this.startBatchConsumer();
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Seed config (base) then subscribe to the transactional events that trigger system mail. */
    protected override async init() : Promise<void>
    {
        await super.init();
        await this.startEventConsumer();
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Register the email endpoint impls (after the inherited /health + /version). */
    protected override async registerEndpoints() : Promise<void>
    {
        await super.registerEndpoints();          // keeps /health + /version
        this.register( new PostEmailSendImpl( this ) );
        this.register( new GetEmailTemplatesImpl( this ) );
        this.register( new GetEmailTemplateImpl( this ) );
        this.register( new PostEmailTemplateImpl( this ) );
        this.register( new PatchEmailTemplateImpl( this ) );
        this.register( new DeleteEmailTemplateImpl( this ) );
        this.register( new PostEmailTemplatePublishImpl( this ) );
        this.register( new PostEmailTemplatePreviewImpl( this ) );
        this.register( new GetEmailTemplateVersionImpl( this ) );
        this.register( new PostEmailTemplateRevertImpl( this ) );
        this.register( new PostEmailPreviewImpl( this ) );
        this.register( new GetEmailConfigImpl( this ) );
        this.register( new PutEmailConfigImpl( this ) );
        this.register( new PostEmailBatchImpl( this ) );
        this.register( new GetEmailBlastsImpl( this ) );
        this.register( new PatchEmailBlastImpl( this ) );
        this.register( new DeleteEmailBlastImpl( this ) );
        this.register( new GetEmailLogImpl( this ) );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // SQS email-send poll loop (dev drain of EmailSendJob) — render + gate + transport off the request path.
    // Each message re-enters the RequestContext from its transaction-id so the send's logs stay correlated to
    // the enqueuing request.
    private async startSendConsumer() : Promise<void>
    {
        this.log.info( "email send consumer started (SQS email-send)" );
        while( !this.stopping )
        {
            try
            {
                const received : Type.Result<Array<Message>> = await this.sqs.receive( "email-send", 10, 10 );
                if( !received.ok ) { await this.delay( 5000 ); continue; }
                for( const message of received.data )
                    await RequestContext.run( { transactionId: Sqs.transactionId( message ) }, async () : Promise<void> =>
                    {
                        try
                        {
                            this.log.trace( "message received (SQS email-send)", { messageId: message.MessageId } );
                            const job = JSON.parse( message.Body ?? "{}" ) as { request? : Email.SendRequest };
                            if( job.request ) await this.processSend( job.request );
                            if( message.ReceiptHandle ) await this.sqs.delete( "email-send", message.ReceiptHandle );
                        }
                        catch( err ) { this.log.warn( "email send failed (will redeliver)", { error: String( err ) } ); }
                    } );
            }
            catch( error ) { this.log.warn( "email send receive failed — backing off", { error: String( error ) } ); await this.delay( 5000 ); }
        }
        this.log.info( "email send consumer stopped" );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // SQS email-feedback poll loop (dev drain of EmailFeedbackJob) — apply inbound bounce/complaint
    // notifications to the suppression list + send log.
    private async startFeedbackConsumer() : Promise<void>
    {
        this.log.info( "email feedback consumer started (SQS email-feedback)" );
        while( !this.stopping )
        {
            try
            {
                const received : Type.Result<Array<Message>> = await this.sqs.receive( "email-feedback", 10, 10 );
                if( !received.ok ) { await this.delay( 5000 ); continue; }
                for( const message of received.data )
                    await RequestContext.run( { transactionId: Sqs.transactionId( message ) }, async () : Promise<void> =>
                    {
                        try
                        {
                            this.log.trace( "message received (SQS email-feedback)", { messageId: message.MessageId } );
                            const feedback = JSON.parse( message.Body ?? "{}" ) as EmailService.Feedback;
                            if( feedback.accountId && feedback.email ) await this.processFeedback( feedback );
                            if( message.ReceiptHandle ) await this.sqs.delete( "email-feedback", message.ReceiptHandle );
                        }
                        catch( err ) { this.log.warn( "email feedback failed (will redeliver)", { error: String( err ) } ); }
                    } );
            }
            catch( error ) { this.log.warn( "email feedback receive failed — backing off", { error: String( error ) } ); await this.delay( 5000 ); }
        }
        this.log.info( "email feedback consumer stopped" );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // SQS email-batch poll loop (dev drain of EmailBatchJob) — expand a blast's audience + pace the
    // per-recipient fan-out onto email-send (honoring the blast's suspend/resume/cancel status).
    private async startBatchConsumer() : Promise<void>
    {
        this.log.info( "email batch consumer started (SQS email-batch)" );
        while( !this.stopping )
        {
            try
            {
                const received : Type.Result<Array<Message>> = await this.sqs.receive( "email-batch", 10, 10 );
                if( !received.ok ) { await this.delay( 5000 ); continue; }
                for( const message of received.data )
                    await RequestContext.run( { transactionId: Sqs.transactionId( message ) }, async () : Promise<void> =>
                    {
                        try
                        {
                            this.log.trace( "message received (SQS email-batch)", { messageId: message.MessageId } );
                            const job = JSON.parse( message.Body ?? "{}" ) as { blastId? : string; accountId? : string };
                            if( job.blastId && job.accountId ) await this.processBatch( job.accountId, job.blastId );
                            if( message.ReceiptHandle ) await this.sqs.delete( "email-batch", message.ReceiptHandle );
                        }
                        catch( err ) { this.log.warn( "email batch failed (will redeliver)", { error: String( err ) } ); }
                    } );
            }
            catch( error ) { this.log.warn( "email batch receive failed — backing off", { error: String( error ) } ); await this.delay( 5000 ); }
        }
        this.log.info( "email batch consumer stopped" );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // Kafka consumer — the transactional TRIGGER path (email-4.9). Auth/account emit user lifecycle events
    // (verification, invite, security alert); this service reacts by enqueuing the matching system-notification
    // send. Best-effort: a bus outage must not block boot. TODO(email-4.9): map each (object, verb) to its
    // Email.NotificationType + extract the recipient address from the event payload, then `enqueueSend`.
    private async startEventConsumer() : Promise<void>
    {
        // no Kafka brokers configured (the common local-dev case) → skip quietly; only WARN on a real outage
        if( !this.kafka.configured() ) { this.log.info( "email-transactional consumer skipped — no Kafka brokers configured (dev)" ); return; }

        try
        {
            await this.kafka.subscribeEvents( "email-transactional", [ Events.Object.AUTH_USER, Events.Object.ACCOUNT_MEMBER ], async ( event ) : Promise<void> =>
            {
                this.log.info( "email consumed transactional event (trigger mapping pending)", { action: event.action, accountId: event.accountId, targetId: event.target.id } );
            } );
        }
        catch( error ) { this.log.warn( "email-transactional consumer failed to start (bus unreachable?)", { error: String( error ) } ); }
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

export default EmailMainService;
// eof
