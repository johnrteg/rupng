//
import React from 'react';
import { JSX } from "react";

import { Box, Chip, Collapse, List, ListItemButton, ListItemText, Tooltip, Typography } from "@mui/material";
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';

import OpenApiOperation from './OpenApiOperation';

//
// OpenApiNav — the left tree of the API reference: endpoints grouped by tag, each group collapsible (all open
// by default). An item shows a small method chip + its summary (or path); selecting it drives the detail pane.
// Presentation-only; the parent owns the selection.
//
export function OpenApiNav( props : OpenApiNav.Props ) : JSX.Element
{
    const [openTags,setOpenTags] = React.useState< Set<string> >( new Set( props.tags ) );

    ////////////////////////////////////////////////////////////////////////////////////////////
    function toggle( tag : string ) : void
    {
        setOpenTags( ( prev : Set<string> ) =>
        {
            const next : Set<string> = new Set( prev );
            ( next.has( tag ) ? next.delete( tag ) : next.add( tag ) );
            return next;
        } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    function item( entry : OpenApiOperation.Entry ) : JSX.Element
    {
        const key : string = OpenApiOperation.keyFor( entry );
        const secured : boolean = ( entry.operation.security?.length ?? 0 ) > 0;
        return  <ListItemButton key={ key } selected={ props.selectedKey === key } onClick={ () => props.onSelect( entry ) } sx={{ borderRadius: 1, py: 0.25, pl: 2 }}>
                    <Chip size="small" color={ OpenApiOperation.colorFor( entry.method ) } label={ entry.method.toUpperCase() }
                          sx={{ height: 18, minWidth: 48, mr: 1, fontSize: 10, fontWeight: 700, "& .MuiChip-label": { px: 0.5 } }} />
                    <ListItemText primary={ entry.operation.summary || entry.path }
                                  sx={{ "& .MuiListItemText-primary": { fontSize: 13, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } }} />
                    { secured && <Tooltip title={"Requires authentication"}><LockOutlinedIcon sx={{ fontSize: 14, color: "text.disabled", ml: 0.5 }} /></Tooltip> }
                </ListItemButton>;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    return  <List dense disablePadding>
                { props.tags.map( ( tag : string ) => (
                    <Box key={ tag }>
                        <ListItemButton onClick={ () => toggle( tag ) } sx={{ borderRadius: 1, py: 0.5 }}>
                            <ListItemText primary={ <Typography variant="overline" sx={{ color: "text.secondary" }}>{ tag }</Typography> } />
                            { openTags.has( tag ) ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" /> }
                        </ListItemButton>
                        <Collapse in={ openTags.has( tag ) } timeout="auto" unmountOnExit>
                            { props.groups[ tag ].map( ( entry : OpenApiOperation.Entry ) => item( entry ) ) }
                        </Collapse>
                    </Box>
                ) ) }
            </List>;
}

export namespace OpenApiNav
{
    export interface Props
    {
        groups      : Record<string, Array<OpenApiOperation.Entry>>;
        tags        : Array<string>;
        selectedKey : string | null;
        onSelect    : ( entry : OpenApiOperation.Entry ) => void;
    }
}

export default OpenApiNav;
// eof
