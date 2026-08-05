//
import React from "react";
import { JSX } from "react";

import { Box, Typography } from "@mui/material";

import { SvgDocument } from "@repo/api";

import { ptToUnit } from "@widgets/svg/editor/SvgEditorModel";

//
// RulerBar — a measurement strip (horizontal or vertical) with adaptive tick density and labeled major ticks.
// The strip fills its flex parent (flexGrow for horizontal, alignSelf:stretch for vertical) and measures its
// own rendered size via ResizeObserver so ticks always cover the full visible area at any window size.
// Unit values are shown in the page's display unit (pt, in, mm, px) so the ruler matches the canvas
// coordinate system.
//
export function RulerBar( props : RulerBar.Props ) : JSX.Element
{
    const RULER_THICKNESS : number = 20;   // px — height of H ruler / width of V ruler
    const LABEL_MIN_PX    : number = 60;   // minimum px gap between major (labeled) ticks
    const MINOR_MIN_PX    : number = 6;    // minimum px gap between minor ticks

    const containerRef : React.MutableRefObject<HTMLDivElement | null> = React.useRef<HTMLDivElement | null>( null );
    // measured pixel extent of this ruler element — drives tick generation so ticks always fill the visible area
    const [ selfPx, setSelfPx ] = React.useState<number>( 0 );

    ////////////////////////////////////////////////////////////////////////////////////////////
    // use the self-measured size for tick rendering; fall back to props.length before first observation
    const renderLength : number = selfPx > 0 ? selfPx : props.length;

    // choose a nice pt step so major-tick labels are spaced ≥ LABEL_MIN_PX apart
    const CANDIDATE_STEPS_PT : Array<number> = [ 5, 9, 18, 36, 72, 144, 288, 576 ];
    const majorStepPt : number = CANDIDATE_STEPS_PT.find(
        ( step : number ) : boolean => step * props.zoom >= LABEL_MIN_PX
    ) ?? 576;

    // minor ticks: step that produces ≥ MINOR_MIN_PX spacing and is smaller than the major step
    const CANDIDATE_MINOR_PT : Array<number> = [ 1, 2, 3, 6, 9, 18, 36, 72 ];
    const minorStepPt : number = CANDIDATE_MINOR_PT.find(
        ( step : number ) : boolean => step * props.zoom >= MINOR_MIN_PX && step < majorStepPt
    ) ?? majorStepPt;

    const totalPt  : number        = props.zoom > 0 ? renderLength / props.zoom : 0;
    const tickCount : number       = Math.ceil( totalPt / minorStepPt ) + 1;
    const ticks     : Array<number> = Array.from( { length: tickCount }, ( _v : unknown, i : number ) : number => i );

    const isHorizontal : boolean = props.orientation === "horizontal";

    const UNIT_LABEL : Record<SvgDocument.Unit, string> =
    {
        [ SvgDocument.Unit.PT     ] : "pt",
        [ SvgDocument.Unit.INCHES ] : "in",
        [ SvgDocument.Unit.MM     ] : "mm",
        [ SvgDocument.Unit.PX     ] : "px",
    };

    React.useEffect( observeSize, [] );

    ////////////////////////////////////////////////////////////////////////////////////////////
    // called by ResizeObserver when the ruler element is first observed or resizes
    function onSelfResize( entries : Array<ResizeObserverEntry> ) : void
    {
        const entry : ResizeObserverEntry | undefined = entries[ 0 ];
        if( entry === undefined ) return;
        const px : number = props.orientation === "horizontal" ? entry.contentRect.width : entry.contentRect.height;
        setSelfPx( px );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // observe the ruler's own element so it self-sizes regardless of the passed length prop
    function observeSize() : () => void
    {
        const el : HTMLDivElement | null = containerRef.current;
        if( el === null ) return () : void => {};
        const observer : ResizeObserver = new ResizeObserver( onSelfResize );
        observer.observe( el );
        return () : void => observer.disconnect();
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // one tick mark — a thin line + an optional label on major ticks
    function tick( index : number ) : JSX.Element
    {
        const pt       : number  = index * minorStepPt;
        const position : number  = pt * props.zoom + props.offset;
        if( position < 0 || position > renderLength ) return <Box key={ index } />;

        const isMajor : boolean = Math.round( pt ) % Math.round( majorStepPt ) === 0;
        const extent  : number  = isMajor ? RULER_THICKNESS * 0.65 : RULER_THICKNESS * 0.3;
        const lineStyle : object = isHorizontal
            ? { position: "absolute", left: position, bottom: 0, width: "1px", height: extent, bgcolor: "divider" }
            : { position: "absolute", top: position, right: 0, height: "1px", width: extent, bgcolor: "divider" };

        if( !isMajor ) return <Box key={ index } sx={ lineStyle } />;

        const labelValue : number = Math.round( ptToUnit( pt, props.unit, 72 ) );
        return  <Box key={ index } sx={{ position: "absolute", ...(isHorizontal ? { left: position, top: 0 } : { top: position, left: 0 }), pointerEvents: "none" }}>
                    <Box sx={ lineStyle } />
                    { isHorizontal
                        ? <Typography variant="caption" sx={{ position: "absolute", left: 3, top: 2, fontSize: 9, lineHeight: 1, color: "text.secondary", userSelect: "none", whiteSpace: "nowrap" }}>
                              { labelValue }
                          </Typography>
                        : <Typography variant="caption" sx={{ position: "absolute", top: 3, left: 2, fontSize: 9, lineHeight: 1, color: "text.secondary", userSelect: "none",
                                                              writingMode: "vertical-rl", transform: "rotate(180deg)", whiteSpace: "nowrap" }}>
                              { labelValue }
                          </Typography> }
                </Box>;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // unit abbreviation chip in the top-left corner of the ruler
    function unitChip() : JSX.Element
    {
        return  <Typography variant="caption" sx={{ position: "absolute", left: 2, top: 2, fontSize: 8, color: "text.disabled", userSelect: "none" }}>
                    { UNIT_LABEL[ props.unit ] }
                </Typography>;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // horizontal: flexGrow fills the remaining width after the corner box; height is fixed
    // vertical:   alignSelf stretch fills the column height; width is fixed
    const flexSx : object = isHorizontal
        ? { flexGrow: 1, height: RULER_THICKNESS, borderBottom: 1 }
        : { alignSelf: "stretch", width: RULER_THICKNESS, borderRight: 1 };

    return  <Box ref={ containerRef }
                 sx={{ position: "relative", overflow: "hidden", bgcolor: "background.paper",
                       borderColor: "divider", ...flexSx }}>
                { ticks.map( ( index : number ) : JSX.Element => tick( index ) ) }
                { unitChip() }
            </Box>;
}

export namespace RulerBar
{
    export interface Props
    {
        orientation : "horizontal" | "vertical";
        length      : number;                     // px — initial fallback before first self-measurement
        unit        : SvgDocument.Unit;
        zoom        : number;
        offset      : number;                     // px scroll offset to shift tick 0 to the canvas origin
    }
}

export default RulerBar;
