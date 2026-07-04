//
import React from 'react';
import { JSX } from "react";

import { Box, Button, Chip, CircularProgress, Stack, Typography } from "@mui/material";
import SaveOutlinedIcon        from '@mui/icons-material/SaveOutlined';
import RestartAltOutlinedIcon  from '@mui/icons-material/RestartAltOutlined';
import CheckCircleOutlineIcon  from '@mui/icons-material/CheckCircleOutlined';

//
// SaveBar — the sticky bottom action bar for editable panels (Profile/Account/… details). Pinned to the
// bottom of its scroll container with an OPAQUE background + a raised stacking context, so scrolling
// content passes UNDER it instead of showing through. It OWNS the save lifecycle: `onSave` runs, the
// button shows a spinner, and on success a green "Saved" chip flashes for 2s then clears; a failure keeps
// the `error` text visible. Save/Reset enable only when `dirty` (and not saving). Reusable so every
// editable panel looks + behaves the same.
//
export function SaveBar( props : SaveBar.Props ) : JSX.Element
{
    const [ busy, setBusy ]   = React.useState< boolean >( false );
    const [ saved, setSaved ] = React.useState< boolean >( false );
    const timer = React.useRef< ReturnType<typeof setTimeout> | null >( null );

    // clear the pending "Saved" timer on unmount (no setState after unmount)
    React.useEffect( () => () => { if( timer.current ) clearTimeout( timer.current ); }, [] );

    ////////////////////////////////////////////////////////////////////////////////////////////
    async function onSave() : Promise<void>
    {
        if( busy ) return;
        setBusy( true );
        setSaved( false );
        try
        {
            const ok : boolean = await props.onSave();
            if( ok )
            {
                setSaved( true );
                if( timer.current ) clearTimeout( timer.current );
                timer.current = setTimeout( () => setSaved( false ), 2000 );   // green chip auto-dismisses
            }
        }
        finally
        {
            setBusy( false );
        }
    }

    const enabled : boolean = props.dirty && !busy;

    return  <Box sx={{
                    position:   "sticky",
                    bottom:     0,
                    zIndex:     ( theme ) => theme.zIndex.appBar,   // paint above scrolling content
                    borderTop:  1,
                    borderColor:"divider",
                    // fully opaque — background.paper as a solid fill (no dark-mode elevation overlay bleed)
                    bgcolor:        "background.paper",
                    backgroundImage:"none",
                    px: 3, py: 1.5,
                }}>
                <Stack direction="row" spacing={ 2 } sx={{ alignItems: "center", maxWidth: props.maxWidth ?? 880, mx: "auto" }}>
                    { saved
                        ? <Chip size="small" color="success" variant="filled" icon={ <CheckCircleOutlineIcon /> } label={ props.savedLabel ?? "Saved" } />
                        : ( props.error !== undefined && props.error !== "" &&
                            <Typography variant="body2" sx={{ color: "error.main" }}>{ props.error }</Typography> )
                    }
                    <Box sx={{ flexGrow: 1 }} />
                    { props.onReset &&
                        <Button variant="text" color="inherit" startIcon={ <RestartAltOutlinedIcon /> } disabled={ !enabled } onClick={ props.onReset }>
                            { props.resetLabel ?? "Reset" }
                        </Button>
                    }
                    <Button variant="contained" startIcon={ busy ? <CircularProgress size={ 15 } color="inherit" /> : <SaveOutlinedIcon /> } disabled={ !enabled } onClick={ () => void onSave() }>
                        { props.saveLabel ?? "Save" }
                    </Button>
                </Stack>
            </Box>;
}

export namespace SaveBar
{
    export interface Props
    {
        dirty       : boolean;
        /** Perform the save; resolve `true` on success (flashes the green "Saved" chip), `false` on failure. */
        onSave      : () => Promise<boolean>;
        onReset?    : () => void;
        error?      : string;             // persistent failure text (shown until the next save attempt)
        saveLabel?  : string;
        resetLabel? : string;
        savedLabel? : string;
        maxWidth?   : number | string;    // align the actions to the panel content width (default 880)
    }
}

export default SaveBar;
