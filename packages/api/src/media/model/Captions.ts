//
import { Media } from "./Media";

//
// Captions — parse a `.srt`/`.vtt` caption file's text into timed `Media.TranscriptSegment`s, and serialize
// segments back to the same format. The SINGLE shared implementation (media-18 caption editing, media-2x
// caption burn-in): the web transcript editor parses/edits/saves with this, and the media service's
// caption-burn job re-parses the same bytes to read segments at render time — one grammar, never duplicated.
//
export namespace Captions
{
    /** Parse a caption file's text into timed segments, dispatching on the item's extension ("srt" | "vtt"). */
    export function parse( text : string, extension : string ) : Array<Media.TranscriptSegment>
    {
        return extension.toLowerCase() === "vtt" ? parseVtt( text ) : parseSrt( text );
    }

    /** Serialize timed segments back to caption text, dispatching on the item's extension ("srt" | "vtt"). */
    export function serialize( segments : Array<Media.TranscriptSegment>, extension : string ) : string
    {
        return extension.toLowerCase() === "vtt" ? toVtt( segments ) : toSrt( segments );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // parse SubRip (.srt): blocks separated by a blank line, each `index \n start --> end \n text…`
    function parseSrt( text : string ) : Array<Media.TranscriptSegment>
    {
        const blocks : Array<string> = splitBlocks( text );
        const segments : Array<Media.TranscriptSegment> = [];
        for( const block of blocks )
        {
            const segment : Media.TranscriptSegment | null = parseBlock( block );
            if( segment ) segments.push( segment );
        }
        return segments;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // parse WebVTT (.vtt): same cue shape as SRT, but preceded by a `WEBVTT` header block (dropped by
    // `splitBlocks`'s "no timing line → skip" rule) and no numeric cue index
    function parseVtt( text : string ) : Array<Media.TranscriptSegment>
    {
        return parseSrt( text );   // the cue grammar (timing line + text) is identical once the header is skipped
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // split raw caption text into blank-line-separated cue blocks
    function splitBlocks( text : string ) : Array<string>
    {
        return text
            .replace( /\r/g, "" )
            .split( /\n\s*\n/ )
            .map( ( block : string ) : string => block.trim() )
            .filter( ( block : string ) : boolean => block.length > 0 );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // one cue block → a segment: find its `start --> end` line (skips a leading numeric index / the
    // WEBVTT header line, neither of which contain "-->"), then join every remaining line as the text
    function parseBlock( block : string ) : Media.TranscriptSegment | null
    {
        const lines : Array<string> = block.split( "\n" );
        const timingIndex : number = lines.findIndex( ( line : string ) : boolean => line.includes( "-->" ) );
        if( timingIndex === -1 ) return null;

        const match : RegExpMatchArray | null = lines[ timingIndex ].match( /(\d{2}:\d{2}:\d{2}[,.]\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}[,.]\d{3})/ );
        if( !match ) return null;

        const start : number = parseTimestamp( match[ 1 ] );
        const end   : number = parseTimestamp( match[ 2 ] );
        const text  : string = lines.slice( timingIndex + 1 ).join( "\n" ).trim();
        return { start, end, text };
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // a caption timestamp (`HH:MM:SS,mmm` or `HH:MM:SS.mmm`) → a seconds offset
    function parseTimestamp( timestamp : string ) : number
    {
        const match : RegExpMatchArray | null = timestamp.replace( ",", "." ).match( /(\d{2}):(\d{2}):(\d{2})\.(\d{3})/ );
        if( !match ) return 0;
        const hours : number = Number( match[ 1 ] );
        const minutes : number = Number( match[ 2 ] );
        const seconds : number = Number( match[ 3 ] );
        const millis : number = Number( match[ 4 ] );
        return hours * 3600 + minutes * 60 + seconds + millis / 1000;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // render timed segments as SubRip (.srt) — a numbered cue per segment, comma before milliseconds
    function toSrt( segments : Array<Media.TranscriptSegment> ) : string
    {
        return segments
            .map( ( segment : Media.TranscriptSegment, index : number ) : string =>
                `${ index + 1 }\n${ captionTimestamp( segment.start, "," ) } --> ${ captionTimestamp( segment.end, "," ) }\n${ segment.text.trim() }\n` )
            .join( "\n" );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // render timed segments as WebVTT (.vtt) — the `WEBVTT` header + a cue per segment, dot before milliseconds
    function toVtt( segments : Array<Media.TranscriptSegment> ) : string
    {
        const cues : string = segments
            .map( ( segment : Media.TranscriptSegment ) : string =>
                `${ captionTimestamp( segment.start, "." ) } --> ${ captionTimestamp( segment.end, "." ) }\n${ segment.text.trim() }\n` )
            .join( "\n" );
        return `WEBVTT\n\n${ cues }`;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // a seconds offset → a caption timestamp `HH:MM:SS<sep>mmm` (`,` for SubRip, `.` for WebVTT)
    function captionTimestamp( seconds : number, millisSeparator : string ) : string
    {
        const safe : number = Number.isFinite( seconds ) && seconds > 0 ? seconds : 0;
        const hours : number = Math.floor( safe / 3600 );
        const minutes : number = Math.floor( ( safe % 3600 ) / 60 );
        const wholeSeconds : number = Math.floor( safe % 60 );
        const milliseconds : number = Math.round( ( safe - Math.floor( safe ) ) * 1000 );
        const pad = ( value : number, size : number ) : string => String( value ).padStart( size, "0" );
        return `${ pad( hours, 2 ) }:${ pad( minutes, 2 ) }:${ pad( wholeSeconds, 2 ) }${ millisSeparator }${ pad( milliseconds, 3 ) }`;
    }
}

export default Captions;
// eof
