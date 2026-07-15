import AppModel from "@model/AppModel";
//
import React from 'react';
import { JSX } from "react";

import { Box, CircularProgress, Stack, Typography } from "@mui/material";

import { Media, GetMediaUrl, PostItemText } from '@repo/api';
import { RestfulService } from '@repo/endpoint';

import DialogWindow from '@widgets/core/DialogWindow';
import TextInput    from '@widgets/core/TextInput';
import VideoInput   from '@widgets/core/VideoInput';
import AudioInput   from '@widgets/core/AudioInput';

//
// CaptionEditorDialog — edit an item's .srt/.vtt captions with the source media beside them: the editable
// caption text on the LEFT, the original video (or audio) on the RIGHT, so you can play + compare while
// editing, then Save (PostItemText writes a new S3 version). Parent owns open/close + passes the caption item.
//
export function CaptionEditorDialog( props : CaptionEditorDialog.Props ) : JSX.Element
{
    const appmodel : AppModel = AppModel.instance();
    const itemKey : string = Media.itemKey( props.item.usage, props.item.profile );

    const [text,setText]       = React.useState< string >( "" );
    const [mediaUrl,setMediaUrl] = React.useState< string >( "" );
    const [loading,setLoading] = React.useState< boolean >( true );

    ////////////////////////////////////////////////////////////////////////////////////////////
    React.useEffect( () : void => { void load(); }, [] );

    ////////////////////////////////////////////////////////////////////////////////////////////
    // load the caption text (fetch its signed URL → text) and the ORIGINAL media's playback URL, in parallel
    async function load() : Promise<void>
    {
        setLoading( true );
        const captionReply : RestfulService.Reply<GetMediaUrl.Response> = await appmodel.server.fetch( new GetMediaUrl( props.asset.guid, itemKey ) );
        const mediaReply : RestfulService.Reply<GetMediaUrl.Response> = await appmodel.server.fetch( new GetMediaUrl( props.asset.guid, "original" ) );
        if( captionReply.ok && captionReply.data )
        {
            try { const response : Response = await fetch( captionReply.data.url ); setText( await response.text() ); }
            catch { setText( "" ); }
        }
        if( mediaReply.ok && mediaReply.data ) setMediaUrl( mediaReply.data.url );
        setLoading( false );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // save the edited caption text → true on success (dialog closes)
    async function onSave() : Promise<boolean>
    {
        const reply : RestfulService.Reply<PostItemText.Response> = await appmodel.server.fetch( new PostItemText( props.asset.guid, { item: itemKey, text } ) );
        return props.onSaved( reply.ok );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // the source media player on the right (video for a video envelope, else the audio player)
    function player() : JSX.Element
    {
        if( !mediaUrl ) return <Typography variant="body2" sx={{ color: "text.secondary" }}>{"Media unavailable."}</Typography>;
        if( props.asset.kind === Media.Kind.VIDEO ) return <VideoInput id="caption-video" value={ mediaUrl } maxWidth="100%" />;
        return <AudioInput id="caption-audio" value={ mediaUrl } width="100%" />;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    return  <DialogWindow id="media-caption-editor"
                          title={ `Edit captions — ${ props.item.extension.toUpperCase() }` }
                          yesLabel={"Save"}
                          cancelLabel={"Cancel"}
                          minWidth="lg"
                          onYes={ onSave }
                          onClose={ props.onClose }>
                { loading
                    ? <Stack direction="row" spacing={ 1 } sx={{ alignItems: "center", p: 3 }}><CircularProgress size={ 18 } /><Typography variant="body2" sx={{ color: "text.secondary" }}>{"Loading…"}</Typography></Stack>
                    : <Stack direction="row" spacing={ 2 } sx={{ p: 2, alignItems: "flex-start" }}>
                          {/* left: editable caption text */}
                          <Box sx={{ flex: 1, minWidth: 0 }}>
                              <TextInput id="caption-text" label={ `${ props.item.extension.toUpperCase() } captions` } value={ text } onChange={ setText }
                                         multiline maxRows={ 24 } fullWidth
                                         sx={{ "& textarea": { minHeight: 380, fontFamily: "monospace", fontSize: 13, lineHeight: 1.5 } }} />
                          </Box>
                          {/* right: the source media to play + compare */}
                          <Box sx={{ width: 420, flexShrink: 0, position: "sticky", top: 0 }}>
                              { player() }
                          </Box>
                      </Stack> }
            </DialogWindow>;
}

export namespace CaptionEditorDialog
{
    export interface Props
    {
        asset   : Media.Asset;
        item    : Media.Item;                        // the .srt / .vtt (text) item being edited
        onSaved : ( ok : boolean ) => boolean;       // report result to parent; return true to close
        onClose : () => void;
    }
}

export default CaptionEditorDialog;
// eof
