//
import { randomUUID } from "node:crypto";

import { Application, Service, Ports, Register, Dynamo, S3, Sqs, Kafka, Secrets } from "@repo/services";
import { Ai, AiFactory } from "@repo/ai";
import { RestfulEndpoint, Access } from "@repo/endpoint";
import { Events } from "@repo/system";
import { Media, MediaConfig, AiRouting, AiGen } from "@repo/api";
import { FileUtils, ObjectUtils } from "@repo/common";
import type { Type } from "@repo/common";

import { MediaPipeline } from "../pipeline/MediaPipeline";
import { MediaAnalyzer } from "../pipeline/MediaAnalyzer";
import { MalwareScanFactory } from "../scan/MalwareScanFactory";
import type { MalwareScanner } from "../scan/MalwareScanner";

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

        // how many candidate solutions to produce — clamped to the provider's range for this media type
        const range : AiRouting.CandidateRange = AiRouting.candidatesFor( client.provider as unknown as AiRouting.Provider, request.modality );
        const count : number = Math.max( range.min, Math.min( range.max, request.count ?? range.default ) );

        // create the placeholder assets (bytes filled by the Job) + a batch to group them
        const batchId : string = randomUUID();
        const now : string = new Date().toISOString();
        const pending : Array<AiGen.Pending> = [];
        const guids : Array<string> = [];
        for( let index : number = 0; index < count; index++ )
        {
            const guid : string = randomUUID();
            // placeholder ORIGINAL item — bytes filled by the Job; the envelope carries the generation provenance
            const original : Media.Item = {
                id: randomUUID(), usage: Media.Usage.ORIGINAL, kind: shape.kind, mime: shape.mime, extension: shape.extension,
                size: 0, version: 1, status: Media.Status.UPLOADING, createdAt: now, modifiedAt: now,
            };
            const asset : Media.Asset = {
                accountId, guid,
                name:       `${ request.modality } — ${ request.prompt.slice( 0, 40 ) }`,
                kind:       shape.kind,
                tier:       Media.Tier.PROTECTED, accessRole: Access.AccountRole.USER, status: Media.Status.UPLOADING,
                scope:      Media.Scope.ACCOUNT, campaignIds: [], tags: [],
                source:     {
                    origin: Media.SourceOrigin.GENERATED, provider: client.provider, model: client.model,
                    prompt: request.prompt, params, batchId, acquiredAt: now, acquiredBy: auth.userId,
                },
                items:      [ original ], createdBy: auth.userId, createdAt: now, modifiedAt: now,
            };
            const wrote : Type.Result<void> = await this.dynamo.put( "media", { ...asset } );
            if( !wrote.ok ) continue;
            void this.assetCreated( asset, auth.userId );
            void this.emitJobStage( accountId, guid, "generate", Events.JobStage.QUEUED, { userId: auth.userId } );
            pending.push( { guid, kind: shape.kind } );
            guids.push( guid );
        }
        if( guids.length === 0 ) return { status: 500 };

        const job : MediaService.GenerateJob = {
            accountId, userId: auth.userId, batchId, guids,
            modality: request.modality, prompt: request.prompt, provider: client.provider as unknown as AiRouting.Provider, model: client.model, params,
        };
        await this.sqs.send( "media-generate", job );

        return { status: 202, response: { batchId, candidates: pending, provider: client.provider, model: client.model } };
    }

    ///////////////////////////////////////////////////////////////////////////////////////
    /** WORKER (media-generate, media-19): produce the bytes for each placeholder guid in a generate job, store
     *  them, run the standard scan → process pipeline, and emit `media.job` stage events (started → completed |
     *  failed) so the UI/workflows track progress. Drained by MAIN locally; a Lambda in prod. */
    public async runGenerate( job : MediaService.GenerateJob ) : Promise<void>
    {
        // VIDEO uses an async provider job that outputs to S3 (Nova Reel) — hand the adapter the media bucket
        // as its scratch output location; harmless/undefined for other modalities.
        const videoBucket : string | undefined = job.modality === AiRouting.Modality.VIDEO ? this.mediaBucketName() : undefined;
        this.log.info( "media.generate job start", { batchId: job.batchId, provider: job.provider, model: job.model, modality: job.modality, guids: job.guids.length } );
        const client : Ai = AiFactory.create( { provider: job.provider as unknown as Ai.Provider, model: job.model, videoBucket } );
        for( const guid of job.guids )
        {
            void this.emitJobStage( job.accountId, guid, "generate", Events.JobStage.STARTED, { userId: job.userId } );
            const got : Type.Result<Media.Asset | undefined> = await this.dynamo.get<Media.Asset>( "media", { accountId: job.accountId, guid } );
            if( !got.ok || !got.data ) { void this.emitJobStage( job.accountId, guid, "generate", Events.JobStage.FAILED, { message: "asset missing" } ); continue; }
            const asset : Media.Asset = got.data;

            const original : Media.Item | undefined = Media.originalItem( asset );
            if( !original ) { void this.emitJobStage( job.accountId, guid, "generate", Events.JobStage.FAILED, { message: "no original item" } ); continue; }

            // capture a thrown provider error too (network / unexpected) — a deterministic failure must land
            // as FAILED with detail, not bubble up and redeliver the job forever
            let produced : MediaService.Produced;
            try { produced = await this.produceBytes( client, job.modality, job.prompt, job.params ); }
            catch( error : unknown ) { produced = { bytes: null, error: `provider threw: ${ String( error ) }` }; }
            if( !produced.bytes || produced.bytes.length === 0 )
            {
                const message : string = produced.error ?? "provider returned no content";
                // surface the REAL provider error (status + message) in the log + stage event — not just "no content"
                this.log.warn( "media.generate failed", { guid, provider: job.provider, model: job.model, modality: job.modality, error: message } );
                await this.dynamo.put( "media", { ...asset, status: Media.Status.FAILED, modifiedAt: new Date().toISOString() } );
                void this.emitJobStage( job.accountId, guid, "generate", Events.JobStage.FAILED, { message, userId: job.userId } );
                continue;
            }
            const bytes : Uint8Array = produced.bytes;

            // store the produced bytes as the ORIGINAL item + advance to scan → process (variants + probe)
            const now : string = new Date().toISOString();
            const put : Type.Result<void> = await this.s3.put( "media", MediaPipeline.itemKey( asset, original ), Buffer.from( bytes ), original.mime );
            const updatedOriginal : Media.Item = { ...original, size: bytes.length, status: put.ok ? Media.Status.SCANNING : Media.Status.FAILED, modifiedAt: now };
            const updated : Media.Asset = { ...asset, status: put.ok ? Media.Status.SCANNING : Media.Status.FAILED, items: Media.upsertItems( asset.items, updatedOriginal ), modifiedAt: now };
            await this.dynamo.put( "media", { ...updated } );
            if( !put.ok ) { void this.emitJobStage( job.accountId, guid, "generate", Events.JobStage.FAILED, { message: "store failed" } ); continue; }
            await this.sqs.send( "media-scan", { accountId: job.accountId, guid } );
            void this.assetUpdated( updated, job.userId );
            void this.emitJobStage( job.accountId, guid, "generate", Events.JobStage.COMPLETED, { userId: job.userId } );
        }
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
            const reply : Ai.ImageResponse = await client.image( { prompt, n: 1, size: MediaService.imageSize( params.aspect ) } );
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
        const queued : Type.Result<void> = await this.sqs.send( "media-transcribe", { accountId, guid, userId: auth.userId } );
        if( !queued.ok ) { this.log.warn( "transcribe enqueue failed — media-transcribe queue send", { guid, error: queued.error } ); return { status: 500 }; }
        this.log.info( "transcribe queued", { guid } );
        return { status: 202 };
    }

    ///////////////////////////////////////////////////////////////////////////////////////
    /** WORKER (media-transcribe, media-19): extract the audio track from a VIDEO (store it as the `audio`
     *  variant) or use an AUDIO asset's bytes, run speech-to-text via the `config/ai` SPEECH_TO_TEXT provider
     *  (Whisper), and save `asset.transcript` (text + timed segments). Emits `media.job` stage events. */
    public async runTranscribe( accountId : string, guid : string, userId? : string ) : Promise<void>
    {
        void this.emitJobStage( accountId, guid, "transcribe", Events.JobStage.STARTED, { userId } );
        const fail = ( message : string ) : void => void this.emitJobStage( accountId, guid, "transcribe", Events.JobStage.FAILED, { message, userId } );

        const got : Type.Result<Media.Asset | undefined> = await this.dynamo.get<Media.Asset>( "media", { accountId, guid } );
        if( !got.ok || !got.data ) { fail( "asset missing" ); return; }
        const asset : Media.Asset = got.data;
        const original : Media.Item | undefined = Media.originalItem( asset );
        if( !original || ( original.kind !== Media.Kind.AUDIO && original.kind !== Media.Kind.VIDEO ) ) { fail( "not audio/video" ); return; }

        // the STT client from config/ai routing (SPEECH_TO_TEXT); capability-gated
        const stt : Ai | undefined = await this.aiFor( AiRouting.Modality.SPEECH_TO_TEXT );
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
            const extracted : { bytes : Uint8Array; format : string; mime : string } | null = await MediaAnalyzer.extractAudio( originalBytes, original.extension );
            if( !extracted ) { fail( "audio extraction failed" ); return; }
            audioBytes = extracted.bytes;
            audioMime  = extracted.mime;
            const now : string = new Date().toISOString();
            const audioItem : Media.Item = {
                id: randomUUID(), usage: Media.Usage.AUDIO, kind: Media.Kind.AUDIO, mime: extracted.mime, extension: extracted.format,
                size: extracted.bytes.length, version: 1, status: Media.Status.OK, createdAt: now, modifiedAt: now,
                derivation: { job: "extract-audio", sourceItemId: original.id },
            };
            const put : Type.Result<void> = await this.s3.put( "media", MediaPipeline.itemKey( asset, audioItem ), Buffer.from( extracted.bytes ), extracted.mime );
            audioItem.status = put.ok ? Media.Status.OK : Media.Status.FAILED;
            items = Media.upsertItems( items, audioItem );
            sourceItemId = audioItem.id;
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
        void this.emitJobStage( accountId, guid, "transcribe", Events.JobStage.COMPLETED, { userId } );
    }

    ///////////////////////////////////////////////////////////////////////////////////////
    // The physical `media` S3 bucket name (for handing to the Nova Reel async video output), or undefined when
    // it can't be resolved (not deployed) — video then reports "no output bucket".
    private mediaBucketName() : string | undefined
    {
        try { return this.cloud.bucketName( "media" ); }
        catch { return undefined; }
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
    public async enqueueArchive( auth : RestfulEndpoint.Authentication, guid : string ) : Promise<{ status : number; archiveId? : string }>
    {
        const accountId : string | undefined = auth.accountId;
        if( !accountId ) return { status: 400 };
        const got : Type.Result<Media.Asset | undefined> = await this.dynamo.get<Media.Asset>( "media", { accountId, guid } );
        if( !got.ok || !got.data ) return { status: 404 };

        const archiveId : string = randomUUID();
        const archive : Media.Archive = {
            accountId, archiveId,
            name: `${ got.data.name }.zip`,
            status: Media.ArchiveStatus.PENDING, sourceGuids: [ guid ],
            requestedBy: auth.userId, createdAt: new Date().toISOString(),
        };
        const wrote : Type.Result<void> = await this.dynamo.put( "archives", { ...archive } );
        if( !wrote.ok ) { this.log.warn( "archive enqueue failed — archives table write", { guid, archiveId, error: wrote.error } ); return { status: 500 }; }

        void this.emitJobStage( accountId, archiveId, "archive", Events.JobStage.QUEUED, { userId: auth.userId } );
        const queued : Type.Result<void> = await this.sqs.send( "media-archive", { accountId, archiveId, userId: auth.userId } );
        if( !queued.ok ) { this.log.warn( "archive enqueue failed — media-archive queue send", { guid, archiveId, error: queued.error } ); return { status: 500 }; }
        this.log.info( "archive queued", { guid, archiveId } );
        return { status: 202, archiveId };
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
        await this.sqs.send( "media-video", { accountId, guid, target, userId: auth.userId } );
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
        // the malware-scan engine for the ingest gate — the config-selected adapter (Noop when scanning is off).
        const scanner : MalwareScanner = MalwareScanFactory.forConfig( config.scan );
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

    /** The `media-generate` SQS job body — one generation request over N placeholder guids (media-19). */
    export interface GenerateJob
    {
        accountId : string;
        userId?   : string;
        batchId   : string;
        guids     : Array<string>;
        modality  : AiRouting.Modality;
        prompt    : string;
        provider  : AiRouting.Provider;
        model?    : string;
        params    : Record<string, unknown>;
    }

    /** The outcome of an AI generation call — the produced bytes, or null with a diagnostic `error` (surfaced
     *  in the job log + the FAILED stage event so a failure is diagnosable, not just "no content"). */
    export interface Produced { bytes : Uint8Array | null; error? : string; }
}

export default MediaService;
