//
import { RequestContext, Sqs } from "@repo/services";
import type { Type } from "@repo/common";
import type { Message } from "@aws-sdk/client-sqs";
import { Texting } from "@repo/api";

import TextingService from "./TextingService";
import RegistrationSyncConsumer from "../consumers/RegistrationSyncConsumer";

import PostTextingSendImpl from "../endpoints/PostTextingSendImpl";
import GetTextingLogImpl from "../endpoints/GetTextingLogImpl";
import PostTextingWebhookImpl from "../endpoints/PostTextingWebhookImpl";

//
// MAIN role — the /texting/* API (send + log + webhook). Also DRAINS the texting-send + texting-dlr
// queues locally (so the send path works end-to-end without a separate Job runtime) — same pattern
// as EmailMainService / PrintMainService's local dev drain.
//
export class TextingMainService extends TextingService
{
    private stopping : boolean = false;

    ////////////////////////////////////////////////////////////////////////////////////////////
    constructor()
    {
        super( TextingService.Role.MAIN );
        void this.startSendConsumer();
        void this.startDlrConsumer();
        void new RegistrationSyncConsumer( { dynamo: this.dynamo, kafka: this.kafka, log: this.log } ).start();
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    protected override async registerEndpoints() : Promise<void>
    {
        await super.registerEndpoints();   // keeps /health + /version
        this.register( new PostTextingSendImpl( this ) );
        this.register( new GetTextingLogImpl( this ) );
        this.register( new PostTextingWebhookImpl( this ) );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // SQS texting-send poll loop (dev drain of TextingSendWorker) — resolve + transport off the request path.
    private async startSendConsumer() : Promise<void>
    {
        this.log.info( "texting send consumer started (SQS texting-send)" );
        while( !this.stopping )
        {
            try
            {
                const received : Type.Result<Array<Message>> = await this.sqs.receive( "texting-send", 10, 10 );
                if( !received.ok ) { await this.delay( 5000 ); continue; }
                for( const message of received.data )
                    await RequestContext.run( { transactionId: Sqs.transactionId( message ) }, async () : Promise<void> =>
                    {
                        try
                        {
                            this.log.trace( "message received (SQS texting-send)", { messageId: message.MessageId } );
                            const request = JSON.parse( message.Body ?? "{}" ) as Texting.SendRequest;
                            if( request.accountId && request.contactId ) await this.processSend( request );
                            if( message.ReceiptHandle ) await this.sqs.delete( "texting-send", message.ReceiptHandle );
                        }
                        catch( err ) { this.log.warn( "texting send failed (will redeliver)", { error: String( err ) } ); }
                    } );
            }
            catch( error ) { this.log.warn( "texting send receive failed — backing off", { error: String( error ) } ); await this.delay( 5000 ); }
        }
        this.log.info( "texting send consumer stopped" );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // SQS texting-dlr poll loop (dev drain of TextingDlrJob) — normalize + apply the status update.
    private async startDlrConsumer() : Promise<void>
    {
        this.log.info( "texting dlr consumer started (SQS texting-dlr)" );
        while( !this.stopping )
        {
            try
            {
                const received : Type.Result<Array<Message>> = await this.sqs.receive( "texting-dlr", 10, 10 );
                if( !received.ok ) { await this.delay( 5000 ); continue; }
                for( const message of received.data )
                    await RequestContext.run( { transactionId: Sqs.transactionId( message ) }, async () : Promise<void> =>
                    {
                        try
                        {
                            this.log.trace( "message received (SQS texting-dlr)", { messageId: message.MessageId } );
                            const payload = JSON.parse( message.Body ?? "{}" ) as Record<string, unknown>;
                            await this.processDlr( payload );
                            if( message.ReceiptHandle ) await this.sqs.delete( "texting-dlr", message.ReceiptHandle );
                        }
                        catch( err ) { this.log.warn( "texting dlr failed (will redeliver)", { error: String( err ) } ); }
                    } );
            }
            catch( error ) { this.log.warn( "texting dlr receive failed — backing off", { error: String( error ) } ); await this.delay( 5000 ); }
        }
        this.log.info( "texting dlr consumer stopped" );
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

export default TextingMainService;
// eof
