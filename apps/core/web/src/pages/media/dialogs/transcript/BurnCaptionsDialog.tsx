import AppModel from "@model/AppModel";
//
import React from 'react';
import { JSX } from "react";

import { Box, CircularProgress, Divider, Stack, Typography } from "@mui/material";

import { Media, GetMediaUrl, PostAssetBurnCaptions, StudioProject } from '@repo/api';
import { RestfulService } from '@repo/endpoint';

import DialogWindow from '@widgets/core/DialogWindow';
import VideoInput    from '@widgets/core/VideoInput';
import SelectInput   from '@widgets/core/SelectInput';
import SwitchInput   from '@widgets/core/SwitchInput';
import ColorPicker   from '@widgets/core/ColorPicker';

import StudioClipInspector from '@pages/media/studio/video/StudioClipInspector';
import TranscriptModel     from './TranscriptModel';

//
// BurnCaptionsDialog — burn a video's (corrected) transcript onto the video itself: pick a style (font,
// color, outline, background, position/size) on the LEFT, preview it live over the playing video on the
// RIGHT (a CSS approximation of the real ffmpeg burn — sufficient to judge the choices before committing to
// the async render), then Generate queues the actual burn (`PostAssetBurnCaptions`), which saves a new
// `Usage.CAPTIONED` item on the SAME asset once the job completes. Parent owns open/close + passes the item.
//
export function BurnCaptionsDialog( props : BurnCaptionsDialog.Props ) : JSX.Element
{
    const appmodel : AppModel = AppModel.instance();
    const itemKey : string = Media.itemKey( props.item.usage, props.item.profile );

    const [segments,setSegments] = React.useState< Array<Media.TranscriptSegment> >( [] );
    const [mediaUrl,setMediaUrl] = React.useState< string >( "" );
    const [loading,setLoading]   = React.useState< boolean >( true );

    const [time,setTime]             = React.useState< number >( 0 );
    const [containerHeight,setContainerHeight] = React.useState< number >( 0 );
    const containerRef : React.RefObject<HTMLDivElement | null> = React.useRef<HTMLDivElement>( null );

    // style picks — mirror StudioClipInspector's TextStyle controls, plus a simplified position/size for a
    // caption bar (not the full relative-geometry editor)
    const [fontFamily,setFontFamily] = React.useState< StudioProject.TextFont >( StudioProject.TextFont.SANS );
    const [bold,setBold]             = React.useState< boolean >( true );
    const [color,setColor]           = React.useState< string >( "#ffffff" );
    const [outlineOn,setOutlineOn]   = React.useState< boolean >( true );
    const [outlineColor,setOutlineColor] = React.useState< string >( "#000000" );
    const [bgOn,setBgOn]             = React.useState< boolean >( false );
    const [bgColor,setBgColor]       = React.useState< string >( "#000000" );
    const [position,setPosition]     = React.useState< "top" | "bottom" >( "bottom" );
    const [size,setSize]             = React.useState< BurnCaptionsDialog.Size >( "medium" );

    ////////////////////////////////////////////////////////////////////////////////////////////
    React.useEffect( () : void => { void load(); }, [] );
    React.useEffect( measureContainer, [ mediaUrl ] );

    ////////////////////////////////////////////////////////////////////////////////////////////
    // load the caption text (→ timed segments) and the ORIGINAL video's playback URL, in parallel
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
    // track the preview video's rendered height (the preview overlay's font size is relative to it)
    function measureContainer() : ( () => void ) | void
    {
        const element : HTMLDivElement | null = containerRef.current;
        if( !element ) return;
        const observer : ResizeObserver = new ResizeObserver( () : void => setContainerHeight( element.clientHeight ) );
        observer.observe( element );
        return () : void => observer.disconnect();
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // the font size (px) a style's fontPct maps to, given the SIZE choice and the preview's measured height
    function fontPctFor( sizeChoice : BurnCaptionsDialog.Size ) : number
    {
        if( sizeChoice === "small" ) return 0.035;
        if( sizeChoice === "large" ) return 0.06;
        if( sizeChoice === "extra-large" ) return 0.08;
        return 0.045;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // the TextStyle the request/preview both build from the current picks
    function buildStyle() : StudioProject.TextStyle
    {
        return {
            fontFamily, bold, color, shadow: true,
            outline: outlineOn ? { color: outlineColor, widthPct: 0.04 } : undefined,
            background: bgOn ? { color: bgColor, opacity: 0.5, padPct: 0.35 } : undefined,
        };
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // queue the actual burn-in job → true on success (dialog closes)
    async function onGenerate() : Promise<boolean>
    {
        const reply : RestfulService.Reply<PostAssetBurnCaptions.Response> = await appmodel.server.fetch(
            new PostAssetBurnCaptions( props.asset.guid, { transcriptItem: itemKey, style: buildStyle(), position, fontPct: fontPctFor( size ) } ) );
        return props.onQueued( reply.ok );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // the style controls (left column) — the same widgets/palette StudioClipInspector's text style uses
    function styleControls() : JSX.Element
    {
        return  <Stack spacing={ 1.5 } sx={{ width: 260, flexShrink: 0 }}>
                    <SelectInput id="burn-position" label={"Position"} value={ position }
                                 choices={ [ { value: "bottom", label: "Bottom" }, { value: "top", label: "Top" } ] }
                                 onChange={ ( value : string ) : void => setPosition( value as "top" | "bottom" ) } />
                    <SelectInput id="burn-size" label={"Size"} value={ size }
                                 choices={ [ { value: "small", label: "Small" }, { value: "medium", label: "Medium" }, { value: "large", label: "Large" }, { value: "extra-large", label: "Extra large" } ] }
                                 onChange={ ( value : string ) : void => setSize( value as BurnCaptionsDialog.Size ) } />

                    <Divider textAlign="left"><Typography variant="caption" sx={{ color: "text.secondary" }}>{"Style"}</Typography></Divider>
                    <SelectInput id="burn-font-family" label={"Font"} value={ fontFamily }
                                 choices={ StudioClipInspector.FONT_CHOICES } onChange={ ( value : string ) : void => setFontFamily( value as StudioProject.TextFont ) } />
                    <Stack direction="row" spacing={ 1 } sx={{ alignItems: "center", justifyContent: "flex-start" }}>
                        <SwitchInput id="burn-bold" label={"Bold"} value={ bold } onChange={ setBold } />
                        <ColorPicker id="burn-color" label={"Fill"} value={ color } choices={ StudioClipInspector.TEXT_COLORS } onChange={ setColor } />
                    </Stack>
                    <Stack direction="row" spacing={ 1 } sx={{ alignItems: "center", justifyContent: "flex-start" }}>
                        <SwitchInput id="burn-outline" label={"Outline"} value={ outlineOn } onChange={ setOutlineOn } />
                        <ColorPicker id="burn-outline-color" label={"Outline color"} value={ outlineColor } choices={ StudioClipInspector.TEXT_COLORS } onChange={ setOutlineColor } disabled={ !outlineOn } />
                    </Stack>

                    <Divider textAlign="left"><Typography variant="caption" sx={{ color: "text.secondary" }}>{"Background"}</Typography></Divider>
                    <Stack direction="row" spacing={ 1 } sx={{ alignItems: "center", justifyContent: "flex-start" }}>
                        <SwitchInput id="burn-bg" label={"Background"} value={ bgOn } onChange={ setBgOn } />
                        <ColorPicker id="burn-bg-color" label={"Background color"} value={ bgColor } choices={ StudioClipInspector.TEXT_COLORS } onChange={ setBgColor } disabled={ !bgOn } />
                    </Stack>
                </Stack>;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // the active caption line's preview overlay — a CSS approximation of the chosen style, positioned top/bottom
    function captionOverlay() : JSX.Element | null
    {
        const activeIndex : number = TranscriptModel.activeIndexAt( segments, time );
        const text : string = activeIndex >= 0 ? segments[ activeIndex ].text : "";
        if( !text || containerHeight === 0 ) return null;
        const fontSizePx : number = Math.max( 10, Math.round( fontPctFor( size ) * containerHeight ) );
        return  <Box sx={{ position: "absolute", left: "4%", right: "4%", textAlign: "center",
                           [ position === "top" ? "top" : "bottom" ]: "6%", pointerEvents: "none" }}>
                    <Typography component="span" sx={{
                        display: "inline-block", fontFamily, fontWeight: bold ? 700 : 400, fontSize: fontSizePx, color,
                        textShadow: "0 1px 3px rgba(0,0,0,0.6)",
                        WebkitTextStroke: outlineOn ? `${ Math.max( 1, Math.round( fontSizePx * 0.04 ) ) }px ${ outlineColor }` : undefined,
                        bgcolor: bgOn ? `${ bgColor }80` : undefined,
                        px: bgOn ? 1.5 : 0, py: bgOn ? 0.5 : 0, borderRadius: bgOn ? 1 : 0 }}>
                        { text }
                    </Typography>
                </Box>;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // the preview column (right) — the video, with the styled caption overlay on top
    function preview() : JSX.Element
    {
        if( !mediaUrl ) return <Typography variant="body2" sx={{ color: "text.secondary" }}>{"Media unavailable."}</Typography>;
        return  <Box ref={ containerRef } sx={{ position: "relative", width: "100%" }}>
                    <VideoInput id="burn-preview-video" value={ mediaUrl } maxWidth="100%" width="100%" onTimeUpdate={ setTime } />
                    { captionOverlay() }
                </Box>;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    return  <DialogWindow id="media-burn-captions"
                          title={"Burn captions into video"}
                          yesLabel={"Generate"}
                          cancelLabel={"Cancel"}
                          minWidth="lg"
                          onYes={ onGenerate }
                          onClose={ props.onClose }>
                { loading
                    ? <Stack direction="row" spacing={ 1 } sx={{ alignItems: "center", p: 3 }}><CircularProgress size={ 18 } /><Typography variant="body2" sx={{ color: "text.secondary" }}>{"Loading…"}</Typography></Stack>
                    : segments.length === 0
                    ? <Typography variant="body2" sx={{ color: "text.secondary", p: 2 }}>{"No timed lines were found in this transcript."}</Typography>
                    : <Stack direction="row" spacing={ 2 } sx={{ p: 2, alignItems: "flex-start" }}>
                          { styleControls() }
                          <Box sx={{ flex: 1, minWidth: 0 }}>
                              { preview() }
                          </Box>
                      </Stack> }
            </DialogWindow>;
}

export namespace BurnCaptionsDialog
{
    export type Size = "small" | "medium" | "large" | "extra-large";

    export interface Props
    {
        asset    : Media.Asset;
        item     : Media.Item;                        // the .srt / .vtt transcript item to burn in
        onQueued : ( ok : boolean ) => boolean;       // report result to parent; return true to close
        onClose  : () => void;
    }
}

export default BurnCaptionsDialog;
// eof
