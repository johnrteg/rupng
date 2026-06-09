//
import React from 'react';
import { JSX } from "react";

import { InputAdornment, TextField } from '@mui/material';

import AodOutlinedIcon from '@mui/icons-material/AodOutlined';
import AdUnitsOutlinedIcon from '@mui/icons-material/AdUnitsOutlined';

//
import AppModel       from "@model/AppModel";

import ButtonIconToggleGroup from './ButtonIconToggleGroup';
import { StringUtils } from '@repo/common';


enum FormatType
{
    LONG_CODE = "LC",
    SHORT_CODE = "SC"
}


export function TelephoneInput( props : TelephoneInput.Props ) : JSX.Element
{
    //const appmodel           : AppModel = AppModel.instance();
    
    const [phone,setPhone]              = React.useState< string >( formatNumber( props.value ) );
    const [placeHolder,setPlaceHolder]  = React.useState< string >( "(###) ###-####" );
    const [format,setFormat]            = React.useState< string | null >( FormatType.LONG_CODE );

    //
    React.useEffect( phoneUpdated, [props.value] );
    React.useEffect( formatChanged, [format] );

    ////////////////////////////////////////////////////////////////////////////////////////////////////
    function formatNumber( value : string ) : string
    {
        return StringUtils.toRichPhoneNumber( value );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////////////
    function formatChanged() : void
    {
        switch( format )
        {
            case FormatType.LONG_CODE : setPlaceHolder( "(###) ###-####" ); break;
            case FormatType.SHORT_CODE : setPlaceHolder( "######" );
                                        const digits    : string = StringUtils.toPhoneNumber( phone );
                                        if( digits.length > 6 )setPhone( digits.substring(0,6));
                                        break;
        }
    }

    ////////////////////////////////////////////////////////////////////////////////////////////////////
    function phoneUpdated() : void
    {
        //console.log( 'phoneUpdated', props.value, phone );
        if( props.value !== undefined )
        {
            const formatted : string = formatNumber( props.value );
            if( formatted !== phone )setPhone( format === FormatType.LONG_CODE ? formatted : props.value );
        }
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////
    function onChange( evt : React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement> ) : void
    {
        evt.preventDefault();
        let value : string = ( evt.target.value as string );

        const digits    : string = StringUtils.toPhoneNumber( value );
        const formatted : string = formatNumber( digits );
        
        if( format === FormatType.LONG_CODE || ( format === FormatType.SHORT_CODE && digits.length < 7 ) )
        {
            setPhone( format === FormatType.LONG_CODE ? formatted : digits );
            if( digits !== props.value && props.onChange !== undefined )props.onChange( digits );
        }
        
    }

    // ============================================================================================

    let slots : any | undefined = undefined;
    if( props.shortLongToggle && props.shortLongToggle === true )
    {
        slots = {
          input: {
            startAdornment: (
              <InputAdornment position="start">
                <ButtonIconToggleGroup  id="format"
                                        value={ format }
                                        choices={[{ value: FormatType.LONG_CODE, label:"10DLC", icon : <AodOutlinedIcon fontSize="small"/> },
                                                  { value: FormatType.SHORT_CODE, label:"Short Code", icon : <AdUnitsOutlinedIcon fontSize="small" /> } ]}
                                        onChange={ setFormat }/>
              </InputAdornment>
            ),
          },
        }
    }
    // keep enough room for the formatted number even inside a flex row (where it could otherwise
    // be shrunk below its content). the short/long toggle adornment needs more room.
    const minWidth : number | string = props.minWidth ?? ( props.shortLongToggle ? 300 : 175 );

    return <TextField   id          = { props.id }
                        label       = { props.label }
                        placeholder = { placeHolder }
                        size        = "small"
                        value       = { phone }
                        autoFocus   = { props.autoFocus ?? false }
                        disabled    = { props.disabled !== undefined ? props.disabled : false }
                        fullWidth   = { props.fullWidth ?? false }
                        sx          = { { width : props.fullWidth ? "100%" : ( props.sx ? props.sx.width : undefined ), minWidth : minWidth } }
                        slotProps  = { slots }
                        onChange    = { ( evt: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement> ) => onChange( evt ) }
            />
}

export namespace TelephoneInput
{
    export interface Props
    {
        id              : string;
        label           : string;
        value           : string;
        shortLongToggle? : boolean;
        autoFocus?      : boolean;
        disabled?       : boolean;
        fullWidth?      : boolean;
        minWidth?       : number | string;
        sx?             : { width : number | string };
        onChange?       : ( value : string ) => void;
    }
}


export default TelephoneInput;
// eof