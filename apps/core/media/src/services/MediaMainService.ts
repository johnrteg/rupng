//
import { RequestContext, Sqs } from "@repo/services";
import type { Type } from "@repo/common";
import type { Message } from "@aws-sdk/client-sqs";

import MediaService from "./MediaService";
import { MediaPipeline } from "../pipeline/MediaPipeline";

import PostUploadImpl from "../endpoints/PostUploadImpl";
import PostUploadCompleteImpl from "../endpoints/PostUploadCompleteImpl";
import GetAssetsImpl from "../endpoints/GetAssetsImpl";
import GetAssetImpl from "../endpoints/GetAssetImpl";
import GetAssetStatusImpl from "../endpoints/GetAssetStatusImpl";
import PatchAssetImpl from "../endpoints/PatchAssetImpl";
import PostAssetVariantsImpl from "../endpoints/PostAssetVariantsImpl";
import PostAssetRescanImpl from "../endpoints/PostAssetRescanImpl";
import PostAssetDuplicateImpl from "../endpoints/PostAssetDuplicateImpl";
import PostAssetPosterImpl from "../endpoints/PostAssetPosterImpl";
import DeleteAssetImpl from "../endpoints/DeleteAssetImpl";
import GetMediaUrlImpl from "../endpoints/GetMediaUrlImpl";
import GetItemVersionsImpl from "../endpoints/GetItemVersionsImpl";
import PostItemRevertImpl from "../endpoints/PostItemRevertImpl";
import PostItemTextImpl from "../endpoints/PostItemTextImpl";
import GetDensitiesImpl from "../endpoints/GetDensitiesImpl";
import PostAssetDensityImpl from "../endpoints/PostAssetDensityImpl";
import GetVariantSpecsImpl from "../endpoints/GetVariantSpecsImpl";
import PostAiGenerateImpl from "../endpoints/PostAiGenerateImpl";
import PostAssetTranscribeImpl from "../endpoints/PostAssetTranscribeImpl";
import PostAssetCompressImpl from "../endpoints/PostAssetCompressImpl";
import PostAssetArchiveImpl from "../endpoints/PostAssetArchiveImpl";
import GetArchivesImpl from "../endpoints/GetArchivesImpl";
import GetArchiveUrlImpl from "../endpoints/GetArchiveUrlImpl";
import DeleteArchiveImpl from "../endpoints/DeleteArchiveImpl";
import PostVoiceCloneImpl from "../endpoints/PostVoiceCloneImpl";
import GetVoicesImpl from "../endpoints/GetVoicesImpl";
import DeleteVoiceImpl from "../endpoints/DeleteVoiceImpl";

//
// MAIN role — the /media/* API. Also DRAINS the ingest queues locally (scan → process) so the pipeline works
// end-to-end without a separate Job runtime; in a deploy the MediaScanJob / MediaProcessJob Lambdas own the
// queues (same MediaPipeline code) and MAIN is just the API.
//
export class MediaMainService extends MediaService
{
    private stopping : boolean = false;

    /////////////////////////////////////////////////////////////////////
    constructor()
    {
        super( MediaService.Role.MAIN );
        void this.startScanConsumer();
        void this.startProcessConsumer();
        void this.startGenerateConsumer();
        void this.startTranscribeConsumer();
        void this.startArchiveConsumer();
        void this.startVideoConsumer();
    }

    /////////////////////////////////////////////////////////////////////
    protected override async registerEndpoints() : Promise<void>
    {
        await super.registerEndpoints();          // keeps /health + /version
        this.register( new PostUploadImpl( this ) );
        this.register( new PostUploadCompleteImpl( this ) );
        this.register( new GetAssetsImpl( this ) );
        this.register( new GetAssetImpl( this ) );
        this.register( new GetAssetStatusImpl( this ) );
        this.register( new PatchAssetImpl( this ) );
        this.register( new PostAssetVariantsImpl( this ) );
        this.register( new PostAssetRescanImpl( this ) );
        this.register( new PostAssetDuplicateImpl( this ) );
        this.register( new PostAssetPosterImpl( this ) );
        this.register( new DeleteAssetImpl( this ) );
        this.register( new GetMediaUrlImpl( this ) );
        this.register( new GetItemVersionsImpl( this ) );
        this.register( new PostItemRevertImpl( this ) );
        this.register( new PostItemTextImpl( this ) );
        this.register( new GetDensitiesImpl( this ) );
        this.register( new PostAssetDensityImpl( this ) );
        this.register( new GetVariantSpecsImpl( this ) );
        this.register( new PostAiGenerateImpl( this ) );
        this.register( new PostAssetTranscribeImpl( this ) );
        this.register( new PostAssetCompressImpl( this ) );
        this.register( new PostAssetArchiveImpl( this ) );
        this.register( new GetArchivesImpl( this ) );
        this.register( new GetArchiveUrlImpl( this ) );
        this.register( new DeleteArchiveImpl( this ) );
        this.register( new PostVoiceCloneImpl( this ) );
        this.register( new GetVoicesImpl( this ) );
        this.register( new DeleteVoiceImpl( this ) );
    }

    /////////////////////////////////////////////////////////////////////
    // SQS scan-queue poll loop (dev drain of MediaScanJob). Each message re-enters the RequestContext from
    // its transaction-id attribute so the pipeline's logs stay correlated to the upload request.
    private async startScanConsumer() : Promise<void>
    {
        this.log.info( "media scan consumer started (SQS media-scan)" );
        while( !this.stopping )
        {
            try
            {
                const received : Type.Result<Array<Message>> = await this.sqs.receive( "media-scan", 10, 10 );
                if( !received.ok ) { await this.delay( 5000 ); continue; }
                for( const message of received.data )
                    await RequestContext.run( { transactionId: Sqs.transactionId( message ) }, async () : Promise<void> =>
                    {
                        try
                        {
                            const req = JSON.parse( message.Body ?? "{}" ) as { accountId? : string; guid? : string };
                            if( req.accountId && req.guid ) await MediaPipeline.scan( await this.pipelineDeps(), req.accountId, req.guid );
                            if( message.ReceiptHandle ) await this.sqs.delete( "media-scan", message.ReceiptHandle );
                        }
                        catch( err ) { this.log.warn( "media scan failed (will redeliver)", { error: String( err ) } ); }
                    } );
            }
            catch( error ) { this.log.warn( "media scan receive failed — backing off", { error: String( error ) } ); await this.delay( 5000 ); }
        }
        this.log.info( "media scan consumer stopped" );
    }

    /////////////////////////////////////////////////////////////////////
    // SQS process-queue poll loop (dev drain of MediaProcessJob) — image variant derivation.
    private async startProcessConsumer() : Promise<void>
    {
        this.log.info( "media process consumer started (SQS media-process)" );
        while( !this.stopping )
        {
            try
            {
                const received : Type.Result<Array<Message>> = await this.sqs.receive( "media-process", 10, 10 );
                if( !received.ok ) { await this.delay( 5000 ); continue; }
                for( const message of received.data )
                    await RequestContext.run( { transactionId: Sqs.transactionId( message ) }, async () : Promise<void> =>
                    {
                        try
                        {
                            const req = JSON.parse( message.Body ?? "{}" ) as { accountId? : string; guid? : string; profile? : string; rescan? : boolean; posterAt? : number; density? : string };
                            if( req.accountId && req.guid )
                            {
                                if( req.posterAt !== undefined ) await MediaPipeline.regeneratePoster( await this.pipelineDeps(), req.accountId, req.guid, req.posterAt );
                                else if( req.rescan ) await MediaPipeline.analyze( await this.pipelineDeps(), req.accountId, req.guid );
                                else if( req.density ) await MediaPipeline.densify( await this.pipelineDeps(), req.accountId, req.guid, req.density );
                                else await MediaPipeline.process( await this.pipelineDeps(), req.accountId, req.guid, req.profile );
                            }
                            if( message.ReceiptHandle ) await this.sqs.delete( "media-process", message.ReceiptHandle );
                        }
                        catch( err ) { this.log.warn( "media process failed (will redeliver)", { error: String( err ) } ); }
                    } );
            }
            catch( error ) { this.log.warn( "media process receive failed — backing off", { error: String( error ) } ); await this.delay( 5000 ); }
        }
        this.log.info( "media process consumer stopped" );
    }

    /////////////////////////////////////////////////////////////////////
    // SQS media-generate poll loop (dev drain of the generate Job, media-19) — runs the heavy AI provider
    // calls off the request path and emits media.job stage events; MAIN drains locally, a Lambda in prod.
    private async startGenerateConsumer() : Promise<void>
    {
        this.log.info( "media generate consumer started (SQS media-generate)" );
        while( !this.stopping )
        {
            try
            {
                const received : Type.Result<Array<Message>> = await this.sqs.receive( "media-generate", 5, 10 );
                if( !received.ok ) { await this.delay( 5000 ); continue; }
                for( const message of received.data )
                    await RequestContext.run( { transactionId: Sqs.transactionId( message ) }, async () : Promise<void> =>
                    {
                        try
                        {
                            const job = JSON.parse( message.Body ?? "{}" ) as MediaService.GenerateJob;
                            if( job.accountId && Array.isArray( job.guids ) && job.guids.length ) await this.runGenerate( job );
                            if( message.ReceiptHandle ) await this.sqs.delete( "media-generate", message.ReceiptHandle );
                        }
                        catch( err ) { this.log.warn( "media generate failed (will redeliver)", { error: String( err ) } ); }
                    } );
            }
            catch( error ) { this.log.warn( "media generate receive failed — backing off", { error: String( error ) } ); await this.delay( 5000 ); }
        }
        this.log.info( "media generate consumer stopped" );
    }

    /////////////////////////////////////////////////////////////////////
    // SQS media-transcribe poll loop (dev drain of the transcribe Job, media-19) — audio extract + Whisper
    // off the request path, emitting media.job stage events. MAIN drains locally; a Lambda in prod.
    private async startTranscribeConsumer() : Promise<void>
    {
        this.log.info( "media transcribe consumer started (SQS media-transcribe)" );
        while( !this.stopping )
        {
            try
            {
                const received : Type.Result<Array<Message>> = await this.sqs.receive( "media-transcribe", 5, 10 );
                if( !received.ok ) { await this.delay( 5000 ); continue; }
                for( const message of received.data )
                    await RequestContext.run( { transactionId: Sqs.transactionId( message ) }, async () : Promise<void> =>
                    {
                        try
                        {
                            const req = JSON.parse( message.Body ?? "{}" ) as { accountId? : string; guid? : string; userId? : string };
                            if( req.accountId && req.guid ) await this.runTranscribe( req.accountId, req.guid, req.userId );
                            if( message.ReceiptHandle ) await this.sqs.delete( "media-transcribe", message.ReceiptHandle );
                        }
                        catch( err ) { this.log.warn( "media transcribe failed (will redeliver)", { error: String( err ) } ); }
                    } );
            }
            catch( error ) { this.log.warn( "media transcribe receive failed — backing off", { error: String( error ) } ); await this.delay( 5000 ); }
        }
        this.log.info( "media transcribe consumer stopped" );
    }

    /////////////////////////////////////////////////////////////////////
    // SQS media-archive poll loop (dev drain of the archive Job, media-20) — zip original+variants off the
    // request path into a TTL'd download; emits media.job stage events. MAIN drains locally; a Lambda in prod.
    private async startArchiveConsumer() : Promise<void>
    {
        this.log.info( "media archive consumer started (SQS media-archive)" );
        while( !this.stopping )
        {
            try
            {
                const received : Type.Result<Array<Message>> = await this.sqs.receive( "media-archive", 5, 10 );
                if( !received.ok ) { await this.delay( 5000 ); continue; }
                for( const message of received.data )
                    await RequestContext.run( { transactionId: Sqs.transactionId( message ) }, async () : Promise<void> =>
                    {
                        try
                        {
                            const req = JSON.parse( message.Body ?? "{}" ) as { accountId? : string; archiveId? : string; userId? : string };
                            if( req.accountId && req.archiveId ) await this.runArchive( req.accountId, req.archiveId, req.userId );
                            if( message.ReceiptHandle ) await this.sqs.delete( "media-archive", message.ReceiptHandle );
                        }
                        catch( err ) { this.log.warn( "media archive failed (will redeliver)", { error: String( err ) } ); }
                    } );
            }
            catch( error ) { this.log.warn( "media archive receive failed — backing off", { error: String( error ) } ); await this.delay( 5000 ); }
        }
        this.log.info( "media archive consumer stopped" );
    }

    /////////////////////////////////////////////////////////////////////
    // SQS media-video poll loop (dev drain of MediaVideoJob, media-10.10) — video compression off the request
    // path (ffmpeg CRF ladder), emitting media.job stage events. MAIN drains locally; Fargate/MediaConvert prod.
    private async startVideoConsumer() : Promise<void>
    {
        this.log.info( "media video consumer started (SQS media-video)" );
        while( !this.stopping )
        {
            try
            {
                const received : Type.Result<Array<Message>> = await this.sqs.receive( "media-video", 2, 10 );
                if( !received.ok ) { await this.delay( 5000 ); continue; }
                for( const message of received.data )
                    await RequestContext.run( { transactionId: Sqs.transactionId( message ) }, async () : Promise<void> =>
                    {
                        try
                        {
                            const req = JSON.parse( message.Body ?? "{}" ) as { accountId? : string; guid? : string; target? : string; userId? : string };
                            if( req.accountId && req.guid && req.target ) await this.runCompress( req.accountId, req.guid, req.target, req.userId );
                            if( message.ReceiptHandle ) await this.sqs.delete( "media-video", message.ReceiptHandle );
                        }
                        catch( err ) { this.log.warn( "media video failed (will redeliver)", { error: String( err ) } ); }
                    } );
            }
            catch( error ) { this.log.warn( "media video receive failed — backing off", { error: String( error ) } ); await this.delay( 5000 ); }
        }
        this.log.info( "media video consumer stopped" );
    }

    /////////////////////////////////////////////////////////////////////
    /** Stop the poll loops before the base closes the HTTP server (so the process can exit on SIGINT). */
    protected override async aboutToQuit() : Promise<void>
    {
        this.stopping = true;
        await super.aboutToQuit();
    }

    /////////////////////////////////////////////////////////////////////
    private delay( ms : number ) : Promise<void> { return new Promise( ( resolve ) => setTimeout( resolve, ms ) ); }
}

export default MediaMainService;
