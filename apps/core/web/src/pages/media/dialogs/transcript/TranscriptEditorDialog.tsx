import AppModel from "@model/AppModel";
//
import React from 'react';
import { JSX } from "react";

import { Box, CircularProgress, Stack, Typography } from "@mui/material";

import { Media, GetMediaUrl, PostItemText } from '@repo/api';
import { RestfulService } from '@repo/endpoint';

import DialogWindow from '@widgets/core/DialogWindow';
import VideoInput    from '@widgets/core/VideoInput';
import AudioInput    from '@widgets/core/AudioInput';

import TranscriptModel   from './TranscriptModel';
import TranscriptLineRow from './TranscriptLineRow';

//
// TranscriptEditorDialog — correct a video/audio asset's extracted transcript line-by-line: the timed lines
// on the LEFT (each an editable text field under its start–end window), the original media on the RIGHT.
// Selecting a line seeks the player to its start; playing (or scrubbing) the player scrolls + highlights the
// line whose window contains the current playback position. Save re-serializes the edited lines back to the
// same `.srt`/`.vtt` item (PostItemText writes a new S3 version). Parent owns open/close + passes the item.
//
export function TranscriptEditorDialog( props : TranscriptEditorDialog.Props ) : JSX.Element
{
    const appmodel : AppModel = AppModel.instance();
    const itemKey : string = Media.itemKey( props.item.usage, props.item.profile );

    const [segments,setSegments] = React.useState< Array<Media.TranscriptSegment> >( [] );
    const [mediaUrl,setMediaUrl] = React.useState< string >( "" );
    const [loading,setLoading]   = React.useState< boolean >( true );

    const [activeIndex,setActiveIndex] = React.useState< number >( -1 );
    const [seekTo,setSeekTo]           = React.useState< number >( 0 );
    const [seekNonce,setSeekNonce]     = React.useState< number >( 0 );

    const rowElements : React.MutableRefObject< Record<number, HTMLDivElement | null> > = React.useRef( {} );

    ////////////////////////////////////////////////////////////////////////////////////////////
    React.useEffect( () : void => { void load(); }, [] );

    ////////////////////////////////////////////////////////////////////////////////////////////
    // load the caption text (fetch its signed URL → text, then parse to timed segments) and the ORIGINAL
    // media's playback URL, in parallel
    async function load() : Promise<void>
    {
        setLoading( true );
        const captionReply : RestfulService.Reply<GetMediaUrl.Response> = await appmodel.server.fetch( new GetMediaUrl( props.asset.guid, itemKey ) );
        const mediaReply : RestfulService.Reply<GetMediaUrl.Response> = await appmodel.server.fetch( new GetMediaUrl( props.asset.guid, "original" ) );
        if( captionReply.ok && captionReply.data )
        {
            // withCredentials: false — a presigned S3 URL's wildcard CORS policy rejects a credentialed request
            const textReply : RestfulService.Reply<string> = await appmodel.server.get( captionReply.data.url, null, {}, null, { withCredentials: false } );
            const text : string = textReply.ok && textReply.data !== undefined ? textReply.data : "";
            setSegments( TranscriptModel.parse( text, props.item.extension ) );
        }
        if( mediaReply.ok && mediaReply.data ) setMediaUrl( mediaReply.data.url );
        setLoading( false );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // save the edited segments, re-serialized to the item's original caption format → true on success
    async function onSave() : Promise<boolean>
    {
        const text : string = TranscriptModel.serialize( segments, props.item.extension );
        const reply : RestfulService.Reply<PostItemText.Response> = await appmodel.server.fetch( new PostItemText( props.asset.guid, { item: itemKey, text } ) );
        return props.onSaved( reply.ok );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // a line was selected (clicked) → highlight it and seek the player to its start
    function onSelectLine( index : number ) : void
    {
        const segment : Media.TranscriptSegment | undefined = segments[ index ];
        if( !segment ) return;
        setActiveIndex( index );
        setSeekTo( segment.start );
        setSeekNonce( ( prior : number ) : number => prior + 1 );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // an edit to one line's text — replace it immutably at its index
    function onLineTextChange( index : number, text : string ) : void
    {
        setSegments( ( prior : Array<Media.TranscriptSegment> ) : Array<Media.TranscriptSegment> =>
            prior.map( ( segment : Media.TranscriptSegment, candidate : number ) : Media.TranscriptSegment =>
                candidate === index ? { ...segment, text } : segment ) );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // the player reported its playback position → find + highlight the line whose window contains it, and
    // scroll that line into view (a scrub/seek moves this same way, since it's just another time update)
    function onPlaybackTime( time : number ) : void
    {
        const index : number = TranscriptModel.activeIndexAt( segments, time );
        if( index === activeIndex ) return;
        setActiveIndex( index );
        const element : HTMLDivElement | null | undefined = rowElements.current[ index ];
        if( element ) element.scrollIntoView( { behavior: "smooth", block: "nearest" } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // the source media player on the right (video for a video envelope, else the audio player), wired to
    // report playback position + accept seek requests from the line list
    function player() : JSX.Element
    {
        if( !mediaUrl ) return <Typography variant="body2" sx={{ color: "text.secondary" }}>{"Media unavailable."}</Typography>;
        if( props.asset.kind === Media.Kind.VIDEO )
            return  <VideoInput id="transcript-video" value={ mediaUrl } maxWidth="100%" width="100%"
                                onTimeUpdate={ onPlaybackTime } seekTo={ seekTo } seekNonce={ seekNonce } />;
        return  <AudioInput id="transcript-audio" value={ mediaUrl } width="100%"
                           onTimeUpdate={ onPlaybackTime } seekTo={ seekTo } seekNonce={ seekNonce } />;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // the left panel's scrollable line list
    function lines() : JSX.Element
    {
        if( segments.length === 0 ) return <Typography variant="body2" sx={{ color: "text.secondary", p: 1 }}>{"No timed lines were found in this transcript."}</Typography>;
        return  <Stack spacing={ 0.5 } sx={{ maxHeight: 480, overflowY: "auto", pr: 1 }}>
                    { segments.map( ( segment : Media.TranscriptSegment, index : number ) : JSX.Element =>
                        <TranscriptLineRow key={ index } segment={ segment } index={ index } active={ index === activeIndex }
                                          rowRef={ ( element : HTMLDivElement | null ) => { rowElements.current[ index ] = element; } }
                                          onSelect={ onSelectLine } onTextChange={ onLineTextChange } /> ) }
                </Stack>;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    return  <DialogWindow id="media-transcript-editor"
                          title={ `Edit transcript — ${ props.item.extension.toUpperCase() }` }
                          yesLabel={"Save"}
                          cancelLabel={"Cancel"}
                          minWidth="lg"
                          onYes={ onSave }
                          onClose={ props.onClose }>
                { loading
                    ? <Stack direction="row" spacing={ 1 } sx={{ alignItems: "center", p: 3 }}><CircularProgress size={ 18 } /><Typography variant="body2" sx={{ color: "text.secondary" }}>{"Loading…"}</Typography></Stack>
                    : <Stack direction="row" spacing={ 2 } sx={{ p: 2, alignItems: "flex-start" }}>
                          {/* left: the timed, editable transcript lines */}
                          <Box sx={{ flex: 1, minWidth: 0 }}>
                              { lines() }
                          </Box>
                          {/* right: the source media to play + compare, sticky while the lines scroll */}
                          <Box sx={{ width: 420, flexShrink: 0, position: "sticky", top: 0 }}>
                              { player() }
                          </Box>
                      </Stack> }
            </DialogWindow>;
}

export namespace TranscriptEditorDialog
{
    export interface Props
    {
        asset   : Media.Asset;
        item    : Media.Item;                        // the .srt / .vtt (text) item being edited
        onSaved : ( ok : boolean ) => boolean;       // report result to parent; return true to close
        onClose : () => void;
    }
}

export default TranscriptEditorDialog;
// eof
