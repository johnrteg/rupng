//
import { JSX } from "react";

import { Box } from "@mui/material";

import { SvgDocument } from "@repo/api";

//
// RulerBar — a thin measurement strip (top or left) with tick marks every 10pt (scaled by zoom). MVP is a
// static visual guide; interactive drag-to-create guides is Phase 2. Colors come from the theme.
//
export function RulerBar( props : RulerBar.Props ) : JSX.Element
{
    const RULER_THICKNESS : number = 20;   // px
    const TICK_STEP_PT : number = 10;      // a tick every 10 points

    // the on-screen spacing between ticks (10pt scaled by the current zoom)
    const tickSpacing : number = TICK_STEP_PT * props.zoom;
    const tickCount : number = tickSpacing > 0 ? Math.ceil( props.length / tickSpacing ) : 0;
    const ticks : Array<number> = Array.from( { length: tickCount }, ( _value : unknown, index : number ) : number => index );
    const isHorizontal : boolean = props.orientation === "horizontal";

    ////////////////////////////////////////////////////////////////////////////////////////////
    // one tick mark (a short line perpendicular to the ruler), positioned along it
    function tick( index : number ) : JSX.Element
    {
        const position : number = index * tickSpacing + props.offset;
        const major : boolean = index % 5 === 0;   // every 5th tick is longer
        const extent : number = major ? RULER_THICKNESS * 0.6 : RULER_THICKNESS * 0.3;
        const style : object = isHorizontal
            ? { position: "absolute", left: position, bottom: 0, width: "1px", height: extent, bgcolor: "divider" }
            : { position: "absolute", top: position, right: 0, height: "1px", width: extent, bgcolor: "divider" };
        return <Box key={ index } sx={ style } />;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    return  <Box sx={{ position: "relative", overflow: "hidden", bgcolor: "background.paper", borderColor: "divider",
                       width: isHorizontal ? props.length : RULER_THICKNESS, height: isHorizontal ? RULER_THICKNESS : props.length,
                       borderBottom: isHorizontal ? 1 : 0, borderRight: isHorizontal ? 0 : 1 }}>
                { ticks.map( ( index : number ) : JSX.Element => tick( index ) ) }
            </Box>;
}

export namespace RulerBar
{
    export interface Props
    {
        orientation : "horizontal" | "vertical";
        length      : number;                     // px
        unit        : SvgDocument.Unit;
        zoom        : number;
        offset      : number;                     // px scroll/pan offset
    }
}

export default RulerBar;
