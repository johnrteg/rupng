//
import React from 'react';
import { JSX } from "react";

//
import { InputAdornment, TextField } from '@mui/material';
import MicNoneOutlinedIcon from '@mui/icons-material/MicNoneOutlined';
import MicOffOutlinedIcon  from '@mui/icons-material/MicOffOutlined';
import { StringUtils, ValueUtils } from '@repo/common';

import ButtonIcon  from './ButtonIcon';
import VoiceToText from '@utils/VoiceToText';


//
//


//
// special case here to wrap TextInput with a reference function
//
const TextInput = React.forwardRef< TextInputHandle, TextInput.Props > (
function TextInput( props : TextInput.Props, ref : React.Ref<TextInputHandle> ) : JSX.Element
{
    const [text,setText]            = React.useState<string>( props.value ? props.value : "" );
    const [disabled,setDisabled]    = React.useState< boolean | undefined >( props.disabled );
    const [listening,setListening]  = React.useState<boolean>( false );   // voice-to-text mic active
    const inputRef                  = React.useRef<HTMLInputElement | null>( null );

    // voice-to-text — refs kept fresh each render so the (once-constructed) recognizer's handlers see the
    // latest text/props; `gotResult` tracks whether a dictation produced anything (for onEnterAtVoiceDone).
    const v2tRef                    = React.useRef< VoiceToText | null >( null );
    const textRef                   = React.useRef<string>( text );  textRef.current = text;
    const propsRef                  = React.useRef< TextInput.Props >( props );  propsRef.current = props;
    const gotResultRef              = React.useRef<boolean>( false );

    React.useEffect( valueChanged, [props.value] );
    React.useEffect( insertRequest, [props.insertAtCursor] );
    React.useEffect( disabledChanged, [props.disabled] );
    React.useEffect( setupVoice, [] );

    // Expose methods to parent
    React.useImperativeHandle( ref, () => ({
        focus           : () => setFocus(),
        setValue        : ( val: string ) => setText( val ),
        getValue        : () => text,
        selectAll       : () => selectAll(),
        setDisabled     : ( flag : boolean ) => setDisabled( flag ),
        getInputElement : () => inputRef.current,
        // add more methods as needed
    }), [text] );

    ///////////////////////////////////////////////////////////////////////////////////////////////////
    function valueChanged() : void
    {
        setText( props.value !== undefined ? props.value : "" );
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////
    function disabledChanged() : void
    {
        setDisabled( props.disabled );
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////
    // construct the voice-to-text recognizer once (when enabled + supported); dispose on unmount. Handlers
    // read the *ref*s so they always see the current text/props despite being bound once.
    function setupVoice() : ( () => void ) | undefined
    {
        if( !( props.voiceToText ?? false ) || !VoiceToText.isSupported() )return undefined;
        const v2t : VoiceToText = new VoiceToText( {}, {
            onStart:  () : void => { gotResultRef.current = false; setListening( true ); },
            onEnd:    onVoiceEnd,
            onResult: onVoiceResult,
        } );
        v2tRef.current = v2t;
        return () : void => v2t.dispose();
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////
    // a finalized dictation chunk — append to the current text (space-separated) and push it out via onChange
    function onVoiceResult( chunk : string, isFinal : boolean ) : void
    {
        if( !isFinal )return;
        const piece : string = chunk.trim();
        if( piece === "" )return;
        gotResultRef.current = true;
        const current : string = textRef.current ?? "";
        const next : string = current === "" ? piece : `${ current } ${ piece }`;
        textRef.current = next;
        setText( next );
        if( propsRef.current.onChange )propsRef.current.onChange( next );
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////
    // dictation ended — clear the mic state and, if requested, fire onEnter once (like pressing Enter)
    function onVoiceEnd() : void
    {
        setListening( false );
        if( propsRef.current.onEnterAtVoiceDone && gotResultRef.current && propsRef.current.onEnter )propsRef.current.onEnter();
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////
    // mic button — start/stop dictation
    function onToggleMic() : void
    {
        v2tRef.current?.toggle();
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////
    function setFocus() : void
    {
        inputRef.current?.focus();
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////
    function selectAll(): void
    {
        const el : HTMLInputElement | null = inputRef.current;
        if( el )
        {
            el.setSelectionRange( 0, el.value.length);
            el.focus();
        }
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////
    function onChange( evt : React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement> ) : void
    {
        evt.preventDefault();
        let value : string = ( evt.target.value as string );

        if( props.allUpperCase !== undefined && props.allUpperCase )
        {
            value = value.toUpperCase();
        }
        else if( props.allLowerCase !== undefined && props.allLowerCase )
        {
            value = value.toLowerCase();
        }
        else if( props.allNumeric !== undefined && props.allNumeric )
        {
            value = value.replace(/[^0-9.-]/g, "");
        }

        if( props.noSpaces !== undefined && props.noSpaces )
        {
            value = StringUtils.removeAllSpaces( value );
        }

        if( props.onlyAlphaNumeric != undefined && props.onlyAlphaNumeric )
        {
            value = StringUtils.removeNonAlphaNumeric( value );
        }

        if( props.maxLength !== undefined && props.maxLength > 0 )
        {
            value = value.substring( 0, props.maxLength );
        }

        setText( value );

        // when allNumeric, skip notifying parent for incomplete states that would produce NaN
        // e.g. "-", ".", "-."  — but allow ".4", "1.", "-3.5" etc. which are valid numbers
        const isIncompleteNumeric : boolean =
            props.allNumeric !== undefined
            && props.allNumeric === true
            && value !== ""
            && isNaN( Number( value ) );

        if( props.onChange != undefined && !isIncompleteNumeric )props.onChange( value );
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////
    function onKeyPress( evt : React.KeyboardEvent<HTMLDivElement> ) : void
    {
        if( props.onKeyPress != undefined )props.onKeyPress( evt );
        if( evt.key == "Enter" && props.onEnter != undefined )
        {
            props.onEnter();
        }
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////
    function onFocus( evt : React.FocusEvent<HTMLInputElement | HTMLTextAreaElement> ) : void
    {
        if( props.onFocus )props.onFocus( true );
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////
    function onBlur( evt : React.FocusEvent<HTMLInputElement | HTMLTextAreaElement> ) : void
    {
        if( props.onFocus )props.onFocus( false );
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////
    function onDblClick( evt : any ) : void
    {
        if( props.onDblClick )props.onDblClick();
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////
    function onSelect() : void
    {
        const el : any = inputRef.current;
        if( el && props.onCursorChange )props.onCursorChange( el.selectionStart ?? 0 );
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////
    // this is a little different that an attribute () is doing something that normally a setter
    // would do.
    // the property is ignored after this points
    //
    function insertRequest() : void
    { 
        if( props.insertAtCursor != undefined && props.insertAtCursor != null && props.insertAtCursor != "" )
        {
            insertStringAtCursor( props.insertAtCursor );
        }
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////
    function insertStringAtCursor( str : string ) : void
    {
        const el : HTMLInputElement | null = inputRef.current;
        if( !el )return;

        // get current cursor or selection
        const start    : number = el.selectionStart ?? 0;
        const end      : number = el.selectionEnd ?? 0;
        const newValue : string = text.slice(0, start) + str + text.slice( end );

        // set new value
        setText( newValue );

        // update parent control
        if( props.onChange != undefined )props.onChange( newValue );

        // reset cursor position
        setTimeout(() => {
                            el.setSelectionRange(start + str.length, start + str.length);
                            el.focus();
                        }, 0 );

        
    }


    let input       : any = null;
    let startIcon   : JSX.Element | undefined = undefined;
    let endIcon     : JSX.Element | undefined = undefined;
    let read_only   : boolean = props.readOnly ?? false;

    if( ValueUtils.notUndefined( props.startLabel ) && props.startLabel !== "" )
    {
        startIcon = <InputAdornment position="start" >
                        <span style={ props.disabled !== undefined && props.disabled ? { color: 'text.disabled' } : {} }>
                            { props.startLabel }
                        </span>
                    </InputAdornment>;
    }
    else if( ValueUtils.notUndefined( props.startIcon ) )
    {
        startIcon = <InputAdornment position="start" >{ props.startIcon }</InputAdornment>;
    }

    if( ValueUtils.notUndefined( props.endLabel ) && props.endLabel !== "" )
    {
        endIcon = <InputAdornment position="end">
                    <span style={ props.disabled !== undefined && props.disabled ? { color: 'text.disabled' } : {} }>
                            { props.endLabel }
                    </span>
                </InputAdornment>;
    }
    else if( ValueUtils.notUndefined( props.endIcon ) )
    {
        endIcon = <InputAdornment position="end">{ props.endIcon }</InputAdornment>;
    }

    // voice-to-text mic toggle, shown at the START of the entry (before any start label/icon)
    const showMic : boolean = ( props.voiceToText ?? false ) && VoiceToText.isSupported();
    const micIcon : JSX.Element | undefined = showMic
            ? <InputAdornment position="start">
                    <ButtonIcon id="voice-to-text" label={ "Voice To Text" } size="small" disabled={ disabled }
                                icon={ listening ? <MicOffOutlinedIcon color="error" fontSize="small" /> : <MicNoneOutlinedIcon color="primary" fontSize="small" /> }
                                onClick={ onToggleMic } />
                </InputAdornment>
            : undefined;

    const startAdornment : JSX.Element | undefined = micIcon && startIcon
            ? <>{ micIcon }{ startIcon }</>
            : ( micIcon ?? startIcon );

    if( read_only || ValueUtils.notNull( startAdornment ) || ValueUtils.notNull( endIcon ) )
    {
        input = {   readOnly        : read_only,
                    startAdornment  : startAdornment,
                    endAdornment    : endIcon ?? endIcon
                };
    }

    // sx={ { "& .MuiInputBase-root": { color: 'white' }, "& .MuiInputLabel-root": { color: 'white' },  "& .MuiOutlinedInput-root": { color: 'white' } } }

    return <TextField   required    = { props.required ?? false }
                        fullWidth   = { props.fullWidth ?? true }
                        variant     = { read_only ? "standard" : "outlined" }
                        error       = { props.error !== undefined && props.error !== "" ? true : false }
                        helperText  = { props.error !== undefined ? props.error : "" }
                        id          = { props.id }
                        label       = { props.label }
                        name        = { props.id }
                        placeholder = { props.placeHolder !== undefined ? props.placeHolder : undefined }
                        inputRef    = { inputRef }
                        size        = { props.dense !== undefined ? ( props.dense ? "small" : "medium" ) : "small" }
                        disabled    = { disabled !== undefined ? disabled : false }
                        autoComplete= { props.autoComplete ?? props.id }
                        onChange    = { ( evt: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement> ) => onChange( evt ) }
                        onKeyDown   = { ( evt: React.KeyboardEvent<HTMLDivElement> ) => onKeyPress( evt )}
                        onFocus     = { onFocus }
                        onBlur      = { onBlur }
                        onDoubleClick={ onDblClick }
                        onSelect     = { onSelect }
                        autoFocus   = { props.focus ?? false }
                        multiline   = { props.multiline ?? false }
                        maxRows     = { props.maxRows ?? 1 }
                        //color = { "error" }
                        //rows        = { props.initRows ?? undefined }
                        value       = { text ?? "" }
                                            
                        style       = {{  width  : props.width ?? undefined }}
                        sx          = { [ props.sx, {   "& .MuiInputBase-input": { color: props.color ? props.color : undefined },
                                                        "& .MuiInputLabel-root": { color: props.color ? props.color : undefined },  
                                                        "& .MuiInputLabel-root.Mui-focused": { color: props.color ? props.color : undefined },
                                                        input :   {
                                                                    textAlign: props.align ?? "left"
                                                                }
                                                    }
                                                    
                                        ]
                                      }
                        slotProps  = { { input: input } }
            />;
    }
);

export namespace TextInput
{
    export interface Props
    {
        id                  : string;
        label               : string;
        error?              : string;
        required?           : boolean;
        focus?              : boolean;
        value?              : string;
        startIcon?          : React.ReactNode;
        endIcon?            : React.ReactNode;
        startLabel?         : string;
        endLabel?           : string;
        disabled?           : boolean;
        readOnly?           : boolean;
        multiline?          : boolean;
        maxRows?            : number;
        voiceToText?        : boolean;      // show a mic toggle that dictates into the field (Web Speech API)
        onEnterAtVoiceDone? : boolean;      // when voiceToText: call onEnter once dictation finishes with a result
        placeHolder?        : string;
        fullWidth?          : boolean;
        width?              : string | number;
        dense?              : boolean;
        allUpperCase?       : boolean;
        allLowerCase?       : boolean;
        allNumeric?         : boolean;
        noSpaces?           : boolean;
        onlyAlphaNumeric?   : boolean;
        maxLength?          : number;
        align?              : "left" | "center" | "right";
        autoComplete?       : string;   // HTML autocomplete token (e.g. "username", "email"); defaults to id
        sx?                 : any;
        color?              : string;
        insertAtCursor?     : string | null;

        onChange?           : ( new_value : string ) => void;
        onKeyPress?         : ( evt : React.KeyboardEvent<HTMLDivElement> ) => void;
        onEnter?            : () => void;
        onFocus?            : ( focus : boolean ) => void;
        onDblClick?         : () => void;
        onCursorChange?     : ( location : number ) => void;
    }
}

    // public functions callable by the reference of the parent container
    export interface TextInputHandle
    {
        focus       : () => void;
        setValue    : ( val: string ) => void;
        getValue    : () => string;
        selectAll   : () => void;
        setDisabled : ( flag: boolean ) => void;
        getInputElement : () => HTMLInputElement | null;
    }
//}



export default TextInput;
// eof