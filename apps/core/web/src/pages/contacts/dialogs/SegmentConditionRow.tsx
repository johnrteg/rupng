//
import React from 'react';
import { JSX } from "react";

import { Box, Stack } from "@mui/material";
import DeleteOutlineOutlinedIcon from '@mui/icons-material/DeleteOutlineOutlined';

import { Segment } from '@repo/api';
import { type Type } from '@repo/common';

import TextInput       from '@widgets/core/TextInput';
import NumericInput    from '@widgets/core/NumericInput';
import DateInput       from '@widgets/core/DateInput';
import DateTimeInput   from '@widgets/core/DateTimeInput';
import SelectInput     from '@widgets/core/SelectInput';
import SelectMultInput from '@widgets/core/SelectMultInput';
import TagInput        from '@widgets/core/TagInput';
import CountryInput    from '@widgets/core/CountryInput';
import StateInput      from '@widgets/core/StateInput';
import TimezoneInput   from '@widgets/core/TimezoneInput';
import ButtonIcon      from '@widgets/core/ButtonIcon';

// Human labels for the filter operators (UI vocabulary — matches the reference "is / begins with / …"). Pure
// constant, so it sits at module scope.
const OPERATOR_LABELS : Record<Segment.Operator, string> =
{
    [ Segment.Operator.IS ]:                    "is",
    [ Segment.Operator.IS_NOT ]:                "is not",
    [ Segment.Operator.CONTAINS ]:              "contains",
    [ Segment.Operator.BEGINS_WITH ]:           "begins with",
    [ Segment.Operator.ENDS_WITH ]:             "ends with",
    [ Segment.Operator.LESS_THAN ]:             "less than",
    [ Segment.Operator.LESS_THAN_OR_EQUAL ]:    "less than or equal to",
    [ Segment.Operator.GREATER_THAN ]:          "greater than",
    [ Segment.Operator.GREATER_THAN_OR_EQUAL ]: "greater than or equal to",
    [ Segment.Operator.BETWEEN ]:               "between",
    [ Segment.Operator.ANY_OF ]:                "any of",
    [ Segment.Operator.EVERY_OF ]:              "every of",
    [ Segment.Operator.NONE_OF ]:               "none of",
    [ Segment.Operator.WITHIN ]:                "within",
    [ Segment.Operator.IS_EMPTY ]:              "is empty",
    [ Segment.Operator.IS_NOT_EMPTY ]:          "is not empty",
};

const UNIT_CHOICES : Array<SelectInput.Choice> =
[
    { value: Segment.DistanceUnit.MILES,      label: "miles" },
    { value: Segment.DistanceUnit.KILOMETERS, label: "km" },
];

const BOOLEAN_CHOICES : Array<SelectInput.Choice> =
[
    { value: "true",  label: "Yes" },
    { value: "false", label: "No" },
];

//
// SegmentConditionRow — one filter condition in the segment query builder: a field (Data) + an operator
// (Comparison) + a type-aware operand editor + a delete. Fully controlled — the parent group owns the
// condition and receives every change via `onChange`. The operand editor it renders is driven by the
// operator's operand cardinality (`Segment.OPERATOR_OPERAND`) and the field's data type.
//
export function SegmentConditionRow( props : SegmentConditionRow.Props ) : JSX.Element
{
    // the field this row targets (fall back to the first catalog field if the id is unknown)
    const field : Segment.FilterField = props.fields.find( ( entry : Segment.FilterField ) : boolean => entry.id === props.condition.field ) ?? props.fields[ 0 ];
    const allowedOperators : Array<Segment.Operator> = Segment.operatorsFor( field );
    const operandKind : Segment.Operand = Segment.OPERATOR_OPERAND[ props.condition.operator ];

    // choices for the two dropdowns
    const fieldChoices : Array<SelectInput.Choice> = props.fields.map( ( entry : Segment.FilterField ) : SelectInput.Choice => ( { value: entry.id, label: entry.label } ) );
    const operatorChoices : Array<SelectInput.Choice> = allowedOperators.map( ( operator : Segment.Operator ) : SelectInput.Choice => ( { value: operator, label: OPERATOR_LABELS[ operator ] } ) );

    ////////////////////////////////////////////////////////////////////////////////////////////
    // Changing the FIELD resets the operator to the new field's first allowed op and clears the operand
    // (its shape usually no longer applies).
    function onFieldChange( id : string ) : void
    {
        const next : Segment.FilterField = props.fields.find( ( entry : Segment.FilterField ) : boolean => entry.id === id ) ?? props.fields[ 0 ];
        const operators : Array<Segment.Operator> = Segment.operatorsFor( next );
        props.onChange( { field: id, operator: operators[ 0 ], value: undefined, values: undefined } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // Changing the OPERATOR clears the operand (single↔set↔pair↔none shapes don't carry over).
    function onOperatorChange( operator : string ) : void
    {
        props.onChange( { ...props.condition, operator: operator as Segment.Operator, value: undefined, values: undefined } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // operand setters — each writes back the whole condition (controlled)
    function setValue( value : Type.Json ) : void
    {
        props.onChange( { ...props.condition, value, values: undefined } );
    }
    function setValues( values : Array<Type.Json> ) : void
    {
        props.onChange( { ...props.condition, value: undefined, values } );
    }
    function setPairAt( index : number, value : Type.Json ) : void
    {
        const pair : Array<Type.Json> = [ props.condition.values?.[ 0 ] ?? "", props.condition.values?.[ 1 ] ?? "" ];
        pair[ index ] = value;
        props.onChange( { ...props.condition, value: undefined, values: pair } );
    }
    function setGeo( patch : Partial<Segment.GeoWithin> ) : void
    {
        const current : Segment.GeoWithin = ( props.condition.value as Segment.GeoWithin | undefined ) ?? { lat: 0, lng: 0, radius: 10, unit: Segment.DistanceUnit.MILES };
        props.onChange( { ...props.condition, values: undefined, value: { ...current, ...patch } } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // date helpers — dates are stored as ISO strings; date-only fields keep just the date part
    function toDate( value : Type.Json | undefined ) : Date | null
    {
        if( value === undefined || value === "" ) return null;
        return new Date( String( value ) );
    }
    function fromDate( date : Date | null, dateOnly : boolean ) : string
    {
        if( !date ) return "";
        const iso : string = date.toISOString();
        return dateOnly ? iso.slice( 0, 10 ) : iso;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // one single-value editor for the field's type (used by SINGLE ops, and by each end of a BETWEEN pair)
    function singleEditor( id : string, value : Type.Json | undefined, onValue : ( value : Type.Json ) => void ) : JSX.Element
    {
        // date / datetime → a picker; store back as an ISO string
        if( field.type === Segment.FilterType.DATE )
            return <DateInput id={ id } label={"Date"} value={ toDate( value ) } onChange={ ( date : Date | null ) : void => onValue( fromDate( date, true ) ) } />;
        if( field.type === Segment.FilterType.DATETIME )
            return <DateTimeInput id={ id } label={"Date/time"} value={ toDate( value ) } onChange={ ( date : Date | null ) : void => onValue( fromDate( date, false ) ) } sx={{ width: "100%" }} />;
        // number → numeric input
        if( field.type === Segment.FilterType.NUMBER )
            return <NumericInput id={ id } label={"Value"} value={ Number( value ) || 0 } onChange={ ( num : number ) : void => onValue( num ) } />;
        // boolean → yes/no
        if( field.type === Segment.FilterType.BOOLEAN )
            return <SelectInput id={ id } label={"Value"} value={ value === true ? "true" : value === false ? "false" : "" } choices={ BOOLEAN_CHOICES } onChange={ ( text : string ) : void => onValue( text === "true" ) } sx={{ width: "100%" }} />;
        // a runtime-provided picklist (e.g. the account's segments for a segment-ref field) wins when present
        const provided : Array<SelectInput.Choice> | undefined = props.choicesFor?.( field );
        if( provided )
            return <SelectInput id={ id } label={"Value"} value={ String( value ?? "" ) } choices={ provided } onChange={ ( text : string ) : void => onValue( text ) } sx={{ width: "100%" }} />;
        // enum WITH known choices → a picklist; without (resolved at runtime) → free text for now
        if( field.type === Segment.FilterType.ENUM && field.enumValues && field.enumValues.length > 0 )
            return <SelectInput id={ id } label={"Value"} value={ String( value ?? "" ) } choices={ field.enumValues.map( ( option : string ) : SelectInput.Choice => ( { value: option, label: option } ) ) } onChange={ ( text : string ) : void => onValue( text ) } sx={{ width: "100%" }} />;
        // string / phone / enum-without-choices → text
        return <TextInput id={ id } label={"Text"} value={ String( value ?? "" ) } onChange={ ( text : string ) : void => onValue( text ) } fullWidth />;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // the operand area — depends on the operator's operand cardinality
    function operandEditor() : JSX.Element | null
    {
        // no operand (is empty / is not empty)
        if( operandKind === Segment.Operand.NONE ) return null;

        // a range → two single editors (from / to)
        if( operandKind === Segment.Operand.PAIR )
            return  <Stack direction="row" spacing={ 1 } sx={{ flexGrow: 1 }}>
                        <Box sx={{ flexGrow: 1 }}>{ singleEditor( "cond-from", props.condition.values?.[ 0 ], ( value : Type.Json ) : void => setPairAt( 0, value ) ) }</Box>
                        <Box sx={{ flexGrow: 1 }}>{ singleEditor( "cond-to", props.condition.values?.[ 1 ], ( value : Type.Json ) : void => setPairAt( 1, value ) ) }</Box>
                    </Stack>;

        // a set → a specialized picker (country/state/timezone), a runtime picklist (segments), an enum
        // multi-select, or a free multi-value entry
        if( operandKind === Segment.Operand.SET )
        {
            const selected : Array<string> = ( props.condition.values ?? [] ).map( ( entry : Type.Json ) : string => String( entry ) );
            // domain multi-selects the field asks for (country chips / state chips / timezone chips)
            if( field.input === Segment.InputKind.COUNTRY )
                return <CountryInput id="cond-country" label={"Countries"} multiple value={ null } values={ selected } onChangeMulti={ ( values : Array<string> ) : void => setValues( values ) } />;
            if( field.input === Segment.InputKind.STATE )
                return <StateInput id="cond-state" label={"States"} country={"US"} multiple value={ selected } onChange={ ( values : Array<string> ) : void => setValues( values ) } />;
            if( field.input === Segment.InputKind.TIMEZONE )
                return <TimezoneInput id="cond-tz" label={"Timezones"} value={ selected } valueType={ TimezoneInput.ValueType.CITY } labelType={ TimezoneInput.LabelType.CITY } onChange={ ( values : Array<string> ) : void => setValues( values ) } />;
            // a runtime-provided list (the account's segments for "belongs to segment", or a custom field's choices)
            const provided : Array<SelectInput.Choice> | undefined = props.choicesFor?.( field );
            if( provided )
                return <SelectMultInput id="cond-set" label={"Values"} value={ selected } choices={ provided.map( ( choice : SelectInput.Choice ) : SelectMultInput.Choice => ( { value: choice.value, label: choice.label ?? "" } ) ) } onChange={ ( values : Array<string> ) : void => setValues( values ) } minWidth="100%" />;
            if( field.type === Segment.FilterType.ENUM && field.enumValues && field.enumValues.length > 0 )
                return <SelectMultInput id="cond-set" label={"Values"} value={ selected } choices={ field.enumValues.map( ( option : string ) : SelectMultInput.Choice => ( { value: option, label: option } ) ) } onChange={ ( values : Array<string> ) : void => setValues( values ) } minWidth="100%" />;
            return <TagInput id="cond-set" label={"Values"} value={ selected } choices={ [] } onChange={ ( values : Array<string> ) : void => setValues( values ) } />;
        }

        // a geo circle → lat / lng / radius / unit
        if( operandKind === Segment.Operand.GEO )
        {
            const geo : Segment.GeoWithin = ( props.condition.value as Segment.GeoWithin | undefined ) ?? { lat: 0, lng: 0, radius: 10, unit: Segment.DistanceUnit.MILES };
            return  <Stack direction="row" spacing={ 1 } sx={{ flexGrow: 1 }}>
                        <NumericInput id="cond-lat"    label={"Latitude"}  value={ geo.lat }    onChange={ ( num : number ) : void => setGeo( { lat: num } ) } />
                        <NumericInput id="cond-lng"    label={"Longitude"} value={ geo.lng }    onChange={ ( num : number ) : void => setGeo( { lng: num } ) } />
                        <NumericInput id="cond-radius" label={"Radius"}    value={ geo.radius } onChange={ ( num : number ) : void => setGeo( { radius: num } ) } />
                        <SelectInput id="cond-unit" label={"Unit"} value={ geo.unit } choices={ UNIT_CHOICES } onChange={ ( text : string ) : void => setGeo( { unit: text as Segment.DistanceUnit } ) } sx={{ width: 110 }} />
                    </Stack>;
        }

        // single value
        return singleEditor( "cond-value", props.condition.value, setValue );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // Row wraps when narrow (flexWrap) and every child can shrink (minWidth:0) so a wide operand never forces a
    // horizontal scrollbar on the dialog. The operand takes the remaining space with a sensible min basis.
    return  <Stack direction="row" spacing={ 1 } sx={{ alignItems: "flex-start", flexWrap: "wrap", rowGap: 1, width: "100%" }}>
                <Box sx={{ width: 220, flexShrink: 0 }}><SelectInput id="cond-field" label={"Data"} value={ field.id } choices={ fieldChoices } onChange={ onFieldChange } sx={{ width: "100%" }} /></Box>
                <Box sx={{ width: 180, flexShrink: 0 }}><SelectInput id="cond-operator" label={"Comparison"} value={ props.condition.operator } choices={ operatorChoices } onChange={ onOperatorChange } sx={{ width: "100%" }} /></Box>
                { operandKind !== Segment.Operand.NONE &&
                    <Box sx={{ flex: "1 1 260px", minWidth: 0 }}>{ operandEditor() }</Box> }
                <Box sx={{ mt: 1 }}><ButtonIcon id="cond-remove" label={"Remove"} size="small" icon={ <DeleteOutlineOutlinedIcon fontSize="small" /> } onClick={ props.onDelete } /></Box>
            </Stack>;
}

export namespace SegmentConditionRow
{
    export interface Props
    {
        condition  : Segment.Condition;
        fields     : Array<Segment.FilterField>;
        choicesFor? : ( field : Segment.FilterField ) => Array<SelectInput.Choice> | undefined;   // runtime operand choices (e.g. the account's segments)
        onChange   : ( condition : Segment.Condition ) => void;
        onDelete   : () => void;
    }
}

export default SegmentConditionRow;
