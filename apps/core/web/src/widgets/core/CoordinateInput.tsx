import React from 'react';
import { JSX } from "react";

import TextInput from '@widgets/core/TextInput';

//
// CoordinateInput — a latitude OR longitude field. The user may type EITHER decimal degrees (`40.446`,
// `-79.982`) OR degrees-minutes-seconds (`40 26 46 N`, `79° 58' 55" W`); on commit (blur / Enter) it parses to
// signed DECIMAL DEGREES — which is what's stored and emitted via onChange — and reformats the display as DMS
// with the hemisphere (N/S for latitude, E/W for longitude). So: DMS is a display convenience; the value is
// always decimal degrees. An empty field emits `undefined`.
//
export function CoordinateInput( props : CoordinateInput.Props ) : JSX.Element
{
    const [text,setText] = React.useState< string >( () => CoordinateInput.toDms( props.value, props.kind ) );
    const focused = React.useRef< boolean >( false );

    ////////////////////////////////////////////////////////////////////////////////////////////
    // reflect an external value change while the field isn't being edited (avoid clobbering mid-type)
    React.useEffect( () : void =>
    {
        if( !focused.current ) setText( CoordinateInput.toDms( props.value, props.kind ) );
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [ props.value, props.kind ] );

    ////////////////////////////////////////////////////////////////////////////////////////////
    // commit the buffer → parse to decimal degrees, emit it, and normalize the display back to DMS
    function commit() : void
    {
        const decimal : number | undefined = CoordinateInput.parse( text, props.kind );
        props.onChange( decimal );
        setText( CoordinateInput.toDms( decimal, props.kind ) );
    }

    // focus true = editing (leave the buffer alone); false = blur → commit
    function onFocus( isFocused : boolean ) : void
    {
        focused.current = isFocused;
        if( !isFocused ) commit();
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    return  <TextInput id={ props.id } label={ props.label } value={ text } disabled={ props.disabled } fullWidth
                       placeHolder={ props.kind === CoordinateInput.Kind.LATITUDE ? "e.g. 40 26 46 N or 40.4462" : "e.g. 79 58 55 W or -79.9822" }
                       onChange={ setText } onEnter={ commit } onFocus={ onFocus } />;
}

export namespace CoordinateInput
{
    /** Which coordinate axis — drives the hemisphere letters (N/S vs E/W) and the ±limit. */
    export enum Kind { LATITUDE = "latitude", LONGITUDE = "longitude" }

    /** The ± bound for a coordinate kind (90 for latitude, 180 for longitude). */
    function limitFor( kind : Kind ) : number { return kind === Kind.LATITUDE ? 90 : 180; }

    /** Format signed decimal degrees as `D° M' S.s" H` (H = hemisphere); empty string when unset. */
    export function toDms( decimal : number | undefined, kind : Kind ) : string
    {
        if( decimal === undefined || !Number.isFinite( decimal ) ) return "";
        const hemisphere : string = kind === Kind.LATITUDE ? ( decimal >= 0 ? "N" : "S" ) : ( decimal >= 0 ? "E" : "W" );

        // split |dd| into whole degrees / minutes / seconds, rounding seconds to 1 decimal (with rollover)
        const absolute : number = Math.abs( decimal );
        let degrees : number = Math.floor( absolute );
        const minutesFloat : number = ( absolute - degrees ) * 60;
        let minutes : number = Math.floor( minutesFloat );
        let seconds : number = Math.round( ( minutesFloat - minutes ) * 60 * 10 ) / 10;
        if( seconds >= 60 ) { seconds -= 60; minutes += 1; }
        if( minutes >= 60 ) { minutes -= 60; degrees += 1; }

        return `${ degrees }° ${ minutes }' ${ seconds }" ${ hemisphere }`;
    }

    /** Parse a decimal-degrees OR DMS string to signed decimal degrees (undefined when blank/unparseable),
     *  clamped to the axis limit and rounded to 6 decimals. A hemisphere letter (N/S/E/W) wins over any sign. */
    export function parse( text : string, kind : Kind ) : number | undefined
    {
        const trimmed : string = text.trim();
        if( trimmed === "" ) return undefined;

        // pull the numeric tokens (deg [min [sec]]) and an optional hemisphere letter
        const numbers : Array<number> = ( trimmed.match( /-?\d+(?:\.\d+)?/g ) ?? [] ).map( ( token : string ) : number => Number( token ) );
        if( numbers.length === 0 ) return undefined;
        const hemisphereMatch : RegExpMatchArray | null = trimmed.match( /[nsewNSEW]/ );
        const hemisphere : string = hemisphereMatch ? hemisphereMatch[ 0 ].toUpperCase() : "";

        // one token = decimal degrees; two/three tokens = degrees/minutes/seconds
        const magnitude : number = numbers.length === 1
            ? Math.abs( numbers[ 0 ] )
            : Math.abs( numbers[ 0 ] ) + ( numbers[ 1 ] ?? 0 ) / 60 + ( numbers[ 2 ] ?? 0 ) / 3600;

        // sign: hemisphere letter wins; else the sign of the degrees token
        let sign : number = numbers[ 0 ] < 0 ? -1 : 1;
        if( hemisphere === "S" || hemisphere === "W" ) sign = -1;
        else if( hemisphere === "N" || hemisphere === "E" ) sign = 1;

        const limit : number = limitFor( kind );
        const clamped : number = Math.max( -limit, Math.min( limit, sign * magnitude ) );
        return Math.round( clamped * 1e6 ) / 1e6;
    }

    export interface Props
    {
        id        : string;
        label     : string;
        kind      : Kind;
        value     : number | undefined;                       // signed decimal degrees (stored form)
        disabled? : boolean;
        onChange  : ( value : number | undefined ) => void;
    }
}

export default CoordinateInput;
// eof
