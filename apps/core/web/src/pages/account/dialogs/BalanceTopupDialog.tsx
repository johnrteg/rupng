//
import React from 'react';
import { JSX } from "react";

import { Stack, Typography } from "@mui/material";

import DialogWindow  from '@widgets/core/DialogWindow';
import NumericInput  from '@widgets/core/NumericInput';

//
// Balance top-up dialog — collects a one-time credit amount and hands the parent the value in minor units.
// The parent owns whether the dialog is shown (renders it conditionally) and performs the actual charge via
// `onConfirm`; this component owns only the amount field. `onConfirm` returns true on success so DialogWindow
// closes + flashes; false keeps it open.
//
export function BalanceTopupDialog( props : BalanceTopupDialog.Props ) : JSX.Element
{
    const [dollars,setDollars] = React.useState< number >( 0 );

    ////////////////////////////////////////////////////////////////////////////////////////////
    // apply — convert whole currency units to minor units and defer the charge to the parent
    async function onYes() : Promise<boolean>
    {
        const amountMinor : number = Math.round( dollars * 100 );
        if( amountMinor < 1 ) return false;
        return props.onConfirm( amountMinor );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    return  <DialogWindow id="billing-topup"
                          title={"Add funds"}
                          yesLabel={"Add funds"}
                          cancelLabel={"Cancel"}
                          minWidth="xs"
                          ready={ dollars > 0 }
                          onYes={ onYes }
                          onClose={ props.onClose }>
                <Stack spacing={ 2 } sx={{ p: 2 }}>
                    <Typography variant="body2" sx={{ color: "text.secondary" }}>{"Add a one-time credit to your account balance."}</Typography>
                    <NumericInput id="billing-topup-amount" label={"Amount"} value={ dollars } minValue={ 0 } decimalPlaces={ 2 } startLabel={"$"} onChange={ ( value : number ) => setDollars( value ) } fullWidth />
                </Stack>
            </DialogWindow>;
}

export namespace BalanceTopupDialog
{
    export interface Props
    {
        onConfirm : ( amountMinor : number ) => Promise<boolean>;   // performs the charge; true = success (dialog closes)
        onClose   : () => void;                                     // dismiss without charging
    }
}

export default BalanceTopupDialog;
// eof
