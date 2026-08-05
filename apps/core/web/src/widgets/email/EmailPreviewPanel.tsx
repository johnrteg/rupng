import React from 'react';
import { JSX } from "react";

import { Box, Stack, ToggleButton, ToggleButtonGroup, Typography } from "@mui/material";
import CloseOutlinedIcon          from '@mui/icons-material/CloseOutlined';
import DesktopWindowsOutlinedIcon from '@mui/icons-material/DesktopWindowsOutlined';
import PhoneIphoneOutlinedIcon    from '@mui/icons-material/PhoneIphoneOutlined';

import { Email } from '@repo/api';

import ButtonIcon from '@widgets/core/ButtonIcon';

//
// EmailPreviewPanel — the right-side email PREVIEW panel: renders compiled HTML in a sandboxed iframe at a
// desktop or mobile viewport (a toggle resizes the panel + frame). Docked INLINE alongside the editor (not an
// overlay) so it stays visible while the author keeps working; the Close button hides it and the toolbar's eye
// icon brings it back. Presentation-only; the host owns the open/viewport state + the compiled HTML.
//
export function EmailPreviewPanel( props : EmailPreviewPanel.Props ) : JSX.Element
{
    ////////////////////////////////////////////////////////////////////////////////////////////
    // switch the viewport — ignore a null (deselect) toggle so one is always active
    function onToggle( _event : React.MouseEvent, value : Email.PreviewViewport | null ) : void
    {
        if( value ) props.onMode( value );
    }

    return <Box sx={{ width: props.mode === Email.PreviewViewport.MOBILE ? 420 : 760, flexShrink: 0, borderLeft: "1px solid", borderColor: "divider", height: "100%", display: "flex", flexDirection: "column", transition: "width 0.2s" }}>
        <Stack direction="row" spacing={ 1 } sx={{ alignItems: "center", px: 2, py: 1, borderBottom: "1px solid", borderColor: "divider" }}>
            <Typography variant="subtitle2" sx={{ flexGrow: 1 }}>{"Preview"}</Typography>
            <ToggleButtonGroup size="small" exclusive value={ props.mode } onChange={ onToggle }>
                <ToggleButton value={ Email.PreviewViewport.DESKTOP }><DesktopWindowsOutlinedIcon fontSize="small" /></ToggleButton>
                <ToggleButton value={ Email.PreviewViewport.MOBILE }><PhoneIphoneOutlinedIcon fontSize="small" /></ToggleButton>
            </ToggleButtonGroup>
            <ButtonIcon id="tpl-preview-close" label={"Close"} size="small" icon={ <CloseOutlinedIcon fontSize="small" /> } onClick={ props.onClose } />
        </Stack>
        <Box sx={{ flexGrow: 1, minHeight: 0, overflow: "auto", display: "flex", justifyContent: "center", p: 2, bgcolor: "action.hover" }}>
            <Box component="iframe" title="preview" sandbox="" srcDoc={ props.html }
                 sx={{ width: props.mode === Email.PreviewViewport.MOBILE ? 380 : 680, height: "100%", border: 1, borderColor: "divider", borderRadius: 1, bgcolor: "#fff" }} />
        </Box>
    </Box>;
}

export namespace EmailPreviewPanel
{
    export interface Props
    {
        mode    : Email.PreviewViewport;                    // current viewport (panel is only mounted while open)
        html    : string;                                   // compiled HTML to render in the iframe
        onMode  : ( mode : Email.PreviewViewport ) => void;  // viewport toggle
        onClose : () => void;
    }
}

export default EmailPreviewPanel;
// eof
