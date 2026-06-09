//
import React from 'react';
import { JSX } from "react";

//
import IconButton from '@mui/material/IconButton';
import EmailOutlinedIcon from '@mui/icons-material/EmailOutlined';
//
import TextInput from './TextInput';
import BrowserUtils from '@utils/BrowserUtils';
import { EmailUtils } from '@repo/common';


//
export function EmailInput( props: EmailInput.Props ) : JSX.Element
{
    const [value,setValue]          = React.useState< string >( props.value );

    React.useEffect( propsUpdated, [props.value] );

    ///////////////////////////////////////////////////////////////////////////////////////////////////
    function propsUpdated() : void
    {
        if( value !== props.value )setValue( props.value );
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////////
    function onClick() : void
    {
        if( value !== "" )BrowserUtils.mailto( value );
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////////
    function onChange( new_value : string ) : void
    {
        setValue( new_value );
        if( props.onChange )props.onChange( new_value );
    }

    return  <TextInput  id={ props.id }
                        label={ props.label }
                        noSpaces={ true }
                        allLowerCase={ true }
                        disabled={ props.disabled != undefined ? props.disabled : false }
                        endIcon={ value != "" && EmailUtils.isValid( value ) ? <IconButton onClick={ () => onClick() }><EmailOutlinedIcon /></IconButton> : null }
                        value={ value }
                        width={ props.sx && props.sx.width ? props.sx.width : undefined }
                        onChange={ onChange }
                        onEnter={ props.onEnter != undefined ? props.onEnter : undefined }
                        />;
}

export namespace EmailInput
{
    export interface Props
    {
        id            : string;
        label         : string;
        value         : string;
        disabled ?    : boolean;
        sx?           : { width? : number | string };
        onChange?     : ( new_value : string ) => void;
        onEnter?      : () => void;
    }
}

export default EmailInput;

// eof