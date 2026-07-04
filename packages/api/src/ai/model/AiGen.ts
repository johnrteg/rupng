//
// AiGen — the AI-generation contract shared by the web AI Gen surface and the media service: the normalized
// generation ATTRIBUTES (a descriptor-driven form so provider-specific knobs — "how creative", "photo-
// realistic", voice, format, audio-emphasis text — render generically), plus the generate request/response.
// Attributes are normalized here (one vocabulary) and mapped to each provider's params in the adapter, so
// the UI stays provider-agnostic. Lives in @repo/api (one definition) so the web renders + the service maps.
//
import { AiRouting } from "./AiRouting";

export namespace AiGen
{
    /** The control type the UI renders for a {@link Param}. */
    export enum ParamType
    {
        SELECT = "select",     // one-of choices (a dropdown)
        RANGE  = "range",      // a bounded slider (min..max, step)
        NUMBER = "number",     // a numeric field
        TOGGLE = "toggle",     // a boolean switch
        TEXT   = "text",       // free text (e.g. an audio-emphasis hint / negative prompt)
    }

    /** One choice for a {@link ParamType.SELECT} param. */
    export interface Choice { value : string; label : string; }

    /** A normalized, provider-agnostic generation attribute descriptor — the UI renders one control per
     *  Param, and the value is sent back in the request's `params` map keyed by `key`. */
    export interface Param
    {
        key          : string;
        label        : string;
        type         : ParamType;
        help?        : string;
        placeholder? : string;              // TEXT
        choices?     : Array<Choice>;       // SELECT
        min?         : number;              // RANGE / NUMBER
        max?         : number;              // RANGE / NUMBER
        step?        : number;              // RANGE / NUMBER
        default?     : string | number | boolean;
    }

    // ── Normalized attribute sets, per modality ──────────────────────────────────────────────────
    // Common, provider-agnostic knobs. Provider-specific extras are layered by attributesFor(); the service
    // maps these normalized keys onto each provider's native params.
    const STYLE_CHOICES : Array<Choice> =
    [
        { value: "auto",          label: "Auto" },
        { value: "photorealistic", label: "Photorealistic" },
        { value: "illustration",  label: "Illustration" },
        { value: "3d",            label: "3D render" },
        { value: "anime",         label: "Anime" },
        { value: "digital-art",   label: "Digital art" },
    ];
    const ASPECT_CHOICES : Array<Choice> =
    [
        { value: "1:1",  label: "Square (1:1)" },
        { value: "16:9", label: "Landscape (16:9)" },
        { value: "9:16", label: "Portrait (9:16)" },
        { value: "4:3",  label: "4:3" },
    ];
    const AUDIO_FORMAT_CHOICES : Array<Choice> =
    [
        { value: "mp3", label: "MP3" },
        { value: "wav", label: "WAV" },
    ];

    /** modality → its normalized attribute descriptors (before provider-specific layering). */
    const BASE : Partial<Record<AiRouting.Modality, Array<Param>>> =
    {
        [ AiRouting.Modality.IMAGE ]:
        [
            { key: "style",      label: "Style",      type: ParamType.SELECT, choices: STYLE_CHOICES, default: "auto", help: "Overall look — e.g. photorealistic vs illustration." },
            { key: "aspect",     label: "Aspect",     type: ParamType.SELECT, choices: ASPECT_CHOICES, default: "1:1" },
            { key: "creativity", label: "Creativity", type: ParamType.RANGE, min: 0, max: 1, step: 0.1, default: 0.5, help: "How freely the model interprets the prompt." },
            { key: "negative",   label: "Avoid",      type: ParamType.TEXT, placeholder: "things to avoid (negative prompt)" },
        ],
        [ AiRouting.Modality.VIDEO ]:
        [
            { key: "aspect",   label: "Aspect",        type: ParamType.SELECT, choices: ASPECT_CHOICES, default: "16:9" },
            { key: "duration", label: "Seconds",       type: ParamType.NUMBER, min: 2, max: 30, step: 1, default: 6 },
        ],
        [ AiRouting.Modality.TEXT_TO_SPEECH ]:
        [
            { key: "voiceId",  label: "Voice",         type: ParamType.TEXT, placeholder: "voice id (a preset or a cloned voice)", help: "Leave blank for the default voice." },
            { key: "format",   label: "Format",        type: ParamType.SELECT, choices: AUDIO_FORMAT_CHOICES, default: "mp3" },
            { key: "speed",    label: "Speed",         type: ParamType.RANGE, min: 0.5, max: 2, step: 0.1, default: 1 },
            { key: "emphasis", label: "Emphasis hints", type: ParamType.TEXT, placeholder: "e.g. [excited] … [whisper] …", help: "Inline audio-emphasis placeholders the voice model honors." },
        ],
        [ AiRouting.Modality.SPEECH_CLONING ]:
        [
            { key: "voiceName", label: "Voice name",   type: ParamType.TEXT, placeholder: "name this voice", help: "The cloned voice is saved to THIS account only." },
            { key: "format",    label: "Format",       type: ParamType.SELECT, choices: AUDIO_FORMAT_CHOICES, default: "mp3" },
        ],
        [ AiRouting.Modality.SOUND ]:
        [
            { key: "duration", label: "Seconds",       type: ParamType.NUMBER, min: 1, max: 30, step: 1, default: 5 },
            { key: "influence", label: "Prompt influence", type: ParamType.RANGE, min: 0, max: 1, step: 0.1, default: 0.5 },
        ],
    };

    /** The normalized attribute descriptors to render for a modality (+ optional provider for future
     *  provider-specific layering). Empty when the modality has no tunable attributes. */
    export function attributesFor( modality : AiRouting.Modality, _provider? : AiRouting.Provider ) : Array<Param>
    {
        return BASE[ modality ] ?? [];
    }

    // ── Generate request / response ──────────────────────────────────────────────────────────────
    /** A generation request. `provider`/`model` override the account's `config/ai` route for the modality;
     *  `params` are the normalized attribute values keyed by {@link Param.key}; `count` is how many candidate
     *  solutions to produce (clamped to the provider's {@link AiRouting.CandidateRange} for the media type). */
    export interface Request
    {
        modality  : AiRouting.Modality;
        prompt    : string;
        provider? : AiRouting.Provider;
        model?    : string;
        params?   : Record<string, unknown>;
        count?    : number;
    }

    /** A generated candidate asset once ready — the UI resolves `previewUrl` (GetMediaUrl) after polling. The
     *  caller keeps one (PatchAsset sets its name/tags) and discards the rest (DeleteAsset). */
    export interface Candidate
    {
        guid       : string;
        kind       : string;          // Media.Kind of the produced asset
        mime       : string;
        previewUrl : string;          // a (signed) URL to preview the generated bytes
    }

    /** A pending candidate placeholder returned by the async generate ack — the asset exists (status
     *  processing) with its guid/kind known; the media-generate Job fills in the bytes. The UI polls each guid
     *  (GetAsset) until ready, then previews it. */
    export interface Pending { guid : string; kind : string; }

    /** The ACK from an async generate (media-19): the job's batch + the pending candidate placeholders to poll.
     *  The bytes are produced by the `media-generate` Job, which emits `media.job` stage events as it works. */
    export interface Response
    {
        batchId    : string;
        candidates : Array<Pending>;
        provider   : string;
        model?     : string;
    }
}

export default AiGen;
