import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { EventEmitter } from "node:events";

import type {
    ClaudeApprovalRequest, ClaudeMessage, ClaudeMode, ClaudeMsgKind
} from "../shared/types";
import { LOG_DIR, REPO_ROOT } from "./paths";
import { claudePrompt } from "./claude";

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
const READONLY_TOOLS = new Set( [ "Read", "Grep", "Glob", "TodoWrite", "Task", "WebFetch", "WebSearch" ] );

/** Tools a read-only mode (ondemand/realtime) must never use. */
const MUTATING_TOOLS = [ "Edit", "Write", "MultiEdit", "NotebookEdit" ];

let counter = 0;
const nextId = () : string => `c${Date.now().toString( 36 )}-${( counter++ ).toString( 36 )}`;

interface Session
{
    abort : AbortController;
}

class ClaudeAgent extends EventEmitter
{
    private mode : ClaudeMode = "ondemand";
    private sessions = new Map<string, Session>();
    /** Pending approvals keyed by id → resolver. */
    private approvals = new Map<string, ( allow : boolean ) => void>();

    getMode() : ClaudeMode { return this.mode; }
    setMode( mode : ClaudeMode ) : void { this.mode = mode; }

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

    stop( service : string ) : void
    {
        const s : Session | undefined = this.sessions.get( service );
        if ( s ) { s.abort.abort(); this.sessions.delete( service ); this.emitState( service, false ); }
        // reject any dangling approvals for this service
        for ( const [ id, resolve ] of this.approvals ) { void id; resolve( false ); }
        this.approvals.clear();
    }

    /** Start a diagnose/fix session for a service. No-op if mode is off or already running. */
    async start( service : string ) : Promise<void>
    {
        if ( this.mode === "off" || this.isRunning( service ) ) return;

        const abort : AbortController = new AbortController();
        this.sessions.set( service, { abort } );
        this.emitState( service, true );

        try
        {
            await this.runQuery( service, abort );
        }
        catch ( err )
        {
            this.push( service, "error", `Claude session error: ${( err as Error ).message}` );
        }
        finally
        {
            this.sessions.delete( service );
            this.emitState( service, false );
        }
    }

    private async runQuery( service : string, abort : AbortController ) : Promise<void>
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

        const { prompt } = claudePrompt( service );
        const fix : boolean = this.mode === "fix";

        this.push( service, "status", `Engaging Claude (${this.mode}) for "${service}" — reading the captured logs…` );

        const response : ReturnType<typeof sdk.query> = sdk.query( {
            prompt,
            options:
            {
                cwd             : REPO_ROOT,
                abortController : abort,
                permissionMode  : "default",
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
                if ( message.subtype === "init" ) this.push( service, "status", "Session initialized." );
                break;

            case "assistant":
            {
                const content : SdkContentBlock[] = message.message?.content ?? [];
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
                break;
            }

            default:
                break; // user/tool_result/stream_event — not surfaced individually
        }
    }

    private requestApproval( service : string, toolName : string, input : Record<string, unknown> ) : Promise<boolean>
    {
        const id : string = nextId();
        const req : ClaudeApprovalRequest = { id, service, toolName, summary: summarizeTool( toolName, input ) };
        return new Promise<boolean>( ( resolve ) =>
        {
            this.approvals.set( id, resolve );
            this.emit( "approval", req );
        } );
    }

    private push( service : string, kind : ClaudeMsgKind, text : string, toolName? : string ) : void
    {
        const msg : ClaudeMessage = { service, id: nextId(), kind, text, ts: Date.now(), toolName };
        this.emit( "message", msg );
        void this.persist( service, msg );
    }

    private async persist( service : string, msg : ClaudeMessage ) : Promise<void>
    {
        try
        {
            const dir : string = join( LOG_DIR, service );
            await mkdir( dir, { recursive: true } );
            const tag : string = msg.toolName ? `${msg.kind}:${msg.toolName}` : msg.kind;
            await appendFile( join( dir, "claude.log" ), `[${tag}] ${msg.text}\n` );
        }
        catch { /* best-effort */ }
    }

    private emitState( service : string, running : boolean ) : void
    {
        this.emit( "state", { service, running } );
    }
}

/** Build a short human summary of a tool call for the transcript / approval prompt. */
function summarizeTool( name : string, input : Record<string, unknown> | undefined ) : string
{
    if ( !input ) return name;
    const i : Record<string, unknown> = input as Record<string, unknown>;
    if ( name === "Bash" && typeof i[ "command" ] === "string" ) return `Bash: ${i[ "command" ] as string}`;
    if ( ( name === "Edit" || name === "Write" || name === "MultiEdit" ) && typeof i[ "file_path" ] === "string" )
        return `${name}: ${i[ "file_path" ] as string}`;
    if ( ( name === "Read" || name === "Grep" || name === "Glob" ) )
        return `${name}: ${String( i[ "file_path" ] ?? i[ "pattern" ] ?? i[ "path" ] ?? "" )}`;
    return `${name}( ${JSON.stringify( i ).slice( 0, 160 )} )`;
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
    result? : unknown;
    message? : { content? : SdkContentBlock[] };
}

export const claudeAgent = new ClaudeAgent();
