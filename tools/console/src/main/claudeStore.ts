import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { ClaudeMessage } from "../shared/types";
import { LOG_DIR, serviceDir } from "./paths";

//
// Per-service Claude state, split by portability:
//
//   • the CONVERSATION transcript is persisted IN THE REPO (apps/core/<svc>/claude-conversation.json)
//     so it's version-controlled and the whole team can read prior diagnoses — same idea as the
//     committed api-requests.json. The panel loads this on open and appends each live turn.
//
//   • the SESSION ID (resume token) is stored MACHINE-LOCALLY in the gitignored .logs/<svc>/, because
//     the underlying transcript the engine resumes from lives at ~/.claude/projects/<dir>/<id>/ on
//     THIS machine only — it isn't tied to the auth key and isn't portable to another dev's clone.
//
// "Clear" wipes both. Ephemeral "status" lines are not persisted (they'd just be noise across runs).
//

/** apps/core/<service>/claude-conversation.json (committed) */
function convPath( service : string ) : string
{
    return join( serviceDir( service ), "claude-conversation.json" );
}

/** .logs/<service>/claude-session.json (gitignored, machine-local) */
function sessionPath( service : string ) : string
{
    return join( LOG_DIR, service, "claude-session.json" );
}

// in-memory cache so appends don't re-read the file each turn
const cache : Map<string, Array<ClaudeMessage>> = new Map<string, Array<ClaudeMessage>>();

/** Load a service's committed transcript (from cache if present, else the repo file; [] if neither). */
export function loadConversation( service : string ) : Array<ClaudeMessage>
{
    const cached : Array<ClaudeMessage> | undefined = cache.get( service );
    if ( cached ) return cached;

    let messages : Array<ClaudeMessage> = [];
    const filePath : string = convPath( service );
    if ( existsSync( filePath ) )
    {
        try
        {
            const parsed = JSON.parse( readFileSync( filePath, "utf8" ) ) as { messages? : Array<ClaudeMessage> };
            messages = parsed.messages ?? [];
        }
        catch { messages = []; }
    }
    cache.set( service, messages );
    return messages;
}

/** Persist the full transcript to the committed file and refresh the in-memory cache. */
function write( service : string, messages : Array<ClaudeMessage> ) : void
{
    cache.set( service, messages );
    try { writeFileSync( convPath( service ), JSON.stringify( { messages }, null, 4 ) + "\n" ); }
    catch { /* best-effort */ }
}

/** Append one turn to the committed transcript. */
export function appendMessage( service : string, msg : ClaudeMessage ) : void
{
    const messages : Array<ClaudeMessage> = loadConversation( service ).slice();
    messages.push( msg );
    write( service, messages );
}

/** Wipe the conversation (removes the committed transcript and the local resume token). */
export function clearConversation( service : string ) : void
{
    cache.set( service, [] );
    const filePath : string = convPath( service );
    try { if ( existsSync( filePath ) ) rmSync( filePath ); }
    catch { /* best-effort */ }
    saveSessionId( service, undefined );
}

// ── session id (machine-local resume token) ──────────────────────────────────────────────────────

/** The Claude session id to resume for this service, if one was saved on this machine. */
export function loadSessionId( service : string ) : string | undefined
{
    const filePath : string = sessionPath( service );
    if ( !existsSync( filePath ) ) return undefined;
    try
    {
        const parsed = JSON.parse( readFileSync( filePath, "utf8" ) ) as { sessionId? : string };
        return parsed.sessionId;
    }
    catch { return undefined; }
}

/** Save (or, with undefined, forget) the resume token for this service. */
export function saveSessionId( service : string, sessionId : string | undefined ) : void
{
    const filePath : string = sessionPath( service );
    try
    {
        if ( sessionId === undefined ) { if ( existsSync( filePath ) ) rmSync( filePath ); return; }
        mkdirSync( join( LOG_DIR, service ), { recursive: true } );
        writeFileSync( filePath, JSON.stringify( { sessionId }, null, 4 ) + "\n" );
    }
    catch { /* best-effort */ }
}
