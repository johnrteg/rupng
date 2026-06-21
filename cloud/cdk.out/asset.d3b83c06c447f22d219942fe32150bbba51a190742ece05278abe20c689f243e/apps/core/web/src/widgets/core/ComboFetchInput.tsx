//
import React from 'react';
import { JSX } from "react";

//
import { IconButton, MenuItem, Box, Popper, Paper, Stack, Typography, MenuList} from '@mui/material';
//import { createFilterOptions } from '@mui/material/Autocomplete';

import ArrowDropDownOutlinedIcon from '@mui/icons-material/ArrowDropDownOutlined';
import ArrowDropUpOutlinedIcon from '@mui/icons-material/ArrowDropUpOutlined';
import ClearOutlinedIcon from '@mui/icons-material/ClearOutlined';

//
import TextInput, { TextInputHandle }   from './TextInput';
import { ValueUtils } from '@repo/common';



//const filter = createFilterOptions< ComboFetchInput.Choice >();


//
//
//
export function ComboFetchInput( props : ComboFetchInput.Props ) : JSX.Element
{
    // state
    const [text,setText]            = React.useState< string >( "" );
    const [value,setValue]          = React.useState< string | null >( props.value );
    const [choices,setChoices]      = React.useState< Array< ComboFetchInput.Choice > | null >( null );
    const [loading, setLoading]     = React.useState< boolean >(false);
    const timeoutRef                = React.useRef<ReturnType<typeof setTimeout> | null>(null);

    // menu
    const [open, setOpen]           = React.useState< boolean >(false);
    const inputRef                  = React.useRef< TextInputHandle | null >( null );
    //const selectedRef               = React.useRef< HTMLLIElement | null>( null );

    const ITEM_HEIGHT : number = 60;


    //
    React.useEffect( () => () => unMountComponent(), [] );
    React.useEffect( propValueUpdated, [props.value] );
    React.useEffect( valueSelected, [value] );
    React.useEffect( doDebounce, [text] );
    React.useEffect( choicesUpdated, [choices] );
    //React.useEffect( scrollToSelected, [open,value] );

    ///////////////////////////////////////////////////////////////////////////////////////////////////
    function unMountComponent() : void
    {
        if( timeoutRef.current )clearTimeout( timeoutRef.current );
        setLoading( false );
    }

/*
    ///////////////////////////////////////////////////////////////////////////////////////////////////
    function scrollToSelected() : void
    {
        if( open && selectedRef.current )
        {
            console.log('scrollToSelected');
            selectedRef.current.scrollIntoView({ block: "nearest" });
        }
    }
*/
    ///////////////////////////////////////////////////////////////////////////////////////////////////
    function propValueUpdated() : void
    {
        //console.log('propValueUpdated', props.value, value );
        if( props.value && props.value !== value )
        {
            setValue( props.value );
        }
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////
    function valueSelected() : void
    {
        const found : ComboFetchInput.Choice | undefined = ( value !== null && value !== "" && choices ) ? choices.find( ( v : ComboFetchInput.Choice ) => { return v.value === value } ) : undefined;
        //console.log('valueSelected', value, found );
        if( found )
        {
            if( text !== found.label )setText( found.label );
            if( props.value !== found.value )props.onChange( found.value );
        }
        // if not found in current choices, go get it
        else if( value !== null && value !== "" )   
        {
            props.onChange( null );
            getChoices( value );
        }
        
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////
    function doDebounce() : void
    {
        if( timeoutRef.current )clearTimeout( timeoutRef.current );
        timeoutRef.current = setTimeout( onDelay, 750 );
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////
    function onDelay() : void
    {
        timeoutRef.current = null;
        setValue( null );
        getChoices( text );
    }

    /////////////////////////////////////////////////////////////////////////////////////////////////////////////
    async function getChoices( search : string ) : Promise<void>
    {
        setLoading( true );
            let new_choices : Array<ComboFetchInput.Choice> = await props.onUpdateChoices( search );
            //console.log('getChoices', text, value, new_choices.length );

            // what gets returned from the server can sometimes be too much
            // filter based on the current text
            const text_trim : string = text.trim();
            // allow the person to enter cids
            if( text_trim !== "" && !text_trim.startsWith( "c_" ))
            {
                const lower_text : string = text.trim().toLowerCase();
                // case insenstive, any occurance of text in label
                new_choices = new_choices.filter( ( item : ComboFetchInput.Choice ) => { return item.label.toLowerCase().includes( lower_text ) } );
            }
            if( value !== null && value !== "" )
            {
                new_choices = new_choices.filter( ( item : ComboFetchInput.Choice ) => { return item.value === value } );
            }

            setChoices( new_choices );
        setLoading( false );
    }

    /////////////////////////////////////////////////////////////////////////////////////////////////////////////
    function choicesUpdated() : void
    {
        let match : boolean = false;
        if( choices )
        {
            const found_by_text : ComboFetchInput.Choice | undefined = ( text !== "" ) ? choices.find( ( v : ComboFetchInput.Choice ) => { return v.label === text } ) : undefined;
            //console.log('choicesUpdated', value, found_by_text );
            if( found_by_text !== undefined )
            {
                //console.log( "setValue", found_by_text.value );
                setValue( found_by_text.value );
                match = true;
            }

            // not found
            else if( value !== null && value !== "" )
            {
                const found_by_value : ComboFetchInput.Choice | undefined = choices.find( ( v : ComboFetchInput.Choice ) => { return v.value === value } );
                if( found_by_value )
                {
                    //console.log( "setText", found_by_value.label );
                    setText( found_by_value.label );
                    match = true;
                }
            }

        }

        if( !match )props.onChange( null );
    }

    /////////////////////////////////////////////////////////////////////////////////////////
    function onFocus( focus : boolean ) : void
    {
        if( !focus )
        {
            setTimeout(() => setOpen(false), 500 ); // Delay closing so click can be processed
        }
        else
        {
            setOpen(true);
        }
    }

    /////////////////////////////////////////////////////////////////////////////////////////
    function onSelect( id : string ) : void
    {
        //console.log('onSelect', id );
        setOpen( false );
        setValue( id );
    }

    /////////////////////////////////////////////////////////////////////////////////////////
    function onClear() : void
    {
        setText( "" );
        setValue( null );
        
        inputRef.current?.focus();  // focus gets pulled away, this restores it
    }

    /////////////////////////////////////////////////////////////////////////////////////////
    function endIcon() : JSX.Element
    {
        return <Stack direction="row" spacing={0} sx={ { p : 0 } }>
            { open && text !== "" ? <IconButton onClick={ () => onClear() }>{ <ClearOutlinedIcon/> } </IconButton> : null }
            { open ? <Box sx={ { pt: 0.75 } }><ArrowDropUpOutlinedIcon/></Box> : <ArrowDropDownOutlinedIcon/> }
        </Stack>;
    }


    const sx : any = { width: ValueUtils.notNull( props.width ) ? props.width : undefined }; 

    // 
    // ===============================================================================================
    return <Box sx={ { width : "100%" } }>
                <TextInput  id={ props.id }
                            ref={ inputRef }
                            label={ props.label }
                            value={ text }
                            disabled={ loading }
                            endIcon={ endIcon() }
                            onFocus={ onFocus }
                            onChange={ setText } />

                <Popper
                    open={open}
                    anchorEl={ inputRef.current ? inputRef.current.getInputElement() : null}
                    placement="bottom-start"
                    style={{ width: inputRef.current?.getInputElement()?.offsetWidth || undefined, zIndex: 1300 }}
                >
                    <Paper style={{ width: "100%", maxHeight: ITEM_HEIGHT * 4.5, overflowY: "auto", overflowX:"hidden" }}>
                        
                        
                        { choices !== null && choices.length > 0 ? <MenuList>
                        { choices && choices.map((option: ComboFetchInput.Choice) => (
                            <MenuItem
                                key={ option.value }
                                selected={ option.value === value }
                                //ref={ option.value === value ? selectedRef : null }
                                onClick={ () => onSelect ( option.value ) }
                            >
                                { option.label }
                            </MenuItem>
                        )
                        )}
                        
                        </MenuList> : null }

                        { choices === null || choices.length === 0 ? <Box sx={ { p: 0.5, display: "flex", alignItems: "center", justifyContent: "center" } }>
                                                                        <Typography color="textDisabled">{ "No Matches" }</Typography>
                                                                    </Box> : null }

                    </Paper>
                </Popper>

        </Box>

}


export namespace ComboFetchInput
{
    export interface Choice
    {
        value : string;
        label : string;
    }

    export interface Props
    {
        id              : string;
        label           : string;
        value           : string | null;
        fullWidth?      : boolean;
        width?          : string | number;
        disabled?       : boolean;
        onUpdateChoices : ( value : string ) => Promise< Array<ComboFetchInput.Choice> >;
        onChange        : ( new_value : string | null ) => void;
    }
}

export default ComboFetchInput;

// eof