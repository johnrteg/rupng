//
import { randomUUID } from "node:crypto";

import { Application, Service, Ports, Register, Dynamo, S3, Sqs, Kafka, Secrets, Scanner, ScanFactory } from "@repo/services";
import { Ai, AiFactory } from "@repo/ai";
import { RestfulEndpoint, Access } from "@repo/endpoint";
import { Events } from "@repo/system";
import { Media, MediaConfig, AiRouting, AiGen, StudioProject, Captions } from "@repo/api";
import { FileUtils, ObjectUtils, ResultUtils } from "@repo/common";
import type { Type } from "@repo/common";

import { MediaPipeline } from "../pipeline/MediaPipeline";
import { MediaAnalyzer } from "../pipeline/MediaAnalyzer";

//
// common media server base — the object index (DynamoDB), the bytes (S3 + presign), and the ingest pipeline
// (SQS scan → process). Concrete roles extend this; today just MediaMainService (the /media/* API, which
// also drains the pipeline queues locally).
//
export class MediaService extends Service
{
    private _dynamo? : Dynamo;
    private _s3?     : S3;
    private _sqs?    : Sqs;
    private _kafka?  : Kafka;
    private _secrets? : Secrets;

    ///////////////////////////////////////////////////////////////////////////////////////
    constructor( role : MediaService.Role )
    {
        super( Register.Service.MEDIA, role, MediaService.PORT[ role ] );

        const pkg : Application.PackageInfo = this.loadPackageInfo( __dirname );
        this.setVersion( pkg.version );
        this.log.info( "version", { name: pkg.name, version: pkg.version } );
    }

    ///////////////////////////////////////////////////////////////////////////////////////
    /** Dynamo facade — the media object index (`media` table). Lazy + cached. */
    public get dynamo() : Dynamo { return this._dynamo ??= new Dynamo( this.cloud ); }

    ///////////////////////////////////////////////////////////////////////////////////////
    /** S3 facade — media bytes + presigned URLs (`media` bucket). Lazy + cached. */
    public get s3() : S3 { return this._s3 ??= new S3( this.cloud ); }

    ///////////////////////////////////////////////////////////////////////////////////////
    /** SQS facade — the ingest pipeline queues (media-scan / media-process). Lazy + cached. */
    public get sqs() : Sqs { return this._sqs ??= new Sqs( this.cloud ); }

    ///////////////////////////////////////////////////////////////////////////////////////
    /** Kafka facade — publishes `media.asset` lifecycle events (created / updated / deleted). Lazy + cached. */
    public get kafka() : Kafka { return this._kafka ??= new Kafka( this.cloud ); }

    ///////////////////////////////////////////////////////////////////////////////////////
    /** Secrets facade — root-managed provider API keys (Browse, media-16). Lazy + cached. */
    public get secrets() : Secrets { return this._secrets ??= new Secrets( this.cloud ); }

    ///////////////////////////////////////////////////////////////////////////////////////
    /** Publish a `media.asset` lifecycle event (media-4 / events dictionary). Best-effort — a bus miss is
     *  logged, never fails the request. The envelope's `data` is the current Media.Asset (the wire model a
     *  websocket/webhook subscriber receives). `userId` is the acting user (the event's actor). */
    public async publishAsset( verb : Events.Verb, asset : Media.Asset, userId? : string ) : Promise<void>
    {
        const published : Type.Result<void> = await this.kafka.publishEvent( {
            version:    "1",
            eventId:    randomUUID(),
            occurredAt: new Date().toISOString(),
            accountId:  asset.accountId,
            actor:      { kind: userId ? Events.ActorKind.USER : Events.ActorKind.SERVICE, id: userId ?? "media" },
            object:     Events.Object.MEDIA_ASSET,
            verb,
            action:     Events.actionOf( Events.Object.MEDIA_ASSET, verb ),
            target:     { type: "media.asset", id: asset.guid },
            source:     { channel: Events.SourceChannel.API },
            outcome:    Events.Outcome.SUCCESS,
            data:       asset,
            sinks:      [ Events.Sink.KAFKA ],
        } );
        if( !published.ok ) this.log.warn( "media.asset event publish failed", { guid: asset.guid, verb, error: published.error } );
        else this.log.trace( "media.asset event published", { guid: asset.guid, verb } );
    }

    ///////////////////////////////////////////////////////////////////////////////////////
    /** Emit a `media.job` STAGE event (media-19.2) — an async operation's progress on one asset, so the UI
     *  can show live status and workflows can sequence steps. Best-effort (a bus miss is logged, never fails
     *  the Job). `job` is the operation id (e.g. "transcribe" / "generate"); terminal stages map to outcome. */
    public async emitJobStage( accountId : string, guid : string, job : string, stage : Events.JobStage,
                               extra : { progress? : number; message? : string; userId? : string } = {} ) : Promise<void>
    {
        const published : Type.Result<void> = await this.kafka.publishEvent( {
            version:    "1",
            eventId:    randomUUID(),
            occurredAt: new Date().toISOString(),
            accountId,
            actor:      { kind: extra.userId ? Events.ActorKind.USER : Events.ActorKind.SERVICE, id: extra.userId ?? "media" },
            object:     Events.Object.MEDIA_JOB,
            verb:       Events.Verb.UPDATED,
            action:     Events.actionOf( Events.Object.MEDIA_JOB, Events.Verb.UPDATED ),
            target:     { type: "media.job", id: guid },
            source:     { channel: Events.SourceChannel.API },
            outcome:    stage === Events.JobStage.FAILED ? Events.Outcome.FAILURE : Events.Outcome.SUCCESS,
            data:       { guid, job, stage, progress: extra.progress, message: extra.message },
            sinks:      [ Events.Sink.KAFKA ],
        } );
        if( !published.ok ) this.log.warn( "media.job stage event publish failed", { guid, job, stage, error: published.error } );
        else this.log.trace( "media.job stage event published", { guid, job, stage } );
    }

    ///////////////////////////////////////////////////////////////////////////////////////
    /** `media.asset created` — a new asset exists (upload accepted / duplicated). */
    public assetCreated( asset : Media.Asset, userId? : string ) : Promise<void> { return this.publishAsset( Events.Verb.CREATED, asset, userId ); }
    /** `media.asset updated` — metadata/variants/status changed. */
    public assetUpdated( asset : Media.Asset, userId? : string ) : Promise<void> { return this.publishAsset( Events.Verb.UPDATED, asset, userId ); }
    /** `media.asset deleted` — the asset was (soft) deleted. */
    public assetDeleted( asset : Media.Asset, userId? : string ) : Promise<void> { return this.publishAsset( Events.Verb.DELETED, asset, userId ); }

    ///////////////////////////////////////////////////////////////////////////////////////
    /** The live runtime config (AppConfig config/settings), falling back to the seeded defaults. Exposed so
     *  endpoint impls (which can't reach the protected `appConfig`) can read upload/delivery/variant policy. */
    public async mediaConfig() : Promise<MediaConfig.Config>
    {
        const got : Type.Result<MediaConfig.Config | undefined> = await this.appConfig.json<MediaConfig.Config>( "config", "settings" );
        // deep-fill from DEFAULT so an older/partial hosted config (seeded before newer fields like `scan`/
        // `autoTag`) tolerates schema drift instead of crashing a reader (media schema-drift rule).
        return got.ok && got.data ? ObjectUtils.withDefaults( got.data, MediaConfig.DEFAULT ) : MediaConfig.DEFAULT;
    }

    ///////////////////////////////////////////////////////////////////////////////////////
    /** ENQUEUE an AI generation (media-18 / media-19): resolve + validate the modality's provider (request
     *  override or `config/ai` routing), create N placeholder `source.origin = generated` assets (status
     *  UPLOADING — no bytes yet), enqueue ONE `media-generate` job carrying their guids, and return the ack.
     *  The heavy provider calls run in the Job (drained by MAIN locally / a Lambda in prod), which produces
     *  the bytes and emits `media.job` stage events. The UI polls each guid until ready. `{ status, response }`
     *  for the impl; 501 when no provider/adapter serves the modality. */
    public async enqueueGenerate( auth : RestfulEndpoint.Authentication, request : AiGen.Request ) : Promise<{ status : number; response? : AiGen.Response }>
    {
        const accountId : string | undefined = auth.accountId;
        if( !accountId ) return { status: 400 };

        // resolve the client — a request override wins, else the account's config/ai route for the modality
        const client : Ai | undefined = request.provider
            ? AiFactory.create( { provider: request.provider as unknown as Ai.Provider, model: request.model } )
            : await this.aiFor( request.modality );
        if( client === undefined ) return { status: 501 };   // no provider configured / no adapter

        const params : Record<string, unknown> = request.params ?? {};
        const shape : { kind : Media.Kind; mime : string; extension : string } | null = MediaService.mediaShape( request.modality, params );
        if( shape === null || !MediaService.supportsModality( client, request.modality ) ) return { status: 501 };

        // resolve the MODEL for this modality on the backend: an explicit request model (account/marketplace
        // override, later) → the per-(provider,modality) default → undefined (adapter's own modality default).
        // NB: never `client.model` — that's the CHAT default and would leak into image/video/tts (e.g. sending
        // gemini-2.5-flash to Imagen's :predict). This is the single backend model-selection point.
        const model : string | undefined = request.model ?? AiRouting.modelFor( client.provider as unknown as AiRouting.Provider, request.modality );

        // how many candidate solutions to produce — clamped to the provider's range for this media type
        const range : AiRouting.CandidateRange = AiRouting.candidatesFor( client.provider as unknown as AiRouting.Provider, request.modality );
        const count : number = Math.max( range.min, Math.min( range.max, request.count ?? range.default ) );

        // build the STAGING batch — N pending candidates (bytes filled by the Job into the staging bucket).
        // Nothing goes to the library; the batch row tracks each candidate until the user promotes.
        const batchId : string = randomUUID();
        const now : string = new Date().toISOString();
        const staged : Array<MediaService.StagingCandidate> = [];
        for( let index : number = 0; index < count; index++ )
            staged.push( { id: randomUUID(), kind: shape.kind, mime: shape.mime, extension: shape.extension, status: AiGen.CandidateStatus.PENDING } );

        const batch : MediaService.StagingBatch = {
            accountId, batchId, userId: auth.userId,
            provider: client.provider, model, prompt: request.prompt, modality: request.modality, params,
            candidates: staged, createdAt: now, ttl: Math.floor( Date.now() / 1000 ) + MediaService.STAGING_TTL_SEC,
        };
        const wrote : Type.Result<void> = await this.dynamo.put( "media_staging", { ...batch } );
        if( !wrote.ok ) { this.log.warn( "generate enqueue failed — staging batch write", { batchId, error: wrote.error } ); return { status: 500 }; }
        void this.emitJobStage( accountId, batchId, "generate", Events.JobStage.QUEUED, { userId: auth.userId } );

        const job : MediaService.GenerateJob = {
            accountId, userId: auth.userId, batchId,
            candidates: staged.map( ( candidate : MediaService.StagingCandidate ) => ( { id: candidate.id, kind: candidate.kind, mime: candidate.mime, extension: candidate.extension } ) ),
            modality: request.modality, prompt: request.prompt, provider: client.provider as unknown as AiRouting.Provider, model, params,
        };
        const queued : Type.Result<void> = await this.sqs.send( "media-generate", job );
        if( !queued.ok ) { this.log.warn( "generate enqueue failed — media-generate queue send", { batchId, error: queued.error } ); return { status: 500 }; }
        this.log.trace( "message enqueued (SQS media-generate)", { accountId, batchId } );

        const pending : Array<AiGen.Pending> = staged.map( ( candidate : MediaService.StagingCandidate ) : AiGen.Pending => ( { id: candidate.id, kind: candidate.kind } ) );
        return { status: 202, response: { batchId, candidates: pending, provider: client.provider, model: client.model } };
    }

    ///////////////////////////////////////////////////////////////////////////////////////
    // the staging-bucket object key for a batch candidate: acct/<accountId>/staging/<batchId>/<id>.<ext>
    private static stagingKey( accountId : string, batchId : string, candidate : { id : string; extension : string } ) : string
    {
        return `acct/${ accountId }/staging/${ batchId }/${ candidate.id }.${ candidate.extension }`;
    }

    ///////////////////////////////////////////////////////////////////////////////////////
    /** WORKER (media-generate, media-18): produce the bytes for each candidate in a generate job, store them in
     *  the STAGING bucket, and update the staging batch row (per-candidate READY/FAILED) so the UI can poll.
     *  Nothing is written to the library — the user promotes chosen candidates later. Emits `media.job` stage
     *  events keyed by the batchId. Drained by MAIN locally; a Lambda in prod. */
    public async runGenerate( job : MediaService.GenerateJob ) : Promise<void>
    {
        // VIDEO uses an async provider job that outputs to S3 (Nova Reel) — hand the adapter the staging bucket
        // as its scratch output location; harmless/undefined for other modalities.
        const videoBucket : string | undefined = job.modality === AiRouting.Modality.VIDEO ? this.stagingBucketName() : undefined;
        this.log.info( "media.generate job start", { batchId: job.batchId, provider: job.provider, model: job.model, modality: job.modality, candidates: job.candidates.length } );
        void this.emitJobStage( job.accountId, job.batchId, "generate", Events.JobStage.STARTED, { userId: job.userId } );
        // image generation is a slow, bursty operation — OpenAI gpt-image-1 occasionally returns transient
        // 500s that resolve in seconds; 5 attempts with a 1 s base delay gives up to ~15 s of back-off time
        const client : Ai = AiFactory.create( { provider: job.provider as unknown as Ai.Provider, model: job.model, videoBucket, maxAttempts: 5, retryBaseDelayMs: 1000 } );

        for( const candidate of job.candidates )
        {
            // capture a thrown provider error too (network / unexpected) — a deterministic failure must land as
            // FAILED with detail, not bubble up and redeliver the job forever
            let produced : MediaService.Produced;
            try { produced = await this.produceBytes( client, job.modality, job.prompt, job.params ); }
            catch( error : unknown ) { produced = { bytes: null, error: `provider threw: ${ String( error ) }` }; }

            if( !produced.bytes || produced.bytes.length === 0 )
            {
                const message : string = produced.error ?? "provider returned no content";
                this.log.warn( "media.generate failed", { batchId: job.batchId, candidateId: candidate.id, provider: job.provider, model: job.model, error: message } );
                await this.updateStagingCandidate( job.accountId, job.batchId, candidate.id, { status: AiGen.CandidateStatus.FAILED, error: message } );
                continue;
            }

            // store the produced bytes in the STAGING bucket + mark the candidate READY
            const key : string = MediaService.stagingKey( job.accountId, job.batchId, candidate );
            const put : Type.Result<void> = await this.s3.put( "media-staging", key, Buffer.from( produced.bytes ), candidate.mime );
            if( !put.ok )
            {
                await this.updateStagingCandidate( job.accountId, job.batchId, candidate.id, { status: AiGen.CandidateStatus.FAILED, error: "store failed" } );
                continue;
            }
            await this.updateStagingCandidate( job.accountId, job.batchId, candidate.id, { status: AiGen.CandidateStatus.READY, size: produced.bytes.length, key } );
        }
        void this.emitJobStage( job.accountId, job.batchId, "generate", Events.JobStage.COMPLETED, { userId: job.userId } );
    }

    ///////////////////////////////////////////////////////////////////////////////////////
    // Whether a client can serve a modality (maps the modality to the AI capability it needs).
    private static supportsModality( client : Ai, modality : AiRouting.Modality ) : boolean
    {
        if( modality === AiRouting.Modality.IMAGE ) return client.capabilities.has( Ai.Capability.IMAGE );
        if( modality === AiRouting.Modality.VIDEO ) return client.capabilities.has( Ai.Capability.VIDEO );
        if( modality === AiRouting.Modality.SOUND )
            return client.capabilities.has( Ai.Capability.SOUND ) || client.capabilities.has( Ai.Capability.SPEECH );
        if( modality === AiRouting.Modality.TEXT_TO_SPEECH || modality === AiRouting.Modality.SPEECH_CLONING )
            return client.capabilities.has( Ai.Capability.SPEECH );
        return false;   // CHAT: no generate-to-asset adapter path
    }

    ///////////////////////////////////////////////////////////////////////////////////////
    // The produced media's kind/mime/extension for a modality (deterministic, so the placeholder's object key
    // matches what the Job writes). null when the modality has no generate-to-asset shape.
    private static mediaShape( modality : AiRouting.Modality, params : Record<string, unknown> ) : { kind : Media.Kind; mime : string; extension : string } | null
    {
        if( modality === AiRouting.Modality.IMAGE ) return { kind: Media.Kind.IMAGE, mime: FileUtils.Mime.IMAGE_PNG, extension: "png" };
        if( modality === AiRouting.Modality.VIDEO ) return { kind: Media.Kind.VIDEO, mime: FileUtils.Mime.VIDEO_MP4, extension: "mp4" };
        if( modality === AiRouting.Modality.TEXT_TO_SPEECH || modality === AiRouting.Modality.SPEECH_CLONING || modality === AiRouting.Modality.SOUND )
            return params.format === "wav"
                ? { kind: Media.Kind.AUDIO, mime: FileUtils.Mime.AUDIO_WAV,  extension: "wav" }
                : { kind: Media.Kind.AUDIO, mime: FileUtils.Mime.AUDIO_MPEG, extension: "mp3" };
        return null;
    }

    ///////////////////////////////////////////////////////////////////////////////////////
    // Call the right AI capability for the modality and return the produced bytes (empty on provider failure,
    // null when unsupported). Normalized `params` are mapped to each capability's request.
    private async produceBytes( client : Ai, modality : AiRouting.Modality, prompt : string, params : Record<string, unknown> ) : Promise<MediaService.Produced>
    {
        if( modality === AiRouting.Modality.IMAGE )
        {
            if( !client.capabilities.has( Ai.Capability.IMAGE ) ) return { bytes: null, error: "provider has no IMAGE capability" };
            const reply : Ai.ImageResponse = await client.image( { prompt, n: 1, size: MediaService.imageSize( params.aspect ), quality: typeof params.quality === "string" ? params.quality : undefined } );
            if( !reply.ok ) return { bytes: null, error: MediaService.replyError( reply.error, "image generation failed" ) };
            const first : Ai.ImageOut | undefined = reply.images[ 0 ];
            // base64 (OpenAI/Bedrock) → decode; a URL (Magnific/Freepik) → fetch the bytes server-side
            if( first?.b64 ) return { bytes: new Uint8Array( Buffer.from( first.b64, "base64" ) ) };
            if( first?.url ) return { bytes: await MediaService.fetchBytes( first.url ) };
            return { bytes: null, error: "provider returned no image data" };
        }
        const format : Ai.AudioFormat = params.format === "wav" ? Ai.AudioFormat.WAV : Ai.AudioFormat.MP3;
        // SOUND — a sound-effect / music prompt → prefer the dedicated sound() capability, else fall through
        if( modality === AiRouting.Modality.SOUND && client.capabilities.has( Ai.Capability.SOUND ) )
        {
            const durationSec : number | undefined = typeof params.duration === "number" ? params.duration : undefined;
            const reply : Ai.SoundResponse = await client.sound( { prompt, durationSec, format } );
            return reply.ok ? { bytes: reply.audio } : { bytes: null, error: MediaService.replyError( reply.error, "sound generation failed" ) };
        }
        // TEXT_TO_SPEECH / SPEECH_CLONING (and SOUND fallback) — text → spoken audio
        if( modality === AiRouting.Modality.TEXT_TO_SPEECH || modality === AiRouting.Modality.SPEECH_CLONING || modality === AiRouting.Modality.SOUND )
        {
            if( !client.capabilities.has( Ai.Capability.SPEECH ) ) return { bytes: null, error: "provider has no SPEECH capability" };
            const voiceId : string | undefined = typeof params.voiceId === "string" && params.voiceId ? params.voiceId : undefined;
            const reply : Ai.SpeakResponse = await client.speak( { text: prompt, voiceId, format } );
            return reply.ok ? { bytes: reply.audio } : { bytes: null, error: MediaService.replyError( reply.error, "speech generation failed" ) };
        }
        if( modality === AiRouting.Modality.VIDEO )
        {
            if( !client.capabilities.has( Ai.Capability.VIDEO ) ) return { bytes: null, error: "provider has no VIDEO capability" };
            const durationSec : number | undefined = typeof params.duration === "number" ? params.duration : undefined;
            const aspect : string | undefined = typeof params.aspect === "string" ? params.aspect : undefined;
            const reply : Ai.VideoResponse = await client.video( { prompt, durationSec, aspect } );
            return reply.ok ? { bytes: reply.video } : { bytes: null, error: MediaService.replyError( reply.error, "video generation failed" ) };
        }
        return { bytes: null, error: `no generate-to-asset path for modality ${ modality }` };   // CHAT
    }

    ///////////////////////////////////////////////////////////////////////////////////////
    // format an AI reply's error (status + message) into a single diagnostic string for logs + stage events
    private static replyError( error : { status? : number; message? : string } | undefined, fallback : string ) : string
    {
        if( !error ) return fallback;
        return [ error.status ? `[${ error.status }]` : "", error.message ?? fallback ].filter( Boolean ).join( " " );
    }

    ///////////////////////////////////////////////////////////////////////////////////////
    // render timed transcript segments as SubRip (.srt): a numbered cue per segment, `HH:MM:SS,mmm` times
    private static toSrt( segments : Array<Media.TranscriptSegment> ) : string
    {
        return segments
            .map( ( segment : Media.TranscriptSegment, index : number ) : string =>
                `${ index + 1 }\n${ MediaService.captionTimestamp( segment.start, "," ) } --> ${ MediaService.captionTimestamp( segment.end, "," ) }\n${ segment.text.trim() }\n` )
            .join( "\n" );
    }

    ///////////////////////////////////////////////////////////////////////////////////////
    // render timed transcript segments as WebVTT (.vtt): the `WEBVTT` header + a cue per segment, `HH:MM:SS.mmm`
    // times (VTT uses a DOT before milliseconds, unlike SubRip's comma)
    private static toVtt( segments : Array<Media.TranscriptSegment> ) : string
    {
        const cues : string = segments
            .map( ( segment : Media.TranscriptSegment ) : string =>
                `${ MediaService.captionTimestamp( segment.start, "." ) } --> ${ MediaService.captionTimestamp( segment.end, "." ) }\n${ segment.text.trim() }\n` )
            .join( "\n" );
        return `WEBVTT\n\n${ cues }`;
    }

    ///////////////////////////////////////////////////////////////////////////////////////
    // a seconds offset → a caption timestamp `HH:MM:SS<sep>mmm` (`,` for SubRip, `.` for WebVTT)
    private static captionTimestamp( seconds : number, millisSeparator : string ) : string
    {
        const safe : number = Number.isFinite( seconds ) && seconds > 0 ? seconds : 0;
        const hours : number = Math.floor( safe / 3600 );
        const minutes : number = Math.floor( ( safe % 3600 ) / 60 );
        const wholeSeconds : number = Math.floor( safe % 60 );
        const milliseconds : number = Math.round( ( safe - Math.floor( safe ) ) * 1000 );
        const pad = ( value : number, size : number ) : string => String( value ).padStart( size, "0" );
        return `${ pad( hours, 2 ) }:${ pad( minutes, 2 ) }:${ pad( wholeSeconds, 2 ) }${ millisSeparator }${ pad( milliseconds, 3 ) }`;
    }

    ///////////////////////////////////////////////////////////////////////////////////////
    // Fetch bytes from a provider URL (a generator that returns a link rather than inline bytes); empty on error.
    private static async fetchBytes( url : string ) : Promise<Uint8Array>
    {
        try
        {
            const response : Response = await fetch( url );
            if( !response.ok ) return new Uint8Array();
            return new Uint8Array( await response.arrayBuffer() );
        }
        catch { return new Uint8Array(); }
    }

    ///////////////////////////////////////////////////////////////////////////////////////
    // Map a normalized aspect attribute to a provider image size (OpenAI's supported set; square default).
    // OpenAI gpt-image-1 supported sizes: 1024x1024 (square), 1536x1024 (landscape), 1024x1536 (portrait)
    private static imageSize( aspect : unknown ) : string
    {
        if( aspect === "16:9" ) return "1536x1024";
        if( aspect === "9:16" ) return "1024x1536";
        return "1024x1024";
    }

    ///////////////////////////////////////////////////////////////////////////////////////
    /** ENQUEUE a transcription (media-18 / media-19): validate the asset is audio/video, then enqueue a
     *  `media-transcribe` job. The heavy work (audio extract + Whisper) runs in the Job. `{ status }` for the
     *  impl; 409 when the asset isn't transcribable. */
    public async enqueueTranscribe( auth : RestfulEndpoint.Authentication, guid : string ) : Promise<{ status : number }>
    {
        const accountId : string | undefined = auth.accountId;
        if( !accountId ) return { status: 400 };
        const got : Type.Result<Media.Asset | undefined> = await this.dynamo.get<Media.Asset>( "media", { accountId, guid } );
        if( !got.ok ) { this.log.warn( "transcribe enqueue failed — media read", { guid, error: got.error } ); return { status: 500 }; }
        if( !got.data ) return { status: 404 };
        if( got.data.kind !== Media.Kind.AUDIO && got.data.kind !== Media.Kind.VIDEO ) return { status: 409 };   // only a/v have speech

        void this.emitJobStage( accountId, guid, "transcribe", Events.JobStage.QUEUED, { userId: auth.userId } );
        const queued : Type.Result<void> = await this.sqs.send( "media-transcribe", { accountId, guid, userId: auth.userId, op: "transcribe" } );
        if( !queued.ok ) { this.log.warn( "transcribe enqueue failed — media-transcribe queue send", { guid, error: queued.error } ); return { status: 500 }; }
        this.log.trace( "message enqueued (SQS media-transcribe)", { accountId, guid } );
        this.log.info( "transcribe queued", { guid } );
        return { status: 202 };
    }

    ///////////////////////////////////////////////////////////////////////////////////////
    /** ENQUEUE an audio-track extraction (a VIDEO → an `audio` variant on the asset). Shares the
     *  `media-transcribe` queue (an `op:"extract"` discriminator) so it reuses the ffmpeg-capable consumer.
     *  409 when the asset isn't a video. */
    public async enqueueExtractAudio( auth : RestfulEndpoint.Authentication, guid : string ) : Promise<{ status : number }>
    {
        const accountId : string | undefined = auth.accountId;
        if( !accountId ) return { status: 400 };
        const got : Type.Result<Media.Asset | undefined> = await this.dynamo.get<Media.Asset>( "media", { accountId, guid } );
        if( !got.ok ) { this.log.warn( "extract-audio enqueue failed — media read", { guid, error: got.error } ); return { status: 500 }; }
        if( !got.data ) return { status: 404 };
        if( got.data.kind !== Media.Kind.VIDEO ) return { status: 409 };   // only a video HAS a separable audio track

        void this.emitJobStage( accountId, guid, "extract-audio", Events.JobStage.QUEUED, { userId: auth.userId } );
        const queued : Type.Result<void> = await this.sqs.send( "media-transcribe", { accountId, guid, userId: auth.userId, op: "extract" } );
        if( !queued.ok ) { this.log.warn( "extract-audio enqueue failed — media-transcribe queue send", { guid, error: queued.error } ); return { status: 500 }; }
        this.log.trace( "message enqueued (SQS media-transcribe)", { accountId, guid } );
        this.log.info( "extract-audio queued", { guid } );
        return { status: 202 };
    }

    ///////////////////////////////////////////////////////////////////////////////////////
    /** WORKER (media-transcribe, media-19): extract the audio track from a VIDEO (store it as the `audio`
     *  variant) or use an AUDIO asset's bytes, run speech-to-text via the `config/ai` SPEECH_TO_TEXT provider
     *  (Whisper), and save `asset.transcript` (text + timed segments). Emits `media.job` stage events. */
    public async runTranscribe( accountId : string, guid : string, userId? : string ) : Promise<void>
    {
        this.log.info( "transcribe started", { guid } );
        void this.emitJobStage( accountId, guid, "transcribe", Events.JobStage.STARTED, { userId } );
        // FAIL both surfaces the reason in the media log (so a job trace is visible) AND emits the Kafka stage
        const fail = ( message : string ) : void =>
        {
            this.log.warn( "transcribe failed", { guid, message } );
            void this.emitJobStage( accountId, guid, "transcribe", Events.JobStage.FAILED, { message, userId } );
        };

        const got : Type.Result<Media.Asset | undefined> = await this.dynamo.get<Media.Asset>( "media", { accountId, guid } );
        if( !got.ok || !got.data ) { fail( "asset missing" ); return; }
        const asset : Media.Asset = got.data;
        const original : Media.Item | undefined = Media.originalItem( asset );
        if( !original || ( original.kind !== Media.Kind.AUDIO && original.kind !== Media.Kind.VIDEO ) ) { fail( "not audio/video" ); return; }

        // the STT client from config/ai routing (SPEECH_TO_TEXT); capability-gated. Pass the staging bucket so
        // an async, S3-backed provider (Amazon Transcribe) has a scratch location for the audio input.
        const stt : Ai | undefined = await this.aiFor( AiRouting.Modality.SPEECH_TO_TEXT, { transcribeBucket: this.stagingBucketName() } );
        if( stt === undefined || !stt.capabilities.has( Ai.Capability.TRANSCRIBE ) ) { fail( "no speech-to-text provider configured" ); return; }

        // read the ORIGINAL bytes
        const object : Type.Result<{ Body? : { transformToByteArray() : Promise<Uint8Array> } }> = await this.s3.get( "media", MediaPipeline.itemKey( asset, original ) );
        if( !object.ok || !object.data.Body ) { fail( "original bytes unavailable" ); return; }
        const originalBytes : Uint8Array = await object.data.Body.transformToByteArray();

        // for a VIDEO, extract the audio track first → an AUDIO item (the STT input); for AUDIO use it directly
        let items : Array<Media.Item> = asset.items;
        let audioBytes : Uint8Array = originalBytes;
        let audioMime  : string = original.mime;
        let sourceItemId : string = original.id;
        if( original.kind === Media.Kind.VIDEO )
        {
            void this.emitJobStage( accountId, guid, "transcribe", Events.JobStage.RUNNING, { progress: 33, message: "extracting audio", userId } );
            const extracted : { items : Array<Media.Item>; audioItem : Media.Item; bytes : Uint8Array; mime : string } | null = await this.saveExtractedAudio( asset, original, originalBytes );
            if( !extracted ) { fail( "audio extraction failed" ); return; }
            items        = extracted.items;
            audioBytes   = extracted.bytes;
            audioMime    = extracted.mime;
            sourceItemId = extracted.audioItem.id;
        }

        // run speech-to-text → a TRANSCRIPT item (a .json file + the text/segments in its meta)
        void this.emitJobStage( accountId, guid, "transcribe", Events.JobStage.RUNNING, { progress: 66, message: "transcribing", userId } );
        const reply : Ai.TranscribeResponse = await stt.transcribe( { audio: audioBytes, mime: audioMime } );
        if( !reply.ok ) { fail( reply.error?.message ?? "transcription failed" ); return; }

        const now : string = new Date().toISOString();
        const transcript : Media.Transcript = {
            text: reply.text, segments: reply.segments, language: reply.language,
            provider: reply.provider, model: reply.model, createdAt: now,
        };
        const transcriptItem : Media.Item = {
            id: randomUUID(), usage: Media.Usage.TRANSCRIPT, kind: Media.Kind.DOCUMENT, mime: FileUtils.Mime.JSON, extension: "json",
            size: 0, version: 1, status: Media.Status.OK, createdAt: now, modifiedAt: now,
            meta: { document: { transcript } },
            derivation: { job: "transcribe", provider: reply.provider, model: reply.model, sourceItemId },
        };
        const doc : Buffer = Buffer.from( JSON.stringify( transcript ) );
        transcriptItem.size = doc.length;
        const put : Type.Result<void> = await this.s3.put( "media", MediaPipeline.itemKey( asset, transcriptItem ), doc, FileUtils.Mime.JSON );
        transcriptItem.status = put.ok ? Media.Status.OK : Media.Status.FAILED;
        items = Media.upsertItems( items, transcriptItem );

        // also emit downloadable caption files when the provider returned timed segments — separate TRANSCRIPT
        // items keyed `transcript.srt` (SubRip) + `transcript.vtt` (WebVTT); the JSON one stays source of truth
        if( reply.segments.length > 0 )
        {
            const captions : Array<{ profile : string; mime : string; extension : string; body : string }> =
            [
                { profile: "srt", mime: "application/x-subrip", extension: "srt", body: MediaService.toSrt( reply.segments ) },
                { profile: "vtt", mime: "text/vtt",             extension: "vtt", body: MediaService.toVtt( reply.segments ) },
            ];
            for( const caption of captions )
            {
                const captionItem : Media.Item = {
                    id: randomUUID(), usage: Media.Usage.TRANSCRIPT, profile: caption.profile, kind: Media.Kind.DOCUMENT,
                    mime: caption.mime, extension: caption.extension, size: 0, version: 1, status: Media.Status.OK,
                    createdAt: now, modifiedAt: now,
                    derivation: { job: "transcribe", provider: reply.provider, model: reply.model, sourceItemId },
                };
                const body : Buffer = Buffer.from( caption.body );
                captionItem.size = body.length;
                const captionPut : Type.Result<void> = await this.s3.put( "media", MediaPipeline.itemKey( asset, captionItem ), body, caption.mime );
                captionItem.status = captionPut.ok ? Media.Status.OK : Media.Status.FAILED;
                items = Media.upsertItems( items, captionItem );
            }
        }

        const updated : Media.Asset = { ...asset, items, modifiedAt: now };
        await this.dynamo.put( "media", { ...updated } );
        void this.assetUpdated( updated, userId );
        this.log.info( "transcribe complete", { guid, segments: reply.segments.length, captions: reply.segments.length > 0 } );
        void this.emitJobStage( accountId, guid, "transcribe", Events.JobStage.COMPLETED, { userId } );
    }

    ///////////////////////////////////////////////////////////////////////////////////////
    /** ENQUEUE a caption burn-in (media-2x): validate the asset is a VIDEO and the named item is a `.srt`/`.vtt`
     *  TRANSCRIPT item, then enqueue a `media-caption-burn` job. The heavy work (ffmpeg drawtext overlay) runs
     *  in the Job. `{ status }` for the impl; 409 when the asset/item can't be burned. */
    public async enqueueBurnCaptions( auth : RestfulEndpoint.Authentication, guid : string, transcriptItem : string, style : StudioProject.TextStyle | undefined, position : "top" | "bottom" | undefined, fontPct : number | undefined ) : Promise<{ status : number }>
    {
        const accountId : string | undefined = auth.accountId;
        if( !accountId ) return { status: 400 };
        const got : Type.Result<Media.Asset | undefined> = await this.dynamo.get<Media.Asset>( "media", { accountId, guid } );
        if( !got.ok ) { this.log.warn( "burn-captions enqueue failed — media read", { guid, error: got.error } ); return { status: 500 }; }
        if( !got.data ) return { status: 404 };
        if( got.data.kind !== Media.Kind.VIDEO ) return { status: 409 };   // only a video can have captions burned onto it

        const item : Media.Item | undefined = got.data.items.find( ( candidate : Media.Item ) : boolean => Media.itemKey( candidate.usage, candidate.profile ) === transcriptItem );
        if( !item || item.usage !== Media.Usage.TRANSCRIPT || ( item.extension !== "srt" && item.extension !== "vtt" ) ) return { status: 409 };   // not a caption item

        void this.emitJobStage( accountId, guid, "burn-captions", Events.JobStage.QUEUED, { userId: auth.userId } );
        const queued : Type.Result<void> = await this.sqs.send( "media-caption-burn", { accountId, guid, userId: auth.userId, transcriptItem, style, position, fontPct } );
        if( !queued.ok ) { this.log.warn( "burn-captions enqueue failed — media-caption-burn queue send", { guid, error: queued.error } ); return { status: 500 }; }
        this.log.trace( "message enqueued (SQS media-caption-burn)", { accountId, guid, transcriptItem } );
        this.log.info( "burn-captions queued", { guid, transcriptItem } );
        return { status: 202 };
    }

    ///////////////////////////////////////////////////////////////////////////////////////
    /** WORKER (media-caption-burn): burn a transcript's timed lines onto its source VIDEO via the SAME ffmpeg
     *  compositor Studio's render uses (`MediaAnalyzer.renderComposite`) — one full-duration video layer + one
     *  `drawtext` layer per timed line. Segments are read FRESH off the caption item's CURRENT bytes at run
     *  time (never stale — always whatever was last saved), and the saved result is stamped with the exact
     *  transcript item + version burned. Saves a NEW `Usage.CAPTIONED` item on the SAME asset (never a new
     *  asset). Emits `media.job` stage events. */
    public async runBurnCaptions( accountId : string, guid : string, transcriptItem : string, style? : StudioProject.TextStyle, position? : "top" | "bottom", fontPct? : number, userId? : string ) : Promise<void>
    {
        this.log.info( "burn-captions started", { guid, transcriptItem } );
        void this.emitJobStage( accountId, guid, "burn-captions", Events.JobStage.STARTED, { userId } );
        // FAIL both surfaces the reason in the media log AND emits the Kafka stage
        const fail = ( message : string ) : void =>
        {
            this.log.warn( "burn-captions failed", { guid, message } );
            void this.emitJobStage( accountId, guid, "burn-captions", Events.JobStage.FAILED, { message, userId } );
        };

        // load the asset + resolve the source video and the transcript item being burned
        const got : Type.Result<Media.Asset | undefined> = await this.dynamo.get<Media.Asset>( "media", { accountId, guid } );
        if( !got.ok || !got.data ) { fail( "asset missing" ); return; }
        const asset : Media.Asset = got.data;
        const original : Media.Item | undefined = Media.originalItem( asset );
        if( !original || original.kind !== Media.Kind.VIDEO ) { fail( "not a video" ); return; }
        const captionItem : Media.Item | undefined = asset.items.find( ( candidate : Media.Item ) : boolean => Media.itemKey( candidate.usage, candidate.profile ) === transcriptItem );
        if( !captionItem ) { fail( "transcript item not found" ); return; }

        const durationSec : number | undefined = original.meta?.video?.durationSec;
        if( !durationSec ) { fail( "source video duration unknown" ); return; }
        const width  : number = original.meta?.video?.width  ?? 1920;
        const height : number = original.meta?.video?.height ?? 1080;
        const fps    : number = original.meta?.video?.frameRate ?? 30;

        // read the transcript item's CURRENT text bytes → timed segments
        void this.emitJobStage( accountId, guid, "burn-captions", Events.JobStage.RUNNING, { progress: 15, message: "reading transcript", userId } );
        const captionObject : Type.Result<{ Body? : { transformToByteArray() : Promise<Uint8Array> } }> = await this.s3.get( "media", MediaPipeline.itemKey( asset, captionItem ) );
        if( !captionObject.ok || !captionObject.data.Body ) { fail( "transcript bytes unavailable" ); return; }
        const captionBytes : Uint8Array = await captionObject.data.Body.transformToByteArray();
        const segments : Array<Media.TranscriptSegment> = Captions.parse( Buffer.from( captionBytes ).toString( "utf-8" ), captionItem.extension );
        if( segments.length === 0 ) { fail( "transcript has no timed lines" ); return; }

        // read the ORIGINAL video's bytes
        void this.emitJobStage( accountId, guid, "burn-captions", Events.JobStage.RUNNING, { progress: 30, message: "reading source video", userId } );
        const videoObject : Type.Result<{ Body? : { transformToByteArray() : Promise<Uint8Array> } }> = await this.s3.get( "media", MediaPipeline.itemKey( asset, original ) );
        if( !videoObject.ok || !videoObject.data.Body ) { fail( "source video bytes unavailable" ); return; }
        const videoBytes : Uint8Array = await videoObject.data.Body.transformToByteArray();

        // one full-duration media layer (the untrimmed source video) + one drawtext layer per timed line,
        // placed at the caption bar (top/bottom per the request, else the shared CAPTION_GEOMETRY default)
        const yPct : number = position === "top" ? 0.08 : StudioProject.CAPTION_GEOMETRY.yPct;
        const resolvedFontPct : number = fontPct ?? StudioProject.CAPTION_GEOMETRY.fontPct;
        const media : Array<MediaAnalyzer.CompositeMediaLayer> =
        [
            { kind: "video", bytes: videoBytes, ext: original.extension, startSec: 0, durationSec, hasAudio: Boolean( original.meta?.video?.audioCodec ) },
        ];
        const texts : Array<MediaAnalyzer.CompositeTextLayer> = segments.map( ( segment : Media.TranscriptSegment ) : MediaAnalyzer.CompositeTextLayer =>
            ( { text: segment.text, startSec: segment.start, durationSec: Math.max( 0.1, segment.end - segment.start ),
                xPct: StudioProject.CAPTION_GEOMETRY.xPct, yPct, fontPct: resolvedFontPct, align: StudioProject.CAPTION_GEOMETRY.align,
                style: style ?? StudioProject.CAPTION_STYLE } ) );

        // composite via the SAME ffmpeg overlay graph Studio's render uses
        void this.emitJobStage( accountId, guid, "burn-captions", Events.JobStage.RUNNING, { progress: 50, message: "rendering", userId } );
        const encodeQuality : { crf : number; preset : string } = StudioProject.VIDEO_QUALITY[ StudioProject.VideoQuality.STANDARD ];
        const out : Uint8Array | null = await MediaAnalyzer.renderComposite( width, height, fps, durationSec, media, texts, undefined, encodeQuality );
        if( out === null ) { fail( "render produced no output" ); return; }

        // save the burned mp4 as a NEW item on the SAME asset — `profile` ties it to the exact transcript item
        // + version burned; `derivation.params` carries the full provenance (item id, key, version, style)
        const now : string = new Date().toISOString();
        const profile : string = `${ transcriptItem.replace( ".", "-" ) }-v${ captionItem.version }`;
        const burnedItem : Media.Item = {
            id: randomUUID(), usage: Media.Usage.CAPTIONED, profile, kind: Media.Kind.VIDEO, mime: "video/mp4", extension: "mp4",
            size: out.length, version: 1, status: Media.Status.OK, createdAt: now, modifiedAt: now,
            derivation: { job: "burn-captions", sourceItemId: original.id, producedAt: now,
                          params: { transcriptItemId: captionItem.id, transcriptItem, transcriptVersion: captionItem.version, style, position } },
        };
        const put : Type.Result<void> = await this.s3.put( "media", MediaPipeline.itemKey( asset, burnedItem ), Buffer.from( out ), "video/mp4" );
        burnedItem.status = put.ok ? Media.Status.OK : Media.Status.FAILED;
        const updated : Media.Asset = { ...asset, items: Media.upsertItems( asset.items, burnedItem ), modifiedAt: now };
        const wrote : Type.Result<void> = await this.dynamo.put( "media", { ...updated } );
        if( !wrote.ok ) { fail( "could not save the captioned variant" ); return; }

        void this.assetUpdated( updated, userId );
        this.log.info( "burn-captions complete", { guid, profile } );
        void this.emitJobStage( accountId, guid, "burn-captions", Events.JobStage.COMPLETED, { progress: 100, message: "saved to library", userId } );
    }

    ///////////////////////////////////////////////////////////////////////////////////////
    /** Extract a video's audio track (ffmpeg) → a stored AUDIO item on the asset (`usage: audio`,
     *  `derivation.job: extract-audio`). Shared by transcribe (which then runs STT on it) and the standalone
     *  Extract-audio action. Returns the updated items + the new item + the raw bytes/mime, or null on failure. */
    private async saveExtractedAudio( asset : Media.Asset, original : Media.Item, originalBytes : Uint8Array ) : Promise<{ items : Array<Media.Item>; audioItem : Media.Item; bytes : Uint8Array; mime : string } | null>
    {
        const extracted : { bytes : Uint8Array; format : string; mime : string } | null = await MediaAnalyzer.extractAudio( originalBytes, original.extension );
        if( !extracted ) return null;
        const now : string = new Date().toISOString();
        const audioItem : Media.Item = {
            id: randomUUID(), usage: Media.Usage.AUDIO, kind: Media.Kind.AUDIO, mime: extracted.mime, extension: extracted.format,
            size: extracted.bytes.length, version: 1, status: Media.Status.OK, createdAt: now, modifiedAt: now,
            derivation: { job: "extract-audio", sourceItemId: original.id },
        };
        const put : Type.Result<void> = await this.s3.put( "media", MediaPipeline.itemKey( asset, audioItem ), Buffer.from( extracted.bytes ), extracted.mime );
        audioItem.status = put.ok ? Media.Status.OK : Media.Status.FAILED;
        const items : Array<Media.Item> = Media.upsertItems( asset.items, audioItem );
        return { items, audioItem, bytes: extracted.bytes, mime: extracted.mime };
    }

    ///////////////////////////////////////////////////////////////////////////////////////
    /** WORKER (media-transcribe, op:"extract"): extract a VIDEO's audio track into an AUDIO variant on the
     *  asset (no transcription). Emits `extract-audio` stage events + logs its outcome. */
    public async runExtractAudio( accountId : string, guid : string, userId? : string ) : Promise<void>
    {
        this.log.info( "extract-audio started", { guid } );
        void this.emitJobStage( accountId, guid, "extract-audio", Events.JobStage.STARTED, { userId } );
        const fail = ( message : string ) : void =>
        {
            this.log.warn( "extract-audio failed", { guid, message } );
            void this.emitJobStage( accountId, guid, "extract-audio", Events.JobStage.FAILED, { message, userId } );
        };

        const got : Type.Result<Media.Asset | undefined> = await this.dynamo.get<Media.Asset>( "media", { accountId, guid } );
        if( !got.ok || !got.data ) { fail( "asset missing" ); return; }
        const asset : Media.Asset = got.data;
        const original : Media.Item | undefined = Media.originalItem( asset );
        if( !original || original.kind !== Media.Kind.VIDEO ) { fail( "not a video" ); return; }

        const object : Type.Result<{ Body? : { transformToByteArray() : Promise<Uint8Array> } }> = await this.s3.get( "media", MediaPipeline.itemKey( asset, original ) );
        if( !object.ok || !object.data.Body ) { fail( "original bytes unavailable" ); return; }
        const originalBytes : Uint8Array = await object.data.Body.transformToByteArray();

        const extracted : { items : Array<Media.Item>; audioItem : Media.Item; bytes : Uint8Array; mime : string } | null = await this.saveExtractedAudio( asset, original, originalBytes );
        if( !extracted ) { fail( "audio extraction failed" ); return; }

        const updated : Media.Asset = { ...asset, items: extracted.items, modifiedAt: new Date().toISOString() };
        const wrote : Type.Result<void> = await this.dynamo.put( "media", { ...updated } );
        if( !wrote.ok ) { fail( "asset write failed" ); return; }
        void this.assetUpdated( updated, userId );
        this.log.info( "extract-audio complete", { guid, item: extracted.audioItem.id } );
        void this.emitJobStage( accountId, guid, "extract-audio", Events.JobStage.COMPLETED, { userId } );
    }

    ///////////////////////////////////////////////////////////////////////////////////////
    // The physical `media-staging` S3 bucket name (for handing to the Nova Reel async video output), or
    // undefined when it can't be resolved (not deployed) — video then reports "no output bucket".
    private stagingBucketName() : string | undefined
    {
        try { return this.cloud.bucketName( "media-staging" ); }
        catch { return undefined; }
    }

    ///////////////////////////////////////////////////////////////////////////////////////
    // Read-modify-write ONE candidate in a staging batch row (per-candidate status updates from the Job). The
    // batch loop is sequential, so a read-modify-write per candidate is safe + keeps polling live.
    private async updateStagingCandidate( accountId : string, batchId : string, candidateId : string, patch : Partial<MediaService.StagingCandidate> ) : Promise<void>
    {
        const got : Type.Result<MediaService.StagingBatch | undefined> = await this.dynamo.get<MediaService.StagingBatch>( "media_staging", { accountId, batchId } );
        if( !got.ok || !got.data ) return;
        const candidates : Array<MediaService.StagingCandidate> = got.data.candidates.map(
            ( candidate : MediaService.StagingCandidate ) : MediaService.StagingCandidate => candidate.id === candidateId ? { ...candidate, ...patch } : candidate );
        const wrote : Type.Result<void> = await this.dynamo.put( "media_staging", { ...got.data, candidates } );
        if( !wrote.ok ) this.log.warn( "staging candidate update failed", { batchId, candidateId, error: wrote.error } );
    }

    ///////////////////////////////////////////////////////////////////////////////////////
    /** Read a staging batch's live state (media-18) — each candidate with its status + a signed staging preview
     *  URL when READY. `undefined` when the batch doesn't exist / isn't this account's. */
    public async batchStatus( accountId : string, batchId : string ) : Promise<AiGen.Batch | undefined>
    {
        const got : Type.Result<MediaService.StagingBatch | undefined> = await this.dynamo.get<MediaService.StagingBatch>( "media_staging", { accountId, batchId } );
        if( !got.ok || !got.data ) return undefined;
        const batch : MediaService.StagingBatch = got.data;

        const candidates : Array<AiGen.Candidate> = [];
        for( const candidate of batch.candidates )
        {
            // resolve a signed preview URL from the staging bucket for READY candidates only
            let previewUrl : string | undefined = undefined;
            if( candidate.status === AiGen.CandidateStatus.READY && candidate.key )
            {
                const signed : Type.Result<string> = await this.s3.presignGet( "media-staging", candidate.key );
                if( signed.ok ) previewUrl = signed.data;
            }
            candidates.push( { id: candidate.id, kind: candidate.kind, mime: candidate.mime, status: candidate.status as AiGen.CandidateStatus, previewUrl, error: candidate.error } );
        }
        return { batchId: batch.batchId, provider: batch.provider, model: batch.model, prompt: batch.prompt, modality: batch.modality, candidates };
    }

    ///////////////////////////////////////////////////////////////////////////////////////
    /** Promote selected staged candidates (media-18) into the library — copy each READY candidate's bytes from
     *  staging into the media bucket as a new generated `Media.Asset` (→ scan → process), then discard the whole
     *  batch. Returns the created assets. 404 when the batch is missing. */
    public async promoteBatch( auth : RestfulEndpoint.Authentication, batchId : string, candidateIds : Array<string>, name? : string, tags? : Array<string>, campaignIds? : Array<string> ) : Promise<{ status : number; assets? : Array<{ guid : string; name : string }> }>
    {
        const accountId : string | undefined = auth.accountId;
        if( !accountId ) return { status: 400 };
        const got : Type.Result<MediaService.StagingBatch | undefined> = await this.dynamo.get<MediaService.StagingBatch>( "media_staging", { accountId, batchId } );
        if( !got.ok || !got.data ) return { status: 404 };
        const batch : MediaService.StagingBatch = got.data;

        // promote each selected + READY candidate → a new library asset seeded with the generation provenance
        const created : Array<{ guid : string; name : string }> = [];
        const chosen : Array<MediaService.StagingCandidate> = batch.candidates.filter(
            ( candidate : MediaService.StagingCandidate ) : boolean => candidateIds.includes( candidate.id ) && candidate.status === AiGen.CandidateStatus.READY && !!candidate.key );
        let index : number = 0;
        for( const candidate of chosen )
        {
            index++;
            // read the staged bytes
            const object : Type.Result<{ Body? : { transformToByteArray() : Promise<Uint8Array> } }> = await this.s3.get( "media-staging", candidate.key as string );
            if( !object.ok || !object.data.Body ) continue;
            const bytes : Uint8Array = await object.data.Body.transformToByteArray();

            // build the library asset (ORIGINAL item) with generation provenance from the batch
            const guid : string = randomUUID();
            const now : string = new Date().toISOString();
            const baseName : string = ( name && name.trim() ) ? name.trim() : batch.prompt.slice( 0, 40 );
            const assetName : string = chosen.length > 1 ? `${ baseName } (${ index })` : baseName;
            const original : Media.Item = {
                id: randomUUID(), usage: Media.Usage.ORIGINAL, kind: candidate.kind, mime: candidate.mime, extension: candidate.extension,
                size: bytes.length, version: 1, status: Media.Status.SCANNING, createdAt: now, modifiedAt: now,
            };
            const asset : Media.Asset = {
                accountId, guid, name: assetName, kind: candidate.kind,
                tier: Media.Tier.PROTECTED, accessRole: Access.AccountRole.USER, status: Media.Status.SCANNING,
                scope: Media.Scope.ACCOUNT, campaignIds: campaignIds ?? [], tags: tags ?? [],
                source: {
                    origin: Media.SourceOrigin.GENERATED, provider: batch.provider, model: batch.model,
                    prompt: batch.prompt, params: batch.params, batchId, acquiredAt: now, acquiredBy: auth.userId,
                },
                items: [ original ], createdBy: auth.userId, createdAt: now, modifiedAt: now,
            };
            // store the bytes in the media bucket, index the asset, and advance it through scan → process
            const put : Type.Result<void> = await this.s3.put( "media", MediaPipeline.itemKey( asset, original ), Buffer.from( bytes ), original.mime );
            if( !put.ok ) continue;
            const wrote : Type.Result<void> = await this.dynamo.put( "media", { ...asset } );
            if( !wrote.ok ) continue;
            void this.assetCreated( asset, auth.userId );
            const queued : Type.Result<void> = await this.sqs.send( "media-scan", { accountId, guid } );
            if( !queued.ok ) this.log.warn( "promote — media-scan send failed", { guid, error: queued.error } );
            else this.log.trace( "message enqueued (SQS media-scan)", { accountId, guid } );
            created.push( { guid, name: assetName } );
        }

        // discard the whole batch (chosen promoted; the rest are dropped) — staging bytes + row
        await this.discardBatch( accountId, batchId );
        return { status: 200, assets: created };
    }

    ///////////////////////////////////////////////////////////////////////////////////////
    /** Discard a staging batch (media-18) — delete every candidate's staged bytes + the batch row. Idempotent. */
    public async discardBatch( accountId : string, batchId : string ) : Promise<{ status : number }>
    {
        const got : Type.Result<MediaService.StagingBatch | undefined> = await this.dynamo.get<MediaService.StagingBatch>( "media_staging", { accountId, batchId } );
        if( !got.ok ) return { status: 500 };
        if( !got.data ) return { status: 404 };
        // best-effort delete of each staged object
        for( const candidate of got.data.candidates )
            if( candidate.key )
            {
                const removed : Type.Result<void> = await this.s3.remove( "media-staging", candidate.key );
                if( !removed.ok ) this.log.warn( "staging object delete failed", { batchId, candidateId: candidate.id, error: removed.error } );
            }
        const removed : Type.Result<void> = await this.dynamo.remove( "media_staging", { accountId, batchId } );
        if( !removed.ok ) return { status: 500 };
        return { status: 200 };
    }

    // The S3 object key for a download archive's zip — under the account, keyed by the archiveId (its own
    // namespace, never a library asset). Reuses the MEDIA layout via a synthetic asset shape.
    private static archiveKey( accountId : string, archiveId : string ) : ReturnType<typeof MediaPipeline.objectKey>
    {
        return MediaPipeline.objectKey( { accountId, guid: archiveId, scope: Media.Scope.ACCOUNT } as Media.Asset, "download", "zip" );
    }

    ///////////////////////////////////////////////////////////////////////////////////////
    /** ENQUEUE a download archive (media-20): create a PENDING {@link Media.Archive} record (its OWN table, so
     *  it never shows in the library) that zips the asset's original + variants, and enqueue the media-archive
     *  Job. Returns `{ status, archiveId }`; 404 when the asset is missing. */
    public async enqueueArchive( auth : RestfulEndpoint.Authentication, guid : string ) : Promise<{ status : number; archiveId? : string; reason? : string }>
    {
        const accountId : string | undefined = auth.accountId;
        if( !accountId ) return { status: 400, reason: "no acting account" };

        // wrap the whole enqueue so ANY failure (a missing table/queue env, a LocalStack resource error, a
        // marshalling throw) is captured + surfaced as a reason instead of an opaque framework 500.
        const attempt : Type.Result<{ status : number; archiveId? : string; reason? : string }> = await ResultUtils.from( async () : Promise<{ status : number; archiveId? : string; reason? : string }> =>
        {
            // 1. the source asset must exist in this account
            const got : Type.Result<Media.Asset | undefined> = await this.dynamo.get<Media.Asset>( "media", { accountId, guid } );
            if( !got.ok )   return { status: 500, reason: `media read failed: ${ String( got.error ) }` };
            if( !got.data ) return { status: 404, reason: "asset not found" };

            // 2. create the PENDING archive record (its own table)
            const archiveId : string = randomUUID();
            const archive : Media.Archive = {
                accountId, archiveId,
                name: `${ got.data.name }.zip`,
                status: Media.ArchiveStatus.PENDING, sourceGuids: [ guid ],
                requestedBy: auth.userId, createdAt: new Date().toISOString(),
            };
            const wrote : Type.Result<void> = await this.dynamo.put( "archives", { ...archive } );
            if( !wrote.ok ) { this.log.warn( "archive enqueue failed — archives table write", { guid, archiveId, error: wrote.error } ); return { status: 500, reason: `archives table write failed: ${ String( wrote.error ) }` }; }

            // 3. enqueue the media-archive Job (best-effort event first)
            void this.emitJobStage( accountId, archiveId, "archive", Events.JobStage.QUEUED, { userId: auth.userId } );
            const queued : Type.Result<void> = await this.sqs.send( "media-archive", { accountId, archiveId, userId: auth.userId } );
            if( !queued.ok ) { this.log.warn( "archive enqueue failed — media-archive queue send", { guid, archiveId, error: queued.error } ); return { status: 500, reason: `media-archive queue send failed: ${ String( queued.error ) }` }; }
            this.log.trace( "message enqueued (SQS media-archive)", { accountId, archiveId } );

            this.log.info( "archive queued", { guid, archiveId } );
            return { status: 202, archiveId };
        } );

        // a throw anywhere above (e.g. a resolver "missing resource identifier 'QUEUE_MEDIA_ARCHIVE'") lands here
        if( !attempt.ok ) { this.log.warn( "archive enqueue threw", { guid, error: attempt.error } ); return { status: 500, reason: `archive enqueue error: ${ String( attempt.error ) }` }; }
        return attempt.data;
    }

    ///////////////////////////////////////////////////////////////////////////////////////
    /** WORKER (media-archive, media-19/20): zip each source asset's original + ready variants, store the zip in
     *  S3 (under the account, TTL'd), and flip the {@link Media.Archive} record COMPLETE (or ERROR). Emits
     *  `media.job` stage events keyed by archiveId. */
    public async runArchive( accountId : string, archiveId : string, userId? : string ) : Promise<void>
    {
        void this.emitJobStage( accountId, archiveId, "archive", Events.JobStage.STARTED, { userId } );
        const got : Type.Result<Media.Archive | undefined> = await this.dynamo.get<Media.Archive>( "archives", { accountId, archiveId } );
        if( !got.ok || !got.data ) { void this.emitJobStage( accountId, archiveId, "archive", Events.JobStage.FAILED, { message: "archive record missing" } ); return; }
        const record : Media.Archive = got.data;

        const fail = async ( message : string ) : Promise<void> =>
        {
            await this.dynamo.put( "archives", { ...record, status: Media.ArchiveStatus.ERROR, error: message } );
            void this.emitJobStage( accountId, archiveId, "archive", Events.JobStage.FAILED, { message, userId } );
        };

        try
        {
            // 1. mark the record PROCESSING so the Downloads view shows it working
            await this.dynamo.put( "archives", { ...record, status: Media.ArchiveStatus.PROCESSING } );

            // 2. open a streaming zip; collect its output chunks in memory (archives are bounded) and expose a
            //    promise that resolves when the stream ends (or rejects on a zip error)
            // CJS/ESM interop under tsx/esbuild: the factory is the module itself or under `.default` — accept
            // either + cast to the factory signature (dynamic-import namespace left inferred, as with sharp/
            // ffmpeg in MediaAnalyzer — the interop namespace type is awkward to annotate).
            const archiverModule = await import( "archiver" );
            const makeArchive = ( ( archiverModule as { default? : unknown } ).default ?? archiverModule ) as ( format : string, options? : object ) => import( "archiver" ).Archiver;
            const archive : import( "archiver" ).Archiver = makeArchive( "zip", { zlib: { level: 9 } } );
            const chunks : Array<Buffer> = [];
            archive.on( "data", ( chunk : Buffer ) => chunks.push( chunk ) );
            const finished : Promise<void> = new Promise<void>( ( resolve, reject ) => { archive.on( "end", () => resolve() ); archive.on( "error", ( err : Error ) => reject( err ) ); } );

            // 3. add each source asset's files: the original + every ready variant. When the zip spans multiple
            //    assets, nest each under a per-asset folder so names don't collide. `appended` guards the case
            //    where nothing was readable (→ fail, below).
            let appended : number = 0;
            for( const sourceGuid of record.sourceGuids )
            {
                const assetGot : Type.Result<Media.Asset | undefined> = await this.dynamo.get<Media.Asset>( "media", { accountId, guid: sourceGuid } );
                if( !assetGot.ok || !assetGot.data ) continue;   // a source that vanished mid-flight — skip it
                const asset : Media.Asset = assetGot.data;

                // the members to include: every READY item in the envelope (original + derived), named by its
                // item key (usage[.profile]); when the zip spans multiple assets, nest each under a folder
                const folder : string = record.sourceGuids.length > 1 ? `${ asset.name }/` : "";
                for( const item of asset.items ?? [] )
                {
                    if( item.status !== Media.Status.OK && item.usage !== Media.Usage.ORIGINAL ) continue;   // skip not-ready derived items
                    // pull each file's bytes from S3 and append into the zip (a missing object is skipped, not fatal)
                    const object : Type.Result<{ Body? : { transformToByteArray() : Promise<Uint8Array> } }> = await this.s3.get( "media", MediaPipeline.itemKey( asset, item ) );
                    if( !object.ok || !object.data.Body ) continue;
                    const bytes : Uint8Array = await object.data.Body.transformToByteArray();
                    archive.append( Buffer.from( bytes ), { name: `${ folder }${ Media.itemKey( item.usage, item.profile ) }.${ item.extension }` } );
                    appended++;
                }
            }

            // 4. finalize the zip and wait for the stream to drain into `chunks`
            await archive.finalize();
            await finished;
            if( appended === 0 ) { await fail( "no bytes to archive" ); return; }   // nothing readable → error
            const zip : Buffer = Buffer.concat( chunks );

            // 5. store the zip under the account (its own archive key), separate from library assets
            const put : Type.Result<void> = await this.s3.put( "media", MediaService.archiveKey( accountId, archiveId ), zip, FileUtils.Mime.ZIP );
            if( !put.ok ) { await fail( "store failed" ); return; }

            // 6. flip the record COMPLETE + stamp the TTL (DDB `ttl` epoch + a human `expiresAt`) so the zip is
            //    swept after the configured window, then emit the terminal stage event for the UI
            const ttlDays : number = ( await this.mediaConfig() ).downloads.ttlDays;
            const expiresMs : number = Date.now() + ttlDays * 24 * 60 * 60 * 1000;
            const complete : Media.Archive = {
                ...record, status: Media.ArchiveStatus.COMPLETE, size: zip.length,
                expiresAt: new Date( expiresMs ).toISOString(), ttl: Math.floor( expiresMs / 1000 ),
            };
            await this.dynamo.put( "archives", { ...complete } );
            void this.emitJobStage( accountId, archiveId, "archive", Events.JobStage.COMPLETED, { userId } );
        }
        catch( error ) { await fail( `archive failed: ${ String( error ) }` ); }   // any throw → ERROR + failed stage
    }

    ///////////////////////////////////////////////////////////////////////////////////////
    /** List an account's download archives (the "Downloads" view), newest first. */
    public async listArchives( accountId : string ) : Promise<Array<Media.Archive>>
    {
        const found : Type.Result<Array<Media.Archive>> = await this.dynamo.query<Media.Archive>( "archives", {
            KeyConditionExpression:    "accountId = :a",
            ExpressionAttributeValues: { ":a": accountId },
        } );
        if( !found.ok ) return [];
        return found.data.sort( ( first, second ) => second.createdAt.localeCompare( first.createdAt ) );
    }

    ///////////////////////////////////////////////////////////////////////////////////////
    /** A presigned URL to download a COMPLETE archive's zip, or null (not ready / missing). */
    public async archiveUrl( accountId : string, archiveId : string ) : Promise<string | null>
    {
        const got : Type.Result<Media.Archive | undefined> = await this.dynamo.get<Media.Archive>( "archives", { accountId, archiveId } );
        if( !got.ok || !got.data || got.data.status !== Media.ArchiveStatus.COMPLETE ) return null;
        const ttlSec : number = ( await this.mediaConfig() ).delivery.signedUrlTtlSec;
        const signed : Type.Result<string> = await this.s3.presignGet( "media", MediaService.archiveKey( accountId, archiveId ), ttlSec );
        return signed.ok ? signed.data : null;
    }

    ///////////////////////////////////////////////////////////////////////////////////////
    /** Delete a download archive — its zip bytes (S3) + the record. */
    public async deleteArchive( accountId : string, archiveId : string ) : Promise<boolean>
    {
        await this.s3.remove( "media", MediaService.archiveKey( accountId, archiveId ) );
        const removed : Type.Result<void> = await this.dynamo.remove( "archives", { accountId, archiveId } );
        return removed.ok;
    }

    ///////////////////////////////////////////////////////////////////////////////////////
    /** Clone a voice (media-21) from an account AUDIO asset's bytes via the SPEECH_CLONING provider's
     *  voice-clone capability, and store it as an ACCOUNT-scoped {@link Media.Voice} (never cross-account).
     *  Returns `{ status, voice? }`; 404 missing asset, 409 not-audio, 501 no clone-capable provider, 502 fail. */
    public async cloneVoice( auth : RestfulEndpoint.Authentication, sourceGuid : string, name : string ) : Promise<{ status : number; voice? : Media.Voice }>
    {
        const accountId : string | undefined = auth.accountId;
        if( !accountId ) return { status: 400 };

        // the reference audio must be an account AUDIO envelope
        const got : Type.Result<Media.Asset | undefined> = await this.dynamo.get<Media.Asset>( "media", { accountId, guid: sourceGuid } );
        if( !got.ok || !got.data ) return { status: 404 };
        const original : Media.Item | undefined = Media.originalItem( got.data );
        if( !original || original.kind !== Media.Kind.AUDIO ) return { status: 409 };
        const asset : Media.Asset = got.data;

        // resolve the clone-capable provider (SPEECH_CLONING route) and read the reference bytes
        const client : Ai | undefined = await this.aiFor( AiRouting.Modality.SPEECH_CLONING );
        if( client === undefined || !client.capabilities.has( Ai.Capability.VOICE_CLONE ) ) return { status: 501 };
        const object : Type.Result<{ Body? : { transformToByteArray() : Promise<Uint8Array> } }> = await this.s3.get( "media", MediaPipeline.itemKey( asset, original ) );
        if( !object.ok || !object.data.Body ) return { status: 502 };
        const bytes : Uint8Array = await object.data.Body.transformToByteArray();

        // clone via the provider → persist the returned voice id, account-scoped
        const reply : Ai.CloneVoiceResponse = await client.cloneVoice( { name, samples: [ { audio: bytes, mime: original.mime } ] } );
        if( !reply.ok ) return { status: 502 };
        const voice : Media.Voice = {
            accountId, voiceId: reply.voiceId, name, provider: reply.provider, sourceGuid,
            createdBy: auth.userId, createdAt: new Date().toISOString(),
        };
        const wrote : Type.Result<void> = await this.dynamo.put( "voices", { ...voice } );
        if( !wrote.ok ) return { status: 500 };
        return { status: 201, voice };
    }

    ///////////////////////////////////////////////////////////////////////////////////////
    /** List an account's cloned voices (for the AI Gen voice picker), newest first. */
    public async listVoices( accountId : string ) : Promise<Array<Media.Voice>>
    {
        const found : Type.Result<Array<Media.Voice>> = await this.dynamo.query<Media.Voice>( "voices", {
            KeyConditionExpression:    "accountId = :a",
            ExpressionAttributeValues: { ":a": accountId },
        } );
        if( !found.ok ) return [];
        return found.data.sort( ( first, second ) => second.createdAt.localeCompare( first.createdAt ) );
    }

    ///////////////////////////////////////////////////////////////////////////////////////
    /** Remove a cloned voice from the account (the record; the provider voice is left in place). */
    public async deleteVoice( accountId : string, voiceId : string ) : Promise<boolean>
    {
        const removed : Type.Result<void> = await this.dynamo.remove( "voices", { accountId, voiceId } );
        return removed.ok;
    }

    ///////////////////////////////////////////////////////////////////////////////////////
    /** ENQUEUE a video compression (media-10.10): validate the asset is a video + the target exists, then
     *  enqueue the `media-video` Job. `{ status }`; 404 missing, 409 not-video, 400 unknown target. */
    public async enqueueCompress( auth : RestfulEndpoint.Authentication, guid : string, target : string ) : Promise<{ status : number }>
    {
        const accountId : string | undefined = auth.accountId;
        if( !accountId ) return { status: 400 };
        const got : Type.Result<Media.Asset | undefined> = await this.dynamo.get<Media.Asset>( "media", { accountId, guid } );
        if( !got.ok || !got.data ) return { status: 404 };
        if( got.data.kind !== Media.Kind.VIDEO ) return { status: 409 };
        const config : MediaConfig.Config = await this.mediaConfig();
        if( !config.videoTargets[ target ] ) return { status: 400 };

        void this.emitJobStage( accountId, guid, "compress", Events.JobStage.QUEUED, { message: target, userId: auth.userId } );
        const queued : Type.Result<void> = await this.sqs.send( "media-video", { accountId, guid, target, userId: auth.userId } );
        if( queued.ok ) this.log.trace( "message enqueued (SQS media-video)", { accountId, guid, target } );
        return { status: 202 };
    }

    ///////////////////////////////////////////////////////////////////////////////////////
    /** WORKER (media-video, media-10.10): compress a video to the named target's goal (CRF ladder) and store
     *  the result as a `compressed.<target>` variant. Emits `media.job` stage events. */
    public async runCompress( accountId : string, guid : string, target : string, userId? : string ) : Promise<void>
    {
        void this.emitJobStage( accountId, guid, "compress", Events.JobStage.STARTED, { message: target, userId } );
        const fail = ( message : string ) : void => void this.emitJobStage( accountId, guid, "compress", Events.JobStage.FAILED, { message, userId } );

        const got : Type.Result<Media.Asset | undefined> = await this.dynamo.get<Media.Asset>( "media", { accountId, guid } );
        if( !got.ok || !got.data || got.data.kind !== Media.Kind.VIDEO ) { fail( "not a video" ); return; }
        const asset : Media.Asset = got.data;
        const original : Media.Item | undefined = Media.originalItem( asset );
        if( !original ) { fail( "no original item" ); return; }
        const spec : MediaConfig.VideoTarget | undefined = ( await this.mediaConfig() ).videoTargets[ target ];
        if( !spec ) { fail( "unknown target" ); return; }

        const object : Type.Result<{ Body? : { transformToByteArray() : Promise<Uint8Array> } }> = await this.s3.get( "media", MediaPipeline.itemKey( asset, original ) );
        if( !object.ok || !object.data.Body ) { fail( "original unavailable" ); return; }
        const bytes : Uint8Array = await object.data.Body.transformToByteArray();

        void this.emitJobStage( accountId, guid, "compress", Events.JobStage.RUNNING, { progress: 50, message: `encoding ${ target }`, userId } );
        const result : { bytes : Uint8Array; format : string; size : number; underCap : boolean } | null = await MediaAnalyzer.compressVideo( bytes, original.extension, spec );
        if( !result ) { fail( "compression failed" ); return; }

        // probe the COMPRESSED output so the item carries its OWN dimensions/duration (not the original's)
        const compressedMeta : Media.VideoMeta | null = await MediaAnalyzer.analyzeVideo( result.bytes, "mp4" );

        // store as a COMPRESSED item keyed by the target profile (media-10.10)
        const now : string = new Date().toISOString();
        const item : Media.Item = {
            id: randomUUID(), usage: Media.Usage.COMPRESSED, profile: target, kind: Media.Kind.VIDEO,
            mime: FileUtils.Mime.VIDEO_MP4, extension: "mp4", size: result.size, version: 1, status: Media.Status.OK,
            createdAt: now, modifiedAt: now, derivation: { job: "compress", params: { target }, sourceItemId: original.id },
            ...( compressedMeta ? { meta: { video: compressedMeta } } : {} ),
        };
        const put : Type.Result<void> = await this.s3.put( "media", MediaPipeline.itemKey( asset, item ), Buffer.from( result.bytes ), FileUtils.Mime.VIDEO_MP4 );
        item.status = put.ok ? Media.Status.OK : Media.Status.FAILED;
        const updated : Media.Asset = { ...asset, items: Media.upsertItems( asset.items, item ), modifiedAt: now };
        await this.dynamo.put( "media", { ...updated } );
        void this.assetUpdated( updated, userId );
        // completed even when the size goal wasn't met — the smallest achieved is stored; note it in the stage
        void this.emitJobStage( accountId, guid, "compress", Events.JobStage.COMPLETED,
            { message: result.underCap ? target : `${ target } (size goal not met — stored smallest)`, userId } );
    }

    ///////////////////////////////////////////////////////////////////////////////////////
    /** The facades + live config the shared MediaPipeline needs (so dev consumers + Jobs run the SAME
     *  processing against the SAME variant profiles / scan switch). Async so it can resolve live config. */
    protected async pipelineDeps() : Promise<MediaPipeline.Deps>
    {
        const config : MediaConfig.Config = await this.mediaConfig();
        // Resolve the CHAT-modality client (auto-tag vision) from config/ai routing — only when auto-tag is on.
        const chatAi : Ai | undefined = config.autoTag.enabled ? await this.aiFor( AiRouting.Modality.CHAT ) : undefined;
        // the malware-scan engine for the ingest gate — the config-selected shared adapter (Noop when off).
        // MediaConfig.Scan is structurally the shared Scanner.Config (enabled/provider/failClosed/clamd).
        const scanner : Scanner = ScanFactory.forConfig( config.scan );
        return { dynamo: this.dynamo, s3: this.s3, sqs: this.sqs, log: this.log, config, chatAi, scanner };
    }

    ///////////////////////////////////////////////////////////////////////////////////////
    /** Seed the runtime config on a fresh environment so the service (and the Console Config tab) have
     *  usable defaults from first boot. */
    protected override async init() : Promise<void>
    {
        super.init();
        const seeded : Type.Result<MediaConfig.Config> = await this.appConfig.ensureSeeded( "config", "settings", MediaConfig.DEFAULT );
        if( seeded.ok ) this.log.info( "media config ready" );
        else this.log.warn( "media config seed failed — using DEFAULT until deployed", { error: seeded.error } );
    }

    ///////////////////////////////////////////////////////////////////////////////////////
    // ── Studio projects (media-21) — the project tree in DynamoDB; the canvas snapshot in S3 ──────────────

    /** List an account's (non-deleted) Studio projects, newest-modified first. */
    public async listStudioProjects( accountId : string ) : Promise<Array<StudioProject.Entity>>
    {
        const found : Type.Result<Array<StudioProject.Entity>> = await this.dynamo.query<StudioProject.Entity>( "studio_projects", {
            KeyConditionExpression:    "accountId = :a",
            ExpressionAttributeValues: { ":a": accountId },
        } );
        if( !found.ok ) return [];
        return found.data
            .filter( ( project : StudioProject.Entity ) : boolean => !project.deleted )
            .sort( ( first : StudioProject.Entity, second : StudioProject.Entity ) : number => second.modifiedAt.localeCompare( first.modifiedAt ) );
    }

    /** Read a single Studio project (undefined when missing). */
    public async getStudioProject( accountId : string, id : string ) : Promise<StudioProject.Entity | undefined>
    {
        const got : Type.Result<StudioProject.Entity | undefined> = await this.dynamo.get<StudioProject.Entity>( "studio_projects", { accountId, id } );
        return got.ok ? got.data : undefined;
    }

    /** Create/replace a Studio project record. */
    public putStudioProject( project : StudioProject.Entity ) : Promise<Type.Result<void>>
    {
        return this.dynamo.put( "studio_projects", { ...project } );
    }

    /** SOFT-delete a Studio project: mark it `deleted` and stamp `deletedAt` rather than removing the row or
     *  its canvas — so a mistaken delete stays recoverable until a later hard-purge. */
    public async removeStudioProject( accountId : string, id : string ) : Promise<Type.Result<void>>
    {
        const existing : StudioProject.Entity | undefined = await this.getStudioProject( accountId, id );
        if( !existing ) return ResultUtils.err( "not found" );
        const now : string = new Date().toISOString();
        return this.dynamo.put( "studio_projects", { ...existing, deleted: true, deletedAt: now, modifiedAt: now } );
    }

    ///////////////////////////////////////////////////////////////////////////////////////
    // the S3 object key for a project's canvas snapshot (in the media bucket, isolated under studio/)
    private studioCanvasKey( accountId : string, id : string ) : string
    {
        return `studio/${ accountId }/${ id }/canvas.json`;
    }

    /** Read a project's canvas snapshot JSON from S3 (null when none saved / unreadable). */
    public async getStudioCanvas( accountId : string, id : string ) : Promise<string | null>
    {
        const object : Type.Result<{ Body? : { transformToByteArray() : Promise<Uint8Array> } }> = await this.s3.get( "media", this.studioCanvasKey( accountId, id ) );
        if( !object.ok || !object.data.Body ) return null;
        const bytes : Uint8Array = await object.data.Body.transformToByteArray();
        return new TextDecoder().decode( bytes );
    }

    /** Write a project's canvas snapshot JSON to S3. */
    public putStudioCanvas( accountId : string, id : string, canvas : string ) : Promise<Type.Result<void>>
    {
        return this.s3.put( "media", this.studioCanvasKey( accountId, id ), Buffer.from( canvas, "utf8" ), FileUtils.Mime.JSON );
    }

    ///////////////////////////////////////////////////////////////////////////////////////
    // ── Studio video render (media-21) — composite the timeline to an mp4 library asset via ffmpeg ─────────

    /** Enqueue a video project render (heavy → a Job; MAIN drains locally). */
    public async enqueueStudioRender( accountId : string, projectId : string, userId? : string ) : Promise<Type.Result<void>>
    {
        // config picks the render engine → its queue (each has a dedicated consumer): ffmpeg (in-process,
        // fast) or remotion (headless Chromium, exact preview==output). Switchable without a redeploy.
        const config : MediaConfig.Config = await this.mediaConfig();
        const queue : string = config.render.engine === MediaConfig.RenderEngine.REMOTION ? "studio-render-remotion" : "studio-render";
        const queued : Type.Result<void> = await this.sqs.send( queue, { accountId, projectId, userId } );
        if( queued.ok ) this.log.trace( `message enqueued (SQS ${ queue })`, { accountId, projectId } );
        return queued;
    }

    /** Refresh every clip's (and the watermark's) `src` to a FRESH, long-lived signed GET url, keyed off its
     *  durable `assetGuid` — for the Remotion/Chromium render, which fetches media straight from `src` inside
     *  the rendered page rather than spooling S3 bytes itself (unlike the ffmpeg path), so a stale/expired
     *  preview URL would otherwise fail silently mid-render. TTL matches the `studio-render-remotion` queue's
     *  visibility timeout so a slow render never outlives its own URLs. Resolves each distinct `assetGuid` once. */
    private async resolveClipSources( accountId : string, doc : StudioProject.VideoDoc ) : Promise<StudioProject.VideoDoc>
    {
        const ttlSec : number = 1800;
        const resolved : Map<string, string | null> = new Map<string, string | null>();

        // resolve ONE asset's fresh signed url (cached — several clips may share the same assetGuid)
        const resolveOne = async ( assetGuid : string ) : Promise<string | null> =>
        {
            const cached : string | null | undefined = resolved.get( assetGuid );
            if( cached !== undefined ) return cached;
            const got : Type.Result<Media.Asset | undefined> = await this.dynamo.get<Media.Asset>( "media", { accountId, guid: assetGuid } );
            const original : Media.Item | undefined = got.ok && got.data ? Media.originalItem( got.data ) : undefined;
            if( !got.ok || !got.data || original === undefined ) { resolved.set( assetGuid, null ); return null; }
            const signed : Type.Result<string> = await this.s3.presignGet( "media", MediaPipeline.itemKey( got.data, original ), ttlSec );
            const url : string | null = signed.ok ? signed.data : null;
            resolved.set( assetGuid, url );
            return url;
        };

        // refresh every media clip's src, then the watermark's — leaving clips without an assetGuid untouched
        const clips : Array<StudioProject.TimelineClip> = await Promise.all( ( doc.clips ?? [] ).map( async ( clip : StudioProject.TimelineClip ) : Promise<StudioProject.TimelineClip> =>
        {
            if( !clip.assetGuid ) return clip;
            const src : string | null = await resolveOne( clip.assetGuid );
            return src !== null ? { ...clip, src } : clip;
        } ) );
        let watermark : StudioProject.Watermark | undefined = doc.watermark;
        if( watermark !== undefined )
        {
            const src : string | null = await resolveOne( watermark.assetGuid );
            if( src !== null ) watermark = { ...watermark, src };
        }
        return { ...doc, clips, watermark };
    }

    /** Render a video project's timeline → mp4 and save it to the library (create, or update the linked asset
     *  in place). Resolves each scene's DURABLE source bytes from S3, composites with ffmpeg, uploads, links
     *  the asset to the project, and emits `media.job` progress. */
    public async runStudioRender( accountId : string, projectId : string, userId? : string, engine : MediaConfig.RenderEngine = MediaConfig.RenderEngine.FFMPEG ) : Promise<void>
    {
        const fail = ( message : string ) : void => { void this.emitJobStage( accountId, projectId, "studio-render", Events.JobStage.FAILED, { message, userId } ); this.log.warn( "studio render failed", { projectId, message } ); };

        const project : StudioProject.Entity | undefined = await this.getStudioProject( accountId, projectId );
        if( project === undefined ) { fail( "project not found" ); return; }
        const canvas : string | null = await this.getStudioCanvas( accountId, projectId );
        if( canvas === null ) { fail( "no timeline saved" ); return; }
        let doc : StudioProject.VideoDoc;
        try { doc = JSON.parse( canvas ) as StudioProject.VideoDoc; }
        catch { fail( "unreadable timeline" ); return; }
        // normalize to the track/clip timeline model (migrates legacy scene docs)
        const timeline : StudioProject.VideoDoc = StudioProject.migrateToTimeline( doc );
        const tracks : Array<StudioProject.TimelineTrack> = timeline.tracks ?? [];
        const clips : Array<StudioProject.TimelineClip> = timeline.clips ?? [];
        if( clips.length === 0 ) { fail( "empty timeline" ); return; }

        void this.emitJobStage( accountId, projectId, "studio-render", Events.JobStage.RUNNING, { progress: 20, message: engine === MediaConfig.RenderEngine.REMOTION ? "preparing render" : "gathering clips", userId } );

        // the output formats: the master, then each chosen DESTINATION (deduped) — one variant per format
        const masterKey : string = StudioProject.videoFormatFor( timeline )?.key ?? "master";
        const formats : Array<{ key : string; width : number; height : number }> = [ { key: masterKey, width: timeline.width, height: timeline.height } ];
        for( const targetKey of timeline.targets ?? [] )
        {
            const format : StudioProject.VideoFormat | undefined = StudioProject.VIDEO_FORMATS.find( ( entry : StudioProject.VideoFormat ) : boolean => entry.key === targetKey );
            if( format === undefined || formats.some( ( existing : { key : string } ) : boolean => existing.key === format.key ) ) continue;
            formats.push( { key: format.key, width: format.width, height: format.height } );
        }
        const durationSec : number = StudioProject.timelineDurationSec( timeline );
        // export encode: quality preset (crf + x264 preset) from the doc, plus an optional explicit bitrate
        const qualitySpec : { crf : number; preset : string } = StudioProject.VIDEO_QUALITY[ timeline.quality ?? StudioProject.VideoQuality.STANDARD ];
        const encodeQuality : { crf : number; preset : string; bitrateKbps? : number } = { ...qualitySpec, bitrateKbps: timeline.bitrateKbps };

        // REMOTION engine → render the SAME composition via headless Chromium (exact preview==output). Renders
        // straight from the doc/inputProps, so it SKIPS the ffmpeg layer gathering (no spooling S3 bytes).
        if( engine === MediaConfig.RenderEngine.REMOTION )
        {
            // the Chromium render fetches each clip's `src` itself (no S3 spooling) — those URLs are the
            // TIME-LIMITED ones the editor last saved, so refresh them to fresh, render-length-safe signed
            // URLs first (a stale/expired URL would otherwise fail silently inside the Chromium page)
            const resolvedTimeline : StudioProject.VideoDoc = await this.resolveClipSources( accountId, timeline );
            const remotionRenders : Array<{ profile : string; bytes : Uint8Array }> = [];
            for( let index : number = 0; index < formats.length; index++ )
            {
                const format : { key : string; width : number; height : number } = formats[ index ];
                void this.emitJobStage( accountId, projectId, "studio-render", Events.JobStage.RUNNING, { progress: 40 + Math.round( ( index / formats.length ) * 50 ), message: `rendering ${ format.key } (remotion)`, userId } );
                const out : Uint8Array | null = await MediaAnalyzer.renderCompositeRemotion( resolvedTimeline, format.width, format.height, timeline.fps, durationSec );
                if( out !== null ) remotionRenders.push( { profile: format.key, bytes: out } );
            }
            if( remotionRenders.length === 0 ) { fail( "remotion render produced no output (Chromium worker + shared composition required)" ); return; }
            const remotionGuid : string = await this.saveRenderedVideo( accountId, project, remotionRenders, userId, timeline.posterSec, timeline.gif );
            void this.emitJobStage( accountId, projectId, "studio-render", Events.JobStage.COMPLETED, { progress: 100, message: "saved to library", userId } );
            this.log.info( "studio render complete (remotion)", { projectId, guid: remotionGuid, formats: remotionRenders.length } );
            return;
        }

        // build the compositing layers in PAINT order (bottom track first, clips left→right); media clips
        // resolve their ORIGINAL bytes from S3 (cached per asset), text clips become time-windowed overlays
        const bytesCache : Map<string, { bytes : Uint8Array; ext? : string; hasAudio : boolean }> = new Map<string, { bytes : Uint8Array; ext? : string; hasAudio : boolean }>();
        const media : Array<MediaAnalyzer.CompositeMediaLayer> = [];
        const texts : Array<MediaAnalyzer.CompositeTextLayer> = [];
        for( let trackIndex : number = tracks.length - 1; trackIndex >= 0; trackIndex-- )
        {
            const track : StudioProject.TimelineTrack = tracks[ trackIndex ];
            if( track.hidden ) continue;   // hidden tracks are excluded from the render
            const trackClips : Array<StudioProject.TimelineClip> = clips
                .filter( ( clip : StudioProject.TimelineClip ) : boolean => clip.trackId === track.id )
                .sort( ( left : StudioProject.TimelineClip, right : StudioProject.TimelineClip ) : number => left.startSec - right.startSec );
            for( const clip of trackClips )
            {
                // an entry transition renders as a dissolve/crossfade: pull the clip's start EARLIER by its
                // duration so it overlaps the previous clip, then alpha-fade it IN over that same window
                // (the overlay graph has no moving mask, so wipe/slide export as a dissolve — the animated
                // reveal is preview-only fidelity)
                const transitionSec : number = clip.transitionIn ? Math.max( 0, clip.transitionIn.durationSec ) : 0;
                const adjStartSec : number = Math.max( 0, clip.startSec - transitionSec );
                const adjDurationSec : number = clip.durationSec + transitionSec;
                const adjFadeInSec : number | undefined = transitionSec > 0 ? transitionSec : clip.fadeInSec;

                // text → a burned overlay (relative geometry, defaulted from the shared model)
                if( clip.kind === StudioProject.VideoSceneKind.TEXT )
                {
                    // SLIDE_*/POP entry animations drive real drawtext x/y/fontsize expressions (see
                    // MediaAnalyzer.textAnimationGeometry) — POP still gets an alpha ramp too ("pop... with a
                    // fade"). FADE/TYPEWRITER have no drawtext geometry equivalent (typewriter would need
                    // per-frame text generation), so they fall back to a plain alpha fade-in over the animation's
                    // duration, same as before.
                    const animatesGeometry : boolean = clip.animateIn !== undefined && clip.animateIn.type !== StudioProject.TextAnimation.FADE && clip.animateIn.type !== StudioProject.TextAnimation.TYPEWRITER && clip.animateIn.type !== StudioProject.TextAnimation.POP;
                    const animInSec : number = clip.animateIn !== undefined && !animatesGeometry ? Math.max( 0, clip.animateIn.durationSec ) : 0;
                    const textFadeInSec : number | undefined = animInSec > 0 ? Math.max( adjFadeInSec ?? 0, animInSec ) : adjFadeInSec;
                    texts.push( { text: clip.text ?? "", startSec: adjStartSec, durationSec: adjDurationSec, xPct: clip.xPct ?? StudioProject.DEFAULT_TEXT_GEOMETRY.xPct, yPct: clip.yPct ?? 0.5, fontPct: clip.fontPct ?? StudioProject.DEFAULT_TEXT_GEOMETRY.fontPct, align: clip.align ?? StudioProject.DEFAULT_TEXT_GEOMETRY.align, fadeInSec: textFadeInSec, fadeOutSec: clip.fadeOutSec, style: clip.style, animateIn: clip.animateIn } );
                    continue;
                }
                // solid color card → a generated layer (no asset bytes); a lavfi color source at render time
                if( clip.kind === StudioProject.VideoSceneKind.SOLID )
                {
                    media.push( { kind: "solid", bytes: new Uint8Array(), color: clip.color, startSec: adjStartSec, durationSec: adjDurationSec, fadeInSec: adjFadeInSec, fadeOutSec: clip.fadeOutSec, transform: clip.transform, filters: clip.filters, blend: clip.blend } );
                    continue;
                }
                // SVG shape/graphic → recolor + rasterize to a transparent PNG (sharp), composited as an image.
                // Force the transform path (contain fit) so its alpha is honored and the shape isn't cropped.
                if( clip.kind === StudioProject.VideoSceneKind.SHAPE )
                {
                    const svg : string = StudioProject.buildShapeSvg( clip.shape, clip.shapeStyle );
                    const png : Uint8Array | null = await MediaAnalyzer.rasterizeSvg( svg, 1024 );
                    if( png !== null )
                        media.push( { kind: "image", bytes: png, ext: "png", startSec: adjStartSec, durationSec: adjDurationSec, fadeInSec: adjFadeInSec, fadeOutSec: clip.fadeOutSec, transform: clip.transform ?? { fit: StudioProject.FitMode.CONTAIN }, kenBurns: clip.kenBurns, filters: clip.filters, blend: clip.blend } );
                    continue;
                }
                // image/video composite visually; audio contributes to the mixed soundtrack — all resolve bytes
                if( clip.kind !== StudioProject.VideoSceneKind.IMAGE && clip.kind !== StudioProject.VideoSceneKind.VIDEO && clip.kind !== StudioProject.VideoSceneKind.AUDIO ) continue;
                if( !clip.assetGuid ) continue;

                // resolve the asset's original bytes once, then reuse for any repeat placements
                let resolved : { bytes : Uint8Array; ext? : string; hasAudio : boolean } | undefined = bytesCache.get( clip.assetGuid );
                if( resolved === undefined )
                {
                    const got : Type.Result<Media.Asset | undefined> = await this.dynamo.get<Media.Asset>( "media", { accountId, guid: clip.assetGuid } );
                    if( !got.ok || !got.data ) continue;
                    const original : Media.Item | undefined = Media.originalItem( got.data );
                    if( original === undefined ) continue;
                    const object : Type.Result<{ Body? : { transformToByteArray() : Promise<Uint8Array> } }> = await this.s3.get( "media", MediaPipeline.itemKey( got.data, original ) );
                    if( !object.ok || !object.data.Body ) continue;
                    const bytes : Uint8Array = await object.data.Body.transformToByteArray();
                    // an audio clip always has audio; a video only if its probe found an audio codec (avoids a missing [i:a])
                    const hasAudio : boolean = clip.kind === StudioProject.VideoSceneKind.AUDIO || Boolean( original.meta?.video?.audioCodec );
                    resolved = { bytes, ext: original.extension, hasAudio };
                    bytesCache.set( clip.assetGuid, resolved );
                }
                const kind : "image" | "video" | "audio" = clip.kind === StudioProject.VideoSceneKind.VIDEO ? "video" : clip.kind === StudioProject.VideoSceneKind.AUDIO ? "audio" : "image";
                media.push( { kind, bytes: resolved.bytes, ext: resolved.ext, startSec: adjStartSec, durationSec: adjDurationSec, trimStartSec: clip.trimStartSec, hasAudio: resolved.hasAudio, muted: track.muted === true, volume: clip.volume, loop: clip.loop, speed: clip.speed, reverse: clip.reverse, fadeInSec: adjFadeInSec, fadeOutSec: clip.fadeOutSec, transform: clip.transform, kenBurns: clip.kenBurns, filters: clip.filters, blend: clip.blend } );
            }
        }
        if( media.length === 0 && texts.length === 0 ) { fail( "no renderable clips" ); return; }

        // resolve the logo/watermark bytes ONCE (shared across every output format), if one is set on the doc
        let watermarkLayer : MediaAnalyzer.CompositeWatermark | undefined = undefined;
        if( timeline.watermark !== undefined )
        {
            const watermarkAsset : Type.Result<Media.Asset | undefined> = await this.dynamo.get<Media.Asset>( "media", { accountId, guid: timeline.watermark.assetGuid } );
            const watermarkOriginal : Media.Item | undefined = watermarkAsset.ok && watermarkAsset.data ? Media.originalItem( watermarkAsset.data ) : undefined;
            if( watermarkAsset.ok && watermarkAsset.data && watermarkOriginal !== undefined )
            {
                const watermarkObject : Type.Result<{ Body? : { transformToByteArray() : Promise<Uint8Array> } }> = await this.s3.get( "media", MediaPipeline.itemKey( watermarkAsset.data, watermarkOriginal ) );
                if( watermarkObject.ok && watermarkObject.data.Body )
                {
                    const watermarkBytes : Uint8Array = await watermarkObject.data.Body.transformToByteArray();
                    watermarkLayer = { bytes: watermarkBytes, ext: watermarkOriginal.extension, corner: timeline.watermark.corner, scalePct: timeline.watermark.scalePct, opacity: timeline.watermark.opacity, marginPct: timeline.watermark.marginPct };
                }
            }
        }

        // composite each format via the multi-track overlay graph; the master is the ORIGINAL, others variants
        const renders : Array<{ profile : string; bytes : Uint8Array }> = [];
        for( let index : number = 0; index < formats.length; index++ )
        {
            const format : { key : string; width : number; height : number } = formats[ index ];
            void this.emitJobStage( accountId, projectId, "studio-render", Events.JobStage.RUNNING, { progress: 50 + Math.round( ( index / formats.length ) * 40 ), message: `rendering ${ format.key }`, userId } );
            const out : Uint8Array | null = await MediaAnalyzer.renderComposite( format.width, format.height, timeline.fps, durationSec, media, texts, watermarkLayer, encodeQuality );
            if( out !== null ) renders.push( { profile: format.key, bytes: out } );
        }
        if( renders.length === 0 ) { fail( "render produced no output" ); return; }

        const guid : string = await this.saveRenderedVideo( accountId, project, renders, userId, timeline.posterSec, timeline.gif );
        void this.emitJobStage( accountId, projectId, "studio-render", Events.JobStage.COMPLETED, { progress: 100, message: "saved to library", userId } );
        this.log.info( "studio render complete", { projectId, guid, clips: clips.length, formats: renders.length } );
    }

    ///////////////////////////////////////////////////////////////////////////////////////
    // save the rendered mp4s as the project's ONE library asset: the master format as the ORIGINAL item + each
    // destination as a COMPRESSED variant item (profile = format key). Create, or replace the linked asset in
    // place. These are FINISHED renders → status OK, no scan/process pipeline. Returns the asset guid.
    private async saveRenderedVideo( accountId : string, project : StudioProject.Entity, renders : Array<{ profile : string; bytes : Uint8Array }>, userId? : string, posterSec? : number, gif? : boolean ) : Promise<string>
    {
        const now : string = new Date().toISOString();
        const name : string = project.name.trim() === "" ? "Studio video" : project.name.trim();
        const master : { profile : string; bytes : Uint8Array } = renders[ 0 ];
        const variants : Array<{ profile : string; bytes : Uint8Array }> = renders.slice( 1 );

        // optional export extras from the master render: a POSTER frame (jpg) and/or an animated GIF
        const posterBytes : Uint8Array | null = posterSec !== undefined ? await MediaAnalyzer.extractPosterFrame( master.bytes, posterSec ) : null;
        const gifBytes : Uint8Array | null = gif === true ? await MediaAnalyzer.toGif( master.bytes ) : null;

        // reuse the linked asset (replace in place) when it still exists, else mint a new one
        const existing : Type.Result<Media.Asset | undefined> | undefined = project.libraryAssetId ? await this.dynamo.get<Media.Asset>( "media", { accountId, guid: project.libraryAssetId } ) : undefined;
        const prior : Media.Asset | undefined = existing && existing.ok ? existing.data : undefined;
        const priorOriginal : Media.Item | undefined = prior ? Media.originalItem( prior ) : undefined;
        const guid : string = prior?.guid ?? randomUUID();
        const originalId : string = priorOriginal?.id ?? randomUUID();

        // the ORIGINAL (master format) + a COMPRESSED item per destination variant (stable id/key per profile)
        const original : Media.Item = { id: originalId, usage: Media.Usage.ORIGINAL, kind: Media.Kind.VIDEO, mime: "video/mp4", extension: "mp4", size: master.bytes.length, version: ( priorOriginal?.version ?? 0 ) + 1, status: Media.Status.OK, createdAt: prior?.createdAt ?? now, modifiedAt: now };
        const variantItems : Array<Media.Item> = variants.map( ( variant : { profile : string; bytes : Uint8Array } ) : Media.Item =>
            ( { id: `v-${ variant.profile }`, usage: Media.Usage.COMPRESSED, profile: variant.profile, kind: Media.Kind.VIDEO, mime: "video/mp4", extension: "mp4", size: variant.bytes.length, version: 1, status: Media.Status.OK, createdAt: now, modifiedAt: now } ) );
        // export extras: a POSTER (jpg) item and/or a GIF (animated) item, when produced above
        const posterItem : Media.Item | null = posterBytes !== null
            ? { id: "poster", usage: Media.Usage.POSTER, kind: Media.Kind.IMAGE, mime: "image/jpeg", extension: "jpg", size: posterBytes.length, version: 1, status: Media.Status.OK, createdAt: now, modifiedAt: now }
            : null;
        const gifItem : Media.Item | null = gifBytes !== null
            ? { id: "v-gif", usage: Media.Usage.COMPRESSED, profile: "gif", kind: Media.Kind.IMAGE, mime: "image/gif", extension: "gif", size: gifBytes.length, version: 1, status: Media.Status.OK, createdAt: now, modifiedAt: now }
            : null;
        const extraItems : Array<Media.Item> = [ ...( posterItem ? [ posterItem ] : [] ), ...( gifItem ? [ gifItem ] : [] ) ];

        const config : MediaConfig.Config = await this.mediaConfig();
        const asset : Media.Asset = prior
            ? { ...prior, name, kind: Media.Kind.VIDEO, status: Media.Status.OK, modifiedAt: now, items: [ original, ...variantItems, ...extraItems ] }
            : { accountId, guid, name, kind: Media.Kind.VIDEO, tier: config.delivery.defaultTier, accessRole: Access.AccountRole.USER,
                status: Media.Status.OK, scope: Media.Scope.ACCOUNT,
                tags: project.tags ?? [], campaignIds: project.campaignId && project.campaignId !== "" ? [ project.campaignId ] : [],
                items: [ original, ...variantItems, ...extraItems ], source: { origin: Media.SourceOrigin.GENERATED, acquiredBy: userId, acquiredAt: now },
                createdBy: userId, createdAt: now, modifiedAt: now };

        // upload the master + each variant to its (usage/profile-keyed) S3 object
        await this.s3.put( "media", MediaPipeline.itemKey( asset, original ), Buffer.from( master.bytes ), "video/mp4" );
        for( let index : number = 0; index < variants.length; index++ )
        {
            const put : Type.Result<void> = await this.s3.put( "media", MediaPipeline.itemKey( asset, variantItems[ index ] ), Buffer.from( variants[ index ].bytes ), "video/mp4" );
            if( !put.ok ) this.log.warn( "studio render: variant upload failed", { profile: variantItems[ index ].profile, error: put.error } );
        }
        // upload the poster + gif export extras (best-effort — a failure just omits that item's bytes)
        if( posterItem !== null && posterBytes !== null ) await this.s3.put( "media", MediaPipeline.itemKey( asset, posterItem ), Buffer.from( posterBytes ), "image/jpeg" );
        if( gifItem !== null && gifBytes !== null ) await this.s3.put( "media", MediaPipeline.itemKey( asset, gifItem ), Buffer.from( gifBytes ), "image/gif" );
        await this.dynamo.put( "media", { ...asset } );
        if( prior ) void this.assetUpdated( asset, userId ); else void this.assetCreated( asset, userId );

        // link a NEW asset to the project so the next render updates it in place
        if( !prior ) await this.putStudioProject( { ...project, libraryAssetId: guid, modifiedAt: now, modifiedBy: userId } );
        return guid;
    }

    ///////////////////////////////////////////////////////////////////////////////////////
    /** Disconnect the Kafka producer before the base closes the HTTP server (clean SIGINT exit). */
    protected override async aboutToQuit() : Promise<void>
    {
        if( this._kafka ) { try { await this._kafka.disconnect(); } catch( err ) { this.log.error( "kafka disconnect failed", err ); } }
        await super.aboutToQuit();
    }
}

export namespace MediaService
{
    export enum Role
    {
        MAIN   = "main",     // the authed /media/* API (+ local pipeline drain)
        BROWSE = "browse",   // the /media/browse/* asset marketplace (provider fan-out) — scales independently
        STUDIO = "studio",   // the /media/studio/* creation/editing surface (stub) — shares the media plane
    }

    // role → its absolute port in the MEDIA block (the manifest's containerPort references the SAME constant)
    export const PORT : Record<Role, number> =
    {
        [ Role.MAIN ]   : Ports.MEDIA.MAIN,
        [ Role.BROWSE ] : Ports.MEDIA.BROWSE,
        [ Role.STUDIO ] : Ports.MEDIA.STUDIO,
    };

    // how long a staging batch lives before the TTL sweeps it (matches the staging bucket's 7-day lifecycle)
    export const STAGING_TTL_SEC : number = 7 * 24 * 60 * 60;

    /** The `media-generate` SQS job body — one generation request over N STAGING candidates (media-18). The
     *  Job produces each candidate's bytes into the staging bucket + updates the staging batch row; nothing is
     *  written to the library until the user promotes. */
    export interface GenerateJob
    {
        accountId  : string;
        userId?    : string;
        batchId    : string;
        candidates : Array<{ id : string; kind : Media.Kind; mime : string; extension : string }>;
        modality   : AiRouting.Modality;
        prompt     : string;
        provider   : AiRouting.Provider;
        model?     : string;
        params     : Record<string, unknown>;
    }

    /** One staged AI candidate — its bytes live in the staging bucket (`key`) until promoted; never a library
     *  asset. `status` mirrors AiGen.CandidateStatus. */
    export interface StagingCandidate
    {
        id        : string;
        kind      : Media.Kind;
        mime      : string;
        extension : string;
        status    : string;      // AiGen.CandidateStatus
        size?     : number;
        key?      : string;      // staging-bucket object key (when READY)
        error?    : string;      // failure reason (when FAILED)
    }

    /** The `media_staging` row — one AI-generation batch: its request context + the staged candidates. TTL
     *  sweeps abandoned batches (matches the staging bucket lifecycle). */
    export interface StagingBatch
    {
        accountId  : string;
        batchId    : string;
        userId?    : string;
        provider   : string;
        model?     : string;
        prompt     : string;
        modality   : AiRouting.Modality;
        params     : Record<string, unknown>;
        candidates : Array<StagingCandidate>;
        createdAt  : string;
        ttl        : number;     // DynamoDB TTL (epoch seconds)
    }

    /** The outcome of an AI generation call — the produced bytes, or null with a diagnostic `error` (surfaced
     *  in the job log + the FAILED stage event so a failure is diagnosable, not just "no content"). */
    export interface Produced { bytes : Uint8Array | null; error? : string; }
}

export default MediaService;
