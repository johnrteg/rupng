import React from 'react';
import { JSX } from "react";

import { Box, Button, Stack } from "@mui/material";
import AddOutlinedIcon           from '@mui/icons-material/AddOutlined';
import DeleteOutlineOutlinedIcon from '@mui/icons-material/DeleteOutlineOutlined';
import DragIndicatorIcon         from '@mui/icons-material/DragIndicator';

import { DndContext, closestCenter, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

import { EmailTemplate } from '@repo/api';

import ButtonIcon from '@widgets/core/ButtonIcon';
import TextInput  from '@widgets/core/TextInput';
import UrlInput   from '@widgets/core/UrlInput';

//
// SortableWebFontRow — one draggable web-font row: a drag handle, the font NAME, its hosted URL (UrlInput), and
// delete. File-scope so `useSortable` gets its own component (the repo's dnd-kit pattern).
//
function SortableWebFontRow( props : SortableWebFontRow.Props ) : JSX.Element
{
    const sortable : ReturnType<typeof useSortable> = useSortable( { id: props.id, disabled: props.readOnly } );
    const style : React.CSSProperties = { transform: CSS.Transform.toString( sortable.transform ), transition: sortable.transition };
    return <Stack ref={ sortable.setNodeRef } style={ style } spacing={ 0.5 } sx={{ border: 1, borderColor: "divider", borderRadius: 1, p: 1 }}>
        <Stack direction="row" spacing={ 0.5 } sx={{ alignItems: "center" }}>
            <Box { ...sortable.attributes } { ...sortable.listeners } sx={{ display: "flex", cursor: "grab", color: "text.disabled", touchAction: "none" }}><DragIndicatorIcon fontSize="small" /></Box>
            <Box sx={{ flex: 1 }}><TextInput id={ `font-name-${ props.id }` } label={"Font name"} value={ props.name } dense fullWidth disabled={ props.readOnly } onChange={ props.onName } /></Box>
            <ButtonIcon id={ `font-del-${ props.id }` } label={"Remove"} size="small" disabled={ props.readOnly } icon={ <DeleteOutlineOutlinedIcon fontSize="small" /> } onClick={ props.onRemove } />
        </Stack>
        <UrlInput id={ `font-href-${ props.id }` } label={"Hosted URL"} value={ props.href } disabled={ props.readOnly } onChange={ props.onHref } />
    </Stack>;
}
namespace SortableWebFontRow
{
    export interface Props
    {
        id       : string;
        name     : string;
        href     : string;
        readOnly : boolean;
        onName   : ( value : string ) => void;
        onHref   : ( value : string ) => void;
        onRemove : () => void;
    }
}

//
// WebFontListEditor — an ordered, editable list of web fonts (name + hosted URL) with add / remove / drag-to-
// reorder (order = priority). A controlled component: the host owns the list + persistence and passes `fonts`
// in and gets the whole new array back via `onChange`. Reused by the template editor (per-template head fonts)
// and Settings → Email (the platform font library).
//
export function WebFontListEditor( props : WebFontListEditor.Props ) : JSX.Element
{
    const fonts : Array<EmailTemplate.FontDef> = props.fonts;
    const readOnly : boolean = props.readOnly === true;

    // append a blank font row
    function add() : void { props.onChange( [ ...fonts, { name: "", href: "https://" } ] ); }
    // remove the row at `index`
    function remove( index : number ) : void { props.onChange( fonts.filter( ( _font : EmailTemplate.FontDef, at : number ) : boolean => at !== index ) ); }
    // patch the row at `index`
    function setAt( index : number, patch : Partial<EmailTemplate.FontDef> ) : void { props.onChange( fonts.map( ( font : EmailTemplate.FontDef, at : number ) : EmailTemplate.FontDef => ( at === index ? { ...font, ...patch } : font ) ) ); }
    // reorder on drag end (ids are `font-<index>`)
    function onDragEnd( event : DragEndEvent ) : void
    {
        if( !event.over ) return;
        const ids : Array<string> = fonts.map( ( _font : EmailTemplate.FontDef, at : number ) : string => `font-${ at }` );
        const from : number = ids.indexOf( String( event.active.id ) );
        const to : number = ids.indexOf( String( event.over.id ) );
        if( from < 0 || to < 0 || from === to ) return;
        props.onChange( arrayMove( fonts, from, to ) );
    }

    return <Stack spacing={ 1 }>
        <DndContext collisionDetection={ closestCenter } onDragEnd={ onDragEnd }>
            <SortableContext items={ fonts.map( ( _font : EmailTemplate.FontDef, at : number ) : string => `font-${ at }` ) } strategy={ verticalListSortingStrategy }>
                <Stack spacing={ 1 }>
                    { fonts.map( ( font : EmailTemplate.FontDef, at : number ) : JSX.Element => (
                        <SortableWebFontRow key={ `font-${ at }` } id={ `font-${ at }` } name={ font.name } href={ font.href } readOnly={ readOnly }
                                            onName={ ( value : string ) : void => setAt( at, { name: value } ) }
                                            onHref={ ( value : string ) : void => setAt( at, { href: value } ) }
                                            onRemove={ () => remove( at ) } /> ) ) }
                </Stack>
            </SortableContext>
        </DndContext>
        <Button size="small" variant="text" startIcon={ <AddOutlinedIcon fontSize="small" /> } disabled={ readOnly } onClick={ add }>{"Add web font"}</Button>
    </Stack>;
}

export namespace WebFontListEditor
{
    export interface Props
    {
        fonts     : Array<EmailTemplate.FontDef>;
        readOnly? : boolean;
        onChange  : ( fonts : Array<EmailTemplate.FontDef> ) => void;
    }
}

export default WebFontListEditor;
// eof
