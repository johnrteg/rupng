//
// Piper adapter — https://github.com/rhasspy/piper, an open-source, SELF-HOSTED neural text-to-speech engine.
// KEYLESS (mirrors BedrockAdapter's IAM-less pattern): this adapter never calls `this.key()` — it talks to a
// Piper HTTP server (`piper --http-server ... --model <voice>.onnx`) at a configured base URL instead of
// Secrets Manager. The stock server binds ONE voice model at process start (no per-request voice switching in
// the official server); `request.voiceId`, if given, is passed as a `voice` query param for forward
// compatibility with multi-voice Piper HTTP wrappers, but the official single-voice server ignores it.
//
import { FileUtils } from "@repo/common";

import { Ai } from "../AiModel";
import { BaseAdapter, AdapterOptions, Attempt } from "./BaseAdapter";

/**
 * **Piper** adapter — POSTs raw text to a self-hosted Piper HTTP server's root endpoint and reads back
 * synthesized WAV bytes. No API key (the server has no auth of its own); the base URL is the only
 * configuration, resolved `opts.piperUrl` → `PIPER_URL` env → a local default (mirrors the `FAKE_EMAIL_URL`
 * convention, `apps/core/email/src/providers/adapters/FakeProvider.ts`).
 */
export class PiperAdapter extends BaseAdapter
{
    /** @inheritDoc */
    readonly provider     : Ai.Provider = Ai.Provider.PIPER;
    /** Text-to-speech only — Piper doesn't do chat/image/voice-cloning/transcription. */
    readonly capabilities : ReadonlySet<Ai.Capability> = new Set<Ai.Capability>( [ Ai.Capability.SPEECH ] );

    /** The Piper HTTP server's base URL. */
    private readonly baseUrl : string;

    /** @param opts adapter options; Piper has no client-side "model id" (the server owns its one voice), so
     *  `opts.model` is only ever used as a label, never sent to the server. */
    constructor( opts : AdapterOptions = {} )
    {
        super( opts, "piper" );
        this.baseUrl = opts.piperUrl ?? process.env.PIPER_URL ?? "http://localhost:5000";
    }

    /** Synthesize speech — POST the raw text to the Piper server and read back WAV bytes. Never throws — a
     *  down/misconfigured server (the common local-dev case) becomes a retryable `SpeakResponse`. */
    override async speak( request : Ai.SpeakRequest ) : Promise<Ai.SpeakResponse>
    {
        this.require( Ai.Capability.SPEECH );
        const url : string = request.voiceId ? `${ this.baseUrl }/?voice=${ encodeURIComponent( request.voiceId ) }` : this.baseUrl;

        const outcome : Attempt<Uint8Array> = await this.withRetry<Uint8Array>( async () : Promise<Attempt<Uint8Array>> =>
        {
            try
            {
                const response : Response = await fetch( url, {
                    method:  "POST",
                    headers: { "Content-Type": "text/plain; charset=utf-8" },
                    body:    request.text,
                } );
                if( !response.ok )
                    return { ok: false, status: response.status, message: `piper tts failed: ${ response.status } ${ await response.text().catch( () => "" ) }`.trim() };
                return { ok: true, value: new Uint8Array( await response.arrayBuffer() ) };
            }
            catch( error : unknown ) { return { ok: false, message: `piper tts error (is the Piper HTTP server running at ${ this.baseUrl }?): ${ String( error ) }` }; }
        } );

        // Piper always emits WAV regardless of the requested container — report it honestly rather than the ask
        const mime : string = FileUtils.Mime.AUDIO_WAV;
        if( !outcome.ok )
            return { ok: false, error: { status: outcome.status, message: outcome.message }, audio: new Uint8Array(), mime, format: Ai.AudioFormat.WAV, usage: {}, model: this.model, provider: this.provider };

        const usage : Ai.Usage = { inputTokens: request.text.length };   // no per-token/char billing (self-hosted) — recorded for parity with other TTS adapters
        this.emitUsage( usage, request.metadata );
        return { ok: true, audio: outcome.value, mime, format: Ai.AudioFormat.WAV, usage, model: this.model, provider: this.provider };
    }
}

export default PiperAdapter;
// eof
