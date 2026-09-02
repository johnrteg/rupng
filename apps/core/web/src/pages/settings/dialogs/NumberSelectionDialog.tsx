//
import React from 'react';
import { JSX } from "react";

import { Stack, Typography } from "@mui/material";

import { PhoneNumber, Texting } from '@repo/api';

import DialogWindow from '@widgets/core/DialogWindow';
import SelectInput   from '@widgets/core/SelectInput';
import TextInput     from '@widgets/core/TextInput';

//
// NumberSelectionDialog — set how a campaign picks a `from` among its registered lines at send time
// (texting-4.10): the WHOLE group, an AREA_CODE subset, or a SINGLE pinned number. `numbers` is the
// campaign's own owned+active lines (client-filtered by the caller), used to populate the SINGLE picker.
//
export function NumberSelectionDialog( props : NumberSelectionDialog.Props ) : JSX.Element
{
    const [mode,setMode]         = React.useState< Texting.NumberSelectionMode >( props.current?.mode ?? Texting.NumberSelectionMode.ALL );
    const [number,setNumber]     = React.useState< string >( props.current?.number ?? props.numbers[ 0 ]?.number ?? "" );
    const [areaCode,setAreaCode] = React.useState< string >( props.current?.areaCode ?? "" );

    const isSingle   : boolean = mode === Texting.NumberSelectionMode.SINGLE;
    const isAreaCode : boolean = mode === Texting.NumberSelectionMode.AREA_CODE;
    const ready : boolean = ( !isSingle || number !== "" ) && ( !isAreaCode || areaCode.trim() !== "" );

    ////////////////////////////////////////////////////////////////////////////////////////////
    function onYes() : Promise<boolean>
    {
        return props.onSave( {
            mode,
            number:   isSingle ? number : undefined,
            areaCode: isAreaCode ? areaCode.trim() : undefined,
        } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    return  <DialogWindow id="registration-number-selection" title={"Number routing"} yesLabel={"Save"} cancelLabel={"Cancel"}
                          minWidth="sm" ready={ ready } onYes={ onYes } onClose={ props.onClose }>
                <Stack spacing={ 2 } sx={{ pt: 1 }}>
                    <Typography variant="body2" color="text.secondary">
                        Choose how this campaign picks a sending number from its registered lines.
                    </Typography>
                    <SelectInput id="number-selection-mode" label={"Mode"} value={ mode }
                                choices={ SelectInput.enumToChoices( Texting.NumberSelectionMode ) } onChange={ ( value : string ) : void => setMode( value as Texting.NumberSelectionMode ) } />
                    { isSingle &&
                        ( props.numbers.length > 0
                            ? <SelectInput id="number-selection-number" label={"Pinned number"} value={ number }
                                          choices={ props.numbers.map( ( owned : PhoneNumber.PhoneNumber ) : SelectInput.Choice => ( { value: owned.number ?? "", label: owned.number ?? "(pending)" } ) ) }
                                          onChange={ setNumber } />
                            : <Typography variant="body2" color="error">This campaign has no active numbers yet.</Typography> ) }
                    { isAreaCode && <TextInput id="number-selection-area-code" label={"Area code (NPA)"} value={ areaCode } onChange={ setAreaCode } allNumeric /> }
                </Stack>
            </DialogWindow>;
}

export namespace NumberSelectionDialog
{
    export interface Props
    {
        current? : Texting.NumberSelection;
        numbers  : Array<PhoneNumber.PhoneNumber>;   // this campaign's owned+active numbers
        onSave   : ( selection : Texting.NumberSelection ) => Promise<boolean>;
        onClose  : () => void;
    }
}

export default NumberSelectionDialog;
// eof
