//
// VoiceToText
//
// Thin wrapper around the browser Web Speech API ( webkitSpeechRecognition / SpeechRecognition )
// that turns spoken audio from the microphone into text. Built as a standalone, framework-agnostic
// class so it can later be embedded into TextInput, the RTE, or anything else: create an instance,
// wire the handlers, and call start()/stop().
//
// Usage ( later, not now ):
//   const v2t = new VoiceToText( { lang: "en-US" }, { onResult: ( text, final ) => ... } );
//   if( VoiceToText.isSupported() ) v2t.start();
//   ...
//   v2t.stop();        // graceful - lets the final result come through
//   v2t.dispose();     // tear down ( e.g. on component unmount )
//

// ──────────────────────────────────────────────────────────────────────────────────────────────
// Minimal Web Speech API typings - these are not part of the standard TS DOM lib, so declare just
// the surface this class touches rather than pulling in `any`.
// ──────────────────────────────────────────────────────────────────────────────────────────────
interface SpeechRecognitionAlternative
{
    readonly transcript : string;
    readonly confidence : number;
}

interface SpeechRecognitionResult
{
    readonly length     : number;
    readonly isFinal    : boolean;
    [ index : number ]  : SpeechRecognitionAlternative;
}

interface SpeechRecognitionResultList
{
    readonly length     : number;
    [ index : number ]  : SpeechRecognitionResult;
}

interface SpeechRecognitionEventLike extends Event
{
    readonly resultIndex : number;
    readonly results     : SpeechRecognitionResultList;
}

interface SpeechRecognitionErrorEventLike extends Event
{
    readonly error      : string;
    readonly message    : string;
}

interface SpeechRecognitionLike
{
    lang            : string;
    continuous      : boolean;
    interimResults  : boolean;
    maxAlternatives : number;

    start() : void;
    stop()  : void;
    abort() : void;

    onstart  : ( ( ev : Event ) => void ) | null;
    onend    : ( ( ev : Event ) => void ) | null;
    onresult : ( ( ev : SpeechRecognitionEventLike ) => void ) | null;
    onerror  : ( ( ev : SpeechRecognitionErrorEventLike ) => void ) | null;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

///////////////////////////////////////////////////////////////////////////////////////////////////
// resolve the ( possibly vendor-prefixed ) constructor, guarding for non-browser / unsupported envs
function getRecognitionCtor() : SpeechRecognitionCtor | null
{
    if( typeof window === "undefined" )return null;

    const w : any = window as any;
    return ( w.SpeechRecognition || w.webkitSpeechRecognition || null ) as SpeechRecognitionCtor | null;
}


//
//
//
export default class VoiceToText
{
    private recognition : SpeechRecognitionLike | null = null;
    private options     : Required<VoiceToText.Options>;
    private handlers    : VoiceToText.Handlers;
    private active      : boolean = false;
    private finalText   : string  = "";   // accumulated finalized transcript for this session

    ///////////////////////////////////////////////////////////////////////////////////////////////
    constructor( options : VoiceToText.Options = {}, handlers : VoiceToText.Handlers = {} )
    {
        this.options = {
                            lang            : options.lang            ?? "en-US",
                            continuous      : options.continuous      ?? true,
                            interimResults  : options.interimResults  ?? true
                        };
        this.handlers = handlers;
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////
    /** True if the current browser exposes the Web Speech recognition API. */
    public static isSupported() : boolean
    {
        return getRecognitionCtor() !== null;
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////
    /** True while actively listening to the microphone. */
    public get listening() : boolean
    {
        return this.active;
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////
    /** Everything finalized ( isFinal ) since the last start(). */
    public get transcript() : string
    {
        return this.finalText;
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////
    /** Replace the result/state callbacks ( useful when re-binding to a component ). */
    public setHandlers( handlers : VoiceToText.Handlers ) : void
    {
        this.handlers = handlers;
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////
    /** Change the recognition language ( e.g. "en-US", "es-ES" ), applied immediately if running. */
    public setLanguage( lang : string ) : void
    {
        this.options.lang = lang;
        if( this.recognition )this.recognition.lang = lang;
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////
    /** Begin listening. No-op if already active; emits a "not-supported" error if unavailable. */
    public start() : void
    {
        if( this.active )return;

        const Ctor : SpeechRecognitionCtor | null = getRecognitionCtor();
        if( Ctor === null )
        {
            this.emitError( "not-supported" );
            return;
        }

        const rec : SpeechRecognitionLike = new Ctor();
        rec.lang            = this.options.lang;
        rec.continuous      = this.options.continuous;
        rec.interimResults  = this.options.interimResults;
        rec.maxAlternatives = 1;

        rec.onstart  = () => { this.active = true; this.finalText = ""; if( this.handlers.onStart )this.handlers.onStart(); };
        rec.onend    = () => { this.active = false; if( this.handlers.onEnd )this.handlers.onEnd(); };
        rec.onresult = ( ev : SpeechRecognitionEventLike ) => this.handleResult( ev );
        rec.onerror  = ( ev : SpeechRecognitionErrorEventLike ) => this.emitError( ev.error || "error" );

        this.recognition = rec;

        try
        {
            rec.start();
        }
        catch( err )
        {
            // start() throws if called while a prior session is still winding down
            this.emitError( "start-failed" );
        }
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////
    /** Stop gracefully - any in-flight final result is still delivered before onEnd. */
    public stop() : void
    {
        if( this.recognition && this.active )this.recognition.stop();
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////
    /** Stop immediately, discarding any pending result. */
    public abort() : void
    {
        if( this.recognition )this.recognition.abort();
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////
    /** Convenience toggle for a single mic button. */
    public toggle() : void
    {
        if( this.active )this.stop();
        else             this.start();
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////
    /** Detach handlers and release the recognition instance ( call on unmount ). */
    public dispose() : void
    {
        if( this.recognition )
        {
            this.recognition.onstart  = null;
            this.recognition.onend    = null;
            this.recognition.onresult = null;
            this.recognition.onerror  = null;

            try { this.recognition.abort(); }
            catch( err ) { /* ignore - already stopped */ }

            this.recognition = null;
        }
        this.active = false;
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////
    // collate the new results since resultIndex into a finalized chunk and an interim chunk, and
    // hand them to the consumer. interim text is what's still being recognized ( may change ).
    private handleResult( ev : SpeechRecognitionEventLike ) : void
    {
        let interim    : string = "";
        let finalChunk : string = "";

        for( let i : number = ev.resultIndex; i < ev.results.length; i++ )
        {
            const result : SpeechRecognitionResult = ev.results[i];
            const text   : string = result[0] ? result[0].transcript : "";

            if( result.isFinal )finalChunk += text;
            else                 interim    += text;
        }

        if( finalChunk !== "" )
        {
            this.finalText += finalChunk;
            if( this.handlers.onResult )this.handlers.onResult( finalChunk, true );
        }

        if( interim !== "" && this.handlers.onResult )this.handlers.onResult( interim, false );
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////
    private emitError( error : string ) : void
    {
        this.active = false;
        if( this.handlers.onError )this.handlers.onError( error );
    }
}


//
//
//
export namespace VoiceToText
{
    export interface Options
    {
        lang?           : string;     // BCP-47 tag, e.g. "en-US" ( default "en-US" )
        continuous?     : boolean;    // keep listening after a pause vs stop on first phrase ( default true )
        interimResults? : boolean;    // emit partial ( not-yet-final ) text ( default true )
    }

    export interface Handlers
    {
        // transcript chunk + whether it is finalized. interim ( isFinal=false ) text may change.
        onResult?   : ( transcript : string, isFinal : boolean ) => void;
        onStart?    : () => void;                        // listening began
        onEnd?      : () => void;                         // listening ended ( manual stop, silence, or error )
        onError?    : ( error : string ) => void;         // e.g. "not-allowed", "no-speech", "not-supported"
    }
}
