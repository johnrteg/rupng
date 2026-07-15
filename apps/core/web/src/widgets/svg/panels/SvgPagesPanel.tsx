//
import { JSX } from "react";

import { Box, Button, Card, Stack, Typography } from "@mui/material";
import AddOutlinedIcon from "@mui/icons-material/AddOutlined";

import { SvgDocument } from "@repo/api";

//
// SvgPagesPanel — the bottom horizontal strip of page thumbnails. MVP is single-page, so it shows one page
// card (name + size); "Add Page" is present but multi-page is Phase 2 (logs, no-op).
//
export function SvgPagesPanel( props : SvgPagesPanel.Props ) : JSX.Element
{
    ////////////////////////////////////////////////////////////////////////////////////////////
    // add-page is deferred to Phase 2 (multi-page support)
    function onAddPage() : void
    {
        console.warn( "multi-page coming in phase 2" );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // one page card (the active page for MVP)
    function pageCard( page : SvgDocument.Page ) : JSX.Element
    {
        return  <Card key={ page.id } variant="outlined" sx={{ minWidth: 120, height: 88, p: 1, display: "flex", flexDirection: "column", justifyContent: "flex-end" }}>
                    <Typography variant="caption" noWrap>{ page.name }</Typography>
                    <Typography variant="caption" sx={{ color: "text.secondary" }}>{ `${ Math.round( page.size.width ) } × ${ Math.round( page.size.height ) } pt` }</Typography>
                </Card>;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    return  <Box sx={{ height: 120, borderTop: 1, borderColor: "divider", bgcolor: "background.paper", px: 2, py: 1 }}>
                <Stack direction="row" spacing={ 1 } sx={{ alignItems: "center", height: "100%" }}>
                    { props.doc.pages.map( ( page : SvgDocument.Page ) : JSX.Element => pageCard( page ) ) }
                    <Button size="small" startIcon={ <AddOutlinedIcon /> } onClick={ onAddPage }>{"Add Page"}</Button>
                </Stack>
            </Box>;
}

export namespace SvgPagesPanel
{
    export interface Props
    {
        doc  : SvgDocument.Doc;
        page : SvgDocument.Page;
    }
}

export default SvgPagesPanel;
