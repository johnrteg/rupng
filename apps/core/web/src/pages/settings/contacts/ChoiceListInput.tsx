//
import React from 'react';
import { JSX } from "react";

import { Box, Stack, Typography } from "@mui/material";
import AddOutlinedIcon           from '@mui/icons-material/AddOutlined';
import DeleteOutlineOutlinedIcon from '@mui/icons-material/DeleteOutlineOutlined';
import DragIndicatorIcon         from '@mui/icons-material/DragIndicator';

import { DndContext, closestCenter, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

import TextInput  from '@widgets/core/TextInput';
import ButtonIcon from '@widgets/core/ButtonIcon';
import Pusher from '@widgets/core/Pusher';

//
// ChoiceListInput — an ORDERED, drag-to-reorder list of choice labels (for a CHOICE / MULTI_CHOICE custom
// field). Order is meaningful (dropdown display order), so rows drag to reorder (via @dnd-kit), and can be
// edited / added / removed. Value is the ordered array of labels; rows are keyed by stable index tokens so a
// blank / duplicate label doesn't break the sortable identity.
//
export function ChoiceListInput( props : ChoiceListInput.Props ) : JSX.Element
{
    // stable per-row ids (index-based tokens) so sortable identity survives edits/dupes
    const ids : Array<string> = props.value.map( ( _label : string, index : number ) : string => `choice-${ index }` );

    ////////////////////////////////////////////////////////////////////////////////////////////
    function setAt( index : number, label : string ) : void
    {
        props.onChange( props.value.map( ( value : string, at : number ) : string => at === index ? label : value ) );
    }
    function removeAt( index : number ) : void
    {
        props.onChange( props.value.filter( ( _value : string, at : number ) : boolean => at !== index ) );
    }
    function add() : void
    {
        props.onChange( [ ...props.value, "" ] );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // on drag end, reorder the labels array from the dragged id to the drop id
    function onDragEnd( event : DragEndEvent ) : void
    {
        const from : number = ids.indexOf( String( event.active.id ) );
        const to : number = event.over ? ids.indexOf( String( event.over.id ) ) : -1;
        if( from < 0 || to < 0 || from === to ) return;
        props.onChange( arrayMove( props.value, from, to ) );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    return  <Stack spacing={ 1 }>
                <Stack direction="row" spacing={ 1 } sx={{ alignItems: "center" }}>
                    <Typography variant="overline" sx={{ color: "text.secondary" }}>{ props.label ?? "Choices" }</Typography>
                    <Pusher/>
                    <ButtonIcon id="choice-add" label={"Add choice"} size="small" icon={ <AddOutlinedIcon fontSize="small" /> } onClick={ add } />
                </Stack>
                { props.value.length === 0
                    ? <Typography variant="caption" sx={{ color: "text.secondary" }}>{"No choices yet — add one. Drag the handle to reorder."}</Typography>
                    : <DndContext collisionDetection={ closestCenter } onDragEnd={ onDragEnd }>
                        <SortableContext items={ ids } strategy={ verticalListSortingStrategy }>
                            <Stack spacing={ 1 }>
                                { props.value.map( ( label : string, index : number ) : JSX.Element => (
                                    <ChoiceRow key={ ids[ index ] } id={ ids[ index ] } label={ label }
                                               onLabel={ ( value : string ) : void => setAt( index, value ) }
                                               onRemove={ () : void => removeAt( index ) } />
                                ) ) }
                            </Stack>
                        </SortableContext>
                      </DndContext> }
            </Stack>;
}

//
// One sortable choice row — a drag handle (the sortable listeners attach here so the text field stays
// editable), an editable label, and a remove button.
//
function ChoiceRow( props : { id : string; label : string; onLabel : ( value : string ) => void; onRemove : () => void } ) : JSX.Element
{
    const sortable : ReturnType<typeof useSortable> = useSortable( { id: props.id } );
    const style : React.CSSProperties = { transform: CSS.Transform.toString( sortable.transform ), transition: sortable.transition };

    return  <Box ref={ sortable.setNodeRef } style={ style } sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                <Box { ...sortable.attributes } { ...sortable.listeners } sx={{ display: "flex", cursor: "grab", color: "text.disabled", touchAction: "none" }}>
                    <DragIndicatorIcon fontSize="small" />
                </Box>
                <Box sx={{ flexGrow: 1 }}>
                    <TextInput id={ `${ props.id }-label` } label={"Choice"} value={ props.label } onChange={ props.onLabel } fullWidth />
                </Box>
                <ButtonIcon id={ `${ props.id }-rm` } label={"Remove"} size="small" icon={ <DeleteOutlineOutlinedIcon fontSize="small" /> } onClick={ props.onRemove } />
            </Box>;
}

export namespace ChoiceListInput
{
    export interface Props
    {
        value    : Array<string>;                       // ordered choice labels
        onChange : ( labels : Array<string> ) => void;
        label?   : string;
    }
}

export default ChoiceListInput;
