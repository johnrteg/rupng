//
import React from 'react';
import { JSX } from "react";

//
import { Box } from '@mui/material';

//
import HtmlInput from "@widgets/core/HtmlInput";

//
// A mini, scrollable viewer for a legal document (Terms of Service, Privacy Policy, …).
// The HTML is loaded from a public URL (e.g. "/legal/terms.html") and rendered via <HtmlInput>.
// It fires `onReachedEnd` once the user has scrolled to the bottom — the caller uses that to
// unlock the "I agree" checkbox (you can't agree to what you haven't seen). If the document is
// short enough that it fits without scrolling, the end is considered reached immediately.
//
export function LegalScroll( props : LegalScroll.Props ) : JSX.Element
{
    const [html,setHtml]        = React.useState< string >( "" );
    const [reached,setReached]  = React.useState< boolean >( false );
    const boxRef                = React.useRef< HTMLDivElement | null >( null );

    React.useEffect( () => { void load(); }, [ props.src ] );

    ////////////////////////////////////////////////////////////////////////////////////////////
    async function load() : Promise<void>
    {
        try
        {
            const response : Response = await fetch( props.src );
            const text     : string   = await response.text();
            setHtml( text );
        }
        catch( err )
        {
            setHtml( "<p>Unable to load the document. Please try again later.</p>" );
        }
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // after the content paints, a document that already fits (no scrollbar) counts as "read"
    React.useEffect( checkFits, [ html ] );

    function checkFits() : void
    {
        const el : HTMLDivElement | null = boxRef.current;
        if( !el || html === "" ) return;
        if( el.scrollHeight - el.clientHeight <= LegalScroll.THRESHOLD ) markReached();
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    function onScroll() : void
    {
        const el : HTMLDivElement | null = boxRef.current;
        if( !el ) return;
        if( el.scrollTop + el.clientHeight >= el.scrollHeight - LegalScroll.THRESHOLD ) markReached();
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    function markReached() : void
    {
        if( reached ) return;          // fire the callback only once
        setReached( true );
        if( props.onReachedEnd ) props.onReachedEnd();
    }


    // ===============================================================================================
    return  <Box ref={ boxRef }
                 onScroll={ onScroll }
                 sx={{
                        maxHeight   : props.maxHeight ?? 180,
                        overflowY   : "auto",
                        border      : 1,
                        borderColor : "divider",
                        borderRadius: 1,
                        p           : 1.5,
                     }}>
                <HtmlInput id={ props.id } value={ html } />
            </Box>;
}

export namespace LegalScroll
{
    // px tolerance — reaching "close enough" to the bottom counts (sub-pixel / zoom rounding)
    export const THRESHOLD : number = 8;

    export interface Props
    {
        id            : string;
        src           : string;          // public URL of the HTML document (e.g. "/legal/terms.html")
        maxHeight?    : number;          // viewport height before it scrolls (default 180)
        onReachedEnd? : () => void;      // fired once the bottom is reached (or the doc already fits)
    }
}

export default LegalScroll;

// eof
