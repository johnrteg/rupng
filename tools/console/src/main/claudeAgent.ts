import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { EventEmitter } from "node:events";

import type {
    ClaudeApprovalRequest, ClaudeMessage, ClaudeMode, ClaudeMsgKind
} from "../shared/types";
import { LOG_DIR, REPO_ROOT } from "./paths";
import { claudePrompt } from "./claude";
import { appendMessage, loadSessionId, saveSessionId } from "./claudeStore";

//
// In-app Claude — wraps @anthropic-ai/claude-agent-sdk's `query()`. The SDK runs the Claude Code
// engine in-process (this is Node), reusing the machine's existing Claude Code auth. We stream its
// messages to the renderer's Claude panel, gate mutating tools behind UI approval (in "fix" mode),
// and persist the transcript to .logs/<service>/claude.log so it's on disk like every other stream.
//
// The SDK is ESM; main is bundled CJS — so we import() it lazily (also lets us degrade gracefully
// if it isn't installed/authed).
//

/** Tools that only read — auto-allowed in every engaged mode. Everything else is gated in "fix". */
const READONLY_TOOLS : Set<string> = new Set( [ "Read", "Grep", "Glob", "TodoWrite", "Task", "WebFetch", "WebSearch" ] );

/** Tools a read-only mode (ondemand/realtime) must never use. */
const MUTATING_TOOLS : Array<string> = [ "Edit", "Write", "MultiEdit", "NotebookEdit" ];

// monotonic suffix so two ids minted in the same millisecond don't collide
let counter : number = 0;
/** Mint a short, time-ordered, collision-resistant id for a message or approval request. */
const nextId = () : string => `c${Date.now().toString( 36 )}-${( counter++ ).toString( 36 )}`;

/**
 * A bounded async queue of user messages feeding the SDK's streaming-input prompt. `push` adds a
 * turn; `end` closes the stream (ends the session). The generator parks on a promise when empty so
 * the conversation stays open between turns, ready for the next follow-up the user types.
 */
function makeInputQueue()
{
    const pending : Array<string> = [];
    let wake : ( () => void ) | null = null;
    let closed : boolean = false;

    const push = ( text : string ) : void => { pending.push( text ); wake?.(); wake = null; };
    const end  = () : void => { closed = true; wake?.(); wake = null; };

    async function* stream() : AsyncGenerator<SdkUserMessage>
    {
        for ( ;; )
        {
            while ( pending.length > 0 )
            {
                const text : string = pending.shift() as string;
                yield { type: "user", message: { role: "user", content: text }, parent_tool_use_id: null };
            }
            if ( closed ) return;
            await new Promise<void>( ( resolve ) => { wake = resolve; } );
        }
    }

    return { push, end, stream };
}

interface Session
{
    abort : AbortController;
    pushInput : ( text : string ) => void;
    endInput : () => void;
}

class ClaudeAgent extends EventEmitter
{
    private mode : ClaudeMode = "ondemand";
    private sessions = new Map<string, Session>();
    /** Pending approvals keyed by id → resolver. */
    private approvals = new Map<string, ( allow : boolean ) => void>();

    /** The current engagement mode (off / ondemand / realtime / fix). */
    getMode() : ClaudeMode { return this.mode; }
    /** Switch the engagement mode; affects future sessions only. */
    setMode( mode : ClaudeMode ) : void { this.mode = mode; }

    /** True while a streaming session is open for the service. */
    isRunning( service : string ) : boolean { return this.sessions.has( service ); }

    /** Called by the IPC layer when a stage fails — auto-engages in realtime/fix modes. */
    onStageFailed( service : string ) : void
    {
        if ( this.mode === "realtime" || this.mode === "fix" )
        {
            if ( !this.isRunning( service ) ) void this.start( service );
        }
    }

    /** Resolve a pending approval (from the UI). */
    approve( id : string, allow : boolean ) : void
    {
        const resolver : ( ( allow : boolean ) => void ) | undefined = this.approvals.get( id );
        if ( resolver ) { this.approvals.delete( id ); resolver( allow ); }
    }

    /** Tear down a service's session: close the input stream, abort the query, deny pending approvals. */
    stop( service : string ) : void
    {
        const session : Session | undefined = this.sessions.get( service );
        if ( session ) { session.endInput(); session.abort.abort(); this.sessions.delete( service ); this.emitState( service, false, false ); }
        // reject any dangling approvals for this service
        for ( const [ id, resolve ] of this.approvals ) { void id; resolve( false ); }
        this.approvals.clear();
    }

    /** Start a diagnose/fix session for a service. No-op if mode is off or already running. */
    async start( service : string ) : Promise<void>
    {
        await this.open( service );
    }

    /**
     * Send a free-text message to Claude for this service. If a session is already open it becomes
     * the next conversation turn; otherwise it opens a new session seeded with this question. Works
     * in every mode except "off" (so you can ask even without a prior diagnosis).
     */
    async send( service : string, text : string ) : Promise<void>
    {
        const trimmed : string = text.trim();
        if ( this.mode === "off" || trimmed === "" ) return;

        const existing : Session | undefined = this.sessions.get( service );
        if ( existing )
        {
            this.push( service, "user", trimmed );
            this.emitState( service, true, true );
            existing.pushInput( trimmed );
            return;
        }
        await this.open( service, trimmed );
    }

    /** Open a streaming session. `firstPrompt` seeds the first turn; default = auto-diagnose prompt. */
    private async open( service : string, firstPrompt? : string ) : Promise<void>
    {
        if ( this.mode === "off" || this.isRunning( service ) ) return;

        const abort : AbortController = new AbortController();
        const queue : ReturnType<typeof makeInputQueue> = makeInputQueue();
        this.sessions.set( service, { abort, pushInput: queue.push, endInput: queue.end } );
        this.emitState( service, true, true );

        if ( firstPrompt !== undefined )
        {
            this.push( service, "user", firstPrompt );
            queue.push( firstPrompt );
        }
        else
        {
            const { prompt } = claudePrompt( service );
            queue.push( prompt );
        }

        try
        {
            await this.runQuery( service, abort, queue.stream() );
        }
        catch ( err )
        {
            this.push( service, "error", `Claude session error: ${( err as Error ).message}` );
        }
        finally
        {
            this.sessions.delete( service );
            this.emitState( service, false, false );
        }
    }

    /**
     * Drive one streaming `query()`: lazily load the (ESM) SDK, resume the prior session if its
     * transcript still exists locally, wire tool-approval gating for "fix" mode, then forward every
     * streamed SDK message to the transcript until the input stream closes or the query is aborted.
     */
    private async runQuery( service : string, abort : AbortController, input : AsyncGenerator<SdkUserMessage> ) : Promise<void>
    {
        // ensure the engine can find the `claude` executable + creds when launched from Finder
        const extraPath : string = [ "/opt/homebrew/bin", "/usr/local/bin", process.env.PATH ?? "" ].filter( Boolean ).join( ":" );
        process.env.PATH = extraPath;

        let sdk : typeof import("@anthropic-ai/claude-agent-sdk");
        try
        {
            sdk = await import( "@anthropic-ai/claude-agent-sdk" );
        }
        catch ( err )
        {
            this.push( service, "error",
                `Could not load @anthropic-ai/claude-agent-sdk (${( err as Error ).message}). ` +
                `Run \`npm install\` in tools/console and ensure Claude Code is authenticated.` );
            return;
        }

        const fix : boolean = this.mode === "fix";

        // resume the prior conversation if we saved a session id AND it still exists on this machine
        // (the transcript lives under ~/.claude/projects/<dir>/<id>/ locally — a stale/foreign id is
        // dropped so we just start fresh rather than erroring).
        let resume : string | undefined = loadSessionId( service );
        if ( resume )
        {
            const info : Awaited<ReturnType<typeof sdk.getSessionInfo>> | undefined =
                await sdk.getSessionInfo( resume, { dir: REPO_ROOT } ).catch( () => undefined );
            if ( info )
            {
                this.push( service, "status", `Resuming the previous conversation (session ${resume.slice( 0, 8 )}…).` );
            }
            else
            {
                this.push( service, "status", "No resumable session on this machine — starting a fresh conversation." );
                saveSessionId( service, undefined );
                resume = undefined;
            }
        }

        this.push( service, "status", `Engaging Claude (${this.mode}) for "${service}" — reading the captured logs…` );

        const response : ReturnType<typeof sdk.query> = sdk.query( {
            prompt           : input as Parameters<typeof sdk.query>[ 0 ][ "prompt" ],
            options:
            {
                cwd             : REPO_ROOT,
                abortController : abort,
                permissionMode  : "default",
                ...( resume ? { resume } : {} ),
                // read-only modes simply can't use mutating tools; fix mode gates them via canUseTool
                ...( fix ? {} : { disallowedTools: MUTATING_TOOLS } ),
                canUseTool : fix
                    ? async ( toolName : string, input : Record<string, unknown> ) =>
                      {
                          if ( READONLY_TOOLS.has( toolName ) )
                              return { behavior: "allow" as const, updatedInput: input };
                          const allowed : boolean = await this.requestApproval( service, toolName, input );
                          return allowed
                              ? { behavior: "allow" as const, updatedInput: input }
                              : { behavior: "deny" as const, message: "Denied by user in the console." };
                      }
                    : undefined
            }
        } );

        for await ( const message of response )
        {
            this.handleMessage( service, message as SdkMessage );
        }
    }

    /** Map an SDK message to one or more transcript entries. Defensive about the exact shape. */
    private handleMessage( service : string, message : SdkMessage ) : void
    {
        switch ( message.type )
        {
            case "system":
                if ( message.subtype === "init" )
                {
                    if ( message.session_id ) saveSessionId( service, message.session_id );
                    this.push( service, "status", "Session initialized." );
                }
                break;

            case "assistant":
            {
                const content : Array<SdkContentBlock> = message.message?.content ?? [];
                for ( const block of content )
                {
                    if ( block.type === "text" && block.text?.trim() )
                        this.push( service, "assistant", block.text );
                    else if ( block.type === "tool_use" )
                    {
                        const toolName : string = block.name ?? "tool";
                        this.push( service, "tool", summarizeTool( toolName, block.input ), toolName );
                    }
                }
                break;
            }

            case "result":
            {
                const text : string = typeof message.result === "string" && message.result.trim()
                    ? message.result
                    : ( message.subtype ?? "done" );
                this.push( service, "result", text );
                // the turn is done, but the session stays open for follow-up questions
                if ( this.isRunning( service ) ) this.emitState( service, true, false );
                break;
            }

            default:
                break; // user/tool_result/stream_event — not surfaced individually
        }
    }

    /** Emit an approval request to the UI and resolve once the user allows/denies it. */
    private requestApproval( service : string, toolName : string, input : Record<string, unknown> ) : Promise<boolean>
    {
        const id : string = nextId();
        const request : ClaudeApprovalRequest = { id, service, toolName, summary: summarizeTool( toolName, input ) };
        return new Promise<boolean>( ( resolve ) =>
        {
            this.approvals.set( id, resolve );
            this.emit( "approval", request );
        } );
    }

    /** Build a transcript entry, emit it live to the renderer, and persist it (fire-and-forget). */
    private push( service : string, kind : ClaudeMsgKind, text : string, toolName? : string ) : void
    {
        const message : ClaudeMessage = { service, id: nextId(), kind, text, ts: Date.now(), toolName };
        this.emit( "message", message );
        void this.persist( service, message );
    }

    /** Persist a transcript entry: append to the committed conversation and to the raw claude.log. */
    private async persist( service : string, message : ClaudeMessage ) : Promise<void>
    {
        // committed, structured transcript loaded on next launch — skip ephemeral status lines
        if ( message.kind !== "status" ) appendMessage( service, message );

        // raw stream log (parity with every other captured stream)
        try
        {
            const dir : string = join( LOG_DIR, service );
            await mkdir( dir, { recursive: true } );
            const tag : string = message.toolName ? `${message.kind}:${message.toolName}` : message.kind;
            await appendFile( join( dir, "claude.log" ), `[${tag}] ${message.text}\n` );
        }
        catch { /* best-effort */ }
    }

    /** Notify the UI of this service's session state (open? mid-turn?). */
    private emitState( service : string, running : boolean, thinking : boolean ) : void
    {
        this.emit( "state", { service, running, thinking } );
    }
}

/** Build a short human summary of a tool call for the transcript / approval prompt. */
function summarizeTool( name : string, input : Record<string, unknown> | undefined ) : string
{
    if ( !input ) return name;
    const fields : Record<string, unknown> = input as Record<string, unknown>;
    if ( name === "Bash" && typeof fields[ "command" ] === "string" ) return `Bash: ${fields[ "command" ] as string}`;
    if ( ( name === "Edit" || name === "Write" || name === "MultiEdit" ) && typeof fields[ "file_path" ] === "string" )
        return `${name}: ${fields[ "file_path" ] as string}`;
    if ( ( name === "Read" || name === "Grep" || name === "Glob" ) )
        return `${name}: ${String( fields[ "file_path" ] ?? fields[ "pattern" ] ?? fields[ "path" ] ?? "" )}`;
    return `${name}( ${JSON.stringify( fields ).slice( 0, 160 )} )`;
}

//
// Minimal structural types for the SDK messages we read (the SDK's own types are richer; we only
// touch these fields, defensively).
//
interface SdkContentBlock
{
    type : string;
    text? : string;
    name? : string;
    input? : Record<string, unknown>;
}
interface SdkMessage
{
    type : "system" | "assistant" | "user" | "result" | "stream_event" | string;
    subtype? : string;
    session_id? : string;
    result? : unknown;
    message? : { content? : Array<SdkContentBlock> };
}
/** What we feed the SDK's streaming-input prompt — one user turn. */
interface SdkUserMessage
{
    type : "user";
    message : { role : "user"; content : string };
    parent_tool_use_id : string | null;
}

export const claudeAgent = new ClaudeAgent();
