//
import React from 'react';
import { JSX } from "react";

//
import { InputAdornment, TextField, IconButton }    from '@mui/material';

import VisibilityOutlinedIcon       from '@mui/icons-material/VisibilityOutlined';
import VisibilityOffOutlinedIcon    from '@mui/icons-material/VisibilityOffOutlined';
import HealthAndSafetyOutlinedIcon  from '@mui/icons-material/HealthAndSafetyOutlined';

//
import ButtonIcon                   from './ButtonIcon';
import { StringUtils } from '@repo/common';

//
//
//
export function PasswordInput( props : PasswordInput.Props ) : JSX.Element
{
    const [show_password,showPassword]  = React.useState<boolean>(false);
    const [error,setError]              = React.useState<boolean>(false);
    const [text,setText]                = React.useState<string>( props.value ? props.value : "");

    //
    React.useEffect( () => propsChanged(), [props] );

    //////////////////////////////////////////////////////////////////////////////////////////////////
    function propsChanged() : void
    {
        setError( props.error != null ? props.error : false );
        setText( props.value ? props.value : "" );
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////
    function onChange( evt : any ) : void
    {
        evt.preventDefault();

        let value : string = StringUtils.removeAllSpaces( evt.target.value );
        setText( value );
        if( props.onChange )props.onChange( value );
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////
    function onTogglePassword() : void
    {
        showPassword( !show_password );
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////
    function onKeyPress( evt : React.KeyboardEvent<HTMLDivElement> ) : void
    {
        if( evt.key == "Enter" && props.onEnter != undefined )
        {
            props.onEnter();
        }
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////
    function onSetPassword() : void
    {
        // need to allow this to be configurable
        setText( StringUtils.generatePassword( 14, 2, 2, 2, 2 ) );
    }

    // ===============================================================================================
    return <TextField   required    = { props.required != null ? props.required : false }
                        fullWidth   = { true }
                        error       = { error }
                        id          = { props.id }
                        autoComplete= { props.autoComplete }
                        name        = { props.id }
                        label       = { props.label }
                        disabled    = { props.disabled != undefined ? props.disabled : false }
                        type        = { show_password ? "text" : "password"}
                        size        = { props.dense != null ? ( props.dense ? "small" : "medium" ) : "small" }
                        autoFocus   = { props.focus ?? false }
                        value       = { text }
                        onChange    = { ( evt: any ) => onChange( evt ) }
                        onKeyDown   = { ( evt: React.KeyboardEvent<HTMLDivElement> ) => onKeyPress( evt )}
                        slotProps={{ input: {
                                        endAdornment: (
                                            <InputAdornment position="end">

                                                { props.allowGenerate !== undefined && props.allowGenerate ? <ButtonIcon id="generate" label={"Generate Password"} onClick={()=>onSetPassword()} icon={<HealthAndSafetyOutlinedIcon/>} /> : null }
                                                
                                                <ButtonIcon id="vis" label={ show_password ? "Hide Password" : "Show Password" } onClick={() => onTogglePassword()} icon={ show_password ? <VisibilityOutlinedIcon /> : <VisibilityOffOutlinedIcon />} />

                                            </InputAdornment>
                                            )
                            } }}
            />;
}

export namespace PasswordInput
{
    export interface Props
    {
        id              : string;
        label           : string;
        error?          : boolean;
        value?          : string;
        required?       : boolean;
        dense?          : boolean;
        disabled?       : boolean;
        focus?          : boolean;   // autofocus on mount (e.g. when the password step appears)
        allowGenerate?  : boolean
        autoComplete?   : string;   // e.g. "current-password" (login) / "new-password" (signup/reset)
        onChange?       : ( new_value : string ) => void;
        onEnter?        : () => void;
    }
}


export default PasswordInput;

// eof