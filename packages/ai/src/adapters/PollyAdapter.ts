//
// Polly adapter — Amazon Polly text-to-speech. IAM-authed (no API key) — mirrors BedrockAdapter's keyless
// pattern: this adapter never calls `this.key()`; the AWS SDK client picks up ambient IAM credentials. Fits
// the platform's AWS-first posture (in-infra, no key sprawl) the same way Bedrock does for chat.
//
import { PollyClient, SynthesizeSpeechCommand, Engine, OutputFormat, VoiceId } from "@aws-sdk/client-polly";
import type { SynthesizeSpeechCommandOutput } from "@aws-sdk/client-polly";

import { Ai } from "../AiModel";
import { BaseAdapter, AdapterOptions, Attempt } from "./BaseAdapter";

/** Bytes + the mime type they were returned as — Polly's own synthesis result before it's wrapped in an
 *  `Ai.SpeakResponse`. */
interface SynthesizedAudio { audio : Uint8Array; mime : string; }

/**
 * **Polly** adapter — `SynthesizeSpeechCommand` over the AWS SDK. Returns synthesized audio bytes (MP3 by
 * default; PCM/OGG on request — Polly has no native WAV output, so a WAV request falls back to MP3, the same
 * posture ElevenLabs takes for an unsupported container). No API key — the SDK client resolves IAM
 * credentials from the ambient environment (task role / instance profile / local AWS config).
 */
export class PollyAdapter extends BaseAdapter
{
    /** @inheritDoc */
    readonly provider     : Ai.Provider = Ai.Provider.POLLY;
    /** Text-to-speech only. */
    readonly capabilities : ReadonlySet<Ai.Capability> = new Set<Ai.Capability>( [ Ai.Capability.SPEECH ] );

    /** A sensible default voice (US English, supports the neural engine). */
    private static readonly DEFAULT_VOICE : VoiceId = "Joanna";
    /** The Polly voice ENGINE — `opts.model` doubles as this, since Polly has no separate "model id" concept. */
    private static readonly ENGINES : ReadonlySet<string> = new Set<string>( [ "standard", "neural", "long-form", "generative" ] );

    private readonly region : string;
    private readonly engine : Engine;
    private readonly client : PollyClient;

    /** @param opts adapter options; `model` (if one of Polly's engine names) selects the synthesis engine,
     *  else defaults to `"neural"` (better quality; not every voice supports it, but `DEFAULT_VOICE` does). */
    constructor( opts : AdapterOptions = {} )
    {
        super( opts, "neural" );
        this.region = opts.region ?? process.env.AWS_REGION ?? "us-east-1";
        this.engine = ( opts.model && PollyAdapter.ENGINES.has( opts.model ) ? opts.model : "neural" ) as Engine;
        this.client = new PollyClient( { region: this.region } );
    }

    /** Synthesize speech via `SynthesizeSpeechCommand`. Never throws — an AWS/network error becomes a
     *  retryable `SpeakResponse`. */
    override async speak( request : Ai.SpeakRequest ) : Promise<Ai.SpeakResponse>
    {
        this.require( Ai.Capability.SPEECH );
        const voiceId : VoiceId = ( request.voiceId as VoiceId | undefined ) || PollyAdapter.DEFAULT_VOICE;
        const outputFormat : OutputFormat = PollyAdapter.outputFormatFor( request.format );

        const outcome : Attempt<SynthesizedAudio> = await this.withRetry<SynthesizedAudio>( async () : Promise<Attempt<SynthesizedAudio>> =>
        {
            try
            {
                const response : SynthesizeSpeechCommandOutput = await this.client.send( new SynthesizeSpeechCommand( {
                    Text: request.text, VoiceId: voiceId, OutputFormat: outputFormat, Engine: this.engine,
                } ) );
                if( !response.AudioStream ) return { ok: false, message: "polly returned no audio stream" };
                const audio : Uint8Array = await ( response.AudioStream as unknown as { transformToByteArray() : Promise<Uint8Array> } ).transformToByteArray();
                return { ok: true, value: { audio, mime: response.ContentType ?? PollyAdapter.mimeFor( outputFormat ) } };
            }
            catch( error : unknown )
            {
                const status : number | undefined = ( error as { $metadata? : { httpStatusCode? : number } } )?.$metadata?.httpStatusCode;
                return { ok: false, status, message: `polly tts error: ${ String( error ) }` };
            }
        } );

        const format : Ai.AudioFormat = request.format ?? Ai.AudioFormat.MP3;
        if( !outcome.ok )
            return { ok: false, error: { status: outcome.status, message: outcome.message }, audio: new Uint8Array(), mime: PollyAdapter.mimeFor( outputFormat ), format, usage: {}, model: this.model, provider: this.provider };

        const usage : Ai.Usage = { inputTokens: request.text.length };   // Polly bills per character
        this.emitUsage( usage, request.metadata );
        return { ok: true, audio: outcome.value.audio, mime: outcome.value.mime, format, usage, model: this.model, provider: this.provider };
    }

    // map the requested container to Polly's own OutputFormat vocabulary — Polly has no WAV output, so WAV
    // (and anything else unrecognized) falls back to MP3.
    private static outputFormatFor( format? : Ai.AudioFormat ) : OutputFormat
    {
        if( format === Ai.AudioFormat.PCM ) return "pcm";
        if( format === Ai.AudioFormat.OPUS ) return "ogg_vorbis";
        return "mp3";
    }

    private static mimeFor( outputFormat : OutputFormat ) : string
    {
        if( outputFormat === "pcm" ) return "audio/pcm";
        if( outputFormat === "ogg_vorbis" ) return "audio/ogg";
        return "audio/mpeg";
    }
}

export default PollyAdapter;
