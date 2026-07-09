import React from 'react';
import { JSX } from "react";

import { Box, Card, CardContent, Stack } from "@mui/material";
import DeleteOutlineOutlinedIcon from '@mui/icons-material/DeleteOutlineOutlined';
import DragIndicatorIcon         from '@mui/icons-material/DragIndicator';
import ViewColumnOutlinedIcon    from '@mui/icons-material/ViewColumnOutlined';
import TuneOutlinedIcon          from '@mui/icons-material/TuneOutlined';

import { SortableContext, useSortable, horizontalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

import { EmailTemplate } from '@repo/api';

import ButtonIcon from '@widgets/core/ButtonIcon';
import ButtonIconDropdown from '@widgets/core/ButtonIconDropdown';
import TextInput  from '@widgets/core/TextInput';
import SortableColumn from '@widgets/email/editor/SortableColumn';

//
// SortableSection — one draggable section/hero band: a drag handle, a kind icon, an inline-editable NAME (bare
// field), a settings-select button, a column-count control (hidden for a hero), a delete, and a horizontal
// sortable row of its columns (each a SortableColumn).
//
export function SortableSection( props : SortableSection.Props ) : JSX.Element
{
    const sortable : ReturnType<typeof useSortable> = useSortable( { id: props.id, disabled: props.readOnly } );
    const style : React.CSSProperties = { transform: CSS.Transform.toString( sortable.transform ), transition: sortable.transition };
    const columns : Array<EmailTemplate.Block> = props.section.children ?? [];
    const isHero : boolean = props.section.type === EmailTemplate.BlockType.HERO;

    return <Card ref={ sortable.setNodeRef } style={ style } variant="outlined" sx={{ borderColor: props.selected ? "primary.main" : undefined }}>
        <Stack direction="row" spacing={ 0.5 } sx={{ alignItems: "center", px: 1, py: 0.5, borderBottom: "1px solid", borderColor: "divider" }}>
            <Box { ...sortable.attributes } { ...sortable.listeners } sx={{ display: "flex", cursor: "grab", color: "text.disabled", touchAction: "none" }}><DragIndicatorIcon fontSize="small" /></Box>
            <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                <TextInput id={ `sec-name-${ props.section.id }` } label={""} placeHolder={"Section name"} value={ String( props.section.props?.name ?? "" ) } dense fullWidth disabled={ props.readOnly }
                           sx={{ "& .MuiOutlinedInput-notchedOutline": { border: "none" } }}
                           onChange={ ( value : string ) : void => props.onRename( value ) } />
            </Box>
            <ButtonIcon id={ `sec-cfg-${ props.section.id }` } label={"Section settings"} size="small" disabled={ props.readOnly } icon={ <TuneOutlinedIcon fontSize="small" /> } onClick={ props.onSelectSection } />
            { !isHero &&
                <ButtonIconDropdown id={ `sec-cols-${ props.section.id }` } label={"Columns"} size="small" disabled={ props.readOnly } icon={ <ViewColumnOutlinedIcon fontSize="small" /> }
                                    selected={ String( Math.max( 1, columns.length ) ) }
                                    choices={ [ 1, 2, 3, 4 ].map( ( count : number ) : ButtonIconDropdown.Choice => ( { value: String( count ), label: count === 1 ? "1 column" : `${ count } columns` } ) ) }
                                    onChange={ ( value : string ) : void => props.onSetColumns( Number( value ) ) } /> }
            <ButtonIcon id={ `sec-del-${ props.section.id }` } label={"Delete section"} size="small" disabled={ props.readOnly } icon={ <DeleteOutlineOutlinedIcon fontSize="small" /> } onClick={ props.onDeleteSection } />
        </Stack>
        <CardContent sx={{ p: 1 }}>
            <SortableContext items={ columns.map( ( column : EmailTemplate.Block ) : string => `col-${ column.id }` ) } strategy={ horizontalListSortingStrategy }>
                <Stack direction="row" spacing={ 1 } sx={{ alignItems: "flex-start" }}>
                    { columns.map( ( column : EmailTemplate.Block ) : JSX.Element => (
                        <SortableColumn key={ `col-${ column.id }` } id={ `col-${ column.id }` } column={ column } selected={ props.selectedBlockId === column.id }
                                        selectedBlockId={ props.selectedBlockId } readOnly={ props.readOnly }
                                        onSelectColumn={ props.onSelectBlock }
                                        onAddBlock={ props.onAddBlock } onSelectBlock={ props.onSelectBlock } onDeleteBlock={ props.onDeleteBlock } />
                    ) ) }
                </Stack>
            </SortableContext>
        </CardContent>
    </Card>;
}

export namespace SortableSection
{
    export interface Props
    {
        id               : string;
        section          : EmailTemplate.Block;
        selected         : boolean;
        selectedBlockId  : string | null;
        readOnly         : boolean;
        onRename         : ( name : string ) => void;
        onSelectSection  : () => void;
        onDeleteSection  : () => void;
        onSetColumns     : ( count : number ) => void;
        onAddBlock       : ( columnId : string, type : EmailTemplate.BlockType ) => void;
        onSelectBlock    : ( id : string ) => void;
        onDeleteBlock    : ( id : string ) => void;
    }
}

export default SortableSection;
// eof
