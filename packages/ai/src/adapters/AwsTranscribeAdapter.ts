//
// AwsTranscribeAdapter — speech-to-text via **Amazon Transcribe**. Unlike the OpenAI/ElevenLabs adapters
// (which upload the audio inline over HTTP), Transcribe is an ASYNC, S3-backed service: stage the audio in
// S3, start a transcription job, poll it to completion, then fetch the transcript JSON. Auth is IAM (same as
// Bedrock) — no API key. It needs a staging bucket (the `transcribeBucket` adapter option); the media service
// passes its own staging bucket for the SPEECH_TO_TEXT modality. On LocalStack the API path works; real
// transcription runs against real AWS.
//
import { S3Client, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { TranscribeClient, StartTranscriptionJobCommand, GetTranscriptionJobCommand } from "@aws-sdk/client-transcribe";
import type { GetTranscriptionJobCommandOutput, MediaFormat, LanguageCode } from "@aws-sdk/client-transcribe";
import { randomUUID } from "crypto";

import { Ai } from "../AiModel";
import { BaseAdapter, AdapterOptions } from "./BaseAdapter";

/**
 * **Amazon Transcribe** adapter — audio → transcript with word/segment timings. IAM-authed (no key). Stages
 * the audio through S3, runs an async job, and reads the transcript back. Requires `transcribeBucket`.
 */
export class AwsTranscribeAdapter extends BaseAdapter
{
    /** @inheritDoc */
    readonly provider     : Ai.Provider = Ai.Provider.AWS_TRANSCRIBE;
    /** Speech-to-text only. */
    readonly capabilities : ReadonlySet<Ai.Capability> = new Set<Ai.Capability>( [ Ai.Capability.TRANSCRIBE ] );

    /** Amazon Transcribe has no "model" knob — this stands in for the response `model` field / config default. */
    private static readonly TRANSCRIBE_MODEL : string = "aws-transcribe";
    /** Max time to wait for a transcription job, and the poll interval. */
    private static readonly JOB_TIMEOUT_MS : number = 5 * 60 * 1000;
    private static readonly JOB_POLL_MS    : number = 3 * 1000;

    /** AWS region for both clients. */
    private readonly region : string;
    /** The S3 bucket used to stage the audio input for the job. */
    private readonly bucket? : string;
    /** Transcribe + S3 clients (same IAM/region). */
    private readonly jobs : TranscribeClient;
    private readonly s3 : S3Client;

    /** @param opts adapter options; `transcribeBucket` (the S3 staging bucket) is required to run a job. */
    constructor( opts : AdapterOptions = {} )
    {
        super( opts, AwsTranscribeAdapter.TRANSCRIBE_MODEL );
        this.region = opts.region ?? process.env.AWS_REGION ?? "us-east-1";
        this.bucket = opts.transcribeBucket;
        this.jobs   = new TranscribeClient( { region: this.region } );
        this.s3     = new S3Client( { region: this.region, forcePathStyle: true } );
    }

    /** Transcribe audio to text + timed segments. Stage → start job → poll → fetch transcript JSON → clean up.
     *  Returns a non-throwing {@link Ai.TranscribeResponse}: a missing bucket, a failed/timed-out job, or a
     *  fetch/parse error all come back as `ok:false`. */
    override async transcribe( request : Ai.TranscribeRequest ) : Promise<Ai.TranscribeResponse>
    {
        this.require( Ai.Capability.TRANSCRIBE );
        const errorResponse = ( message : string, status? : number ) : Ai.TranscribeResponse =>
            ( { ok: false, error: { status, message }, text: "", segments: [], usage: {}, model: this.model, provider: this.provider } );
        if( !this.bucket ) return errorResponse( "no staging bucket configured (transcribeBucket)" );

        // unique per-job identifiers — the job name must match ^[0-9a-zA-Z._-]+$
        const jobName : string = `stt-${ randomUUID() }`;
        const key : string = `ai-transcribe/${ jobName }/audio.${ AwsTranscribeAdapter.audioExtension( request.mime ) }`;

        try
        {
            // 1. stage the audio in S3 — Transcribe reads its input from an S3 URI, not an upload
            const staged : PutObjectCommand = new PutObjectCommand( { Bucket: this.bucket, Key: key, Body: request.audio, ContentType: request.mime } );
            await this.s3.send( staged );

            // 2. start the job — identify the language when the caller didn't pin a full BCP-47 code
            const languageCode : LanguageCode | undefined = AwsTranscribeAdapter.languageCode( request.language );
            const start : StartTranscriptionJobCommand = new StartTranscriptionJobCommand( {
                TranscriptionJobName : jobName,
                Media                : { MediaFileUri: `s3://${ this.bucket }/${ key }` },
                MediaFormat          : AwsTranscribeAdapter.mediaFormat( request.mime ),
                ...( languageCode ? { LanguageCode: languageCode } : { IdentifyLanguage: true } ),
            } );
            await this.jobs.send( start );

            // 3. poll the job to completion / failure / timeout
            const deadline : number = Date.now() + AwsTranscribeAdapter.JOB_TIMEOUT_MS;
            let job : GetTranscriptionJobCommandOutput | undefined = undefined;
            while( Date.now() < deadline )
            {
                await AwsTranscribeAdapter.sleep( AwsTranscribeAdapter.JOB_POLL_MS );
                job = await this.jobs.send( new GetTranscriptionJobCommand( { TranscriptionJobName: jobName } ) );
                const status : string | undefined = job.TranscriptionJob?.TranscriptionJobStatus;
                if( status === "COMPLETED" || status === "FAILED" ) break;
            }
            const finalStatus : string | undefined = job?.TranscriptionJob?.TranscriptionJobStatus;
            if( finalStatus !== "COMPLETED" )
            {
                await this.cleanup( key );
                return errorResponse( `transcribe job ${ finalStatus === "FAILED" ? ( job?.TranscriptionJob?.FailureReason ?? "failed" ) : "timed out" }` );
            }

            // 4. fetch + parse the transcript JSON (Transcribe returns a pre-signed URL when no output bucket is set)
            const uri : string | undefined = job?.TranscriptionJob?.Transcript?.TranscriptFileUri;
            if( !uri ) { await this.cleanup( key ); return errorResponse( "no transcript uri returned" ); }
            const response : Response = await fetch( uri );
            if( !response.ok ) { await this.cleanup( key ); return errorResponse( `transcript fetch failed: ${ response.status }`, response.status ); }
            const parsed : TranscribeOutput = await response.json() as TranscribeOutput;

            // 5. clean up the staged audio (best-effort) and shape the response
            await this.cleanup( key );
            const text : string = parsed.results?.transcripts?.[ 0 ]?.transcript ?? "";
            const segments : Array<Ai.TranscriptSegment> = AwsTranscribeAdapter.toSegments( parsed );
            const usage : Ai.Usage = {};
            this.emitUsage( usage, request.metadata );
            return { ok: true, text, segments, language: job?.TranscriptionJob?.LanguageCode, usage, model: this.model, provider: this.provider };
        }
        catch( error : unknown )
        {
            await this.cleanup( key );
            const status : number | undefined = ( error as { $metadata? : { httpStatusCode? : number } } ).$metadata?.httpStatusCode;
            return errorResponse( error instanceof Error ? error.message : "aws transcribe failed", status );
        }
    }

    /** Delete the staged audio object (best-effort — a cleanup miss must never fail the transcription). */
    private async cleanup( key : string ) : Promise<void>
    {
        if( !this.bucket ) return;
        try { await this.s3.send( new DeleteObjectCommand( { Bucket: this.bucket, Key: key } ) ); }
        catch { /* best-effort */ }
    }

    /** Prefer Transcribe's `audio_segments` (already caption-sized); fall back to building segments from the
     *  word-level `items` (group into sentences), so SRT/VTT captions work regardless of output shape. */
    private static toSegments( output : TranscribeOutput ) : Array<Ai.TranscriptSegment>
    {
        const audioSegments : Array<AudioSegment> = output.results?.audio_segments ?? [];
        if( audioSegments.length > 0 )
            return audioSegments.map( ( segment : AudioSegment ) : Ai.TranscriptSegment =>
                ( { start: Number( segment.start_time ?? 0 ), end: Number( segment.end_time ?? 0 ), text: ( segment.transcript ?? "" ).trim() } ) );
        return AwsTranscribeAdapter.itemsToSegments( output.results?.items ?? [] );
    }

    /** Fold word-level items into sentence segments — join tokens (attaching punctuation without a space) and
     *  break after sentence-ending punctuation. Timing comes from the pronounced words' start/end times. */
    private static itemsToSegments( items : Array<TranscribeItem> ) : Array<Ai.TranscriptSegment>
    {
        const segments : Array<Ai.TranscriptSegment> = [];
        let text : string = "";
        let start : number | undefined = undefined;
        let end : number = 0;

        // walk the items, accumulating a sentence and flushing on terminal punctuation
        for( const item of items )
        {
            const content : string = item.alternatives?.[ 0 ]?.content ?? "";
            const isPunctuation : boolean = item.type === "punctuation";
            text += isPunctuation ? content : ( text === "" ? content : ` ${ content }` );
            if( !isPunctuation )
            {
                if( start === undefined ) start = Number( item.start_time ?? end );
                end = Number( item.end_time ?? end );
            }
            if( start !== undefined && isPunctuation && /[.!?]/.test( content ) )
            {
                segments.push( { start, end, text: text.trim() } );
                text = "";
                start = undefined;
            }
        }
        // flush a trailing sentence with no terminal punctuation
        if( start !== undefined && text.trim() !== "" ) segments.push( { start, end, text: text.trim() } );
        return segments;
    }

    /** Map an audio mime to a Transcribe `MediaFormat` (its accepted container set). */
    private static mediaFormat( mime : string ) : MediaFormat
    {
        if( mime.includes( "wav" ) ) return "wav";
        if( mime.includes( "flac" ) ) return "flac";
        if( mime.includes( "ogg" ) ) return "ogg";
        if( mime.includes( "webm" ) ) return "webm";
        if( mime.includes( "mp4" ) || mime.includes( "m4a" ) ) return "mp4";
        if( mime.includes( "amr" ) ) return "amr";
        return "mp3";
    }

    /** A file extension for the staged object, from the audio mime. */
    private static audioExtension( mime : string ) : string
    {
        if( mime.includes( "wav" ) ) return "wav";
        if( mime.includes( "flac" ) ) return "flac";
        if( mime.includes( "ogg" ) ) return "ogg";
        if( mime.includes( "webm" ) ) return "webm";
        if( mime.includes( "mp4" ) || mime.includes( "m4a" ) ) return "m4a";
        return "mp3";
    }

    /** Transcribe needs a full language code (e.g. `en-US`), not a bare `en` — pass a full code through, map a
     *  bare `en` to `en-US`, and otherwise return undefined so the caller uses automatic language identification. */
    private static languageCode( language? : string ) : LanguageCode | undefined
    {
        if( !language ) return undefined;
        if( language.includes( "-" ) ) return language as LanguageCode;
        if( language.toLowerCase() === "en" ) return "en-US";
        return undefined;
    }

    /** Sleep helper for the async-job poll loop. */
    private static sleep( ms : number ) : Promise<void> { return new Promise( ( resolve ) => setTimeout( resolve, ms ) ); }
}

/** One alternative transcription of a word/punctuation token. */
interface TranscribeAlternative { content? : string; }

/** One word/punctuation item from Transcribe's word-level `items`. */
interface TranscribeItem
{
    type?         : string;   // "pronunciation" | "punctuation"
    start_time?   : string;
    end_time?     : string;
    alternatives? : Array<TranscribeAlternative>;
}

/** One caption-sized segment from Transcribe's `audio_segments` (present in newer output). */
interface AudioSegment
{
    start_time? : string;
    end_time?   : string;
    transcript? : string;
}

/** Internal shape of an Amazon Transcribe transcript JSON document. */
interface TranscribeOutput
{
    results? :
    {
        transcripts?    : Array<{ transcript? : string }>;
        items?          : Array<TranscribeItem>;
        audio_segments? : Array<AudioSegment>;
    };
}

export default AwsTranscribeAdapter;
