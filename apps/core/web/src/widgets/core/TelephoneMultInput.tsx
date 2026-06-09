//
import React from 'react';
import { JSX } from "react";

//

import TagInput     from './TagInput';
import { PhoneUtils, StringUtils } from '@repo/common';


//
export function TelephoneMultInput( props: TelephoneMultInput.Props ) : JSX.Element
{
    const [value,setValue]          = React.useState< Array<string> >( props.value );

    React.useEffect( propsUpdated, [props.value] );

    ///////////////////////////////////////////////////////////////////////////////////////////////////
    function propsUpdated() : void
    {
        if( value !== props.value )setValue( props.value );
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////////
    function onChange( new_value : Array<string> ) : void
    {
        setValue( new_value );
        if( props.onChange )props.onChange( new_value );
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////////
    function onValidate( phone : string ) : boolean
    {
        const str : string =  StringUtils.toPhoneNumber( phone );
        return PhoneUtils.isValid( str ) || PhoneUtils.isShortCode( str );
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////////
    function onFormat( phone : string ) : string
    {
        return StringUtils.toRichPhoneNumber( phone );
    }

    return  <TagInput   id={ props.id }
                        label={ props.label }
                        noSpaces={ true }
                        choices={ [] }
                        allLowerCase={ true }
                        size="small"
                        disabled={ props.disabled !== undefined ? props.disabled : false }
                        value={ value }
                        onTagValid={ onValidate }
                        onFormat={ onFormat }
                        onChange={ onChange }
                        />;
}

export namespace TelephoneMultInput
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

export default TelephoneMultInput;

// eof