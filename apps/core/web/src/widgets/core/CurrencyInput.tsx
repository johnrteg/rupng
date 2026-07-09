//
import React from 'react';
import { JSX } from "react";

import { Type, CurrencyUtils } from '@repo/common';

import NumericInput from './NumericInput';

//
// CurrencyInput — a money field. The VALUE is whole cents ({@link Type.Cents}); the user edits it in major
// units (dollars) with a "$" prefix + 2 decimals. Conversion (cents ⇄ dollars) uses `CurrencyUtils`, so the
// component never leaks floating dollars into stored amounts. For fractional-cent RATES use a rate input, not
// this (this settles to whole cents).
//
export function CurrencyInput( props : CurrencyInput.Props ) : JSX.Element
{
    // display the stored cents as major units
    const dollars : number = CurrencyUtils.centsToDollars( props.value );

    ////////////////////////////////////////////////////////////////////////////////////////////
    // convert the edited dollars back to whole cents before handing up
    function onChange( next : number ) : void
    {
        if( props.onChange ) props.onChange( CurrencyUtils.dollarsToCents( next ) );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    return  <NumericInput id={ props.id }
                          label={ props.label }
                          value={ dollars }
                          decimalPlaces={ 2 }
                          minValue={ 0 }
                          startLabel={ "$" }
                          disabled={ props.disabled }
                          fullWidth={ props.fullWidth }
                          sx={ props.sx }
                          onChange={ onChange } />;
}

export namespace CurrencyInput
{
    export interface Props
    {
        id         : string;
        label      : string;
        value      : Type.Cents;                       // whole cents (the stored amount)
        disabled?  : boolean;
        fullWidth? : boolean;
        sx?        : { width? : number };
        onChange?  : ( cents : Type.Cents ) => void;   // emits whole cents
    }
}

export default CurrencyInput;
