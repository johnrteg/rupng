//
import React from 'react';
import { JSX } from "react";

//
import { DatePicker }           from '@mui/x-date-pickers/DatePicker';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { AdapterDayjs }         from '@mui/x-date-pickers/AdapterDayjs';

//
import { PickerValue }          from "@mui/x-date-pickers/internals";
import { DateValidationError, PickerChangeHandlerContext } from "@mui/x-date-pickers";

import dayjs, { Dayjs }         from 'dayjs';



// https://day.js.org/docs/en/parse/string-format
//
//
//
export function DateInput( props : DateInput.Props ) : JSX.Element
{
    const [cleared, setCleared] = React.useState<boolean>(false);
    const [value, setValue]     = React.useState<Dayjs | null>( null );

    React.useEffect( () => propsUpdated(), [props] );
    //React.useEffect( () => valueChanged(), [value] );

    ///////////////////////////////////////////////////////////////////////////////////////////////////
    function propsUpdated() : void
    {
        if( props.value !== null )
        {
            const isValid : boolean = props.value instanceof Date && !isNaN( props.value.getTime() );
            if( !isValid ) return;

            // ideally, only look at YYYY-MM-DD portion
            if( value === null || props.value.getTime() !== value.toDate().getTime() )
            {
                setValue( dayjs( props.value ) );
            }
        }
        else
        {
            setValue( null );
        }
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////
    //     //function onChange( new_value : dayjs.Dayjs ) : void
    function onChange( new_value: PickerValue, context: PickerChangeHandlerContext<DateValidationError> ) : void
    {
        setValue( new_value );
        if( props.onChange )props.onChange( new_value ? new_value.toDate() : null );
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////
    function onClear() : void
    {
        //setCleared( true );
        setValue( null );
    }


    let slots : any = { textField: { size: props.dense != null ? ( props.dense ? 'small' : 'large' ) : "small",
                                    sx: {
                                            width: props.width !== undefined ? props.width: 300,
                                            "& .MuiInputBase-input": { color: props.color ? props.color : undefined, WebkitTextFillColor: props.color ?? undefined, },
                                            "& .MuiInputLabel-root": { color: props.color ? props.color : undefined },  
                                            "& .MuiInputLabel-root.Mui-focused": { color: props.color ? props.color : undefined },  
                                            "& .MuiIconButton-root": { color: props.color ? props.color : undefined },

                                            "& .MuiOutlinedInput-root input": { color: props.color ? props.color : undefined, WebkitTextFillColor: props.color ?? undefined, },

                                            "& .MuiOutlinedInput-notchedOutline": { color: props.color ? props.color : undefined },
                                            //"&:hover .MuiOutlinedInput-notchedOutline": { color: props.color ? props.color : undefined },
                                            "&.Mui-focused .MuiOutlinedInput-notchedOutline": { color: props.color ? props.color : undefined },

                                            //"& .MuiOutlinedInput-root input": {
                                            //            color: props.color ? `${props.color} !important` : undefined,
                                            //            WebkitTextFillColor: props.color ? `${props.color} !important` : undefined,
                                            //            },
                                           // "& .MuiInputBase-input": {
                                           //             color: props.color ? `${props.color} !important` : undefined,
                                            //            WebkitTextFillColor: props.color ? `${props.color} !important` : undefined,
                                           //             },

                                        }      }  
                    };
    if( props.clearable != null && props.clearable )
    {
        slots['field'] = { clearable: true, onClear: onClear };
    }

    return<LocalizationProvider dateAdapter={AdapterDayjs}>
        <DatePicker key={props.id}
                    label={ props.label + ( ( props.required !== undefined && props.required === true ) ? "*" : "" ) }
                    value={ value }
                    sx={ { minWidth: 190 } }
                    views={ Array.isArray(props.view) ? props.view : undefined }
                    disabled={ props.disabled !== undefined ? props.disabled : false }
                    readOnly={ props.readOnly !== undefined ? props.readOnly : false }
                    slotProps={ slots }
                    onChange={ onChange } />
        </LocalizationProvider>;
}

export namespace DateInput
{
    export interface Props
    {
        id            : string;
        label         : string;
        value         : Date | null;
        dense?        : boolean;
        disabled?     : boolean;
        required?       : boolean;
        width?          : number;
        readOnly?     : boolean;
        view?         : Array<"day"|"month"|"year">;
        clearable?    : boolean;
        color?        : string;
        onChange?     : ( new_value : Date | null ) => void;
    }

}

export default DateInput;

// eof