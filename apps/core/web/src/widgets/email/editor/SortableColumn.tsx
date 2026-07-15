import React from 'react';
import { JSX } from "react";

import { Box, Stack, Typography } from "@mui/material";
import AddOutlinedIcon    from '@mui/icons-material/AddOutlined';
import DragIndicatorIcon  from '@mui/icons-material/DragIndicator';
import TuneOutlinedIcon   from '@mui/icons-material/TuneOutlined';

import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

import { EmailTemplate } from '@repo/api';

import ButtonIcon from '@widgets/core/ButtonIcon';
import ButtonIconDropdown from '@widgets/core/ButtonIconDropdown';
import SortableBlockRow from '@widgets/email/editor/SortableBlockRow';
import { BLOCK_KINDS } from '@widgets/email/editor/EmailEditorModel';

//
// SortableColumn — one draggable column within a section: a drag handle, a select-for-inspector settings button,
// an add-block dropdown, and its own vertical sortable list of content blocks.
//
export function SortableColumn( props : SortableColumn.Props ) : JSX.Element
{
    const sortable : ReturnType<typeof useSortable> = useSortable( { id: props.id, disabled: props.readOnly } );
    const style : React.CSSProperties = { transform: CSS.Transform.toString( sortable.transform ), transition: sortable.transition };
    const blocks : Array<EmailTemplate.Block> = props.column.children ?? [];

    return <Box ref={ sortable.setNodeRef } style={ style }
                sx={{ flex: 1, minWidth: 0, border: 1, borderColor: props.selected ? "primary.main" : "divider", borderRadius: 1, p: 0.5, bgcolor: props.selected ? "action.selected" : "transparent" }}>
        <Stack direction="row" spacing={ 0.5 } sx={{ alignItems: "center", mb: 0.5 }}>
            <Box { ...sortable.attributes } { ...sortable.listeners } sx={{ display: "flex", cursor: "grab", color: "text.disabled", touchAction: "none" }}><DragIndicatorIcon fontSize="small" /></Box>
            <Typography variant="caption" sx={{ color: "text.disabled", flexGrow: 1, pl: 0.5 }}>{"Column"}</Typography>
            <ButtonIcon id={ `col-cfg-${ props.column.id }` } label={"Column settings"} size="small" disabled={ props.readOnly } icon={ <TuneOutlinedIcon fontSize="small" /> } onClick={ () => props.onSelectColumn( props.column.id ) } />
            <ButtonIconDropdown id={ `col-add-${ props.column.id }` } label={"Add block"} size="small" disabled={ props.readOnly } icon={ <AddOutlinedIcon fontSize="small" /> }
                                choices={ BLOCK_KINDS.map( ( kind : { type : EmailTemplate.BlockType; label : string } ) : ButtonIconDropdown.Choice => ( { value: kind.type, label: kind.label } ) ) }
                                onChange={ ( value : string ) : void => props.onAddBlock( props.column.id, value as EmailTemplate.BlockType ) } />
        </Stack>
        <SortableContext items={ blocks.map( ( block : EmailTemplate.Block ) : string => `block-${ block.id }` ) } strategy={ verticalListSortingStrategy }>
            <Stack spacing={ 0.5 }>
                { blocks.length === 0 && <Typography variant="caption" sx={{ color: "text.disabled", px: 1 }}>{"Empty — use + to add a block."}</Typography> }
                { blocks.map( ( block : EmailTemplate.Block ) : JSX.Element => (
                    <SortableBlockRow key={ `block-${ block.id }` } id={ `block-${ block.id }` } block={ block } selected={ props.selectedBlockId === block.id } readOnly={ props.readOnly }
                                      onSelect={ () => props.onSelectBlock( block.id ) } onDelete={ () => props.onDeleteBlock( block.id ) } />
                ) ) }
            </Stack>
        </SortableContext>
    </Box>;
}

export namespace SortableColumn
{
    export interface Props
    {
        id              : string;
        column          : EmailTemplate.Block;
        selected        : boolean;
        selectedBlockId : string | null;
        readOnly        : boolean;
        onSelectColumn  : ( id : string ) => void;
        onAddBlock      : ( columnId : string, type : EmailTemplate.BlockType ) => void;
        onSelectBlock   : ( id : string ) => void;
        onDeleteBlock   : ( id : string ) => void;
    }
}

export default SortableColumn;
// eof
