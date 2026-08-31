//
import { RequestContext, Sqs } from "@repo/services";
import type { Type } from "@repo/common";
import type { Message } from "@aws-sdk/client-sqs";

import RegistrationService from "./RegistrationService";
import { RegistrationDomain } from "../domain/RegistrationDomain";

import PostRegistrationBrandImpl from "../endpoints/PostRegistrationBrandImpl";
import GetRegistrationBrandImpl from "../endpoints/GetRegistrationBrandImpl";
import GetRegistrationBrandsImpl from "../endpoints/GetRegistrationBrandsImpl";
import PatchRegistrationBrandImpl from "../endpoints/PatchRegistrationBrandImpl";
import PostRegistrationCampaignImpl from "../endpoints/PostRegistrationCampaignImpl";
import GetRegistrationCampaignImpl from "../endpoints/GetRegistrationCampaignImpl";
import GetRegistrationCampaignsImpl from "../endpoints/GetRegistrationCampaignsImpl";
import PatchRegistrationCampaignImpl from "../endpoints/PatchRegistrationCampaignImpl";
import GetRegistrationVettingStatusImpl from "../endpoints/GetRegistrationVettingStatusImpl";
import PostRegistrationVettingRefreshImpl from "../endpoints/PostRegistrationVettingRefreshImpl";
import PostRegistrationResubmitImpl from "../endpoints/PostRegistrationResubmitImpl";
import PostRegistrationReprovisionImpl from "../endpoints/PostRegistrationReprovisionImpl";
import PostRegistrationOverrideImpl from "../endpoints/PostRegistrationOverrideImpl";
import PostRegistrationNudgeImpl from "../endpoints/PostRegistrationNudgeImpl";
import PostRegistrationCheckSyncImpl from "../endpoints/PostRegistrationCheckSyncImpl";
import GetRegistrationConfigImpl from "../endpoints/GetRegistrationConfigImpl";
import PutRegistrationConfigImpl from "../endpoints/PutRegistrationConfigImpl";
import GetInternalRegistrationBrandsImpl from "../endpoints/GetInternalRegistrationBrandsImpl";
import GetInternalRegistrationCampaignsImpl from "../endpoints/GetInternalRegistrationCampaignsImpl";
import GetInternalRegistrationCostEstimatesImpl from "../endpoints/GetInternalRegistrationCostEstimatesImpl";

//
// MAIN role — the /registration/* API (registration-12.2): brand + campaign CRUD, the registration-11.x
// lifecycle operations, the status/vetting reads, config, and the S2S internal listings the `report` service
// consumes. Also DRAINS the registration-submit + registration-vetting queues locally, so the whole
// submit → provision pipeline works end-to-end under `tsx watch` without a separate Job runtime; in a deploy
// the RegistrationSubmitJob / RegistrationVettingJob Lambdas own those queues (running the SAME domain code)
// and MAIN is just the API. Same shape as apps/core/voice/src/services/VoiceMainService.ts.
//
export class RegistrationMainService extends RegistrationService
{
    private stopping : boolean = false;

    ////////////////////////////////////////////////////////////////////////////////////////////
    constructor()
    {
        super( RegistrationService.Role.MAIN );
        void this.startSubmitConsumer();
        void this.startVettingConsumer();
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Register the registration endpoint impls (after the inherited /health + /version). */
    protected override async registerEndpoints() : Promise<void>
    {
        await super.registerEndpoints();          // keeps /health + /version

        // brand (registration-1.0)
        this.register( new PostRegistrationBrandImpl( this ) );
        this.register( new GetRegistrationBrandImpl( this ) );
        this.register( new GetRegistrationBrandsImpl( this ) );
        this.register( new PatchRegistrationBrandImpl( this ) );

        // campaign (registration-2.0)
        this.register( new PostRegistrationCampaignImpl( this ) );
        this.register( new GetRegistrationCampaignImpl( this ) );
        this.register( new GetRegistrationCampaignsImpl( this ) );
        this.register( new PatchRegistrationCampaignImpl( this ) );

        // lifecycle operations (registration-11.x)
        this.register( new GetRegistrationVettingStatusImpl( this ) );
        this.register( new PostRegistrationVettingRefreshImpl( this ) );
        this.register( new PostRegistrationResubmitImpl( this ) );
        this.register( new PostRegistrationReprovisionImpl( this ) );
        this.register( new PostRegistrationOverrideImpl( this ) );
        this.register( new PostRegistrationNudgeImpl( this ) );
        this.register( new PostRegistrationCheckSyncImpl( this ) );

        // operator config
        this.register( new GetRegistrationConfigImpl( this ) );
        this.register( new PutRegistrationConfigImpl( this ) );

        // S2S (INTERNAL audience) — the `report` service's reads; it never touches these tables directly
        this.register( new GetInternalRegistrationBrandsImpl( this ) );
        this.register( new GetInternalRegistrationCampaignsImpl( this ) );
        this.register( new GetInternalRegistrationCostEstimatesImpl( this ) );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // SQS registration-submit poll loop (dev drain of RegistrationSubmitJob) — push submits/resubmits/
    // reprovisions to TCR and the carriers off the request path. Each message re-enters the RequestContext
    // from its transaction-id so the whole chain stays correlated back to the enqueuing request.
    private async startSubmitConsumer() : Promise<void>
    {
        this.log.info( "registration submit consumer started (SQS registration-submit)" );
        while( !this.stopping )
        {
            try
            {
                const received : Type.Result<Array<Message>> = await this.sqs.receive( "registration-submit", 10, 10 );
                if( !received.ok ) { await this.delay( 5000 ); continue; }
                for( const message of received.data ) await this.drainSubmit( message );
            }
            catch( error ) { this.log.warn( "registration submit receive failed — backing off", { error: String( error ) } ); await this.delay( 5000 ); }
        }
        this.log.info( "registration submit consumer stopped" );
    }

    // handle ONE registration-submit message inside its own RequestContext; a failure is left un-deleted so
    // SQS redelivers it (and eventually dead-letters), exactly as the Lambda path would behave.
    private async drainSubmit( message : Message ) : Promise<void>
    {
        await RequestContext.run( { transactionId: Sqs.transactionId( message ) }, async () : Promise<void> =>
        {
            this.log.trace( "message received (SQS registration-submit)", { messageId: message.MessageId } );
            const body : RegistrationDomain.SubmitMessage = JSON.parse( message.Body ?? "{}" ) as RegistrationDomain.SubmitMessage;
            const done : Type.Result<void> = await this.domain.processSubmit( body );
            if( !done.ok ) { this.log.warn( "registration submit failed (will redeliver)", { error: done.error } ); return; }
            if( message.ReceiptHandle ) await this.sqs.delete( "registration-submit", message.ReceiptHandle );
        } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // SQS registration-vetting poll loop (dev drain of RegistrationVettingJob) — refresh a brand's external
    // vetting and re-publish trust-score → MPS when the score changes tier.
    private async startVettingConsumer() : Promise<void>
    {
        this.log.info( "registration vetting consumer started (SQS registration-vetting)" );
        while( !this.stopping )
        {
            try
            {
                const received : Type.Result<Array<Message>> = await this.sqs.receive( "registration-vetting", 10, 10 );
                if( !received.ok ) { await this.delay( 5000 ); continue; }
                for( const message of received.data ) await this.drainVetting( message );
            }
            catch( error ) { this.log.warn( "registration vetting receive failed — backing off", { error: String( error ) } ); await this.delay( 5000 ); }
        }
        this.log.info( "registration vetting consumer stopped" );
    }

    // handle ONE registration-vetting message inside its own RequestContext
    private async drainVetting( message : Message ) : Promise<void>
    {
        await RequestContext.run( { transactionId: Sqs.transactionId( message ) }, async () : Promise<void> =>
        {
            this.log.trace( "message received (SQS registration-vetting)", { messageId: message.MessageId } );
            const body : RegistrationDomain.VettingMessage = JSON.parse( message.Body ?? "{}" ) as RegistrationDomain.VettingMessage;
            const done : Type.Result<void> = await this.domain.processVetting( body.accountId, body.brandId );
            if( !done.ok ) { this.log.warn( "registration vetting failed (will redeliver)", { error: done.error } ); return; }
            if( message.ReceiptHandle ) await this.sqs.delete( "registration-vetting", message.ReceiptHandle );
        } );
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

export default RegistrationMainService;
// eof
