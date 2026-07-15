import React from 'react';
import { JSX } from "react";

import { AbsoluteFill, Sequence, Img, OffthreadVideo, Audio, useCurrentFrame } from 'remotion';

import { StudioProject } from '@repo/api';

//////////////////////////////////////////////////////////////////////
//
// ClipLayer — a small presentation-only wrapper (used solely by StudioVideoComposition) that applies a clip's
// fade IN/OUT (opacity) AND its entry TRANSITION (dissolve / wipe / slide, over the first `transitionSec`
// where it overlaps the previous clip), then renders the clip itself.
//
function ClipLayer( props : { clip : StudioProject.TimelineClip; doc : StudioProject.VideoDoc; muted : boolean } ) : JSX.Element
{
    const frame : number = useCurrentFrame();
    const fps : number = props.doc.fps;
    const clip : StudioProject.TimelineClip = props.clip;
    const transitionFrames : number = clip.transitionIn ? Math.round( Math.max( 0, clip.transitionIn.durationSec ) * fps ) : 0;
    // the Sequence is EXTENDED by the transition (it starts early to overlap the previous clip)
    const totalFrames : number = Math.max( 1, Math.round( ( clip.durationSec + ( clip.transitionIn ? Math.max( 0, clip.transitionIn.durationSec ) : 0 ) ) * fps ) );
    const fadeInFrames : number = Math.max( 0, Math.round( ( clip.fadeInSec ?? 0 ) * fps ) );
    const fadeOutFrames : number = Math.max( 0, Math.round( ( clip.fadeOutSec ?? 0 ) * fps ) );

    // fade opacity over the whole (extended) clip — when a transition drives the entry, skip the plain fade-in
    const fadeOpacity : number = StudioVideoComposition.fadeMultiplier( frame, totalFrames, transitionFrames > 0 ? 0 : fadeInFrames, fadeOutFrames );

    // the transition reveal over the first `transitionFrames` (opacity / clip-path / transform)
    const reveal : { opacity? : number; transform? : string; clipPath? : string } =
        clip.transitionIn && transitionFrames > 0 ? StudioVideoComposition.transitionStyle( clip.transitionIn.type, Math.min( 1, frame / transitionFrames ) ) : {};

    // a TEXT layer's entry animation over its first `durationSec` (opacity/transform reveal; typewriter reveals
    // characters via `textProgress`). Measured from the clip's own start (sequence-local frame 0).
    const animFrames : number = clip.animateIn ? Math.round( Math.max( 0, clip.animateIn.durationSec ) * fps ) : 0;
    const animProgress : number = animFrames > 0 ? Math.min( 1, frame / animFrames ) : 1;
    const anim : { opacity? : number; transform? : string } =
        clip.animateIn && animFrames > 0 ? StudioVideoComposition.textAnimateStyle( clip.animateIn.type, animProgress ) : {};
    const textProgress : number = clip.animateIn?.type === StudioProject.TextAnimation.TYPEWRITER ? animProgress : 1;

    // a visual clip's per-clip transform + Ken Burns pan/zoom (interpolated over the clip); identity for text
    const visual : { opacity? : number; transform? : string } = StudioVideoComposition.visualTransformStyle( clip, frame, totalFrames );

    // compose transition + animation + transform transforms (any may be empty)
    const transform : string | undefined = [ reveal.transform, anim.transform, visual.transform ].filter( Boolean ).join( " " ) || undefined;

    // how this layer blends over the ones beneath (preview-only; export composites normal)
    const mixBlendMode : React.CSSProperties[ "mixBlendMode" ] = clip.blend !== undefined && clip.blend !== StudioProject.BlendMode.NORMAL ? clip.blend : undefined;

    return  <AbsoluteFill style={{ opacity: fadeOpacity * ( reveal.opacity ?? 1 ) * ( anim.opacity ?? 1 ) * ( visual.opacity ?? 1 ), transform, clipPath: reveal.clipPath, mixBlendMode }}>
                { StudioVideoComposition.renderClip( clip, props.doc, props.muted, textProgress ) }
            </AbsoluteFill>;
}

//////////////////////////////////////////////////////////////////////
//
// StudioVideoComposition — the Remotion composition a video project renders: a multi-track TIMELINE of CLIPS
// (library image, library video clip, audio, or a positioned text layer), each with an absolute start time and
// duration. Tracks composite by order (earlier track = on top). It's fully DATA-DRIVEN from the `doc` inputProps
// so the same component powers both the in-browser <Player> preview AND the server-side render — the render path
// just feeds it the same doc. Legacy sequential scene docs are migrated to the timeline on the way in.
//
export function StudioVideoComposition( props : StudioVideoComposition.Props ) : JSX.Element
{
    const doc : StudioVideoComposition.Doc = StudioProject.migrateToTimeline( props.doc );
    const tracks : Array<StudioVideoComposition.Track> = doc.tracks ?? [];
    const clips : Array<StudioVideoComposition.Clip> = doc.clips ?? [];

    // paint tracks back-to-front: reverse the array so tracks[0] (the top UI lane) renders LAST → on top
    const painted : Array<StudioVideoComposition.Track> = [ ...tracks ].reverse();

    return  <AbsoluteFill style={{ backgroundColor: "#000000" }}>
                {/* a logo/watermark, if set, is burned over the WHOLE timeline in its corner (top-most) */}
                { doc.watermark?.src !== undefined &&
                    <Img src={ doc.watermark.src } style={ StudioVideoComposition.watermarkCss( doc.watermark ) } /> }
                { painted.map( ( track : StudioVideoComposition.Track ) : JSX.Element =>
                {
                    if( track.hidden ) return <React.Fragment key={ track.id } />;
                    const trackClips : Array<StudioVideoComposition.Clip> = clips.filter( ( clip : StudioVideoComposition.Clip ) : boolean => clip.trackId === track.id );
                    return  <React.Fragment key={ track.id }>
                                { trackClips.map( ( clip : StudioVideoComposition.Clip ) : JSX.Element =>
                                {
                                    // a transition pulls the clip's start EARLIER so it overlaps the previous clip
                                    const transitionSec : number = clip.transitionIn ? Math.max( 0, clip.transitionIn.durationSec ) : 0;
                                    const from : number = Math.max( 0, Math.round( ( clip.startSec - transitionSec ) * doc.fps ) );
                                    const frames : number = Math.max( 1, Math.round( ( clip.durationSec + transitionSec ) * doc.fps ) );
                                    return  <Sequence key={ clip.id } from={ from } durationInFrames={ frames }>
                                                <ClipLayer clip={ clip } doc={ doc } muted={ track.muted === true } />
                                            </Sequence>;
                                } ) }
                            </React.Fragment>;
                } ) }
            </AbsoluteFill>;
}

export namespace StudioVideoComposition
{
    // the timeline model is defined once in @repo/api (shared with the server render); alias it here so the
    // composition + editor keep their familiar names (both the enum VALUE and the TYPE alias are exported)
    export const SceneKind = StudioProject.VideoSceneKind;
    export type SceneKind = StudioProject.VideoSceneKind;
    export type Doc = StudioProject.VideoDoc;
    export type Track = StudioProject.TimelineTrack;
    export type Clip = StudioProject.TimelineClip;

    /** A blank 1080p / 30fps timeline document. */
    export const DEFAULT_DOC : Doc = StudioProject.DEFAULT_VIDEO_DOC;

    //////////////////////////////////////////////////////////////////////
    /** Total timeline length in frames (min 1 so the Player always has a valid duration). */
    export function totalFrames( doc : Doc ) : number
    {
        return Math.max( 1, Math.round( StudioProject.timelineDurationSec( doc ) * doc.fps ) );
    }

    //////////////////////////////////////////////////////////////////////
    /** The fade multiplier (0..1) at a sequence-local frame — ramps up over the fade-in, holds at 1, ramps down
     *  over the fade-out (plain math; no fade → flat 1). Shared by the visual OPACITY ramp AND the audio/video
     *  VOLUME ramp, so the preview fades audio too — matching the ffmpeg render's afade. */
    export function fadeMultiplier( frame : number, durationFrames : number, fadeInFrames : number, fadeOutFrames : number ) : number
    {
        let value : number = 1;
        if( fadeInFrames > 0 && frame < fadeInFrames ) value = frame / fadeInFrames;
        else if( fadeOutFrames > 0 && frame > durationFrames - fadeOutFrames ) value = ( durationFrames - frame ) / fadeOutFrames;
        return Math.max( 0, Math.min( 1, value ) );
    }

    //////////////////////////////////////////////////////////////////////
    /** The CSS reveal for a transition at progress `p` (0..1) — dissolve (opacity), wipe (clip-path inset), or
     *  slide (translate). Applied to the incoming clip while it overlaps the previous one. */
    export function transitionStyle( type : StudioProject.TransitionType, p : number ) : { opacity? : number; transform? : string; clipPath? : string }
    {
        const hidden : number = ( 1 - p ) * 100;   // percent still hidden
        switch( type )
        {
            case StudioProject.TransitionType.DISSOLVE:    return { opacity: p };
            case StudioProject.TransitionType.WIPE_RIGHT:  return { clipPath: `inset(0 ${ hidden }% 0 0)` };   // reveal left→right
            case StudioProject.TransitionType.WIPE_LEFT:   return { clipPath: `inset(0 0 0 ${ hidden }%)` };   // reveal right→left
            case StudioProject.TransitionType.WIPE_DOWN:   return { clipPath: `inset(0 0 ${ hidden }% 0)` };   // reveal top→bottom
            case StudioProject.TransitionType.WIPE_UP:     return { clipPath: `inset(${ hidden }% 0 0 0)` };   // reveal bottom→top
            case StudioProject.TransitionType.SLIDE_LEFT:  return { transform: `translateX(${ hidden }%)` };   // in from the right
            case StudioProject.TransitionType.SLIDE_RIGHT: return { transform: `translateX(${ -hidden }%)` };  // in from the left
            case StudioProject.TransitionType.SLIDE_UP:    return { transform: `translateY(${ hidden }%)` };   // in from below
            case StudioProject.TransitionType.SLIDE_DOWN:  return { transform: `translateY(${ -hidden }%)` };  // in from above
            default:                                       return {};
        }
    }

    //////////////////////////////////////////////////////////////////////
    /** The CSS reveal for a TEXT entry animation at progress `p` (0..1) — fade (opacity), slide (translate +
     *  fade), or pop (scale + fade). Typewriter reveals characters instead (see `textProgress` in renderClip),
     *  so it contributes no wrapper style. Slides/pop offsets are a fraction of the frame so they scale. */
    export function textAnimateStyle( type : StudioProject.TextAnimation, p : number ) : { opacity? : number; transform? : string }
    {
        const offset : number = ( 1 - p ) * 10;   // percent of frame still to travel
        switch( type )
        {
            case StudioProject.TextAnimation.FADE:        return { opacity: p };
            case StudioProject.TextAnimation.POP:         return { opacity: p, transform: `scale(${ 0.6 + 0.4 * p })` };
            case StudioProject.TextAnimation.SLIDE_LEFT:  return { opacity: p, transform: `translateX(${ offset }%)` };   // in from the right
            case StudioProject.TextAnimation.SLIDE_RIGHT: return { opacity: p, transform: `translateX(${ -offset }%)` };  // in from the left
            case StudioProject.TextAnimation.SLIDE_UP:    return { opacity: p, transform: `translateY(${ offset }%)` };   // in from below
            case StudioProject.TextAnimation.SLIDE_DOWN:  return { opacity: p, transform: `translateY(${ -offset }%)` };  // in from above
            default:                                      return {};   // typewriter (char-revealed) / unknown
        }
    }

    //////////////////////////////////////////////////////////////////////
    /** CSS for the logo/watermark overlay: absolute, corner-anchored (margin + width as fractions of the frame
     *  so it scales across formats), at the configured opacity. Mirrors the render's overlay placement. */
    export function watermarkCss( watermark : StudioProject.Watermark ) : React.CSSProperties
    {
        const margin : string = `${ watermark.marginPct * 100 }%`;
        const css : React.CSSProperties =
            { position: "absolute", width: `${ watermark.scalePct * 100 }%`, height: "auto", objectFit: "contain", opacity: watermark.opacity };
        const isTop : boolean = watermark.corner === StudioProject.WatermarkCorner.TOP_LEFT || watermark.corner === StudioProject.WatermarkCorner.TOP_RIGHT;
        const isLeft : boolean = watermark.corner === StudioProject.WatermarkCorner.TOP_LEFT || watermark.corner === StudioProject.WatermarkCorner.BOTTOM_LEFT;
        if( isTop ) css.top = margin; else css.bottom = margin;
        if( isLeft ) css.left = margin; else css.right = margin;
        return css;
    }

    //////////////////////////////////////////////////////////////////////
    /** The CSS transform/opacity for a visual clip's per-clip TRANSFORM (position / scale / rotation / opacity)
     *  combined with its KEN BURNS pan-zoom, interpolated at the sequence-local `frame` over `totalFrames`.
     *  Returns identity for text/audio (no transform set). Offsets are fractions of the frame (percent translate). */
    export function visualTransformStyle( clip : Clip, frame : number, totalFrames : number ) : { opacity? : number; transform? : string }
    {
        const isVisual : boolean = clip.kind === SceneKind.IMAGE || clip.kind === SceneKind.VIDEO || clip.kind === SceneKind.SHAPE;
        if( !isVisual || ( clip.transform === undefined && clip.kenBurns === undefined ) ) return {};

        let scale : number = clip.transform?.scale ?? 1;
        let xPct : number = clip.transform?.xPct ?? 0;
        let yPct : number = clip.transform?.yPct ?? 0;
        const rotation : number = clip.transform?.rotation ?? 0;
        const opacity : number = clip.transform?.opacity ?? 1;

        // Ken Burns: linearly interpolate scale + center offset from the `from` state to the `to` state
        if( clip.kenBurns !== undefined )
        {
            const progress : number = totalFrames > 1 ? Math.max( 0, Math.min( 1, frame / totalFrames ) ) : 1;
            scale *= lerp( clip.kenBurns.fromScale, clip.kenBurns.toScale, progress );
            xPct += lerp( clip.kenBurns.fromXPct, clip.kenBurns.toXPct, progress );
            yPct += lerp( clip.kenBurns.fromYPct, clip.kenBurns.toYPct, progress );
        }

        const parts : Array<string> = [];
        if( xPct !== 0 || yPct !== 0 ) parts.push( `translate(${ xPct * 100 }%, ${ yPct * 100 }%)` );
        if( scale !== 1 ) parts.push( `scale(${ scale })` );
        if( rotation !== 0 ) parts.push( `rotate(${ rotation }deg)` );
        return { opacity, transform: parts.length > 0 ? parts.join( " " ) : undefined };
    }

    //////////////////////////////////////////////////////////////////////
    /** Linear interpolation between `from` and `to` at fraction `t` (0..1). */
    export function lerp( from : number, to : number, t : number ) : number { return from + ( to - from ) * t; }

    //////////////////////////////////////////////////////////////////////
    /** The CSS `filter` string for a clip's color EFFECTS (brightness / contrast / saturation / grayscale /
     *  blur) — neutral values are omitted; vignette is handled separately as an overlay. Mirrors the render's
     *  ffmpeg `eq`/`gblur` so preview and export match. Returns undefined when nothing is set. */
    export function clipFilterCss( filters : StudioProject.ClipFilters | undefined ) : string | undefined
    {
        if( filters === undefined ) return undefined;
        const parts : Array<string> = [];
        const brightness : number = filters.brightness ?? 0;
        const contrast : number = filters.contrast ?? 1;
        const saturation : number = filters.saturation ?? 1;
        const blur : number = filters.blur ?? 0;
        if( brightness !== 0 ) parts.push( `brightness(${ 1 + brightness })` );
        if( contrast !== 1 ) parts.push( `contrast(${ contrast })` );
        if( filters.grayscale ) parts.push( "grayscale(1)" );
        else if( saturation !== 1 ) parts.push( `saturate(${ saturation })` );
        if( blur > 0 ) parts.push( `blur(${ blur * StudioProject.FILTER_BLUR_MAX }px)` );
        return parts.length > 0 ? parts.join( " " ) : undefined;
    }

    //////////////////////////////////////////////////////////////////////
    /** Slice a string to a fraction (0..1) of its characters for the typewriter reveal (full string at p≥1). */
    export function typewriterSlice( text : string, progress : number ) : string
    {
        if( progress >= 1 ) return text;
        return text.slice( 0, Math.ceil( text.length * Math.max( 0, progress ) ) );
    }

    //////////////////////////////////////////////////////////////////////
    /** Render a single clip full-frame: image/video COVER-fit, audio (invisible), or a relatively-positioned
     *  text layer. `frameHeight` (the composition height) scales the text font so it stays proportional across
     *  the master format and every auto-generated destination variant. `muted` silences audio/video.
     *  `textProgress` (0..1) drives the typewriter reveal — the text is sliced to that fraction of characters. */
    export function renderClip( clip : Clip, doc : Doc, muted : boolean, textProgress : number = 1 ) : JSX.Element
    {
        const startFrom : number = Math.max( 0, Math.round( ( clip.trimStartSec ?? 0 ) * doc.fps ) );
        const baseVolume : number = muted ? 0 : ( clip.volume ?? 1 );
        // a per-frame volume that fades in/out with the clip (matches the visual opacity + the render's afade)
        const durationFrames : number = Math.max( 1, Math.round( clip.durationSec * doc.fps ) );
        const fadeInFrames : number = Math.max( 0, Math.round( ( clip.fadeInSec ?? 0 ) * doc.fps ) );
        const fadeOutFrames : number = Math.max( 0, Math.round( ( clip.fadeOutSec ?? 0 ) * doc.fps ) );
        const volumeAt = ( frame : number ) : number => baseVolume * fadeMultiplier( frame, durationFrames, fadeInFrames, fadeOutFrames );

        // wrap a visual element with an edge-darkening vignette overlay (a radial gradient), when enabled
        function withVignette( media : JSX.Element, on : boolean ) : JSX.Element
        {
            if( !on ) return media;
            return  <AbsoluteFill>
                        { media }
                        <AbsoluteFill style={{ background: "radial-gradient(ellipse at center, rgba(0,0,0,0) 55%, rgba(0,0,0,0.6) 100%)" }} />
                    </AbsoluteFill>;
        }

        // base media — images/video fill the frame per the clip's fit mode (cover default); audio plays invisibly.
        // Color effects/filters apply via CSS `filter`; a vignette is a separate edge-darkening overlay.
        const objectFit : "cover" | "contain" = clip.transform?.fit === StudioProject.FitMode.CONTAIN ? "contain" : "cover";
        const filter : string | undefined = StudioVideoComposition.clipFilterCss( clip.filters );
        const vignette : boolean = clip.filters?.vignette === true;
        // playback rate (slow-mo / fast-motion) for time-based media (1 = normal); images/text ignore it
        const playbackRate : number = clip.speed !== undefined && clip.speed > 0 ? clip.speed : 1;
        if( clip.kind === SceneKind.IMAGE && clip.src )
            return withVignette( <Img src={ clip.src } style={{ width: "100%", height: "100%", objectFit, filter }} />, vignette );
        if( clip.kind === SceneKind.VIDEO && clip.src )
            return withVignette( <OffthreadVideo src={ clip.src } startFrom={ startFrom } volume={ volumeAt } playbackRate={ playbackRate } style={{ width: "100%", height: "100%", objectFit, filter }} />, vignette );
        if( clip.kind === SceneKind.AUDIO && clip.src )
            return <Audio src={ clip.src } startFrom={ startFrom } volume={ volumeAt } playbackRate={ playbackRate } loop={ clip.loop === true } />;
        // a solid color card (background / title backdrop) — fills the frame
        if( clip.kind === SceneKind.SOLID )
            return withVignette( <AbsoluteFill style={{ backgroundColor: clip.color ?? "#000000", filter }} />, vignette );
        // an SVG shape/graphic overlay — recolored + rendered as a data-URI image (fit inside, positioned by transform)
        if( clip.kind === SceneKind.SHAPE )
        {
            const svg : string = StudioProject.buildShapeSvg( clip.shape, clip.shapeStyle );
            const uri : string = "data:image/svg+xml;utf8," + encodeURIComponent( svg );
            return withVignette( <img src={ uri } style={{ width: "100%", height: "100%", objectFit: "contain", filter }} />, vignette );
        }

        // a positioned text layer (reflows with the frame; anchored at xPct/yPct)
        const xPct : number = clip.xPct ?? StudioProject.DEFAULT_TEXT_GEOMETRY.xPct;
        const yPct : number = clip.yPct ?? 0.5;
        const fontPct : number = clip.fontPct ?? StudioProject.DEFAULT_TEXT_GEOMETRY.fontPct;
        const align : "left" | "center" | "right" = clip.align ?? StudioProject.DEFAULT_TEXT_GEOMETRY.align;
        const fontSize : number = doc.height * fontPct;
        return  <AbsoluteFill>
                    <div style={{
                             position: "absolute", left: `${ xPct * 100 }%`, top: `${ yPct * 100 }%`,
                             transform: `translate(${ align === "left" ? "0%" : align === "right" ? "-100%" : "-50%" }, -50%)`,
                             maxWidth: "90%", fontSize, textAlign: align, lineHeight: 1.15, whiteSpace: "pre-wrap",
                             ...StudioVideoComposition.textStyleCss( clip.style, fontSize ),
                         }}>
                        { StudioVideoComposition.typewriterSlice( clip.text ?? "", textProgress ) }
                    </div>
                </AbsoluteFill>;
    }

    //////////////////////////////////////////////////////////////////////
    /** Build the CSS for a text layer's STYLE (fill / font / outline / shadow / background box), filling any
     *  unset field from {@link StudioProject.DEFAULT_TEXT_STYLE} so an unstyled clip keeps the legacy look.
     *  Widths/padding are fractions of the font size so they scale across destination formats. Mirrors the
     *  ffmpeg drawtext options the server render builds, so preview and export match. */
    export function textStyleCss( style : StudioProject.TextStyle | undefined, fontSize : number ) : React.CSSProperties
    {
        const resolved : StudioProject.TextStyle = { ...StudioProject.DEFAULT_TEXT_STYLE, ...( style ?? {} ) };
        const css : React.CSSProperties = {
            color: resolved.color ?? "#ffffff",
            fontFamily: resolved.fontFamily ?? StudioProject.TextFont.SANS,
            fontWeight: resolved.bold === false ? 400 : 700,
        };
        // drop shadow (on unless explicitly disabled) — matches the render's shadowcolor=black@0.6
        if( resolved.shadow !== false ) css.textShadow = "0 2px 10px rgba(0,0,0,0.6)";
        // outline/stroke — width relative to the font size so it scales with the text
        if( resolved.outline !== undefined && resolved.outline.widthPct > 0 )
            css.WebkitTextStroke = `${ resolved.outline.widthPct * fontSize }px ${ resolved.outline.color }`;
        // background box (lower-third) — pad relative to font size; opacity folded into the fill color
        if( resolved.background !== undefined )
        {
            const pad : number = resolved.background.padPct * fontSize;
            css.backgroundColor = StudioVideoComposition.hexWithAlpha( resolved.background.color, resolved.background.opacity );
            css.padding = `${ pad * 0.5 }px ${ pad }px`;
            css.borderRadius = pad * 0.3;
        }
        return css;
    }

    //////////////////////////////////////////////////////////////////////
    /** Fold an opacity (0..1) into a `#rrggbb` hex as an 8-digit `#rrggbbaa` (so a background box tints without
     *  an `opacity` that would also fade the text). Falls back to the input if it isn't a 6-digit hex. */
    export function hexWithAlpha( hex : string, opacity : number ) : string
    {
        const clamped : number = Math.max( 0, Math.min( 1, opacity ) );
        const alpha : string = Math.round( clamped * 255 ).toString( 16 ).padStart( 2, "0" );
        return /^#[0-9a-fA-F]{6}$/.test( hex ) ? `${ hex }${ alpha }` : hex;
    }

    export interface Props { doc : Doc; }
}

export default StudioVideoComposition;
// eof
