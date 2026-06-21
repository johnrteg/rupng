//
import React from 'react';
import { JSX } from "react";

//
import { Stack } from '@mui/material';
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined';

import ButtonIcon               from './ButtonIcon';
import TelephoneMultLabelInput  from './TelephoneMultLabelInput';


//
// Wraps TelephoneMultLabelInput in a row with a gear button on the left used to manage
// the saved (labeled) test phone numbers. The gear's action is supplied by the caller
// via onSettings.
//
export function TestPhoneNumberInput( props: TestPhoneNumberInput.Props ) : JSX.Element
{
    const { onSettings, settingsLabel, ...inputProps } = props;

    return  <Stack direction="row" spacing={ 1 } sx={ { width: "100%", alignItems: "center" } }>

                <ButtonIcon id={ props.id + "-settings" }
                            icon={ <SettingsOutlinedIcon /> }
                            label={ settingsLabel ?? "Settings" }
                            disabled={ props.disabled }
                            onClick={ onSettings } />

                <TelephoneMultLabelInput { ...inputProps } />

            </Stack>;
}

export namespace TestPhoneNumberInput
{
    export interface Props extends TelephoneMultLabelInput.Props
    {
        onSettings      : () => void;       // gear click - manage saved test numbers
        settingsLabel?  : string;           // tooltip/aria label for the gear button
    }
}

export default TestPhoneNumberInput;

// eof
