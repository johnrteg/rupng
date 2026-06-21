//
import React from 'react';
import { JSX } from "react";

//
import Stack from '@mui/material/Stack';

//
import TextInput        from './TextInput';
import TelephoneInput   from './TelephoneInput';


//
//
export function SmsInput( props: SmsInput.Props ) : JSX.Element
{
    const [phone,setPhone]            = React.useState< string >( "" );
    const [subject,setSubject]        = React.useState< string >( "" );
    const [body,setBody]              = React.useState< string >( "" );

    const [disabled,setDisabled]    = React.useState< boolean >( props.disabled !== undefined ? props.disabled : false );

    const timeoutRef                = React.useRef< ReturnType<typeof setTimeout> | null >( null );

    //
    React.useEffect( () => () => unMountComponent(), [] );
    React.useEffect( doDebounce, [phone,subject,body] );
    React.useEffect( disabledChanged, [props.disabled] );
    React.useEffect( valueChanged, [props.value] );

    ///////////////////////////////////////////////////////////////////////////////////////////////////
    function valueChanged() : void
    {
        if( !props.value ) return;
        try
        {
            const url : URL = new URL( props.value );
            setPhone(   url.pathname                          );
            setBody(    url.searchParams.get("body")    ?? "" );
            setSubject( url.searchParams.get("subject") ?? "" );
        }
        catch( e : any )
        {
            // invalid uri, leave fields as-is
        }
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////
    function disabledChanged() : void
    {
        setDisabled( props.disabled != undefined ? props.disabled : false );
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////
    function unMountComponent() : void
    {
        if( timeoutRef.current )clearTimeout( timeoutRef.current );
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////
    function doDebounce() : void
    {
        if( timeoutRef.current )clearTimeout( timeoutRef.current );
        timeoutRef.current = setTimeout( onDelay, 100 );
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////
    function onDelay() : void
    {
        timeoutRef.current = null;
        pushChange();
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////////
    function getUrl() : string
    {
        const params = new URLSearchParams();
        if( body.trim()    !== "" ) params.set( "body",    body.trim()    );
        if( subject.trim() !== "" ) params.set( "subject", subject.trim() );
        const query = params.toString();
        return "sms:" + phone + ( query ? "?" + query : "" );
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////////
    function pushChange() : void
    {
        if( props.onChange )props.onChange( getUrl() );
    }

    // ======================================================================================================    
    return  <Stack direction="column" spacing={1.5} sx={ { width: "100%", boxSizing: "border-box" } } >
                <TelephoneInput id={ props.id }
                                label={ "Cell Phone" }
                                disabled={ disabled }
                                value={ phone }
                                //shortLongToggle={ true }
                                //sx={ { width : 600 } }
                                onChange={ setPhone }/>

                <TextInput      id={ props.id }
                                label={ "Subject" }
                                disabled={ disabled }
                                value={ subject }
                                onChange={ setSubject }/>

                <TextInput      id={ props.id }
                                label={ "Body" }
                                disabled={ disabled }
                                value={ body }
                                onChange={ setBody }/>
            </Stack>
    
}

export namespace SmsInput
{
    export interface Props
    {
        id                  : string;
        label               : string;
        value               : string;
        disabled?           : boolean;
        onChange?           : ( new_value : string ) => void;
    }
}

export default SmsInput;
// eof