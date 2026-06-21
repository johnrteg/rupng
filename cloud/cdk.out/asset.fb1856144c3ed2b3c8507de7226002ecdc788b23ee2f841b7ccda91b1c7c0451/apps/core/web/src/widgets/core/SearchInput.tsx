//
import React from 'react';
import { JSX } from "react";

//
import IconButton from "@mui/material/IconButton";
import ButtonIconDropdown from "./ButtonIconDropdown";
import { Stack } from '@mui/material';

// icons
import SearchIcon from '@mui/icons-material/Search';
import ClearOutlinedIcon from '@mui/icons-material/ClearOutlined';
import SavedSearchIcon from '@mui/icons-material/SavedSearch';

//
import TextInput from "./TextInput";
import { StringUtils } from '@repo/common';

enum WildCardType
{
    ANY         = 'any',
    EXACT       = 'exact',      // "bob"
    START_WIDTH = 'startwith',  // "bob*"
    END_WITH    = 'endwith',    // "*bob"
    CONTAINS    = 'contains'    // "*bob*"
}


//
//
//
export function SearchInput( props : SearchInput.Props ) : JSX.Element
{
    // state
    const [value,setValue]          = React.useState< string >( props.value );
    const [wildcard,setWildcard]    = React.useState< WildCardType >( WildCardType.ANY );
    const [disabled,setDisabled]    = React.useState< boolean | undefined >( props.disabled );
    const timeoutRef                = React.useRef<ReturnType<typeof setTimeout> | null>(null);

    //
    React.useEffect( () => () => unMountComponent(), [] );
    React.useEffect( valueUpdated, [props.value] );
    React.useEffect( disabledUpdated, [props.disabled] );
    React.useEffect( pushChange, [wildcard] );
    React.useEffect( doDebounce, [value] );

    ///////////////////////////////////////////////////////////////////////////////////////////////////
    function valueUpdated() : void
    {
        if( value !== props.value )
        {
            let new_value : string = props.value;
            if( isWildcard() && new_value !== "" )
            {
                // remove any leading or trailing '*'
                new_value = StringUtils.removeLeading( new_value, "*" );
                new_value = StringUtils.removeTrailing( new_value, "*" );
                new_value = StringUtils.removeLeading( new_value, '"' );
                new_value = StringUtils.removeTrailing( new_value, '"' );
            }

            if( value !== new_value )setValue( new_value );
        }
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////
    function disabledUpdated() : void
    {
        setDisabled( props.disabled );
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
        timeoutRef.current = setTimeout( onDelay, props.delay ?? 750 );
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////
    function onDelay() : void
    {
        timeoutRef.current = null;
        pushChange();
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////
    function onEnter() : void
    {
        pushChange();
        if( props.onEnter )props.onEnter();
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////////
    function pushChange() : void
    {
        let push_value : string = value;
        if( isWildcard() && push_value !== "" )
        {
            switch( wildcard )
            {
                case WildCardType.START_WIDTH : push_value = push_value + "*"; break;
                case WildCardType.END_WITH    : push_value = "*" + push_value;break;
                case WildCardType.CONTAINS    : push_value = "*" + push_value + "*"; break;
                case WildCardType.EXACT       : push_value = '"' + push_value + '"'; break;
            }
        }
        props.onChange( push_value );
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////////
    function onClear() : void
    {
        setValue( "" );
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////////
    function isWildcard() : boolean
    {
        return ( props.allowWildcard !== undefined && props.allowWildcard );
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////////
    function searchTypeIcon() : JSX.Element
    {
        return <ButtonIconDropdown  id={ props.id + "-wildcard" }
                                    label={ "Wildcard Search Options" }
                                    icon={ isWildcard() && wildcard !== WildCardType.ANY ? <SavedSearchIcon/> : <SearchIcon /> }
                                    choices={ [ { value: WildCardType.ANY           , label: "Any Match" },
                                                { value: WildCardType.EXACT         , label: "Exact Match" },
                                                { value: WildCardType.START_WIDTH   , label: "Starts With" },
                                                { value: WildCardType.END_WITH      , label: "Ends With" },
                                                { value: WildCardType.CONTAINS      , label: "Contains" } ] }
                                    selected={ wildcard } 
                                    onChange={ ( value : string ) => setWildcard( value as WildCardType ) }/>;
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////////
    //function onWildcard() : void
   // {
    //}

    //////////////////////////////////////////////////////////////////////////////////////////////////////
    function endIcon() : React.ReactNode | undefined
    {
        if( value !== "" || props.endIcon !== undefined )
        {
            let icon : React.ReactNode = undefined;
            if( value !== "" )icon = <IconButton onClick={ () => onClear() }><ClearOutlinedIcon  /></IconButton>;
            if( props.endIcon !== undefined )
            {
                if( icon === undefined )
                {
                    icon = props.endIcon;
                }
                else
                {
                    icon = <Stack direction="row" spacing={ 0 } sx={ { p : 0 } }>{icon}{props.endIcon}</Stack>;
                }
            }
            return icon;
        }
        else
        {
            return undefined;
        }
    }

    return <TextInput   id          = { props.id }
                        label       = { props.label }
                        startIcon   = { !isWildcard() ? <SearchIcon /> : searchTypeIcon() }
                        endIcon     = { endIcon() }
                        value       = { value }
                        disabled    = { disabled != undefined ? disabled : false }
                        sx          = {{ width: props.sx && props.sx.width ? props.sx.width : undefined }}
                        onChange    = { setValue }
                        onEnter     = { onEnter } />
}

//
//
export namespace SearchInput
{
    export interface Props
    {
        id                : string;
        label             : string;
        value             : string;
        disabled?         : boolean;
        allowWildcard?    : boolean;
        endIcon?          : React.ReactNode;
        delay?            : number;
        sx?               : { width? : string | number; };
        onChange          : ( new_value : string ) => void;
        onEnter?          : () => void;
    }
}


export default SearchInput;
// eof