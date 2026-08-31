//
import React from 'react';
import { JSX } from "react";

import { Stack, Tab, Tabs, Typography } from "@mui/material";

import { Report } from '@repo/api';

import SelectInput  from '@widgets/core/SelectInput';
import NumericInput from '@widgets/core/NumericInput';
import DateInput    from '@widgets/core/DateInput';

// the three ways a UI can express a time-bounded window — mirrors Report.DateWindow's tagged union, but as a
// selectable mode (the union alone can't tell "preset" from "rolling" apart — both are kind:"relative")
enum Mode
{
    PRESET  = "preset",
    ROLLING = "rolling",
    FIXED   = "fixed",
}

// rolling-window unit choices — Report.Unit is a string-literal type (not an enum), so hand-list the choices
const UNIT_CHOICES : Array<SelectInput.Choice> =
[
    { value: "day",     label: "Day(s)" },
    { value: "week",    label: "Week(s)" },
    { value: "month",   label: "Month(s)" },
    { value: "quarter", label: "Quarter(s)" },
    { value: "year",    label: "Year(s)" },
];

const PRESET_CHOICES : Array<SelectInput.Choice> = SelectInput.enumToChoices( Report.RelativePreset );

//
// DateWindowInput — the ONE shared editor for a `Report.DateWindow` param, reused by the submit dialog
// (allowFixed=true) and the schedule dialog (allowFixed=false — a Schedule can't carry a frozen fixed window;
// it would re-pull the same dates on every fire, report-3.3). Three modes: a named RelativePreset, a rolling
// amount+unit(+endOffsetDays), or (when allowed) a fixed start/end pair.
//
export function DateWindowInput( props : DateWindowInput.Props ) : JSX.Element
{
    const mode : Mode = modeOf( props.value );

    ////////////////////////////////////////////////////////////////////////////////////////////
    // classify the current value into a UI mode (both relative shapes share kind:"relative")
    function modeOf( value : Report.DateWindow ) : Mode
    {
        if( value.kind === "fixed" ) return Mode.FIXED;
        if( "preset" in value ) return Mode.PRESET;
        return Mode.ROLLING;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // switching modes reseeds `value` with a sane default for the newly selected mode
    function onModeChange( _event : React.SyntheticEvent, next : Mode ) : void
    {
        if( next === Mode.PRESET )  props.onChange( { kind: "relative", preset: Report.RelativePreset.LAST_30_DAYS } );
        if( next === Mode.ROLLING ) props.onChange( { kind: "relative", rolling: { amount: 7, unit: "day" } } );
        if( next === Mode.FIXED )   props.onChange( { kind: "fixed" } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    function onPresetChange( value : string ) : void
    {
        props.onChange( { kind: "relative", preset: value as Report.RelativePreset } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // rolling amount changed — keep the current unit + endOffsetDays
    function onRollingAmountChange( amount : number ) : void
    {
        if( props.value.kind !== "relative" || !( "rolling" in props.value ) ) return;
        props.onChange( { kind: "relative", rolling: { ...props.value.rolling, amount }, endOffsetDays: props.value.endOffsetDays } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    function onRollingUnitChange( unit : string ) : void
    {
        if( props.value.kind !== "relative" || !( "rolling" in props.value ) ) return;
        props.onChange( { kind: "relative", rolling: { ...props.value.rolling, unit: unit as Report.Unit }, endOffsetDays: props.value.endOffsetDays } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    function onEndOffsetChange( days : number ) : void
    {
        if( props.value.kind !== "relative" || !( "rolling" in props.value ) ) return;
        props.onChange( { kind: "relative", rolling: props.value.rolling, endOffsetDays: days } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    function onFixedStartChange( date : Date | null ) : void
    {
        if( props.value.kind !== "fixed" ) return;
        props.onChange( { ...props.value, start: date ? date.toISOString() : undefined } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    function onFixedEndChange( date : Date | null ) : void
    {
        if( props.value.kind !== "fixed" ) return;
        props.onChange( { ...props.value, end: date ? date.toISOString() : undefined } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    return  <Stack spacing={ 2 }>
                <Tabs value={ mode } onChange={ onModeChange }>
                    <Tab value={ Mode.PRESET }  label={"Preset"} />
                    <Tab value={ Mode.ROLLING } label={"Rolling"} />
                    { props.allowFixed && <Tab value={ Mode.FIXED } label={"Fixed"} /> }
                </Tabs>

                { mode === Mode.PRESET &&
                    <SelectInput id="window-preset" label={"Range"}
                                 value={ props.value.kind === "relative" && "preset" in props.value ? props.value.preset : "" }
                                 choices={ PRESET_CHOICES } onChange={ onPresetChange } sx={{ width: 260 }} /> }

                { mode === Mode.ROLLING &&
                    <Stack direction="row" spacing={ 1 } sx={{ alignItems: "flex-start" }}>
                        <NumericInput id="window-rolling-amount" label={"Amount"}
                                      value={ props.value.kind === "relative" && "rolling" in props.value ? props.value.rolling.amount : 7 }
                                      minValue={ 1 } onChange={ onRollingAmountChange } />
                        <SelectInput id="window-rolling-unit" label={"Unit"}
                                     value={ props.value.kind === "relative" && "rolling" in props.value ? props.value.rolling.unit : "day" }
                                     choices={ UNIT_CHOICES } onChange={ onRollingUnitChange } sx={{ width: 160 }} />
                        <NumericInput id="window-rolling-endoffset" label={"End offset (days)"}
                                      value={ props.value.kind === "relative" && "rolling" in props.value ? ( props.value.endOffsetDays ?? 0 ) : 0 }
                                      minValue={ 0 } onChange={ onEndOffsetChange } />
                    </Stack> }

                { mode === Mode.FIXED && props.allowFixed &&
                    <Stack direction="row" spacing={ 1 }>
                        <DateInput id="window-fixed-start" label={"Start"}
                                   value={ props.value.kind === "fixed" && props.value.start ? new Date( props.value.start ) : null }
                                   onChange={ onFixedStartChange } />
                        <DateInput id="window-fixed-end" label={"End"}
                                   value={ props.value.kind === "fixed" && props.value.end ? new Date( props.value.end ) : null }
                                   onChange={ onFixedEndChange } />
                    </Stack> }

                { mode === Mode.ROLLING &&
                    <Typography variant="caption" sx={{ color: "text.secondary" }}>
                        {"Rolling: amount/unit back from today, minus an optional end offset (days) — resolved to concrete dates at submit/fire time."}
                    </Typography> }
            </Stack>;
}

export namespace DateWindowInput
{
    export interface Props
    {
        value      : Report.DateWindow;
        onChange   : ( value : Report.DateWindow ) => void;
        allowFixed : boolean;   // schedules can't carry a fixed window (report-3.3) — the submit dialog can
    }
}

export default DateWindowInput;
// eof
