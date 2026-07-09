import React from 'react';
import { JSX } from "react";

import { Box, Stack } from "@mui/material";
import DeleteOutlineOutlinedIcon from '@mui/icons-material/DeleteOutlineOutlined';
import DragIndicatorIcon         from '@mui/icons-material/DragIndicator';

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

import { EmailTemplate } from '@repo/api';

import ButtonIcon from '@widgets/core/ButtonIcon';
import SelectInput from '@widgets/core/SelectInput';
import UrlInput   from '@widgets/core/UrlInput';
import { SOCIAL_NETWORKS } from '@widgets/email/editor/EmailEditorModel';

//
// SortableSocialRow — one draggable social-network element in the inspector: a drag handle, the network choice
// (with delete) on top, and the link URL underneath (vertical to fit the narrow inspector).
//
export function SortableSocialRow( props : SortableSocialRow.Props ) : JSX.Element
{
    const sortable : ReturnType<typeof useSortable> = useSortable( { id: props.id, disabled: props.readOnly } );
    const style : React.CSSProperties = { transform: CSS.Transform.toString( sortable.transform ), transition: sortable.transition };
    const name : string = String( props.element.props?.name ?? "web" );
    const href : string = String( props.element.props?.href ?? "" );
    return <Stack ref={ sortable.setNodeRef } style={ style } spacing={ 0.5 } sx={{ border: 1, borderColor: "divider", borderRadius: 1, p: 1 }}>
        <Stack direction="row" spacing={ 0.5 } sx={{ alignItems: "center" }}>
            <Box { ...sortable.attributes } { ...sortable.listeners } sx={{ display: "flex", cursor: "grab", color: "text.disabled", touchAction: "none" }}><DragIndicatorIcon fontSize="small" /></Box>
            <Box sx={{ flex: 1 }}><SelectInput id={ `soc-name-${ props.element.id }` } label={"Network"} value={ name } choices={ SOCIAL_NETWORKS } disabled={ props.readOnly } onChange={ ( value : string ) : void => props.onChangeNetwork( name, href, value ) } /></Box>
            <ButtonIcon id={ `soc-del-${ props.element.id }` } label={"Remove"} size="small" disabled={ props.readOnly } icon={ <DeleteOutlineOutlinedIcon fontSize="small" /> } onClick={ props.onRemove } />
        </Stack>
        <UrlInput id={ `soc-href-${ props.element.id }` } label={"Link"} value={ href } disabled={ props.readOnly } onChange={ props.onChangeHref } />
    </Stack>;
}

export namespace SortableSocialRow
{
    export interface Props
    {
        id             : string;
        element        : EmailTemplate.Block;
        readOnly       : boolean;
        onChangeNetwork : ( oldName : string, oldHref : string, newName : string ) => void;
        onChangeHref   : ( value : string ) => void;
        onRemove       : () => void;
    }
}

export default SortableSocialRow;
// eof
