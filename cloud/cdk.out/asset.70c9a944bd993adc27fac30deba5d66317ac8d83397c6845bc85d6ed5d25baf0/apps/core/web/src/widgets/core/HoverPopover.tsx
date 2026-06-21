//
import React from 'react';
import { JSX } from "react";

//
import Popper, { PopperPlacementType } from '@mui/material/Popper';
import Paper                           from '@mui/material/Paper';
import { useTheme, Theme }             from '@mui/material';


//
// A lightweight, reusable hover popover.
//
// The CONTAINER (portal, positioning, paper styling, z-index) is generic; the CONTENT is
// whatever children the caller passes in.  It anchors to a screen coordinate (typically the
// mouse position) through a virtual element, so it works for hover targets that are not real
// DOM nodes - e.g. items drawn by a canvas/calendar library where there is no element to
// anchor to.
//
// By default the popover is non-interactive (pointerEvents: none) so it can follow / sit under
// the cursor without stealing mouse events and causing hover flicker.  Set interactive when the
// content needs to be clickable (links, buttons).
//
export function HoverPopover( props : HoverPopover.Props ) : JSX.Element | null
{
    const theme : Theme = useTheme();

    if( !props.open || props.anchor === null )return null;

    const x : number = props.anchor.x;
    const y : number = props.anchor.y;

    // virtual anchor positioned at the given screen coordinate
    const anchorEl = {
        getBoundingClientRect : () : DOMRect => ( {
                                                    x, y,
                                                    top    : y,
                                                    left   : x,
                                                    right  : x,
                                                    bottom : y,
                                                    width  : 0,
                                                    height : 0,
                                                    toJSON : () => ""
                                                } as DOMRect )
    };

    return  <Popper open={ props.open }
                    anchorEl={ anchorEl }
                    placement={ props.placement ?? "right-start" }
                    modifiers={ [ { name: "offset", options: { offset: [ 0, props.offset ?? 14 ] } },
                                  { name: "preventOverflow", options: { padding: 8 } } ] }
                    style={ { zIndex        : theme.zIndex.tooltip,
                              pointerEvents  : props.interactive ? "auto" : "none" } } >

                <Paper  elevation={ 8 }
                        sx={ { p            : 1.5,
                               maxWidth     : props.maxWidth ?? 320,
                               border       : 1,
                               borderColor  : "divider",
                               borderRadius : 1.5 } } >
                    { props.children }
                </Paper>

            </Popper>;
}

export namespace HoverPopover
{
    export interface Anchor
    {
        x : number;
        y : number;
    }

    export interface Props
    {
        open            : boolean;
        anchor          : HoverPopover.Anchor | null;     // screen coordinate to anchor to (e.g. mouse position)
        children?       : React.ReactNode;                // unique, caller-supplied content
        placement?      : PopperPlacementType;            // default "right-start"
        offset?         : number;                         // gap from the anchor, default 14
        maxWidth?       : number | string;                // default 320
        interactive?    : boolean;                        // default false -> pointer events disabled
    }
}

export default HoverPopover;

// eof
