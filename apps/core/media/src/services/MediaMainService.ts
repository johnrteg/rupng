//
import { RequestContext, Sqs } from "@repo/services";
import type { Type } from "@repo/common";
import type { Message } from "@aws-sdk/client-sqs";
import type { Browser } from "puppeteer";
import { MediaConfig, SvgDocument, GetSvgRenderJob, StudioProject } from "@repo/api";

import MediaService from "./MediaService";
import SvgService from "./SvgService";
import { MediaPipeline } from "../pipeline/MediaPipeline";
import { SvgRenderPipeline } from "../pipeline/SvgRenderPipeline";

import PostUploadImpl from "../endpoints/PostUploadImpl";
import PostUploadCompleteImpl from "../endpoints/PostUploadCompleteImpl";
import PostAssetReplaceImpl from "../endpoints/PostAssetReplaceImpl";
import GetAssetsImpl from "../endpoints/GetAssetsImpl";
import GetAssetImpl from "../endpoints/GetAssetImpl";
import GetAssetStatusImpl from "../endpoints/GetAssetStatusImpl";
import PatchAssetImpl from "../endpoints/PatchAssetImpl";
import PostAvatarImpl from "../endpoints/PostAvatarImpl";
import PostAssetVariantsImpl from "../endpoints/PostAssetVariantsImpl";
import PostAssetRescanImpl from "../endpoints/PostAssetRescanImpl";
import PostAssetScanImpl from "../endpoints/PostAssetScanImpl";
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
import GetGenerateBatchImpl from "../endpoints/GetGenerateBatchImpl";
import PostGeneratePromoteImpl from "../endpoints/PostGeneratePromoteImpl";
import DeleteGenerateBatchImpl from "../endpoints/DeleteGenerateBatchImpl";
import PostAssetTranscribeImpl from "../endpoints/PostAssetTranscribeImpl";
import PostAssetBurnCaptionsImpl from "../endpoints/PostAssetBurnCaptionsImpl";
import PostAssetExtractAudioImpl from "../endpoints/PostAssetExtractAudioImpl";
import PostAssetCompressImpl from "../endpoints/PostAssetCompressImpl";
import PostAssetArchiveImpl from "../endpoints/PostAssetArchiveImpl";
import GetArchivesImpl from "../endpoints/GetArchivesImpl";
import GetArchiveUrlImpl from "../endpoints/GetArchiveUrlImpl";
import DeleteArchiveImpl from "../endpoints/DeleteArchiveImpl";
import PostVoiceCloneImpl from "../endpoints/PostVoiceCloneImpl";
import GetVoicesImpl from "../endpoints/GetVoicesImpl";
import DeleteVoiceImpl from "../endpoints/DeleteVoiceImpl";
import GetStudioProjectsImpl from "../endpoints/GetStudioProjectsImpl";
import PostStudioProjectImpl from "../endpoints/PostStudioProjectImpl";
import PostStudioProjectCopyImpl from "../endpoints/PostStudioProjectCopyImpl";
import PatchStudioProjectImpl from "../endpoints/PatchStudioProjectImpl";
import DeleteStudioProjectImpl from "../endpoints/DeleteStudioProjectImpl";
import GetStudioCanvasImpl from "../endpoints/GetStudioCanvasImpl";
import PutStudioCanvasImpl from "../endpoints/PutStudioCanvasImpl";
import PostStudioRenderImpl from "../endpoints/PostStudioRenderImpl";
import GetSvgCanvasImpl from "../endpoints/GetSvgCanvasImpl";
import PutSvgCanvasImpl from "../endpoints/PutSvgCanvasImpl";
import PostSvgRenderImpl from "../endpoints/PostSvgRenderImpl";
import GetSvgRenderJobImpl from "../endpoints/GetSvgRenderJobImpl";
import GetSvgTemplatesImpl from "../endpoints/GetSvgTemplatesImpl";
import PostSvgFromTemplateImpl from "../endpoints/PostSvgFromTemplateImpl";
import PostSvgTemplateImpl from "../endpoints/PostSvgTemplateImpl";
import GetSvgAssetsImpl from "../endpoints/GetSvgAssetsImpl";
import GetSvgAssetImpl from "../endpoints/GetSvgAssetImpl";
import PostSvgAssetImpl from "../endpoints/PostSvgAssetImpl";
import PostSystemSvgAssetImpl from "../endpoints/PostSystemSvgAssetImpl";
import DeleteSvgAssetImpl from "../endpoints/DeleteSvgAssetImpl";

//
// MAIN role — the /media/* API. Also DRAINS the ingest queues locally (scan → process) so the pipeline works
// end-to-end without a separate Job runtime; in a deploy the MediaScanJob / MediaProcessJob Lambdas own the
// queues (same MediaPipeline code) and MAIN is just the API.
//
export class MediaMainService extends MediaService
{
    private stopping : boolean = false;

    // the shared headless Chromium instance backing the svg-render consumer — launched once, lazily, and
    // reused across jobs (relaunching Chromium per message would be far too slow); closed in aboutToQuit()
    private _browser? : Browser;

    /////////////////////////////////////////////////////////////////////
    constructor()
    {
        super( MediaService.Role.MAIN );
        void this.startScanConsumer();
        void this.startProcessConsumer();
        void this.startGenerateConsumer();
        void this.startTranscribeConsumer();
        void this.startBurnCaptionsConsumer();
        void this.startArchiveConsumer();
        void this.startVideoConsumer();
        void this.startStudioRenderConsumer();
        void this.startStudioRenderRemotionConsumer();
        void this.startSvgRenderConsumer();
    }

    /////////////////////////////////////////////////////////////////////
    protected override async registerEndpoints() : Promise<void>
    {
        await super.registerEndpoints();          // keeps /health + /version
        this.register( new PostUploadImpl( this ) );
        this.register( new PostUploadCompleteImpl( this ) );
        this.register( new PostAssetReplaceImpl( this ) );
        this.register( new GetAssetsImpl( this ) );
        this.register( new GetAssetImpl( this ) );
        this.register( new GetAssetStatusImpl( this ) );
        this.register( new PatchAssetImpl( this ) );
        this.register( new PostAvatarImpl( this ) );
        this.register( new PostAssetVariantsImpl( this ) );
        this.register( new PostAssetRescanImpl( this ) );
        this.register( new PostAssetScanImpl( this ) );
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
        this.register( new GetGenerateBatchImpl( this ) );
        this.register( new PostGeneratePromoteImpl( this ) );
        this.register( new DeleteGenerateBatchImpl( this ) );
        this.register( new PostAssetTranscribeImpl( this ) );
        this.register( new PostAssetBurnCaptionsImpl( this ) );
        this.register( new PostAssetExtractAudioImpl( this ) );
        this.register( new PostAssetCompressImpl( this ) );
        this.register( new PostAssetArchiveImpl( this ) );
        this.register( new GetArchivesImpl( this ) );
        this.register( new GetArchiveUrlImpl( this ) );
        this.register( new DeleteArchiveImpl( this ) );
        this.register( new PostVoiceCloneImpl( this ) );
        this.register( new GetVoicesImpl( this ) );
        this.register( new DeleteVoiceImpl( this ) );
        this.register( new GetStudioProjectsImpl( this ) );
        this.register( new PostStudioProjectImpl( this ) );
        this.register( new PostStudioProjectCopyImpl( this ) );
        this.register( new PatchStudioProjectImpl( this ) );
        this.register( new DeleteStudioProjectImpl( this ) );
        this.register( new GetStudioCanvasImpl( this ) );
        this.register( new PutStudioCanvasImpl( this ) );
        this.register( new PostStudioRenderImpl( this ) );
        this.register( new GetSvgCanvasImpl( this ) );
        this.register( new PutSvgCanvasImpl( this ) );
        this.register( new PostSvgRenderImpl( this ) );
        this.register( new GetSvgRenderJobImpl( this ) );
        this.register( new GetSvgTemplatesImpl( this ) );
        this.register( new PostSvgFromTemplateImpl( this ) );
        this.register( new PostSvgTemplateImpl( this ) );
        this.register( new GetSvgAssetsImpl( this ) );
        this.register( new GetSvgAssetImpl( this ) );
        this.register( new PostSvgAssetImpl( this ) );
        this.register( new PostSystemSvgAssetImpl( this ) );
        this.register( new DeleteSvgAssetImpl( this ) );
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
                            this.log.trace( "message received (SQS media-scan)", { messageId: message.MessageId } );
                            const req : any = JSON.parse( message.Body ?? "{}" ) as { accountId? : string; guid? : string };
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
                            this.log.trace( "message received (SQS media-process)", { messageId: message.MessageId } );
                            const req : any = JSON.parse( message.Body ?? "{}" ) as { accountId? : string; guid? : string; profile? : string; rescan? : boolean; posterAt? : number; density? : string };
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
                            this.log.trace( "message received (SQS media-generate)", { messageId: message.MessageId } );
                            const job : any = JSON.parse( message.Body ?? "{}" ) as MediaService.GenerateJob;
                            if( job.accountId && Array.isArray( job.candidates ) && job.candidates.length ) await this.runGenerate( job );
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
                            this.log.trace( "message received (SQS media-transcribe)", { messageId: message.MessageId } );
                            const req : any = JSON.parse( message.Body ?? "{}" ) as { accountId? : string; guid? : string; userId? : string; op? : string };
                            // the queue carries both jobs (op discriminator): "extract" = audio-track only, else transcribe
                            if( req.accountId && req.guid && req.op === "extract" ) await this.runExtractAudio( req.accountId, req.guid, req.userId );
                            else if( req.accountId && req.guid ) await this.runTranscribe( req.accountId, req.guid, req.userId );
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
    // SQS media-caption-burn poll loop (dev drain of the caption burn-in Job, media-2x) — ffmpeg drawtext
    // overlay of a transcript's timed lines onto its source video, off the request path. MAIN drains locally.
    private async startBurnCaptionsConsumer() : Promise<void>
    {
        this.log.info( "media caption-burn consumer started (SQS media-caption-burn)" );
        while( !this.stopping )
        {
            try
            {
                const received : Type.Result<Array<Message>> = await this.sqs.receive( "media-caption-burn", 2, 10 );
                this.log.info( "DEBUG burn-captions receive result", { ok: received.ok, count: received.ok ? received.data.length : 0, error: received.ok ? undefined : received.error } );
                if( !received.ok ) { await this.delay( 5000 ); continue; }
                for( const message of received.data )
                    await RequestContext.run( { transactionId: Sqs.transactionId( message ) }, async () : Promise<void> =>
                    {
                        try
                        {
                            this.log.info( "DEBUG message received (SQS media-caption-burn)", { messageId: message.MessageId, body: message.Body } );
                            const req : any = JSON.parse( message.Body ?? "{}" ) as { accountId? : string; guid? : string; userId? : string; transcriptItem? : string; style? : StudioProject.TextStyle; position? : "top" | "bottom"; fontPct? : number };
                            this.log.info( "DEBUG parsed req", { req } );
                            if( req.accountId && req.guid && req.transcriptItem ) await this.runBurnCaptions( req.accountId, req.guid, req.transcriptItem, req.style, req.position, req.fontPct, req.userId );
                            else this.log.warn( "DEBUG burn-captions guard failed", { req } );
                            if( message.ReceiptHandle ) await this.sqs.delete( "media-caption-burn", message.ReceiptHandle );
                        }
                        catch( err ) { this.log.warn( "media caption-burn failed (will redeliver)", { error: String( err ) } ); }
                    } );
            }
            catch( error ) { this.log.warn( "media caption-burn receive failed — backing off", { error: String( error ) } ); await this.delay( 5000 ); }
        }
        this.log.info( "media caption-burn consumer stopped" );
    }

    /////////////////////////////////////////////////////////////////////
    // SQS studio-render poll loop (dev drain of the Studio video-render Job, media-21) — composite the project
    // timeline to an mp4 with ffmpeg off the request path; emits media.job stage events. MAIN drains locally.
    private async startStudioRenderConsumer() : Promise<void>
    {
        this.log.info( "studio render consumer started (SQS studio-render)" );
        while( !this.stopping )
        {
            try
            {
                const received : Type.Result<Array<Message>> = await this.sqs.receive( "studio-render", 2, 10 );
                if( !received.ok ) { await this.delay( 5000 ); continue; }
                for( const message of received.data )
                    await RequestContext.run( { transactionId: Sqs.transactionId( message ) }, async () : Promise<void> =>
                    {
                        try
                        {
                            this.log.trace( "message received (SQS studio-render)", { messageId: message.MessageId } );
                            const req : any = JSON.parse( message.Body ?? "{}" ) as { accountId? : string; projectId? : string; userId? : string };
                            if( req.accountId && req.projectId ) await this.runStudioRender( req.accountId, req.projectId, req.userId );
                            if( message.ReceiptHandle ) await this.sqs.delete( "studio-render", message.ReceiptHandle );
                        }
                        catch( err ) { this.log.warn( "studio render failed (will redeliver)", { error: String( err ) } ); }
                    } );
            }
            catch( error ) { this.log.warn( "studio render receive failed — backing off", { error: String( error ) } ); await this.delay( 5000 ); }
        }
        this.log.info( "studio render consumer stopped" );
    }

    /////////////////////////////////////////////////////////////////////
    // SQS studio-render-remotion poll loop (media-21.18) — the Chromium/Remotion render engine. Same job payload
    // as the ffmpeg queue; the endpoint routes here when MediaConfig.render.engine === REMOTION. Runs the render
    // with the REMOTION engine (exact preview==output via headless Chromium). MAIN drains locally.
    private async startStudioRenderRemotionConsumer() : Promise<void>
    {
        this.log.info( "studio render (remotion) consumer started (SQS studio-render-remotion)" );
        while( !this.stopping )
        {
            try
            {
                const received : Type.Result<Array<Message>> = await this.sqs.receive( "studio-render-remotion", 2, 10 );
                if( !received.ok ) { await this.delay( 5000 ); continue; }
                for( const message of received.data )
                    await RequestContext.run( { transactionId: Sqs.transactionId( message ) }, async () : Promise<void> =>
                    {
                        try
                        {
                            this.log.trace( "message received (SQS studio-render-remotion)", { messageId: message.MessageId } );
                            const req : any = JSON.parse( message.Body ?? "{}" ) as { accountId? : string; projectId? : string; userId? : string };
                            if( req.accountId && req.projectId ) await this.runStudioRender( req.accountId, req.projectId, req.userId, MediaConfig.RenderEngine.REMOTION );
                            if( message.ReceiptHandle ) await this.sqs.delete( "studio-render-remotion", message.ReceiptHandle );
                        }
                        catch( err ) { this.log.warn( "studio render (remotion) failed (will redeliver)", { error: String( err ) } ); }
                    } );
            }
            catch( error ) { this.log.warn( "studio render (remotion) receive failed — backing off", { error: String( error ) } ); await this.delay( 5000 ); }
        }
        this.log.info( "studio render (remotion) consumer stopped" );
    }

    /////////////////////////////////////////////////////////////////////
    // SQS svg-render poll loop (SVG editor export-render — SVG_EDITOR_SPEC §10) — compile the requested
    // SvgDocument pages to SVG/PNG/JPEG/PDF via the shared headless Chromium instance and flip the
    // svg-render-jobs row to DONE/FAILED. MAIN drains locally; Chromium's process weight is a poor fit for a
    // cold-start Lambda, so (unlike scan/process) there is no Lambda counterpart yet.
    // mirrors CloudManifest's `svg-render` queue `maxReceiveCount` — the delivery attempt after which SQS
    // moves the message to the DLQ, so a failure ON this attempt must be recorded here rather than left to
    // silently dead-letter (which would leave the job's row stuck at PENDING/PROCESSING forever).
    private static readonly SVG_RENDER_MAX_ATTEMPTS : number = 2;

    private async startSvgRenderConsumer() : Promise<void>
    {
        this.log.info( "svg render consumer started (SQS svg-render)" );
        while( !this.stopping )
        {
            try
            {
                const received : Type.Result<Array<Message>> = await this.sqs.receive( "svg-render", 2, 10 );
                if( !received.ok ) { await this.delay( 5000 ); continue; }
                for( const message of received.data )
                    await RequestContext.run( { transactionId: Sqs.transactionId( message ) }, async () : Promise<void> =>
                    {
                        // this attempt count (from SQS's own redelivery bookkeeping) tells us whether this is
                        // the LAST chance before the message dead-letters
                        const attempt : number = Number( message.Attributes?.ApproximateReceiveCount ?? "1" );
                        const isLastAttempt : boolean = attempt >= MediaMainService.SVG_RENDER_MAX_ATTEMPTS;
                        let jobId : string | undefined;
                        try
                        {
                            this.log.trace( "message received (SQS svg-render)", { messageId: message.MessageId } );
                            const req : any = JSON.parse( message.Body ?? "{}" ) as { jobId? : string; accountId? : string; projectId? : string; pageIds? : Array<string> | null; settings? : SvgDocument.ExportSettings };
                            jobId = req.jobId;
                            if( req.jobId && req.accountId && req.projectId && req.settings )
                            {
                                const browser : Browser = await this.browser();
                                await SvgRenderPipeline.runRenderJob( { dynamo: this.dynamo, s3: this.s3, log: this.log }, browser, req.jobId, req.accountId, req.projectId, req.pageIds ?? null, req.settings );
                            }
                            if( message.ReceiptHandle ) await this.sqs.delete( "svg-render", message.ReceiptHandle );
                        }
                        catch( err )
                        {
                            this.log.warn( isLastAttempt ? "svg render failed (final attempt — failing the job)" : "svg render failed (will redeliver)", { jobId, attempt, error: String( err ) } );
                            if( isLastAttempt )
                            {
                                if( jobId ) await this.failRenderJob( jobId, String( err ) );
                                if( message.ReceiptHandle ) await this.sqs.delete( "svg-render", message.ReceiptHandle );
                            }
                        }
                    } );
            }
            catch( error ) { this.log.warn( "svg render receive failed — backing off", { error: String( error ) } ); await this.delay( 5000 ); }
        }
        this.log.info( "svg render consumer stopped" );
    }

    /////////////////////////////////////////////////////////////////////
    /** Flip a render job's row straight to FAILED — used when the SQS consumer gives up on its final delivery
     *  attempt, so the row never dead-ends at PENDING/PROCESSING once the message reaches the DLQ. */
    private async failRenderJob( jobId : string, reason : string ) : Promise<void>
    {
        const got : Type.Result<SvgService.RenderJobRow | undefined> = await this.dynamo.get<SvgService.RenderJobRow>( "svg-render-jobs", { pk: jobId } );
        if( !got.ok || got.data === undefined ) return;
        const wrote : Type.Result<void> = await this.dynamo.put( "svg-render-jobs", { ...got.data, status: GetSvgRenderJob.RenderStatus.FAILED, outputUrl: null, error: reason } );
        if( !wrote.ok ) this.log.warn( "svg render: could not record final failure", { jobId, error: wrote.error } );
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
                            this.log.trace( "message received (SQS media-archive)", { messageId: message.MessageId } );
                            const req : any = JSON.parse( message.Body ?? "{}" ) as { accountId? : string; archiveId? : string; userId? : string };
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
                            this.log.trace( "message received (SQS media-video)", { messageId: message.MessageId } );
                            const req : any = JSON.parse( message.Body ?? "{}" ) as { accountId? : string; guid? : string; target? : string; userId? : string };
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
    // lazily launch the shared headless Chromium instance used by the svg-render consumer — dynamic import
    // matches this repo's convention for heavy native deps (sharp/ffmpeg/archiver — see MediaAnalyzer).
    // Chromium can crash/disconnect between jobs (OOM, a renderer crash, …); a cached-but-dead Browser throws
    // "ConnectionClosedError" on the next newPage() call, so check `.connected` and relaunch rather than
    // trusting the cached reference forever.
    private async browser() : Promise<Browser>
    {
        if( this._browser === undefined || !this._browser.connected )
        {
            const puppeteer = await import( "puppeteer" );
            this._browser = await puppeteer.launch( { headless: true, args: [ "--no-sandbox", "--disable-setuid-sandbox" ] } );
        }
        return this._browser;
    }

    /////////////////////////////////////////////////////////////////////
    /** Stop the poll loops before the base closes the HTTP server (so the process can exit on SIGINT). */
    protected override async aboutToQuit() : Promise<void>
    {
        this.stopping = true;
        if( this._browser !== undefined && this._browser.connected )
        {
            try { await this._browser.close(); }
            catch( error ) { this.log.warn( "browser close failed during shutdown", { error: String( error ) } ); }
        }
        await super.aboutToQuit();
    }

    /////////////////////////////////////////////////////////////////////
    private delay( ms : number ) : Promise<void> { return new Promise( ( resolve ) => setTimeout( resolve, ms ) ); }
}

export default MediaMainService;
