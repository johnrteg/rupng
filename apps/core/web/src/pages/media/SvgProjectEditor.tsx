//
import React from "react";
import { JSX } from "react";

import { Box, Stack, Typography } from "@mui/material";
import ArrowBackOutlinedIcon from "@mui/icons-material/ArrowBackOutlined";

import ButtonIcon from "@widgets/core/ButtonIcon";
import SvgDesignEditor from "@widgets/svg/SvgDesignEditor";

//
// SvgProjectEditor — the full-viewport editor page for one SVG project. Hosts the SvgDesignEditor widget with
// a slim header carrying a back control. `projectId` is supplied by the parent (the projects list renders this
// inline); route-param wiring can layer on later without changing this component.
//
export function SvgProjectEditor( props : SvgProjectEditor.Props ) : JSX.Element
{
    ////////////////////////////////////////////////////////////////////////////////////////////
    // return to the projects list
    function onBack() : void
    {
        if( props.onBack ) props.onBack();
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    return  <Box sx={{ display: "flex", flexDirection: "column", height: "100vh", bgcolor: "background.default" }}>
                <Stack direction="row" spacing={ 1 } sx={{ alignItems: "center", px: 1, py: 0.5, borderBottom: 1, borderColor: "divider", bgcolor: "background.paper" }}>
                    <ButtonIcon id="svg-editor-back" label={"Back to designs"} size="small" icon={ <ArrowBackOutlinedIcon fontSize="small" /> } onClick={ onBack } />
                    <Typography variant="subtitle2">{"Design editor"}</Typography>
                </Stack>
                <Box sx={{ flexGrow: 1, minHeight: 0 }}>
                    <SvgDesignEditor projectId={ props.projectId } />
                </Box>
            </Box>;
}

export namespace SvgProjectEditor
{
    export interface Props
    {
        projectId : string;
        onBack?   : () => void;
    }
}

export default SvgProjectEditor;
