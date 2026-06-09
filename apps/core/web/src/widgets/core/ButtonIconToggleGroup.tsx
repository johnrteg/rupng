//
import React from 'react';
import { JSX } from "react";

//
import Tooltip              from '@mui/material/Tooltip';
import ToggleButtonGroup    from '@mui/material/ToggleButtonGroup';
import ToggleButton         from '@mui/material/ToggleButton';

//

export function ButtonIconToggleGroup( props: ButtonIconToggleGroup.Props ) : JSX.Element
{
    const [value,setValue]          = React.useState< string | null >( props.value );

    //
    React.useEffect( selectionChanged, [props.value] );
    React.useEffect( onValueChange, [value] );

    /////////////////////////////////////////////////////////////////////////////////////////
    function selectionChanged() : void
    {
        if( props.value !== value )setValue( props.value );
    }

    /////////////////////////////////////////////////////////////////////////////////////////
    function onValueChange() : void
    {
        props.onChange( value );
    }

    /////////////////////////////////////////////////////////////////////////////////////////
    function onChange( event: React.MouseEvent<HTMLElement>, new_value: string ) : void
    {
        event.stopPropagation();
        setValue( new_value );
        //props.onChange( new_value );
    }


    //
    //
    //
    return  <ToggleButtonGroup id={ props.id }
                                size="small"
                                color="primary"
                                disabled={ props.disabled != undefined ? props.disabled : false }
                                value={ props.disableToggle == undefined || !props.disableToggle ? value : null } 
                                exclusive={ true }
                                onChange={ onChange } >

                { props.choices.map( ( item : ButtonIconToggleGroup.Item, index : number ) => {
                            return  <Tooltip title={ item.label } arrow={ true } >
                                        <ToggleButton value={ item.value } >
                                            { item.icon }
                                        </ToggleButton>
                                    </Tooltip> } ) }
            </ToggleButtonGroup>;

}

export namespace ButtonIconToggleGroup
{
    export interface Item
    {
        value    : string;
        icon     : JSX.Element;
        label    : string;
    }

    export interface Props
    {
        id              : string;
        value           : string | null;
        choices         : Array<ButtonIconToggleGroup.Item>;
        disableToggle?  : boolean;
        disabled?       : boolean;
        onChange        : ( id : string | null ) => void;
    }
}

export default ButtonIconToggleGroup;

// eof