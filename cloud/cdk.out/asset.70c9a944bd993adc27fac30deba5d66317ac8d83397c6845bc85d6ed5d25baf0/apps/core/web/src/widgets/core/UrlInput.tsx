//
import React from 'react';
import { JSX } from "react";

//
import Stack from '@mui/material/Stack';

//
import IconButton               from '@mui/material/IconButton';
import OpenInNewOutlinedIcon    from '@mui/icons-material/OpenInNewOutlined';

//
import BrowserUtils     from '@utils/BrowserUtils';
import SelectInput      from './SelectInput';
import TextInput        from './TextInput';
import { NetworkUtils, StringUtils } from '@repo/common';


//
//
export function UrlInput( props: UrlInput.Props ) : JSX.Element
{
    const [uri,setUri]              = React.useState< string >( "" );
    const [protocol,setProtocol]    = React.useState< string >( NetworkUtils.Protocol.HTTPS );
    const [disabled,setDisabled]    = React.useState< boolean >( props.disabled !== undefined ? props.disabled : false );

    const timeoutRef                = React.useRef< ReturnType<typeof setTimeout> | null >( null );

    //
    React.useEffect( () => () => unMountComponent(), [] );
    React.useEffect( propsValueUpdated, [props.value] );
    React.useEffect( doDebounce, [protocol,uri] );
    React.useEffect( disabledChanged, [props.disabled] );

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

    ///////////////////////////////////////////////////////////////////////////////////////////////////
    function propsValueUpdated() : void
    {
        if( props.value !== undefined && props.value !== "" && props.value.indexOf( NetworkUtils.PROTOCOL_SEPARATOR ) > 0 )
        {
            const parts      : Array<string> = props.value.split( NetworkUtils.PROTOCOL_SEPARATOR );
            let new_protocol : NetworkUtils.Protocol = parts[0].toLowerCase() as NetworkUtils.Protocol;

            // check if given is allowed.  here if not found if given in props
            if( props.allowedProtocols && props.allowedProtocols.indexOf( new_protocol ) < 0 )
            {
                new_protocol = props.allowedProtocols[0];   // default to first allowed
            }

            // has url
            let new_uri : string = "";
            if( parts.length > 1 )
            {
                // remove any leading '/'
                new_uri = parts[1];
                if( props.allLowerCase !== undefined && props.allLowerCase )new_uri = new_uri.toLowerCase();
                new_uri = StringUtils.removeLeading( new_uri, '/' );
            }

            if( new_protocol != protocol )setProtocol( new_protocol );
            if( new_uri      != uri      )setUri( new_uri );
        }
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////////
    function onClick() : void
    {
        BrowserUtils.open( getUrl() );
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////////
    function getUrl() : string
    {
        return protocol + NetworkUtils.PROTOCOL_SEPARATOR + uri;
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////////
    function pushChange() : void
    {
        if( props.onChange )props.onChange( getUrl() );
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////////
    function allowedProtcols( ) : Array<SelectInput.Choice>
    {
        let choices : Array<SelectInput.Choice> = [];
        if( props.allowedProtocols != undefined )
        {
            props.allowedProtocols.forEach( ( proto : NetworkUtils.Protocol ) => ( choices.push( {   value: proto,
                                                                                                label: proto + NetworkUtils.PROTOCOL_SEPARATOR } ) ) );
        }
        else
        {
            choices =   [   { value: NetworkUtils.Protocol.HTTPS, label: NetworkUtils.Protocol.HTTPS + NetworkUtils.PROTOCOL_SEPARATOR },
                            { value: NetworkUtils.Protocol.HTTP, label: NetworkUtils.Protocol.HTTP + NetworkUtils.PROTOCOL_SEPARATOR }
                        ];
        }

        return choices;
    }

    // ======================================================================================================    
    return  <Stack direction="row" spacing={0.5} sx={ { width: "100%", boxSizing: "border-box" } } >
                <SelectInput    id={ props.id + "-protocol" }
                                label={ "" }
                                disabled={ disabled }
                                sx={ { width: 100 } }
                                choices={ allowedProtcols() }
                                value={ protocol }
                                onChange={ setProtocol } />

                <TextInput      id={ props.id }
                                label={ props.label }
                                disabled={ disabled }
                                noSpaces={ true }
                                width={ "100%" }
                                allLowerCase={ props.allLowerCase !== undefined ? props.allLowerCase : true }
                                endIcon={ NetworkUtils.isUrl( protocol + NetworkUtils.PROTOCOL_SEPARATOR + uri ) ? <IconButton onClick={ () => onClick() }><OpenInNewOutlinedIcon /></IconButton> : null }
                                value={ uri }
                                onChange={ setUri }/>
            </Stack>
    
}

export namespace UrlInput
{
    export interface Props
    {
        id                  : string;
        label               : string;
        value               : string;
        disabled?           : boolean;
        allLowerCase?       : boolean;
        allowedProtocols?   : Array< NetworkUtils.Protocol >;
        onChange?           : ( new_value : string ) => void;
    }
}

export default UrlInput;
// eof