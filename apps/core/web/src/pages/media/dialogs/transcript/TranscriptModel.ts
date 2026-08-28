//
import { Captions, Media } from '@repo/api';

//
// TranscriptModel — the transcript editor + caption-burn dialogs' UI-only helpers on top of the shared
// `Captions` parse/serialize model (`@repo/api`, reused by the media service's caption-burn job so both
// surfaces read the exact same grammar off the same bytes).
//
export namespace TranscriptModel
{
    /** Parse a caption file's text into timed segments, dispatching on the item's extension ("srt" | "vtt"). */
    export function parse( text : string, extension : string ) : Array<Media.TranscriptSegment>
    {
        return Captions.parse( text, extension );
    }

    /** Serialize timed segments back to caption text, dispatching on the item's extension ("srt" | "vtt"). */
    export function serialize( segments : Array<Media.TranscriptSegment>, extension : string ) : string
    {
        return Captions.serialize( segments, extension );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // a seconds offset → a short display label for the line list, `M:SS` (or `H:MM:SS` past an hour)
    export function formatDisplay( seconds : number ) : string
    {
        const safe : number = Number.isFinite( seconds ) && seconds > 0 ? seconds : 0;
        const hours : number = Math.floor( safe / 3600 );
        const minutes : number = Math.floor( ( safe % 3600 ) / 60 );
        const wholeSeconds : number = Math.floor( safe % 60 );
        const pad = ( value : number ) : string => String( value ).padStart( 2, "0" );
        return hours > 0 ? `${ hours }:${ pad( minutes ) }:${ pad( wholeSeconds ) }` : `${ minutes }:${ pad( wholeSeconds ) }`;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // the index of the segment active at `time` (its window contains `time`), else the last segment that has
    // already started, else -1 (before the first segment / no segments)
    export function activeIndexAt( segments : Array<Media.TranscriptSegment>, time : number ) : number
    {
        const within : number = segments.findIndex( ( segment : Media.TranscriptSegment ) : boolean => time >= segment.start && time < segment.end );
        if( within !== -1 ) return within;

        let lastStarted : number = -1;
        segments.forEach( ( segment : Media.TranscriptSegment, index : number ) : void =>
        {
            if( segment.start <= time ) lastStarted = index;
        } );
        return lastStarted;
    }
}

export default TranscriptModel;
// eof
