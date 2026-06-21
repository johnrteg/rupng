import { createWriteStream, mkdirSync, type WriteStream } from "node:fs";
import { join } from "node:path";
import { EventEmitter } from "node:events";

import type { LogLine, LogStream } from "../shared/types";
import { LOG_DIR } from "./paths";

//
// Log store. Every line a child process emits is:
//   1. kept in a per-(service,stream) in-memory ring buffer (so the renderer can fetch history when
//      a tab is opened, without replaying from disk), and
//   2. appended to a file at <repo>/tools/console/.logs/<service>/<stream>.log.
//
// (2) is the Claude Code integration: when something breaks, the full output is already on disk at a
// stable path, so you can ask Claude to "read .logs/app/deploy.log and fix it" — no copy/paste.
//
// The store also emits "line" events the IPC layer forwards to the renderer live.
//

const RING = 5000; // lines kept in memory per (service, stream)

interface Buf
{
    lines : LogLine[];
    seq : number;
    file : WriteStream;
}

class LogStore extends EventEmitter
{
    private bufs = new Map<string, Buf>();

    private key( service : string, stream : LogStream ) : string
    {
        return `${service}:${stream}`;
    }

    private buf( service : string, stream : LogStream ) : Buf
    {
        const k : string = this.key( service, stream );
        let b : Buf | undefined = this.bufs.get( k );
        if ( !b )
        {
            const dir : string = join( LOG_DIR, service );
            mkdirSync( dir, { recursive: true } );
            const file : WriteStream = createWriteStream( join( dir, `${stream}.log` ), { flags: "a" } );
            b = { lines: [], seq: 0, file };
            this.bufs.set( k, b );
        }
        return b;
    }

    /** Append one line of text (may contain embedded newlines — split into lines). */
    append( service : string, stream : LogStream, level : LogLine[ "level" ], text : string ) : void
    {
        const b : Buf = this.buf( service, stream );

        for ( const raw of text.split( /\r?\n/ ) )
        {
            // keep blank lines that came mid-output, but drop a trailing empty from the final newline
            const line : LogLine =
            {
                service, stream, level,
                seq  : b.seq++,
                ts   : Date.now(),
                text : raw
            };

            b.lines.push( line );
            if ( b.lines.length > RING ) b.lines.splice( 0, b.lines.length - RING );

            this.emit( "line", line );
        }

        b.file.write( text.endsWith( "\n" ) ? text : text + "\n" );
    }

    /** A console-generated annotation line (started / exited / errors). */
    sys( service : string, stream : LogStream, text : string ) : void
    {
        this.append( service, stream, "sys", text );
    }

    /** Fetch buffered history for a (service, stream). */
    get( service : string, stream : LogStream ) : LogLine[]
    {
        return this.bufs.get( this.key( service, stream ) )?.lines.slice() ?? [];
    }

    /** Clear the in-memory buffer for a stream (the file on disk is left intact for history). */
    clear( service : string, stream : LogStream ) : void
    {
        const b : Buf | undefined = this.bufs.get( this.key( service, stream ) );
        if ( b ) b.lines = [];
    }

    /** Absolute on-disk path for a stream's log file (shown in the UI + used by Ask-Claude). */
    path( service : string, stream : LogStream ) : string
    {
        return join( LOG_DIR, service, `${stream}.log` );
    }
}

export const logStore = new LogStore();
