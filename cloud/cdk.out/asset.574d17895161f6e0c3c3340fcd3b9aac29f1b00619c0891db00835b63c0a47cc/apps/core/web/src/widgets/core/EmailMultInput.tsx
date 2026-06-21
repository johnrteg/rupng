//
import React from 'react';
import { JSX } from "react";

//
import TagInput from './TagInput';
import { EmailUtils } from '@repo/common';


//
export function EmailMultInput( props: EmailMultInput.Props ) : JSX.Element
{
    const [value,setValue]          = React.useState< Array<string> >( props.value );

    React.useEffect( propsUpdated, [props.value] );

    ///////////////////////////////////////////////////////////////////////////////////////////////////
    function propsUpdated() : void
    {
        if( value != props.value )setValue( props.value );
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////////
    function onChange( new_value : Array<string> ) : void
    {
        setValue( new_value );
        if( props.onChange )props.onChange( new_value );
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////////
    function onValidate( email : string ) : boolean
    {
        return EmailUtils.isValid( email );
    }

    return  <TagInput   id={ props.id }
                        label={ props.label }
                        noSpaces={ true }
                        choices={ [] }
                        allLowerCase={ true }
                        disabled={ props.disabled != undefined ? props.disabled : false }
                        value={ value }
                        onTagValid={ onValidate }
                        onChange={ onChange }
                        />;
}

export namespace EmailMultInput
{
    export interface Props
    {
        id            : string;
        label         : string;
        value         : Array<string>;
        disabled ?    : boolean;
        onChange?     : ( new_value : Array<string> ) => void;
    }
}

export default EmailMultInput;

// eof