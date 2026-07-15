import React from 'react';
import { JSX } from "react";

import { Box, Button, Divider, Stack, Typography } from "@mui/material";
import DeleteOutlineOutlinedIcon from '@mui/icons-material/DeleteOutlineOutlined';
import ImageOutlinedIcon        from '@mui/icons-material/ImageOutlined';
import SubtitlesOutlinedIcon    from '@mui/icons-material/SubtitlesOutlined';
import MusicNoteOutlinedIcon    from '@mui/icons-material/MusicNoteOutlined';

import { StudioProject } from '@repo/api';

import TextInput       from '@widgets/core/TextInput';
import SelectInput     from '@widgets/core/SelectInput';
import SelectMultInput from '@widgets/core/SelectMultInput';
import SwitchInput     from '@widgets/core/SwitchInput';
import SliderInput     from '@widgets/core/SliderInput';
import ColorPicker     from '@widgets/core/ColorPicker';
import AccordionSection from '@widgets/core/AccordionSection';

//
// StudioClipInspector — the right-hand properties panel of the video editor. With a clip SELECTED it edits that
// clip's timing (start / duration), track placement, and kind-specific properties (text content + relative
// position/size/alignment for TEXT; trim + volume for VIDEO/AUDIO). With NOTHING selected it shows composition-
// wide settings (master format + destination variants). Controlled — every change is reported up to the editor.
//
export function StudioClipInspector( props : StudioClipInspector.Props ) : JSX.Element
{
    const clip : StudioProject.TimelineClip | null = props.clip;
    const tracks : Array<StudioProject.TimelineTrack> = props.doc.tracks ?? [];

    // which inspector accordion section is open (exclusive; null = all collapsed)
    const [ section, setSection ] = React.useState< string | null >( "sec-main" );

    // wrap a group of controls in a collapsible section (the side panel is split into these)
    function accordion( id : string, primary : string, body : JSX.Element ) : JSX.Element
    {
        return  <AccordionSection id={ id } selected={ section } primary={ primary } onClick={ setSection }>
                    <Stack spacing={ 2 } sx={{ p: 1.5, width: "100%" }}>{ body }</Stack>
                </AccordionSection>;
    }

    //////////////////////////////////////////////////////////////////////
    // parse a numeric field, clamping to a floor (invalid input keeps the floor)
    function num( value : string, floor : number ) : number
    {
        const parsed : number = Number.parseFloat( value );
        return Number.isFinite( parsed ) ? Math.max( floor, parsed ) : floor;
    }

    // parse + quantize to one decimal place (0.1 precision) — used by the fade inputs
    function oneDecimal( value : string ) : number { return Math.round( num( value, 0 ) * 10 ) / 10; }

    // round a second value to the nearest whole frame (1/fps) — clip times live on the frame grid, so the
    // render (which rounds to frames anyway) and the timeline stay frame-accurate
    function toFrame( seconds : number ) : number
    {
        const fps : number = Math.max( 1, props.doc.fps );
        return Math.round( seconds * fps ) / fps;
    }

    // display a second value snapped to the frame grid, trimming trailing zeros so the field shows a clean
    // frame-accurate time (e.g. "5.433" at 30fps, not "5.4333333") instead of a raw source-derived float
    function frameSec( seconds : number ) : string
    {
        const snapped : number = toFrame( seconds );
        return snapped.toFixed( 3 ).replace( /\.?0+$/, "" );
    }

    //////////////////////////////////////////////////////////////////////
    // apply a change to the selected clip
    function change( patch : Partial<StudioProject.TimelineClip> ) : void
    {
        if( clip === null ) return;
        props.onChangeClip( clip.id, patch );
    }

    // merge a patch into the selected TEXT clip's style (preserving the other style fields)
    function patchStyle( selected : StudioProject.TimelineClip, patch : Partial<StudioProject.TextStyle> ) : void
    {
        const merged : StudioProject.TextStyle = { ...( selected.style ?? {} ), ...patch };
        change( { style: merged } );
    }

    // merge a patch into the doc's watermark (no-op if none is set yet — the asset is picked first)
    function patchWatermark( patch : Partial<StudioProject.Watermark> ) : void
    {
        if( props.watermark === undefined ) return;
        props.onSetWatermark( { ...props.watermark, ...patch } );
    }

    // slider handlers narrow the number|number[] union to the single value the slider emits
    function setWatermarkScale( value : number | Array<number> ) : void
    { if( typeof value === "number" ) patchWatermark( { scalePct: value } ); }
    function setWatermarkOpacity( value : number | Array<number> ) : void
    { if( typeof value === "number" ) patchWatermark( { opacity: value } ); }

    // entry-transition controls (a named transition INTO this clip that overlaps the previous one)
    const transitionChoices : Array<SelectInput.Choice> = [ { value: "", label: "None" },
        ...Object.values( StudioProject.TransitionType ).map( ( type : StudioProject.TransitionType ) : SelectInput.Choice => ( { value: type, label: StudioClipInspector.TRANSITION_LABELS[ type ] ?? type } ) ) ];
    function setTransitionType( value : string ) : void
    {
        if( clip === null ) return;
        if( value === "" ) change( { transitionIn: undefined } );
        else change( { transitionIn: { type: value as StudioProject.TransitionType, durationSec: clip.transitionIn?.durationSec ?? 0.5 } } );
    }
    function setTransitionDuration( value : string ) : void
    {
        if( clip?.transitionIn === undefined ) return;
        change( { transitionIn: { type: clip.transitionIn.type, durationSec: oneDecimal( value ) } } );
    }

    // text entry-animation controls (an animation the text plays IN over the clip's first `durationSec`)
    const animateChoices : Array<SelectInput.Choice> = [ { value: "", label: "None" },
        ...Object.values( StudioProject.TextAnimation ).map( ( type : StudioProject.TextAnimation ) : SelectInput.Choice => ( { value: type, label: StudioClipInspector.TEXT_ANIM_LABELS[ type ] ?? type } ) ) ];
    function setAnimateInType( value : string ) : void
    {
        if( clip === null ) return;
        if( value === "" ) change( { animateIn: undefined } );
        else change( { animateIn: { type: value as StudioProject.TextAnimation, durationSec: clip.animateIn?.durationSec ?? 0.5 } } );
    }
    function setAnimateInDuration( value : string ) : void
    {
        if( clip?.animateIn === undefined ) return;
        change( { animateIn: { type: clip.animateIn.type, durationSec: oneDecimal( value ) } } );
    }

    // per-clip visual transform (IMAGE/VIDEO): merge a patch into the selected clip's transform
    function patchTransform( patch : Partial<StudioProject.ClipTransform> ) : void
    {
        if( clip === null ) return;
        change( { transform: { ...( clip.transform ?? {} ), ...patch } } );
    }

    // slider handlers narrow the number|number[] union to the single value each slider emits
    function setTransformScale( value : number | Array<number> ) : void
    { if( typeof value === "number" ) patchTransform( { scale: value } ); }
    function setTransformRotation( value : number | Array<number> ) : void
    { if( typeof value === "number" ) patchTransform( { rotation: value } ); }
    function setTransformOpacity( value : number | Array<number> ) : void
    { if( typeof value === "number" ) patchTransform( { opacity: value } ); }
    function setTransformX( value : number | Array<number> ) : void
    { if( typeof value === "number" ) patchTransform( { xPct: value } ); }
    function setTransformY( value : number | Array<number> ) : void
    { if( typeof value === "number" ) patchTransform( { yPct: value } ); }

    // Ken Burns preset select — "" clears it, otherwise apply the named preset's from/to values
    function setKenBurns( key : string ) : void
    {
        if( clip === null ) return;
        if( key === "" ) { change( { kenBurns: undefined } ); return; }
        const preset : StudioProject.KenBurnsPreset | undefined = StudioProject.KEN_BURNS_PRESETS.find( ( entry : StudioProject.KenBurnsPreset ) : boolean => entry.key === key );
        if( preset !== undefined ) change( { kenBurns: { ...preset.value } } );
    }

    // per-clip color EFFECTS (IMAGE/VIDEO): merge a patch into the selected clip's filters
    function patchFilters( patch : Partial<StudioProject.ClipFilters> ) : void
    {
        if( clip === null ) return;
        change( { filters: { ...( clip.filters ?? {} ), ...patch } } );
    }

    // slider handlers narrow the number|number[] union to the single value each slider emits
    function setBrightness( value : number | Array<number> ) : void
    { if( typeof value === "number" ) patchFilters( { brightness: value } ); }
    function setContrast( value : number | Array<number> ) : void
    { if( typeof value === "number" ) patchFilters( { contrast: value } ); }
    function setSaturation( value : number | Array<number> ) : void
    { if( typeof value === "number" ) patchFilters( { saturation: value } ); }
    function setBlur( value : number | Array<number> ) : void
    { if( typeof value === "number" ) patchFilters( { blur: value } ); }

    // playback speed (slow-mo / fast-motion) for a video/audio clip
    function setSpeed( value : number | Array<number> ) : void
    { if( typeof value === "number" ) change( { speed: value } ); }

    // SHAPE (SVG overlay): merge a patch into the clip's shapeStyle (fill / stroke recolor)
    function patchShape( patch : Partial<StudioProject.ShapeStyle> ) : void
    {
        if( clip === null ) return;
        change( { shapeStyle: { ...( clip.shapeStyle ?? {} ), ...patch } } );
    }
    // stroke on/off — seeds a sensible width + color when enabled, 0 when off
    function toggleShapeStroke( on : boolean ) : void
    { patchShape( { strokeWidth: on ? ( ( clip?.shapeStyle?.strokeWidth ?? 0 ) > 0 ? clip?.shapeStyle?.strokeWidth : 3 ) : 0, stroke: clip?.shapeStyle?.stroke ?? "#000000" } ); }
    function setShapeStrokeWidth( value : number | Array<number> ) : void
    { if( typeof value === "number" ) patchShape( { strokeWidth: value } ); }

    // map the selected clip's Ken Burns values back to a preset key (for the select's value); "" if none/custom
    function kenBurnsPresetKey() : string
    {
        const current : StudioProject.KenBurns | undefined = clip?.kenBurns;
        if( current === undefined ) return "";
        const match : StudioProject.KenBurnsPreset | undefined = StudioProject.KEN_BURNS_PRESETS.find( ( entry : StudioProject.KenBurnsPreset ) : boolean =>
            entry.value.fromScale === current.fromScale && entry.value.toScale === current.toScale
            && entry.value.fromXPct === current.fromXPct && entry.value.toXPct === current.toXPct
            && entry.value.fromYPct === current.fromYPct && entry.value.toYPct === current.toYPct );
        return match?.key ?? "";
    }

    // the longest a clip may run from a given in-point — capped by the source length for time-based media
    function maxDuration( selected : StudioProject.TimelineClip, trimStartSec : number ) : number
    {
        if( selected.sourceDurationSec === undefined ) return Number.POSITIVE_INFINITY;
        return Math.max( 0.1, selected.sourceDurationSec - trimStartSec );
    }

    // set the duration, clamped so a video/audio clip never exceeds what remains of its source
    function setDuration( selected : StudioProject.TimelineClip, requested : number ) : void
    { change( { durationSec: Math.min( requested, maxDuration( selected, selected.trimStartSec ?? 0 ) ) } ); }

    // set the trim in-point, clamped to the source; also re-cap the duration to what remains after the new in-point
    function setTrim( selected : StudioProject.TimelineClip, requested : number ) : void
    {
        const trimStartSec : number = selected.sourceDurationSec !== undefined ? Math.min( requested, Math.max( 0, selected.sourceDurationSec - 0.1 ) ) : requested;
        change( { trimStartSec, durationSec: Math.min( selected.durationSec, maxDuration( selected, trimStartSec ) ) } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // composition settings shown when nothing is selected (master format + auto-generated destinations)
    function compositionSettings() : JSX.Element
    {
        return  <Stack spacing={ 2 }>
                    <Typography variant="subtitle2">{"Composition"}</Typography>
                    <SelectInput id="insp-format" label={"Format"} value={ StudioProject.videoFormatFor( props.doc )?.key ?? "" } disabled={ props.readonly }
                                 choices={ StudioProject.VIDEO_FORMATS.map( ( format : StudioProject.VideoFormat ) : SelectInput.Choice => ( { value: format.key, label: format.label } ) ) }
                                 onChange={ props.onSetFormat } />
                    <SelectMultInput id="insp-targets" label={"Destinations"} value={ props.doc.targets ?? [] } disabled={ props.readonly }
                                     choices={ StudioProject.VIDEO_FORMATS.map( ( format : StudioProject.VideoFormat ) : SelectMultInput.Choice => ( { value: format.key, label: format.label } ) ) }
                                     onChange={ props.onSetTargets } />
                    {/* export encode quality (crf/preset) — trades render time + size for quality; export-only */}
                    <SelectInput id="insp-quality" label={"Export quality"} value={ props.doc.quality ?? StudioProject.VideoQuality.STANDARD } disabled={ props.readonly }
                                 choices={ StudioClipInspector.QUALITY_CHOICES } onChange={ props.onSetQuality } />
                    {/* explicit target bitrate (kbps); 0 = use the quality preset's CRF */}
                    <TextInput id="insp-bitrate" label={"Bitrate (kbps, 0 = auto)"} value={ String( props.doc.bitrateKbps ?? 0 ) } onChange={ ( value : string ) : void => props.onSetBitrate( num( value, 0 ) ) } allNumeric fullWidth />
                    {/* export extras: a poster frame + an animated GIF of the render */}
                    <Stack direction="row" spacing={ 1 } sx={{ alignItems: "center" }}>
                        <SwitchInput id="insp-poster" label={"Poster @ playhead"} value={ props.doc.posterSec !== undefined } onChange={ props.onTogglePoster } />
                        <SwitchInput id="insp-gif" label={"Also export GIF"} value={ props.doc.gif === true } onChange={ ( on : boolean ) : void => props.onSetGif( on ) } />
                    </Stack>
                    <Typography variant="caption" sx={{ color: "text.secondary" }}>{ `${ props.doc.width } × ${ props.doc.height } @ ${ props.doc.fps }fps` }</Typography>

                    {/* logo / watermark — a persistent overlay burned over the whole timeline (top-most) */}
                    <Divider textAlign="left"><Typography variant="caption" sx={{ color: "text.secondary" }}>{"Watermark"}</Typography></Divider>
                    { props.watermark === undefined
                        ? <Button size="small" variant="outlined" startIcon={ <ImageOutlinedIcon /> } disabled={ props.readonly } onClick={ props.onPickWatermark }>{"Add logo / watermark"}</Button>
                        : watermarkFields( props.watermark ) }

                    <Typography variant="caption" sx={{ color: "text.disabled" }}>{"Select a clip on the timeline to edit its properties."}</Typography>
                </Stack>;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // the logo/watermark controls (shown once an image is chosen): preview + corner / size / opacity + actions
    function watermarkFields( watermark : StudioProject.Watermark ) : JSX.Element
    {
        return  <>
                    { watermark.src !== undefined &&
                        <Box component="img" src={ watermark.src } sx={{ maxWidth: "100%", maxHeight: 80, objectFit: "contain", bgcolor: "action.selected", borderRadius: 1, p: 0.5 }} /> }
                    <SelectInput id="insp-wm-corner" label={"Corner"} value={ watermark.corner } disabled={ props.readonly }
                                 choices={ StudioClipInspector.WATERMARK_CORNERS } onChange={ ( value : string ) : void => patchWatermark( { corner: value as StudioProject.WatermarkCorner } ) } />
                    <SliderInput id="insp-wm-scale" label={"Size"} value={ watermark.scalePct } min={ 0.05 } max={ 0.5 } step={ 0.01 } isPercent labelPlacement="top" disabled={ props.readonly } onChange={ setWatermarkScale } />
                    <SliderInput id="insp-wm-opacity" label={"Opacity"} value={ watermark.opacity } min={ 0 } max={ 1 } step={ 0.05 } isPercent labelPlacement="top" disabled={ props.readonly } onChange={ setWatermarkOpacity } />
                    <Stack direction="row" spacing={ 1 }>
                        <Button size="small" disabled={ props.readonly } onClick={ props.onPickWatermark }>{"Replace"}</Button>
                        <Button size="small" color="error" disabled={ props.readonly } onClick={ () : void => props.onSetWatermark( undefined ) }>{"Remove"}</Button>
                    </Stack>
                </>;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // text-clip specific properties (content + relative geometry)
    function textFields( selected : StudioProject.TimelineClip ) : JSX.Element
    {
        return  <>
                    <TextInput id="insp-text" label={"Text"} value={ selected.text ?? "" } onChange={ ( value : string ) : void => change( { text: value } ) } fullWidth />
                    <SelectInput id="insp-align" label={"Alignment"} value={ selected.align ?? "center" } disabled={ props.readonly }
                                 choices={ StudioClipInspector.ALIGNMENTS.map( ( entry : StudioClipInspector.Choice ) : SelectInput.Choice => ( { value: entry.value, label: entry.label } ) ) }
                                 onChange={ ( value : string ) : void => change( { align: value as "left" | "center" | "right" } ) } />
                    <TextInput id="insp-font" label={"Font size (% of height)"} value={ String( Math.round( ( selected.fontPct ?? StudioProject.DEFAULT_TEXT_GEOMETRY.fontPct ) * 100 ) ) }
                               onChange={ ( value : string ) : void => change( { fontPct: num( value, 1 ) / 100 } ) } allNumeric fullWidth />
                    <Stack direction="row" spacing={ 1 }>
                        <TextInput id="insp-x" label={"X (%)"} value={ String( Math.round( ( selected.xPct ?? 0.5 ) * 100 ) ) } onChange={ ( value : string ) : void => change( { xPct: num( value, 0 ) / 100 } ) } allNumeric fullWidth />
                        <TextInput id="insp-y" label={"Y (%)"} value={ String( Math.round( ( selected.yPct ?? 0.5 ) * 100 ) ) } onChange={ ( value : string ) : void => change( { yPct: num( value, 0 ) / 100 } ) } allNumeric fullWidth />
                    </Stack>

                    {/* text styling — stacked VERTICALLY so nothing runs off the narrow panel (font / fill / shadow / outline) */}
                    <Divider textAlign="left"><Typography variant="caption" sx={{ color: "text.secondary" }}>{"Style"}</Typography></Divider>
                    <SelectInput id="insp-font-family" label={"Font"} value={ selected.style?.fontFamily ?? StudioProject.TextFont.SANS } disabled={ props.readonly }
                                 choices={ StudioClipInspector.FONT_CHOICES } onChange={ ( value : string ) : void => patchStyle( selected, { fontFamily: value as StudioProject.TextFont } ) } sx={{ width: "100%" }} />
                    <SwitchInput id="insp-bold" label={"Bold"} value={ selected.style?.bold !== false } onChange={ ( on : boolean ) : void => patchStyle( selected, { bold: on } ) } />
                    <ColorPicker id="insp-color" label={"Fill"} value={ selected.style?.color ?? "#ffffff" } choices={ StudioClipInspector.TEXT_COLORS } onChange={ ( color : string ) : void => patchStyle( selected, { color } ) } />
                    <SwitchInput id="insp-shadow" label={"Shadow"} value={ selected.style?.shadow !== false } onChange={ ( on : boolean ) : void => patchStyle( selected, { shadow: on } ) } />
                    <SwitchInput id="insp-outline" label={"Outline"} value={ selected.style?.outline !== undefined } onChange={ ( on : boolean ) : void => patchStyle( selected, { outline: on ? { color: selected.style?.outline?.color ?? "#000000", widthPct: selected.style?.outline?.widthPct ?? 0.04 } : undefined } ) } />
                    { selected.style?.outline !== undefined &&
                        <ColorPicker id="insp-outline-color" label={"Outline color"} value={ selected.style.outline.color } choices={ StudioClipInspector.TEXT_COLORS } onChange={ ( color : string ) : void => patchStyle( selected, { outline: { color, widthPct: selected.style?.outline?.widthPct ?? 0.04 } } ) } /> }

                    {/* background box (lower-third) — switch, then its color on the next line */}
                    <Divider textAlign="left"><Typography variant="caption" sx={{ color: "text.secondary" }}>{"Background"}</Typography></Divider>
                    <SwitchInput id="insp-bg" label={"Background"} value={ selected.style?.background !== undefined } onChange={ ( on : boolean ) : void => patchStyle( selected, { background: on ? { color: selected.style?.background?.color ?? "#000000", opacity: selected.style?.background?.opacity ?? 0.5, padPct: selected.style?.background?.padPct ?? 0.3 } : undefined } ) } />
                    { selected.style?.background !== undefined &&
                        <ColorPicker id="insp-bg-color" label={"Background color"} value={ selected.style.background.color } choices={ StudioClipInspector.TEXT_COLORS } onChange={ ( color : string ) : void => patchStyle( selected, { background: { color, opacity: selected.style?.background?.opacity ?? 0.5, padPct: selected.style?.background?.padPct ?? 0.3 } } ) } /> }

                    {/* text entry animation — plays the text IN over the clip's first `durationSec` */}
                    <Divider textAlign="left"><Typography variant="caption" sx={{ color: "text.secondary" }}>{"Animation"}</Typography></Divider>
                    <Stack direction="row" spacing={ 1 }>
                        <Box sx={{ width: "62%" }}><SelectInput id="insp-anim" label={"Animate in"} value={ selected.animateIn?.type ?? "" } choices={ animateChoices } onChange={ setAnimateInType } sx={{ width: "100%" }} /></Box>
                        <Box sx={{ width: "38%" }}><TextInput id="insp-anim-dur" label={"Duration (s)"} value={ ( selected.animateIn?.durationSec ?? 0 ).toFixed( 1 ) } onChange={ setAnimateInDuration } allNumeric disabled={ selected.animateIn === undefined } fullWidth /></Box>
                    </Stack>
                </>;
    }

    //////////////////////////////////////////////////////////////////////
    // video/audio specific properties (source in-point + volume)
    function mediaFields( selected : StudioProject.TimelineClip ) : JSX.Element
    {
        return  <>
                    <TextInput id="insp-trim" label={"Trim start (s)"} value={ frameSec( selected.trimStartSec ?? 0 ) } onChange={ ( value : string ) : void => setTrim( selected, toFrame( num( value, 0 ) ) ) } allNumeric fullWidth />
                    <TextInput id="insp-vol" label={"Volume (%)"} value={ String( Math.round( ( selected.volume ?? 1 ) * 100 ) ) } onChange={ ( value : string ) : void => change( { volume: Math.min( 100, num( value, 0 ) ) / 100 } ) } allNumeric fullWidth />
                    {/* playback speed — slow-mo (<100%) / fast-motion (>100%); source consumed scales with it */}
                    <SliderInput id="insp-speed" label={"Speed"} value={ selected.speed ?? 1 } min={ 0.25 } max={ 4 } step={ 0.25 } isPercent labelPlacement="top" disabled={ props.readonly } onChange={ setSpeed } />
                    {/* reverse — export-accurate; the preview plays forward (Remotion has no negative playback) */}
                    <SwitchInput id="insp-reverse" label={"Reverse (export)"} value={ selected.reverse === true } onChange={ ( on : boolean ) : void => change( { reverse: on } ) } />
                    {/* AUDIO: loop the source to fill the clip's duration (background music) */}
                    { selected.kind === StudioProject.VideoSceneKind.AUDIO &&
                        <SwitchInput id="insp-loop" label={"Loop to fill duration"} value={ selected.loop === true } onChange={ ( on : boolean ) : void => change( { loop: on } ) } /> }
                    {/* VIDEO: split the audio track into its own audio clip (and silence the video's audio) */}
                    { selected.kind === StudioProject.VideoSceneKind.VIDEO &&
                        <Button size="small" variant="outlined" startIcon={ <MusicNoteOutlinedIcon /> } disabled={ props.readonly } onClick={ () : void => props.onDetachAudio( selected ) }>{"Detach audio"}</Button> }
                    {/* auto-captions from the clip's speech transcript (transcribes first if not yet available) */}
                    <Button size="small" variant="outlined" startIcon={ <SubtitlesOutlinedIcon /> } disabled={ props.readonly } onClick={ () : void => props.onGenerateCaptions( selected ) }>{"Generate captions"}</Button>
                </>;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // visual-clip transform (IMAGE/VIDEO): fit / scale / rotation / opacity / position + a Ken Burns preset
    function transformFields( selected : StudioProject.TimelineClip ) : JSX.Element
    {
        return  <>
                    <SelectInput id="insp-fit" label={"Fit"} value={ selected.transform?.fit ?? StudioProject.FitMode.COVER } disabled={ props.readonly }
                                 choices={ StudioClipInspector.FIT_CHOICES } onChange={ ( value : string ) : void => patchTransform( { fit: value as StudioProject.FitMode } ) } />
                    <SliderInput id="insp-scale" label={"Scale"} value={ selected.transform?.scale ?? 1 } min={ 0.25 } max={ 3 } step={ 0.05 } isPercent labelPlacement="top" disabled={ props.readonly } onChange={ setTransformScale } />
                    <SliderInput id="insp-rotate" label={"Rotation"} value={ selected.transform?.rotation ?? 0 } min={ -180 } max={ 180 } step={ 1 } labelPlacement="top" disabled={ props.readonly } onChange={ setTransformRotation } />
                    <SliderInput id="insp-opacity" label={"Opacity"} value={ selected.transform?.opacity ?? 1 } min={ 0 } max={ 1 } step={ 0.05 } isPercent labelPlacement="top" disabled={ props.readonly } onChange={ setTransformOpacity } />
                    <Stack direction="row" spacing={ 1 }>
                        <SliderInput id="insp-tx" label={"Offset X"} value={ selected.transform?.xPct ?? 0 } min={ -0.5 } max={ 0.5 } step={ 0.01 } isPercent labelPlacement="top" disabled={ props.readonly } onChange={ setTransformX } />
                        <SliderInput id="insp-ty" label={"Offset Y"} value={ selected.transform?.yPct ?? 0 } min={ -0.5 } max={ 0.5 } step={ 0.01 } isPercent labelPlacement="top" disabled={ props.readonly } onChange={ setTransformY } />
                    </Stack>
                    <SelectInput id="insp-kenburns" label={"Ken Burns"} value={ kenBurnsPresetKey() } disabled={ props.readonly }
                                 choices={ StudioClipInspector.KEN_BURNS_CHOICES } onChange={ setKenBurns } />
                    <SelectInput id="insp-blend" label={"Blend"} value={ selected.blend ?? StudioProject.BlendMode.NORMAL } disabled={ props.readonly }
                                 choices={ StudioClipInspector.BLEND_CHOICES } onChange={ ( value : string ) : void => change( { blend: value as StudioProject.BlendMode } ) } />
                </>;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // visual-clip color effects (IMAGE/VIDEO): brightness / contrast / saturation / blur + grayscale / vignette
    function effectsFields( selected : StudioProject.TimelineClip ) : JSX.Element
    {
        return  <>
                    <SliderInput id="insp-brightness" label={"Brightness"} value={ selected.filters?.brightness ?? 0 } min={ -1 } max={ 1 } step={ 0.05 } labelPlacement="top" disabled={ props.readonly } onChange={ setBrightness } />
                    <SliderInput id="insp-contrast" label={"Contrast"} value={ selected.filters?.contrast ?? 1 } min={ 0 } max={ 2 } step={ 0.05 } isPercent labelPlacement="top" disabled={ props.readonly } onChange={ setContrast } />
                    <SliderInput id="insp-saturation" label={"Saturation"} value={ selected.filters?.saturation ?? 1 } min={ 0 } max={ 2 } step={ 0.05 } isPercent labelPlacement="top" disabled={ props.readonly || selected.filters?.grayscale === true } onChange={ setSaturation } />
                    <SliderInput id="insp-blur" label={"Blur"} value={ selected.filters?.blur ?? 0 } min={ 0 } max={ 1 } step={ 0.05 } isPercent labelPlacement="top" disabled={ props.readonly } onChange={ setBlur } />
                    <Stack direction="row" spacing={ 1 } sx={{ alignItems: "center" }}>
                        <SwitchInput id="insp-grayscale" label={"Grayscale"} value={ selected.filters?.grayscale === true } onChange={ ( on : boolean ) : void => patchFilters( { grayscale: on } ) } />
                        <SwitchInput id="insp-vignette" label={"Vignette"} value={ selected.filters?.vignette === true } onChange={ ( on : boolean ) : void => patchFilters( { vignette: on } ) } />
                    </Stack>
                </>;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // solid-clip properties (the fill color)
    function solidFields( selected : StudioProject.TimelineClip ) : JSX.Element
    {
        return  <ColorPicker id="insp-solid-color" label={"Color"} value={ selected.color ?? "#000000" } choices={ StudioClipInspector.TEXT_COLORS }
                             onChange={ ( color : string ) : void => change( { color } ) } />;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // shape-clip properties: which library SVG + fill / stroke recolor (geometry is the Transform section)
    function shapeFields( selected : StudioProject.TimelineClip ) : JSX.Element
    {
        const hasStroke : boolean = ( selected.shapeStyle?.strokeWidth ?? 0 ) > 0;
        return  <>
                    <SelectInput id="insp-shape" label={"Shape"} value={ selected.shape ?? "rectangle" } disabled={ props.readonly }
                                 choices={ StudioClipInspector.SHAPE_CHOICES } onChange={ ( value : string ) : void => change( { shape: value } ) } />
                    <ColorPicker id="insp-shape-fill" label={"Fill"} value={ selected.shapeStyle?.fill ?? "#ffffff" } choices={ StudioClipInspector.TEXT_COLORS } onChange={ ( color : string ) : void => patchShape( { fill: color } ) } />
                    <SwitchInput id="insp-shape-stroke" label={"Stroke"} value={ hasStroke } onChange={ toggleShapeStroke } />
                    { hasStroke &&
                        <ColorPicker id="insp-shape-stroke-color" label={"Stroke color"} value={ selected.shapeStyle?.stroke ?? "#000000" } choices={ StudioClipInspector.TEXT_COLORS } onChange={ ( color : string ) : void => patchShape( { stroke: color } ) } /> }
                    { hasStroke &&
                        <SliderInput id="insp-shape-stroke-w" label={"Stroke width"} value={ selected.shapeStyle?.strokeWidth ?? 0 } min={ 0 } max={ 12 } step={ 1 } labelPlacement="top" disabled={ props.readonly } onChange={ setShapeStrokeWidth } /> }
                </>;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // the properties of the selected clip
    function clipFields( selected : StudioProject.TimelineClip ) : JSX.Element
    {
        const isText : boolean = selected.kind === StudioProject.VideoSceneKind.TEXT;
        const isSolid : boolean = selected.kind === StudioProject.VideoSceneKind.SOLID;
        const isShape : boolean = selected.kind === StudioProject.VideoSceneKind.SHAPE;
        const isMedia : boolean = selected.kind === StudioProject.VideoSceneKind.VIDEO || selected.kind === StudioProject.VideoSceneKind.AUDIO;
        const isVisual : boolean = selected.kind === StudioProject.VideoSceneKind.IMAGE || selected.kind === StudioProject.VideoSceneKind.VIDEO;
        // fades + entry transition, grouped into a "Timing" section
        const timingFields : JSX.Element =
            <>
                <Stack direction="row" spacing={ 1 }>
                    <TextInput id="insp-fadein" label={"Fade in (s)"} value={ ( selected.fadeInSec ?? 0 ).toFixed( 1 ) } onChange={ ( value : string ) : void => change( { fadeInSec: oneDecimal( value ) } ) } allNumeric fullWidth />
                    <TextInput id="insp-fadeout" label={"Fade out (s)"} value={ ( selected.fadeOutSec ?? 0 ).toFixed( 1 ) } onChange={ ( value : string ) : void => change( { fadeOutSec: oneDecimal( value ) } ) } allNumeric fullWidth />
                </Stack>
                { selected.kind !== StudioProject.VideoSceneKind.AUDIO &&
                    <Stack direction="row" spacing={ 1 }>
                        {/* key on the clip id so the (internally-stateful) select re-inits per clip — a reset to "" (no transition) from the parent is otherwise dropped */}
                        <Box sx={{ width: "62%" }}><SelectInput key={ "insp-trans-" + selected.id } id="insp-trans" label={"Transition in"} value={ selected.transitionIn?.type ?? "" } choices={ transitionChoices } onChange={ setTransitionType } sx={{ width: "100%" }} /></Box>
                        <Box sx={{ width: "38%" }}><TextInput id="insp-trans-dur" label={"Duration (s)"} value={ ( selected.transitionIn?.durationSec ?? 0 ).toFixed( 1 ) } onChange={ setTransitionDuration } allNumeric disabled={ selected.transitionIn === undefined } fullWidth /></Box>
                    </Stack> }
            </>;

        return  <Stack spacing={ 1 }>
                    {/* always-visible clip header: kind + start/duration + track */}
                    <Typography variant="subtitle2" sx={{ textTransform: "capitalize", px: 0.5 }}>{ `${ selected.kind } clip` }</Typography>
                    <Stack direction="row" spacing={ 1 } sx={{ px: 0.5 }}>
                        <TextInput id="insp-start" label={"Start (s)"} value={ frameSec( selected.startSec ) } onChange={ ( value : string ) : void => change( { startSec: toFrame( num( value, 0 ) ) } ) } allNumeric fullWidth />
                        <TextInput id="insp-dur" label={"Duration (s)"} value={ frameSec( selected.durationSec ) } onChange={ ( value : string ) : void => setDuration( selected, toFrame( num( value, 0.1 ) ) ) } allNumeric fullWidth />
                    </Stack>
                    <Box sx={{ px: 0.5 }}>
                        <SelectInput id="insp-track" label={"Track"} value={ selected.trackId } disabled={ props.readonly }
                                     choices={ tracks.map( ( track : StudioProject.TimelineTrack ) : SelectInput.Choice => ( { value: track.id, label: track.name } ) ) }
                                     onChange={ ( value : string ) : void => change( { trackId: value } ) } />
                    </Box>

                    {/* the rest split into collapsible sections */}
                    { isText && accordion( "sec-main", "Text", textFields( selected ) ) }
                    { isSolid && accordion( "sec-main", "Color", solidFields( selected ) ) }
                    { isShape && accordion( "sec-main", "Shape", shapeFields( selected ) ) }
                    { isMedia && accordion( "sec-main", "Media", mediaFields( selected ) ) }
                    { ( isVisual || isShape ) && accordion( "sec-transform", "Transform", transformFields( selected ) ) }
                    { isVisual && accordion( "sec-effects", "Effects", effectsFields( selected ) ) }
                    { accordion( "sec-timing", "Timing", timingFields ) }

                    <Divider />
                    <Button size="small" color="error" startIcon={ <DeleteOutlineOutlinedIcon /> } disabled={ props.readonly } onClick={ () : void => props.onRemoveClip( selected.id ) }>{"Remove clip"}</Button>
                </Stack>;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    return  <Box sx={{ height: "100%", overflowY: "auto", p: 1.5, bgcolor: "background.paper" }}>
                { clip === null ? compositionSettings() : clipFields( clip ) }
            </Box>;
}

export namespace StudioClipInspector
{
    /** A labelled select choice. */
    export interface Choice { value : string; label : string; }

    /** Font-family choices for a text clip (values are the {@link StudioProject.TextFont} CSS families). */
    export const FONT_CHOICES : Array<SelectInput.Choice> =
    [
        { value: StudioProject.TextFont.SANS,  label: "Sans-serif" },
        { value: StudioProject.TextFont.SERIF, label: "Serif" },
        { value: StudioProject.TextFont.MONO,  label: "Monospace" },
    ];

    /** The swatch palette offered for text fill / outline / background colors (white + black first, then the
     *  house color + grey ramps). Text colors are free-form content values, not app theme tokens. */
    export const TEXT_COLORS : Array<string> = [ "#ffffff", "#000000", ...ColorPicker.COLORS, ...ColorPicker.GREYS ];

    /** Shape choices from the built-in SVG library (values are {@link StudioProject.SHAPE_LIBRARY} keys). */
    export const SHAPE_CHOICES : Array<SelectInput.Choice> =
        StudioProject.SHAPE_LIBRARY.map( ( entry : StudioProject.ShapeDef ) : SelectInput.Choice => ( { value: entry.key, label: entry.label } ) );

    /** Blend-mode choices for a visual clip (values are {@link StudioProject.BlendMode}). */
    export const BLEND_CHOICES : Array<SelectInput.Choice> =
    [
        { value: StudioProject.BlendMode.NORMAL,     label: "Normal" },
        { value: StudioProject.BlendMode.MULTIPLY,   label: "Multiply" },
        { value: StudioProject.BlendMode.SCREEN,     label: "Screen" },
        { value: StudioProject.BlendMode.OVERLAY,    label: "Overlay" },
        { value: StudioProject.BlendMode.DARKEN,     label: "Darken" },
        { value: StudioProject.BlendMode.LIGHTEN,    label: "Lighten" },
        { value: StudioProject.BlendMode.DIFFERENCE, label: "Difference" },
    ];

    /** Export encode-quality choices (values are {@link StudioProject.VideoQuality}). */
    export const QUALITY_CHOICES : Array<SelectInput.Choice> =
    [
        { value: StudioProject.VideoQuality.DRAFT,    label: "Draft (fast)" },
        { value: StudioProject.VideoQuality.STANDARD, label: "Standard" },
        { value: StudioProject.VideoQuality.HIGH,     label: "High (slow)" },
    ];

    /** Fit-mode choices for a visual clip. */
    export const FIT_CHOICES : Array<SelectInput.Choice> =
    [
        { value: StudioProject.FitMode.COVER,   label: "Cover (fill)" },
        { value: StudioProject.FitMode.CONTAIN, label: "Contain (fit)" },
    ];

    /** Ken Burns choices — "None" then each built-in preset. */
    export const KEN_BURNS_CHOICES : Array<SelectInput.Choice> = [ { value: "", label: "None" },
        ...StudioProject.KEN_BURNS_PRESETS.map( ( preset : StudioProject.KenBurnsPreset ) : SelectInput.Choice => ( { value: preset.key, label: preset.label } ) ) ];

    /** Corner choices for the logo/watermark placement. */
    export const WATERMARK_CORNERS : Array<SelectInput.Choice> =
    [
        { value: StudioProject.WatermarkCorner.TOP_LEFT,     label: "Top left" },
        { value: StudioProject.WatermarkCorner.TOP_RIGHT,    label: "Top right" },
        { value: StudioProject.WatermarkCorner.BOTTOM_LEFT,  label: "Bottom left" },
        { value: StudioProject.WatermarkCorner.BOTTOM_RIGHT, label: "Bottom right" },
    ];

    /** Horizontal text alignment options for a text clip. */
    export const ALIGNMENTS : Array<Choice> =
    [
        { value: "left",   label: "Left" },
        { value: "center", label: "Center" },
        { value: "right",  label: "Right" },
    ];

    /** Human labels for the text entry animations. */
    export const TEXT_ANIM_LABELS : Record<string, string> =
    {
        [ StudioProject.TextAnimation.FADE ]:        "Fade",
        [ StudioProject.TextAnimation.TYPEWRITER ]:  "Typewriter",
        [ StudioProject.TextAnimation.SLIDE_LEFT ]:  "Slide left",
        [ StudioProject.TextAnimation.SLIDE_RIGHT ]: "Slide right",
        [ StudioProject.TextAnimation.SLIDE_UP ]:    "Slide up",
        [ StudioProject.TextAnimation.SLIDE_DOWN ]:  "Slide down",
        [ StudioProject.TextAnimation.POP ]:         "Pop",
    };

    /** Human labels for the entry transitions. */
    export const TRANSITION_LABELS : Record<string, string> =
    {
        [ StudioProject.TransitionType.DISSOLVE ]:    "Dissolve",
        [ StudioProject.TransitionType.WIPE_LEFT ]:   "Wipe left",
        [ StudioProject.TransitionType.WIPE_RIGHT ]:  "Wipe right",
        [ StudioProject.TransitionType.WIPE_UP ]:     "Wipe up",
        [ StudioProject.TransitionType.WIPE_DOWN ]:   "Wipe down",
        [ StudioProject.TransitionType.SLIDE_LEFT ]:  "Slide left",
        [ StudioProject.TransitionType.SLIDE_RIGHT ]: "Slide right",
        [ StudioProject.TransitionType.SLIDE_UP ]:    "Slide up",
        [ StudioProject.TransitionType.SLIDE_DOWN ]:  "Slide down",
    };

    export interface Props
    {
        doc             : StudioProject.VideoDoc;
        clip            : StudioProject.TimelineClip | null;
        readonly        : boolean;
        watermark?      : StudioProject.Watermark;
        onChangeClip    : ( id : string, patch : Partial<StudioProject.TimelineClip> ) => void;
        onRemoveClip    : ( id : string ) => void;
        onSetFormat     : ( key : string ) => void;
        onSetTargets    : ( keys : Array<string> ) => void;
        onSetQuality    : ( key : string ) => void;
        onSetBitrate    : ( kbps : number ) => void;
        onTogglePoster  : ( on : boolean ) => void;
        onSetGif        : ( on : boolean ) => void;
        onPickWatermark : () => void;
        onSetWatermark  : ( watermark : StudioProject.Watermark | undefined ) => void;
        onGenerateCaptions : ( clip : StudioProject.TimelineClip ) => void;
        onDetachAudio      : ( clip : StudioProject.TimelineClip ) => void;
    }
}

export default StudioClipInspector;
// eof
