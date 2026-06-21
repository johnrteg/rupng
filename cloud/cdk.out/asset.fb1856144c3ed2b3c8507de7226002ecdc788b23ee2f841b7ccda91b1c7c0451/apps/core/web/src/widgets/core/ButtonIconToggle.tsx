//
import React from 'react';
import { JSX } from "react";

//
import Tooltip              from '@mui/material/Tooltip';
import ToggleButtonGroup    from '@mui/material/ToggleButtonGroup';
import ToggleButton         from '@mui/material/ToggleButton';

//
export function ButtonIconToggle( props: ButtonIconToggle.Props ) : JSX.Element
{
    const [selected,setSelected]    = React.useState< boolean >( props.selected );
    const [value,setValue]          = React.useState< string | null >( props.id + "-pressed-button" );

    //
    React.useEffect( selectionChanged, [props.selected] );
    React.useEffect( onSelection, [selected] );

    /////////////////////////////////////////////////////////////////////////////////////////
    function selectionChanged() : void
    {
        if( props.selected !== selected )setSelected( props.selected );
    }

    /////////////////////////////////////////////////////////////////////////////////////////
    function onSelection() : void
    {
        setValue( selected ? props.id + "-pressed-button" : null );
        if( props.selected !== selected )props.onChange( selected );
    }

    /////////////////////////////////////////////////////////////////////////////////////////
    function onGroupSelected() : void
    {
        setSelected( !selected );
    }


    //
    //
    //
    return  <ToggleButtonGroup
                            size="small"
                            color="primary"
                            value={ value } 
                            disabled={ props.disabled }
                            exclusive
                            onChange={ ( event: React.MouseEvent<HTMLElement>, new_value: string ) => onGroupSelected() } >

                <ToggleButton value={ props.id + "-pressed-button" } >
                    <Tooltip title={ props.label } arrow={ true } >
                        { selected || props.iconOff === undefined ? props.icon : props.iconOff }
                    </Tooltip>
                </ToggleButton>
            </ToggleButtonGroup>;

}

export namespace ButtonIconToggle
{
    export interface Props
    {
        id          : string;
        icon        : JSX.Element;
        iconOff?    : JSX.Element;
        label       : string;
        selected    : boolean;
        disabled?   : boolean;
        onChange    : ( flag : boolean ) => void;
    }

}

export default ButtonIconToggle;
// eof