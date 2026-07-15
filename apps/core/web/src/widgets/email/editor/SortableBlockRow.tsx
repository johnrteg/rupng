import React from 'react';
import { JSX } from "react";

import { Box, Stack, Typography } from "@mui/material";
import DeleteOutlineOutlinedIcon from '@mui/icons-material/DeleteOutlineOutlined';
import DragIndicatorIcon         from '@mui/icons-material/DragIndicator';

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

import { EmailTemplate } from '@repo/api';

import ButtonIcon from '@widgets/core/ButtonIcon';
import { blockSummary } from '@widgets/email/editor/EmailEditorModel';

//
// SortableBlockRow — one draggable content-block row (drag handle + summary + delete). Selecting it opens the
// inspector for that block.
//
export function SortableBlockRow( props : SortableBlockRow.Props ) : JSX.Element
{
    const sortable : ReturnType<typeof useSortable> = useSortable( { id: props.id, disabled: props.readOnly } );
    const style : React.CSSProperties = { transform: CSS.Transform.toString( sortable.transform ), transition: sortable.transition };
    return <Stack ref={ sortable.setNodeRef } style={ style } direction="row" spacing={ 0.5 } onClick={ props.onSelect }
                  sx={{ alignItems: "center", px: 1, py: 0.5, borderRadius: 1, cursor: "pointer",
                        bgcolor: props.selected ? "action.selected" : "transparent", "&:hover": { bgcolor: "action.hover" } }}>
        <Box { ...sortable.attributes } { ...sortable.listeners } sx={{ display: "flex", cursor: "grab", color: "text.disabled", touchAction: "none" }}><DragIndicatorIcon fontSize="small" /></Box>
        <Typography variant="body2" noWrap sx={{ flexGrow: 1, minWidth: 0 }}>{ blockSummary( props.block ) }</Typography>
        <ButtonIcon id={ `blk-del-${ props.block.id }` } label={"Delete"} size="small" disabled={ props.readOnly } icon={ <DeleteOutlineOutlinedIcon fontSize="small" /> } onClick={ props.onDelete } />
    </Stack>;
}

export namespace SortableBlockRow
{
    export interface Props { id : string; block : EmailTemplate.Block; selected : boolean; readOnly : boolean; onSelect : () => void; onDelete : () => void; }
}

export default SortableBlockRow;
// eof
