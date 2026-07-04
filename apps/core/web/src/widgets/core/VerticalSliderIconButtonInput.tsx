//
import React from 'react';
import { JSX } from "react";

//

//
import Tooltip from '@mui/material/Tooltip';
import IconButton from '@mui/material/IconButton';
import { Popover, Slider } from '@mui/material';



export function VerticalSliderIconButtonInput( props : VerticalSliderIconButtonInput.Props ) : JSX.Element
{
    const [anchor, setAnchor]           = React.useState<null | HTMLElement>(null);
    const [disabled, setDisabled]       = React.useState< boolean >( props.disabled == undefined ? false : props.disabled );
    const [value, setValue]             = React.useState< number >( props.value );

    //
    React.useEffect( () => componentLoaded(), [] );
    React.useEffect( disabledChanged, [props.disabled] );
    React.useEffect( valueUpdated, [props.value] );
    React.useEffect( valueChanged, [value] );

    ///////////////////////////////////////////////////////////////////////////////////////////////////
    function componentLoaded() : void
    {
        // these will likely come from the server...

    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////
    function valueChanged() : void
    {
        props.onChange( value );
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////
    function valueUpdated() : void
    {
        //if( props.value != value )setValue( props.value );
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////
    function disabledChanged() : void
    {
        setDisabled( props.disabled == undefined ? false : props.disabled  );
        onClose();
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////
    function onClick( event: React.MouseEvent<HTMLButtonElement> ) : void
    {
        setAnchor( event.currentTarget );
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////
    function onClose() : void
    {
        setAnchor( null );
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////
    function onEmoji( selection : any ) : void
    {
        props.onChange( selection.emoji );
        onClose();
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////
    // format value as needed
    function getAriaValueText(value: number) : string
    {
        return value.toString(); //`${value}°C`;
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////
    function onChange( event: Event, value: number | Array<number>, activeThumb: number )  : void
    {
        setValue( value as number );
    }

    // ============================================================================================
    return  <section>
                <Tooltip title={ props.label } arrow={ true } >
                    <IconButton disabled={ disabled } onClick={ ( event: React.MouseEvent<HTMLButtonElement> ) => onClick( event ) }>
                        { props.icon }
                    </IconButton>
                </Tooltip>

                { anchor ? <Popover
                                    open={ true }
                                    anchorEl={ anchor }
                                    onClose={ onClose }
                                    anchorOrigin={{
                                        vertical: 'top',    // show above the button
                                        horizontal: 'center',
                                    }}
                                    transformOrigin={{
                                        vertical: 'bottom', // popover's bottom aligns with button's top
                                        horizontal: 'center',
                                    }}
                                >
                    <Slider
                        aria-label={ props.label }
                        min={ props.minValue }
                        max={ props.maxValue }
                        step={ props.step }
                        orientation="vertical"
                        getAriaValueText={ getAriaValueText }
                        valueLabelDisplay="auto"
                        value={ value }
                        onChange={ onChange }
                        sx={ { height: 200, my : 3, ml: 7, mr: 1.5 } }
                    />
                </Popover> : null }
            </section>;

}

export namespace VerticalSliderIconButtonInput
{
    export interface Props
    {
        id          : string;
        label       : string;
        minValue    : number;
        maxValue    : number;
        value       : number;
        step        : number;
        icon        : JSX.Element;
        disabled?   : boolean;
        onChange    : ( value: number ) => void;
    }
}

export default VerticalSliderIconButtonInput;

// eof