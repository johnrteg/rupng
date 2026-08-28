//
import React from 'react';
import { JSX } from "react";

import { Box, Typography } from "@mui/material";

import { Media } from '@repo/api';

import TextInput from '@widgets/core/TextInput';

import TranscriptModel from './TranscriptModel';

//
// TranscriptLineRow — one timed line inside TranscriptEditorDialog's left panel: a read-only start/end time
// badge + an editable text field. Selecting the row (clicking anywhere in it) seeks the video to its start
// time; it highlights when the video's playback position falls inside its window.
//
export function TranscriptLineRow( props : TranscriptLineRow.Props ) : JSX.Element
{
    ////////////////////////////////////////////////////////////////////////////////////////////
    // route a text edit up to the parent's segments array, keyed by this row's index
    function onTextChange( value : string ) : void
    {
        props.onTextChange( props.index, value );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    return  <Box ref={ props.rowRef }
                 onClick={ () => props.onSelect( props.index ) }
                 sx={{ display: "flex", gap: 1.5, alignItems: "flex-start", p: 1, borderRadius: 1, cursor: "pointer",
                       bgcolor: props.active ? "action.selected" : "transparent",
                       "&:hover": { bgcolor: props.active ? "action.selected" : "action.hover" } }}>
                <Typography variant="caption" sx={{ color: "text.secondary", fontVariantNumeric: "tabular-nums", pt: 1.5, width: 80, flexShrink: 0 }}>
                    { `${ TranscriptModel.formatDisplay( props.segment.start ) } – ${ TranscriptModel.formatDisplay( props.segment.end ) }` }
                </Typography>
                <TextInput id={ `transcript-line-${ props.index }` } label="" value={ props.segment.text } onChange={ onTextChange }
                           multiline maxRows={ 2 } fullWidth sx={{ flex: 1, "& textarea": { overflow: "hidden" } }} />
            </Box>;
}

export namespace TranscriptLineRow
{
    export interface Props
    {
        segment      : Media.TranscriptSegment;
        index        : number;
        active       : boolean;
        rowRef       : ( element : HTMLDivElement | null ) => void;
        onSelect     : ( index : number ) => void;
        onTextChange : ( index : number, text : string ) => void;
    }
}

export default TranscriptLineRow;
// eof
