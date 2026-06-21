//
import React from 'react';
import { JSX } from "react";

//

//
import { DateTimePicker }       from '@mui/x-date-pickers/DateTimePicker';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { AdapterDayjs }         from '@mui/x-date-pickers/AdapterDayjs';

import dayjs, { Dayjs } from 'dayjs';

// this will need to be updated if additional lanuguages are to be added
import 'dayjs/locale/es';
import 'dayjs/locale/fr';
import 'dayjs/locale/en';


//
import { DateTimeValidationError, PickerChangeHandlerContext } from "@mui/x-date-pickers";
import { PickerValue } from "@mui/x-date-pickers/internals";


//



// https://day.js.org/docs/en/parse/string-format
//
//
//
export function DateTimeInput( props : DateTimeInput.Props ) : JSX.Element
{
    const [cleared, setCleared] = React.useState<boolean>(false);
    const [value, setValue]     = React.useState<Dayjs | null>( null );
    const [locale, setLocale]     = React.useState<string>( "en" );

    React.useEffect( () => propsUpdated(), [props] );
    //React.useEffect( () => valueChanged(), [value] );

    ///////////////////////////////////////////////////////////////////////////////////////////////////
    function propsUpdated() : void
    {
        if( props.value )
        {
            setValue( dayjs( props.value ) );

            if( props.locale )
            {
                
                let new_locale : string = props.locale;
                if( props.locale.includes( '-' ) )
                {
                    new_locale = new_locale.split('-')[0];
                }
                if( locale !== new_locale )setLocale( new_locale );
            }
        }
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////
    function onChange( new_value: PickerValue, context: PickerChangeHandlerContext<DateTimeValidationError> ) : void
    {
        if( props.onChange )props.onChange( new_value ? new_value.toDate() : null );
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////
    function onClear() : void
    {
        //setCleared(true);
        setValue( null );
    }


    let slots : any = { textField: { size: props.dense != null ? ( props.dense ? 'small' : 'large' ) : "small",
                                     sx: { width: props.sx !== undefined && props.sx.width !== undefined ? props.sx.width: 300 }
                                     } };
    if( props.clearable != null && props.clearable )
    {
        slots['field'] = { clearable: true, onClear: onClear };
    }

    return <LocalizationProvider dateAdapter={AdapterDayjs} adapterLocale={ locale }
                localeText={{ clearButtonLabel: 'Empty', todayButtonLabel: 'Now' }}
                >
                <DateTimePicker  key={props.id}
                                label={props.label + ( ( props.required !== undefined && props.required === true ) ? "*" : "" )}
                                value={ value }
                                views={ props.view }
                                minTime={ props.minHours ? dayjs().hour(props.minHours).minute(0).second(0) : undefined }
                                maxTime={ props.maxHours ? dayjs().hour(props.maxHours).minute(0).second(0) : undefined }
                                disabled={ props.disabled != null ? props.disabled : false }
                                readOnly={ props.readOnly != null ? props.readOnly : false }
                                slotProps={ slots }
                                onChange={ onChange } />
        </LocalizationProvider>;

}

export namespace DateTimeInput
{
    export interface Props
    {
        id              : string;
        label           : string;
        value           : Date | null;
        dense?          : boolean;
        disabled?       : boolean;
        required?       : boolean;
        sx?             : { width : number | string; };
        readOnly?       : boolean;
        view?           : Array<"day"|"month"|"year">;
        clearable?      : boolean;
        locale?         : string;
        minHours?       : number;
        maxHours?       : number;
        onChange?       : ( new_value : Date | null ) => void;
    }
}

export default DateTimeInput;

// eof