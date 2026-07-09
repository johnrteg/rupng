import React from 'react';
import { JSX } from "react";

import { Box, Button, Popover, Stack, Typography } from "@mui/material";
import ColorLensOutlinedIcon from '@mui/icons-material/ColorLensOutlined';
import CloseOutlinedIcon     from '@mui/icons-material/CloseOutlined';

import { MuiColorInput } from 'mui-color-input';

import { DndContext, closestCenter, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, useSortable, rectSortingStrategy, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

import ButtonIcon  from '@widgets/core/ButtonIcon';
import ColorPicker from '@widgets/core/ColorPicker';

//
// SortableSwatch — one draggable color chip: the swatch itself is the drag handle, with a small remove button
// beneath it. File-scope so `useSortable` gets its own component (the repo's dnd-kit pattern, per WebFontListEditor).
//
function SortableSwatch( props : SortableSwatch.Props ) : JSX.Element
{
    const sortable : ReturnType<typeof useSortable> = useSortable( { id: props.id, disabled: props.readOnly } );
    const style : React.CSSProperties = { transform: CSS.Transform.toString( sortable.transform ), transition: sortable.transition };
    return <Box ref={ sortable.setNodeRef } style={ style } sx={{ position: "relative" }}>
        <Box { ...sortable.attributes } { ...sortable.listeners }
             title={ props.color }
             sx={{ width: 36, height: 36, borderRadius: 1, bgcolor: props.color, border: 1, borderColor: "divider", cursor: props.readOnly ? "default" : "grab", touchAction: "none" }} />
        { !props.readOnly ? <ButtonIcon id={ `swatch-del-${ props.id }` } label={"Remove"} size="small" icon={ <CloseOutlinedIcon sx={{ fontSize: 12 }} /> } onClick={ props.onRemove } sx={{ position: "absolute", top: -10, right: -10 }} /> : null }
    </Box>;
}
namespace SortableSwatch
{
    export interface Props
    {
        id       : string;
        color    : string;
        readOnly : boolean;
        onRemove : () => void;
    }
}

//
// PaletteEditor — an ordered, editable set of brand colors (hex) with add / remove / drag-to-reorder (order is
// meaningful — it's the palette's priority). A CONTROLLED component: the host owns the array + persistence and
// passes `value` in, getting the whole new array back via `onChange`. Reused by Account → Theme and the campaign
// editor's Theme section.
//
export function PaletteEditor( props : PaletteEditor.Props ) : JSX.Element
{
    const colors : Array<string> = props.value;
    const readOnly : boolean = props.readOnly === true;

    // the working color in the add-picker (a sensible default until the user picks)
    const [pending,setPending] = React.useState< string >( "#2196f3" );
    const [addOpen,setAddOpen] = React.useState< boolean >( false );   // the add-color popover
    const addAnchor            = React.useRef< HTMLDivElement | null >( null );

    // the swatches offered in the add popover (standard + greys + white)
    const addChoices : Array<string> = [ "#ffffff", ...ColorPicker.COLORS, ...ColorPicker.GREYS ];

    // append a color (skip blanks + exact duplicates so the palette stays clean)
    function addColor( hex : string ) : void
    {
        const next : string = hex.trim();
        if( next === "" || colors.includes( next ) ) return;
        props.onChange( [ ...colors, next ] );
    }

    // add a swatch the user clicked in the popover, then close
    function addAndClose( hex : string ) : void
    {
        addColor( hex );
        setAddOpen( false );
    }

    // remove the swatch at `index`
    function remove( index : number ) : void
    {
        props.onChange( colors.filter( ( _color : string, at : number ) : boolean => at !== index ) );
    }

    // reorder on drag end (ids are `swatch-<index>`)
    function onDragEnd( event : DragEndEvent ) : void
    {
        if( !event.over ) return;
        const ids : Array<string> = colors.map( ( _color : string, at : number ) : string => `swatch-${ at }` );
        const from : number = ids.indexOf( String( event.active.id ) );
        const to : number = ids.indexOf( String( event.over.id ) );
        if( from < 0 || to < 0 || from === to ) return;
        props.onChange( arrayMove( colors, from, to ) );
    }

    return <Stack spacing={ 1.5 }>
        {/* header: label + the add-color trigger (opens the color picker popover) */}
        <Stack direction="row" spacing={ 1 } sx={{ alignItems: "center" }}>
            { props.label !== undefined ? <Typography variant="subtitle2">{ props.label }</Typography> : null }
            { !readOnly ?
                <Box ref={ addAnchor } sx={{ display: "inline-flex" }}>
                    <ButtonIcon id="palette-add-btn" label={"Add color"} size="small" icon={ <ColorLensOutlinedIcon fontSize="small" /> } onClick={ () : void => setAddOpen( true ) } />
                </Box> : null }
        </Stack>

        <DndContext collisionDetection={ closestCenter } onDragEnd={ onDragEnd }>
            <SortableContext items={ colors.map( ( _color : string, at : number ) : string => `swatch-${ at }` ) } strategy={ rectSortingStrategy }>
                <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1, alignItems: "flex-start" }}>
                    { colors.map( ( color : string, at : number ) : JSX.Element => (
                        <SortableSwatch key={ `swatch-${ at }` } id={ `swatch-${ at }` } color={ color } readOnly={ readOnly } onRemove={ () => remove( at ) } /> ) ) }
                    { colors.length === 0 ? <Typography variant="body2" sx={{ color: "text.secondary" }}>{"No colors yet."}</Typography> : null }
                </Box>
            </SortableContext>
        </DndContext>

        {/* add-color picker popover: freeform input + standard swatches; picking adds to the palette */}
        <Popover open={ addOpen } anchorEl={ addAnchor.current } onClose={ () : void => setAddOpen( false ) }
                 anchorOrigin={{ vertical: "bottom", horizontal: "left" }}>
            <Stack spacing={ 1 } sx={{ p: 1.5, width: 236 }}>
                <MuiColorInput value={ pending } format="hex" isAlphaHidden onChange={ setPending } />
                <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
                    { addChoices.map( ( hex : string ) : JSX.Element => (
                        <Box key={ hex } title={ hex } onClick={ () : void => addAndClose( hex ) }
                             sx={{ width: 20, height: 20, borderRadius: 0.5, bgcolor: hex, border: 1, borderColor: "divider", cursor: "pointer" }} /> ) ) }
                </Box>
                <Button size="small" variant="outlined" onClick={ () : void => addAndClose( pending ) }>{"Add"}</Button>
            </Stack>
        </Popover>
    </Stack>;
}

export namespace PaletteEditor
{
    export interface Props
    {
        value     : Array<string>;                       // the ordered hex palette
        label?    : string;                              // section title shown before the add button
        readOnly? : boolean;
        onChange  : ( colors : Array<string> ) => void;   // the whole new array
    }
}

export default PaletteEditor;
// eof
