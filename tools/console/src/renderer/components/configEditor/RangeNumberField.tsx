import { useEffect, useState } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import TextField from "@mui/material/TextField";

//
// RangeNumberField — a labeled numeric input with an optional help caption that CLAMPS the committed value
// to [min,max] on blur. The whole point of the smart editor is to make an out-of-range/typo'd number
// impossible to save — free typing is allowed mid-edit, but the value that reaches the config is always
// in range.
//

/** A labeled numeric field that clamps to [min,max] on blur so the config can't drift out of range. */
export function RangeNumberField( props : RangeNumberField.Props )
{
    const [ text, setText ] = useState<string>( String( props.value ) );

    // keep the local text in sync when the underlying value changes from elsewhere (e.g. a sibling edit)
    useEffect( () : void => { setText( String( props.value ) ); }, [ props.value ] );

    /** Free-type — don't clamp/commit until blur, so the user can clear the field or type multi-digit numbers. */
    function onFieldChange( event : React.ChangeEvent<HTMLInputElement> ) : void
    {
        setText( event.target.value );
    }

    /** Parse, clamp to [min,max], and commit — falling back to the last good value on unparseable text. */
    function onFieldBlur() : void
    {
        const numeric : number = Number( text );
        const parsed : number = ( text.trim() === "" || Number.isNaN( numeric ) ) ? props.value : numeric;
        const clamped : number = Math.min( props.max ?? Infinity, Math.max( props.min ?? -Infinity, parsed ) );
        setText( String( clamped ) );
        if ( clamped !== props.value ) props.onChange( clamped );
    }

    return (
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 2, flexWrap: "wrap" }}>
            <Box>
                <Typography variant="body2">{props.label}</Typography>
                {props.help && <Typography variant="caption" sx={{ color: "text.disabled" }}>{props.help}</Typography>}
            </Box>
            <TextField
                size="small" type="number" value={text}
                onChange={onFieldChange}
                onBlur={onFieldBlur}
                disabled={props.disabled}
                slotProps={{ htmlInput: { min: props.min, max: props.max, step: props.step ?? 1 } }}
                sx={{ width: 120 }}
            />
        </Box>
    );
}

export namespace RangeNumberField
{
    export interface Props
    {
        label     : string;
        help?     : string;
        value     : number;
        onChange  : ( value : number ) => void;
        min?      : number;
        max?      : number;
        step?     : number;
        disabled? : boolean;
    }
}

export default RangeNumberField;
