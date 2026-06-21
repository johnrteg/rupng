import React from 'react';
import { JSX } from "react";

import TextInput from "./TextInput";
import { NumberUtils } from '@repo/common';

export function NumericInput( props : NumericInput.Props ) : JSX.Element
{
    const NUMERIC_REGEX : RegExp = /[0-9]|\.|,/;

    // state
    const [numeric, setNumeric]     = React.useState<number>( props.value );
    const [text, setText]           = React.useState<string>( "" );
    const [isFocused, setIsFocused] = React.useState<boolean>( false );

    // Update text from props.value only if not focused
    React.useEffect(stateChange, [props.value, props.decimalPlaces, isFocused]);
    React.useEffect(propsUpdated, [props]);

    ////////////////////////////////////////////////////////////////////////////////
    function stateChange() : void
    {
        if (!isFocused) 
        {
            setText( valueToString(props.value) );
        }
    }

    ////////////////////////////////////////////////////////////////////////////////
    function propsUpdated() : void
    {
        if ( numeric != props.value ) setNumeric( props.value );
    }

    ////////////////////////////////////////////////////////////////////////////////
    function getValue() : number
    {
        let nbr: number;
        let places: number = props.decimalPlaces ?? 0;

        // Remove commas for parsing
        const cleanText: string = text.replace(/,/g, '');

        if (places > 0) {
            nbr = parseFloat(cleanText);
        } else {
            nbr = parseInt(cleanText);
        }

        if (isNaN(nbr)) nbr = 0;

        return nbr;
    }

    ////////////////////////////////////////////////////////////////////////////////
    function checkRange(nbr: number): number
    {
        nbr = Math.max(props.minValue ?? nbr, nbr);
        nbr = Math.min(props.maxValue ?? nbr, nbr);
        return nbr;
    }

    ////////////////////////////////////////////////////////////////////////////////
    function valueToString(nbr: number): string
    {
        if (!NumberUtils.isValid(nbr)) return "n/a";

        const decimalPlaces : number = props.decimalPlaces ?? 0;
        const formatted : string = nbr.toFixed(decimalPlaces);

        // Add comma formatting for numbers >= 1000
        if (Math.abs(nbr) >= 1000) {
            return Number(formatted).toLocaleString('en-US', {
                minimumFractionDigits: decimalPlaces,
                maximumFractionDigits: decimalPlaces
            });
        }

        return formatted;
    }

    ////////////////////////////////////////////////////////////////////////////////
    function setValue(nbr: number): void
    {
        setText(valueToString(nbr));
    }

    ////////////////////////////////////////////////////////////////////////////////
    function onFocus(focus: boolean): void
    {
        setIsFocused(focus);
        if (!focus)
        {
            let nbr: number = getValue();
            nbr = checkRange(nbr);
            setValue(nbr); // Format only on blur
            if (props.onChange && props.value !== nbr) props.onChange(nbr);
        }
    }

    ////////////////////////////////////////////////////////////////////////////////
    function onKeyPress(evt: React.KeyboardEvent<HTMLDivElement>): void
    {
        if ((evt.key === "+" && evt.ctrlKey) || evt.key === "ArrowUp")
        {
            let nbr: number = checkRange(getValue() + 1);
            setValue(nbr);
        }
        else if ((evt.key === "-" && evt.ctrlKey) || evt.key === "ArrowDown")
        {
            let nbr: number = checkRange(getValue() - 1);
            setValue(nbr);
        }

        if (
            evt.key != "Backspace"
            && evt.key != "ArrowLeft"
            && evt.key != "ArrowRight"
            && (evt.key != "-" && !evt.altKey)
            && !NUMERIC_REGEX.test(evt.key)
        ) {
            evt.preventDefault();
        }
    }

    ////////////////////////////////////////////////////////////////////////////////
    function onEnter(): void
    {
        onFocus(false); // Format on enter
        if (props.onEnter) props.onEnter();
    }

    ////////////////////////////////////////////////////////////////////////////////
    // Only update numeric state on valid input, but do not format while typing
    function handleTextChange(newText: string): void
    {
        setText(newText);
        // Remove commas for parsing
        const cleanText : string = newText.replace(/,/g, '');
        let nbr: number;
        const places : number = props.decimalPlaces ?? 0;
        if (places > 0)
        {
            nbr = parseFloat(cleanText);
        }
        else
        {
            nbr = parseInt(cleanText);
        }
        if (!isNaN(nbr))
        {
            nbr = checkRange(nbr);
            setNumeric(nbr);
            if (props.onChange && nbr !== props.value)
            {
                props.onChange(nbr);
            }
        }
    }

    return <TextInput
                    id={props.id}
                    label={props.label}
                    disabled={props.disabled}
                    readOnly={props.readOnly}
                    fullWidth={props.fullWidth}
                    align={"right"}
                    value={text}
                    required={props.required}
                    startIcon={props.startIcon}
                    startLabel={props.startLabel}
                    endLabel={props.endLabel}
                    placeHolder={props.placeHolder}
                    width={props.sx !== undefined && props.sx.width ? props.sx.width : undefined}
                    dense={props.dense}
                    error={props.error}
                    onChange={handleTextChange}
                    onKeyPress={onKeyPress}
                    onFocus={onFocus}
                    onEnter={onEnter}
                />;
}

export namespace NumericInput
{
    export interface Props
    {
        id                  : string;
        label               : string;
        value               : number;
        minValue?           : number;
        maxValue?           : number;
        decimalPlaces?      : number;

        startIcon?          : React.ReactNode;

        startLabel?         : string;
        endLabel?           : string;

        placeHolder?        : string;

        required?           : boolean;
        error?              : string;
        dense?              : boolean;
        disabled?           : boolean;
        readOnly?           : boolean;
        fullWidth?          : boolean;
        sx?                 : { width? : number };
        onChange?           : ( new_value : number ) => void;
        onEnter?            : () => void;
    }
}

export default NumericInput;

// eof