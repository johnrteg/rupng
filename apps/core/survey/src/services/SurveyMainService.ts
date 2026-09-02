//
import { RequestContext, Sqs } from "@repo/services";
import { Events } from "@repo/system";
import { Distribution, SurveyResponse } from "@repo/api";
import type { Type } from "@repo/common";
import type { Message } from "@aws-sdk/client-sqs";

import SurveyService from "./SurveyService";
import SurveyTokenStore from "./SurveyTokenStore";

import GetSurveysImpl from "../endpoints/GetSurveysImpl";
import PostSurveyImpl from "../endpoints/PostSurveyImpl";
import GetSurveyImpl from "../endpoints/GetSurveyImpl";
import PutSurveyImpl from "../endpoints/PutSurveyImpl";
import PostSurveyPublishImpl from "../endpoints/PostSurveyPublishImpl";
import PostDistributionImpl from "../endpoints/PostDistributionImpl";
import GetDistributionImpl from "../endpoints/GetDistributionImpl";
import GetResponsesImpl from "../endpoints/GetResponsesImpl";
import GetResultsImpl from "../endpoints/GetResultsImpl";
import PostInternalResponseImpl from "../endpoints/PostInternalResponseImpl";
import PostSurveyWebhookImpl from "../endpoints/PostSurveyWebhookImpl";
import GetSurveyConfigImpl from "../endpoints/GetSurveyConfigImpl";
import PutSurveyConfigImpl from "../endpoints/PutSurveyConfigImpl";

//
// MAIN role — the authed /survey/* API (definition CRUD/publish, distribution setup, results/reads, config).
// Also DRAINS the survey-distribution + survey-ingest queues locally, and runs the WorkQueue dispatch +
// abandonment-sweep ticks — so the whole pipeline works end-to-end without a separate Job runtime (same
// pattern as email's MAIN; survey-9.4-9.6/9.2 documents the eventual Job-Lambda split).
//
export class SurveyMainService extends SurveyService
{
    private stopping : boolean = false;

    ////////////////////////////////////////////////////////////////////////////////////////////
    constructor()
    {
        super( SurveyService.Role.MAIN );
        void this.startDistributionConsumer();
        void this.startIngestConsumer();
        void this.startDispatchTick();
        void this.startAbandonmentSweep();
        void this.startVoiceStepConsumer();
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    /** Register the survey endpoint impls (after the inherited /health + /version). */
    protected override async registerEndpoints() : Promise<void>
    {
        await super.registerEndpoints();          // keeps /health + /version
        this.register( new GetSurveysImpl( this ) );
        this.register( new PostSurveyImpl( this ) );
        this.register( new GetSurveyImpl( this ) );
        this.register( new PutSurveyImpl( this ) );
        this.register( new PostSurveyPublishImpl( this ) );
        this.register( new PostDistributionImpl( this ) );
        this.register( new GetDistributionImpl( this ) );
        this.register( new GetResponsesImpl( this ) );
        this.register( new GetResultsImpl( this ) );
        this.register( new PostInternalResponseImpl( this ) );
        this.register( new PostSurveyWebhookImpl( this ) );
        this.register( new GetSurveyConfigImpl( this ) );
        this.register( new PutSurveyConfigImpl( this ) );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // SQS survey-distribution poll loop (dev drain of SurveyDistributionJob) — expand the audience + mint
    // tokens + enqueue WorkQueue jobs off the request path (survey-3.1/9.6).
    private async startDistributionConsumer() : Promise<void>
    {
        this.log.info( "survey distribution consumer started (SQS survey-distribution)" );
        while( !this.stopping )
        {
            try
            {
                const received : Type.Result<Array<Message>> = await this.sqs.receive( "survey-distribution", 10, 10 );
                if( !received.ok ) { await this.delay( 5000 ); continue; }
                for( const message of received.data )
                    await RequestContext.run( { transactionId: Sqs.transactionId( message ) }, async () : Promise<void> =>
                    {
                        try
                        {
                            const job = JSON.parse( message.Body ?? "{}" ) as { accountId? : string; distributionId? : string };
                            if( job.accountId && job.distributionId ) await this.expandDistribution( job.accountId, job.distributionId );
                            if( message.ReceiptHandle ) await this.sqs.delete( "survey-distribution", message.ReceiptHandle );
                        }
                        catch( err ) { this.log.warn( "survey distribution expand failed (will redeliver)", { error: String( err ) } ); }
                    } );
            }
            catch( error ) { this.log.warn( "survey distribution receive failed — backing off", { error: String( error ) } ); await this.delay( 5000 ); }
        }
        this.log.info( "survey distribution consumer stopped" );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // SQS survey-ingest poll loop (dev drain of SurveyIngestJob) — normalize an external provider's webhook
    // payload into a Response (survey-6.0). See SurveyProviderFactory (Phase 10) for the per-provider mapping.
    private async startIngestConsumer() : Promise<void>
    {
        this.log.info( "survey ingest consumer started (SQS survey-ingest)" );
        while( !this.stopping )
        {
            try
            {
                const received : Type.Result<Array<Message>> = await this.sqs.receive( "survey-ingest", 10, 10 );
                if( !received.ok ) { await this.delay( 5000 ); continue; }
                for( const message of received.data )
                    await RequestContext.run( { transactionId: Sqs.transactionId( message ) }, async () : Promise<void> =>
                    {
                        try
                        {
                            const job = JSON.parse( message.Body ?? "{}" ) as { provider? : string; payload? : unknown };
                            const adapter = job.provider ? this.providers.get( job.provider ) : undefined;
                            const normalized = adapter ? adapter.normalize( job.payload, {} ) : undefined;
                            if( normalized )
                            {
                                // TODO(survey-6.0): resolve `accountId` from the marketplace installation that owns this
                                // provider connection (not yet built) — `captureAnswers` needs a tenant, not just a survey id.
                                this.log.info( "survey webhook normalized (accountId resolution via marketplace pending)", { provider: job.provider, surveyId: normalized.surveyId } );
                            }
                            else this.log.warn( "survey webhook could not be normalized", { provider: job.provider } );
                            if( message.ReceiptHandle ) await this.sqs.delete( "survey-ingest", message.ReceiptHandle );
                        }
                        catch( err ) { this.log.warn( "survey ingest normalize failed (will redeliver)", { error: String( err ) } ); }
                    } );
            }
            catch( error ) { this.log.warn( "survey ingest receive failed — backing off", { error: String( error ) } ); await this.delay( 5000 ); }
        }
        this.log.info( "survey ingest consumer stopped" );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // Kafka consumer — voice's `voice.call` UPDATED event (survey-2.4's phone/IVR runner). Voice emits this
    // per DTMF digit collected (VoiceService.ivrFlowStep), carrying the call's `mergeData` + the just-answered
    // step id/value. Deliberately reads `event.data` as an untyped record rather than importing `@repo/api`'s
    // `Voice` model — survey only needs three fields off a payload it doesn't own, not a hard type dependency
    // on voice's wire contract. Ignores any `voice.call` event that isn't carrying a `mergeData.surveyToken`
    // (i.e. every non-survey call voice places).
    private async startVoiceStepConsumer() : Promise<void>
    {
        if( !this.kafka.configured() ) { this.log.info( "survey voice-step consumer skipped — no Kafka brokers configured (dev)" ); return; }
        try
        {
            await this.kafka.subscribeEvents( "survey-voice-step", Events.Object.VOICE_CALL, async ( event ) : Promise<void> =>
            {
                if( event.verb !== Events.Verb.UPDATED ) return;
                const call = event.data as { accountId? : string; mergeData? : { surveyToken? : string }; lastAnsweredStepId? : string; lastAnsweredValue? : string } | undefined;
                const token : string | undefined = call?.mergeData?.surveyToken;
                if( !token || !call?.lastAnsweredStepId || call.lastAnsweredValue === undefined ) return;   // not a survey call, or no answer yet

                const found : Type.Result<SurveyTokenStore.Entity | undefined> = await this.tokens.get( token );
                if( !found.ok || !found.data ) { this.log.warn( "survey voice-step: unknown/expired token", { token } ); return; }

                const captured : Type.Result<SurveyResponse.Entity> = await this.captureAnswers( {
                    accountId:      found.data.accountId,
                    surveyId:       found.data.surveyId,
                    distributionId: found.data.distributionId,
                    contactId:      found.data.contactId,
                    channel:        Distribution.Channel.PHONE,
                    responseId:     found.data.responseId,
                    answers:        [ { questionId: call.lastAnsweredStepId, value: call.lastAnsweredValue } ],
                } );
                if( !captured.ok ) this.log.warn( "survey voice-step capture failed", { token, error: captured.error } );
            } );
        }
        catch( error ) { this.log.warn( "survey voice-step consumer failed to start (bus unreachable?)", { error: String( error ) } ); }
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // WorkQueue dispatch tick — periodically hands leased recipients to their channel (survey-9.6).
    private async startDispatchTick() : Promise<void>
    {
        while( !this.stopping )
        {
            try { await this.dispatchDistributions(); }
            catch( error ) { this.log.warn( "survey dispatch tick failed", { error: String( error ) } ); }
            await this.delay( 10000 );
        }
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // Abandonment sweep — flips a stale `in_progress` Response to `abandoned` once it's idle past the
    // account's configured inactivity timeout (survey-4.3), scanning the `status` GSI (partition-scoped,
    // not a table scan).
    private async startAbandonmentSweep() : Promise<void>
    {
        while( !this.stopping )
        {
            try { await this.sweepAbandoned(); }
            catch( error ) { this.log.warn( "survey abandonment sweep failed", { error: String( error ) } ); }
            await this.delay( 60000 );
        }
    }

    private async sweepAbandoned() : Promise<void>
    {
        const config = await this.surveyConfig();
        const cutoff : number = Date.now() - config.abandonmentTimeoutMinutes * 60 * 1000;

        // MVP: scan every account's in_progress responses is unavailable without a cross-account index;
        // this sweep relies on being invoked with tenant context in a future cut. For now it's a no-op
        // stub that documents the intended cadence — a per-account trigger (e.g. from GetResponses reads,
        // or a scheduled per-account fan-out) supplies `accountId` once that wiring lands.
        this.log.trace( "abandonment sweep tick (per-account wiring pending)", { cutoff } );
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

export default SurveyMainService;
// eof
