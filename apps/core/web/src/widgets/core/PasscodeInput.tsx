//
import React from 'react';
import { JSX } from "react";

//
import { Stack } from '@mui/material';
import TextInput, { TextInputHandle } from "./TextInput";



//
//
//
export function PasscodeInput( props : PasscodeInput.Props ) : JSX.Element
{
    const inputRefs                     = React.useRef< Array< TextInputHandle | null > >([]);
    const passcode                      = React.useRef<string[]>( Array(props.digits).fill("") );
    const [disabled,setDisabled]        = React.useState< boolean >( props.disabled != undefined ? props.disabled : false );

    //
    React.useEffect( disabledUpdated, [props.disabled] );
    React.useEffect( disabledChanged, [disabled] );

    /////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    function disabledUpdated() : void
    {
        setDisabled( props.disabled != undefined ? props.disabled : false );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    function disabledChanged() : void
    {
        inputRefs.current.forEach( ( ref : TextInputHandle | null, index: number ) => { if( ref )ref.setDisabled( disabled ); } );
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    function onCellChange( value : string, index : number ) : void
    {
        //console.log( "onCellChange", value, index, props.digits );

        let currentIndex : number = index;
        let remaining    : string = value;

        // if the value is more than 1 digit, then take that first
        // digit for the current cell and let the next cell take the
        // reminder of the digits
        while( remaining.length > 0 && currentIndex < props.digits )
        {
            const digit : string = remaining[0];
            inputRefs.current[currentIndex]?.setValue( digit );
            passcode.current[currentIndex] = digit;

            remaining = remaining.substring(1);
            currentIndex++;
        }

        if( index < props.digits )
        {
            // go to next cell
            inputRefs.current[ index + 1]?.selectAll();
        }

        //setTimeout( updateValue, 10 );
        //console.log( 'value', getValue() );
        props.onChange( getValue() );
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    function getValue() : string
    {
        // filter out blank characters
        return passcode.current.filter(char => char !== "").join("");
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    function digits() : Array<JSX.Element>
    {
        let cells    : Array<JSX.Element> = [];
        const digits : number = Math.max( 3, props.digits );
        let i        : number;

        // fill out empty refs
        if( inputRefs.current.length !== digits )
        {
            inputRefs.current = Array( digits ).fill( null );
        }

        for( i=0; i < digits; i++ )
        {
            const cellIndex : number = i;   // to avoid wrong reference to i in onCellChange

            cells.push( <TextInput id={ "code-" + cellIndex }
                                    key={ "key-" +  cellIndex }
                                    ref={ inputRef => { inputRefs.current[cellIndex] = inputRef; }}
                                    width={ 40 }
                                    noSpaces={ true }
                                    //maxLength={ 1 }
                                    align="center"
                                    allNumeric={ true }
                                    label={ "" }
                                    value={ "" }
                                    onChange={ ( val : string ) => onCellChange( val, cellIndex ) } /> );
        }

        return cells;
    }

  // ===============================================================================================
  return (
        <Stack direction="row" spacing={1} >
            { digits() }
        </Stack>
    );
}


export namespace PasscodeInput
{
    export interface Props
    {
        id          : string;
        label       : string;
        digits      : number;
        disabled?   : boolean;
        onChange    : ( value : string ) => void;
    }
}


export default PasscodeInput;

// eof