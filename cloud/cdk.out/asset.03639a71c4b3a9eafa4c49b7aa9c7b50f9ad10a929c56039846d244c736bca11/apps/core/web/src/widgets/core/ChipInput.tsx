//
import React from 'react';
import { JSX } from "react";

//
import { Box, Chip, IconButton, Typography } from '@mui/material';
import { HighlightOff as HighlightOffIcon } from '@mui/icons-material';

import ClearIcon from '@mui/icons-material/Clear';

//
//
//
export function ChipInput( props : ChipInput.Props ) : JSX.Element
{
    // state
    const [chips,setChips]              = React.useState< Array<ChipInput.Item> >( props.value );
    const [disabled, setDisabled]       = React.useState< boolean >( props.disabled == undefined ? false : props.disabled );
    const [values, setValues]           = React.useState< Array<ChipInput.Item> >( props.value );

    //
    React.useEffect( chipsChanged, [chips] );
    React.useEffect( propValueUpdated, [props.value] );
    React.useEffect( propDisabledUpdated, [props.disabled] );

    ///////////////////////////////////////////////////////////////////////////////////////////////////
    function chipsChanged() : void
    {
        //if( checked !== props.value )setChecked( props.value );
        //console.log( 'chipsChanged', chips );
        props.onChange( chips );
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////
    function propValueUpdated() : void
    {
        if( chipsAreDifferent( props.value, chips ) )setChips( props.value );
       //console.log( 'propValueUpdated', props.value );
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////
    function chipsAreDifferent( a: Array<ChipInput.Item>, b: Array<ChipInput.Item> ): boolean
    {
        if (a.length !== b.length) return true;
        for (let i = 0; i < a.length; i++)
        {
            if ( a[i].value !== b[i].value || a[i].label !== b[i].label )
            {
                return true;
            }
        }
        return false;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    function propDisabledUpdated() : void
    {
        setDisabled( props.disabled == undefined ? false : props.disabled  );
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////
    function onChange( evt : any ) : void
    {
        //evt.preventDefault();
        //setChecked( evt.target.checked );
        //if( props.onChange )props.onChange( evt.target.checked );
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////
    function onRemoveAll() : void 
    {
        setChips( [] );
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////
    function onDelete( chipToDelete : ChipInput.Item ) : void 
    {
        setChips((chips) => chips.filter((chip) => chip.value !== chipToDelete.value ));
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////
    function onRenderTags() : Array<JSX.Element>
    {
        return chips.map( ( item : ChipInput.Item, index : number ) => (
                    <Chip
                        key={ item.value }
                        variant="outlined"
                        label={ item.label }
                        disabled={ disabled }
                        sx={ { ml: index === 0 ? 1 : 0, mr: 0.5 } }
                        size={ props.size ? props.size : "small" }
                        onDelete={ ( evt : any ) => onDelete( item ) }
                        deleteIcon={ <HighlightOffIcon /> }
                    />
                ) );
    }

     // ===============================================================================================
    return  <Box
                sx={{
                    position: 'relative',
                    border: '1px solid #ccc',
                    borderRadius: '5px',
                    pl: 0.5,
                    pr: 0.5,
                    pt: 1,
                    pb: 0.5,
                    background: 'inherit',
                    minHeight: 20,
                    width: "100%",
                    boxSizing: "border-box",
                    display: 'flex',
                    alignItems: 'center',
                    my: 0 
                }}
            >
                {/* Floating label in upper right */}
                <Typography
                    variant="caption"
                    sx={{
                        position: 'absolute',
                        top: -10,
                        left: 12,
                        background: 'background.paper',
                        backgroundColor: props.backgroundColor ?? 'background.paper',
                        px: 0.5,
                        mx: 0.5,
                        color: 'text.secondary',
                    }}
                >
                    { props.label }
                </Typography>

                { props.startIcon ? props.startIcon : null }

                <Box
                    sx={{
                        display: 'flex',
                        flexWrap: 'wrap',
                        minWidth: 0,
                        flex: 1,
                        width: '100%',
                    }}
                >
                    { onRenderTags() }
                </Box>

                {/* IconButton on far right */}
                { chips.length > 0 ?
                    <IconButton sx={{ ml: 1 }} onClick={ () => onRemoveAll() }>
                        <ClearIcon />
                    </IconButton>
                    : null }
                
            </Box>;
}

export namespace ChipInput
{
    export interface Item
    {
        value : string;
        label : string;
        data? : any;
        readonly?: boolean;
    }

    export interface Props
    {
        id                  : string;
        label               : string;
        value               : Array<ChipInput.Item>;
        disabled?           : boolean;
        disableClearable?   : boolean;
        backgroundColor?    : string;
        limitTags?          : number;
        startIcon?          : JSX.Element;
        size?               : "medium" | "small";
        onChange            : ( new_value : Array<ChipInput.Item> ) => void;
    }
}


export default ChipInput;
// eof