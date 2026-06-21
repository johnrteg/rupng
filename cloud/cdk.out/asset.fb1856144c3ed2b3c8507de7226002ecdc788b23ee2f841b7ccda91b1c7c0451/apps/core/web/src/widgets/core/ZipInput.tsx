//
import React from 'react';
import { JSX } from "react";


//
import TextInput from './TextInput';
import { StringUtils } from '@repo/common';

interface ZipConfig
{
    maxLength : number;
}


export function ZipInput( props: ZipInput.Props ) : JSX.Element
{
    const [disabled,setDisabled]            = React.useState< boolean >( props.disabled != undefined ? props.disabled : false );
    const [value,setValue]                  = React.useState< string >( props.value );
    const [maxLength,setMaxLength]          = React.useState< number >( 10 );
    
    const config                            = React.useRef< Record<string, ZipConfig> >(
                                                    {   US: { maxLength: 10 },
                                                        GB: { maxLength: 8 },
                                                        NL: { maxLength: 6 },
                                                        CA: { maxLength: 6 }
                                                        // more to be added??
                                                    } );

    //
    React.useEffect( propsUpdated, [props.value] );
    React.useEffect( countryUpdate, [props.country] );
    React.useEffect( disabledChanged, [props.disabled] );

    ///////////////////////////////////////////////////////////////////////////////////////////////////
    function propsUpdated() : void
    {
        if( value != props.value )setValue( props.value );
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////
    function disabledChanged() : void
    {
        setDisabled( props.disabled != undefined ? props.disabled : false );
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////
    function countryUpdate() : void
    {
        if( props.country && config.current[ props.country ] )
        {
            setMaxLength( config.current[ props.country ].maxLength );
        }
        else    // default
        {
            setMaxLength( 10 );
        }
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////////
    function onChange( new_value : string ) : void
    {
        if( props.country === "US" && new_value.length > 5 )
        {
            new_value = StringUtils.removeAll( new_value, "-" );
            new_value = new_value.substring(0,5) + "-" + new_value.substring(5);
        }
        setValue( new_value );
        if( props.onChange )props.onChange( new_value );
    }

    // =======================================================================================
    // longest zip code in the world is 10 character, all upper case of letters are allowed
    return  <TextInput  id={ props.id }
                        label={ props.label }
                        noSpaces={ false }
                        maxLength={ maxLength }
                        disabled={ disabled }
                        allUpperCase={ true }
                        value={ value }
                        onChange={ onChange }/>;
}

export namespace ZipInput
{
    export interface Props
    {
        id            : string;
        label         : string;
        value         : string;
        country       : string | null;
        disabled?     : boolean;
        onChange?     : ( new_value : string ) => void;
    }
}

export default ZipInput;
// eof