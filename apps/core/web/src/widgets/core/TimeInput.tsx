//
import React from 'react';
import { JSX } from "react";

//

//
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { AdapterDayjs }         from '@mui/x-date-pickers/AdapterDayjs';

import dayjs, { Dayjs } from 'dayjs';

//
import { DateTimeValidationError, PickerChangeHandlerContext, TimePicker } from "@mui/x-date-pickers";
import { PickerValue } from "@mui/x-date-pickers/internals";


//



// https://day.js.org/docs/en/parse/string-format
//
//
//
export function TimeInput( props : TimeInput.Props ) : JSX.Element
{
    const [cleared, setCleared] = React.useState<boolean>(false);
    const [value, setValue]     = React.useState<Dayjs | null>( null );

    React.useEffect( () => propsUpdated(), [props] );
    //React.useEffect( () => valueChanged(), [value] );

    ///////////////////////////////////////////////////////////////////////////////////////////////////
    function propsUpdated() : void
    {
        if( props.value )
        {
            //console.log("DateTimeInput::props", props.date );
            // is different?
            //if( ObjectUtils.notNull( value ) )
            //{
            //    console.log('propsUpdated', props.date.getFullYear(), props.date.getMonth(), props.date.getDate(), props.date.getHours(), props.date.getMinutes(),
            //    "value:", value.get('year'), value.get('month'), value.get('date'), value.get('hour'), value.get('minute') );
            //}
            /*
            if( ObjectUtils.notNull( value ) &&
                ( props.date.getFullYear()  != value.get('year')
                || props.date.getMonth()    != value.get('month')
                || props.date.getDate()     != value.get('date')
                || props.date.getHours()    != value.get('hour')
                || props.date.getMinutes()  != value.get('minute') ) )
            {
                setValue( dayjs( props.date ) );
            }
            */
            //else if( ObjectUtils.isNull( value ) )
            //{
                setValue( dayjs( props.value ) );
            //}
      
        }
        //else if( ObjectUtils.notNull( value ) )
        //{
        //    setValue( null );
        //}
     
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////
    function onChange( new_value: PickerValue, context: PickerChangeHandlerContext<DateTimeValidationError> ) : void
    {
        //setValue( new_value );
        if( props.onChange )props.onChange( new_value ? new_value.toDate() : null );
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////
    function onClear() : void
    {
        //setCleared(true);
        setValue( null );
    }


    let slots : any = { textField: {
                                        size: props.dense != null ? ( props.dense ? 'small' : 'large' ) : "small",
                                        sx: { width: props.width !== undefined ? props.width: 200 } 
                                    } };
    if( props.clearable != null && props.clearable )
    {
        slots['field'] = { clearable: true, onClear: onClear };
    }

    return <LocalizationProvider dateAdapter={ AdapterDayjs }>
        <TimePicker  key={props.id}
                    label={props.label + ( ( props.required !== undefined && props.required === true ) ? "*" : "" )}
                    value={ value }
                    sx={ { width: "100%" } }
                    views={ props.view ? props.view : ["hours","minutes"] }
                    disabled={ props.disabled != null ? props.disabled : false }
                    readOnly={ props.readOnly != null ? props.readOnly : false }
                    minTime={ props.minHours ? dayjs().hour(props.minHours).minute(0).second(0) : undefined }
                    maxTime={ props.maxHours ? dayjs().hour(props.maxHours).minute(0).second(0) : undefined }
                    slotProps={ slots }
                    onChange={ onChange } />
        </LocalizationProvider>;

}

export namespace TimeInput
{
    export interface Props
    {
        id            : string;
        label         : string;
        value         : Date | null;
        dense?        : boolean;
        disabled?     : boolean;
        required?       : boolean;
        width?        : string | number;
        readOnly?     : boolean;
        view?         : Array<"hours"|"minutes"|"seconds">;
        clearable?    : boolean;
        minHours?       : number;
        maxHours?       : number;
        onChange?     : ( new_value : Date | null ) => void;
    }
}

export default TimeInput;

// eof