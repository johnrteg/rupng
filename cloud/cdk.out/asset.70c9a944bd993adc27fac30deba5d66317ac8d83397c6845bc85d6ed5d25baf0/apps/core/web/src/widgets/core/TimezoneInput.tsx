//
import React from 'react';
import { JSX } from "react";

//

// local
import { ArrayUtils, StringUtils } from "@repo/common";
import DropdownInput from "./DropdownInput";



//
export function TimezoneInput( props : TimezoneInput.Props ) : JSX.Element
{
    const [selected,setSelected]    = React.useState< Array<string> >( props.value );
    const [timezones,setTimezones]  = React.useState< Array<DropdownInput.Choice> >( [] );

    //
    React.useEffect( () => componentLoaded(), [] );
    React.useEffect( () => propsChanged(), [props] );

    ///////////////////////////////////////////////////////////////////////////////////////////////////
    function componentLoaded() : void
    {
        let choices : Array<DropdownInput.Choice> = [];

        // @ts-ignore
        let zones : Array<string> = Intl.supportedValuesOf( 'timeZone' );

        // limit the timezones that contain the start of things in 'only'
        if( props.only != undefined && props.only.length > 0 )
        {
            zones = zones.filter( tz => props.only!.some( ( prefix : string ) => tz.startsWith( prefix ) ) );
        }
  
        //console.log('zones', zones );
        
        let label : string;
        let offset : number;
        let value : string;
        let short_abbrev : string;
        let long_abbrev : string;
        zones.forEach( ( tz: string, index: number ) => { 
                                                        //label = tz;
                                                        //if( props.dense !== undefined && props.dense ) label = tz.split('/')[1];    // remove leading context
                                                        //label = StringUtils.replaceAll( label, "_", " " );  // clean up context
                                                        
                                                        offset = getTimezoneOffset( tz );
                                                        short_abbrev = getTimezoneAbbrev( tz, "short" );
                                                        long_abbrev = getTimezoneAbbrev( tz, "long" );

                                                        //console.log( 'TZ', tz, abbrev );

                                                        switch( props.valueType )
                                                        {
                                                            case TimezoneInput.ValueType.CITY : value = tz; break;
                                                            case TimezoneInput.ValueType.UTC  : value = StringUtils.format( "UTC{0}", offsetToString( offset, false ) ); break;
                                                            case TimezoneInput.ValueType.ABBREV  : value = short_abbrev; break;
                                                        
                                                        }

                                                        switch( props.labelType )
                                                        {
                                                            case TimezoneInput.LabelType.ABBREV :   label = StringUtils.format( "{0}: {1}", short_abbrev, long_abbrev ); break;
                                                            case TimezoneInput.LabelType.CITY   :   label = StringUtils.replaceAll( tz, "_", " " );
                                                                                                    if( props.dense !== undefined && props.dense ) label = tz.split('/')[1];
                                                                                                    break;
                                                        }

                                                        choices.push( { value: value,
                                                                        label: StringUtils.format( "{0} (UTC{1})", label, offsetToString( offset, true ) ),
                                                                        data : offset
                                                                    } );
                                                    } );

        // sort by timezone offset (in munutes)
        choices.sort((a : DropdownInput.Choice, b : DropdownInput.Choice ) => (b.data as number) - (a.data as number));

        //console.log('choices', choices );

        setTimezones( choices );

        // set current one
        const this_tz : string = Intl.DateTimeFormat().resolvedOptions().timeZone;
        let tzs : Array<string> = props.value.length > 0 ? props.value : [ this_tz ];
        setSelected( tzs );
        props.onChange( tzs );
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////
    function getTimezoneOffset( tz: string ): number
    {
        const now : Date = new Date();

        // Get the time in UTC
        const utcYear   : number = now.getUTCFullYear();
        const utcMonth  : number = now.getUTCMonth();
        const utcDate   : number = now.getUTCDate();
        const utcHour   : number = now.getUTCHours();
        const utcMinute : number = now.getUTCMinutes();
        const utcSecond : number = now.getUTCSeconds();

        // Get the time in the target timezone
        const dtf : Intl.DateTimeFormat = new Intl.DateTimeFormat('en-US', {
            timeZone: tz,
            hour12: false,
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', second: '2-digit'
        });
        const parts : Array<Intl.DateTimeFormatPart> = dtf.formatToParts(now);
        const year   : number = Number(parts.find(p => p.type === 'year')?.value);
        const month  : number = Number(parts.find(p => p.type === 'month')?.value) - 1;
        const day    : number = Number(parts.find(p => p.type === 'day')?.value);
        const hour   : number = Number(parts.find(p => p.type === 'hour')?.value);
        const minute : number = Number(parts.find(p => p.type === 'minute')?.value);
        const second : number = Number(parts.find(p => p.type === 'second')?.value);

        // Create a date in the target timezone (interpreted as local time)
        const tzDate : Date = new Date(Date.UTC(year, month, day, hour, minute, second));
        const utcDateObj : Date = new Date(Date.UTC(utcYear, utcMonth, utcDate, utcHour, utcMinute, utcSecond));

        // Offset in minutes from UTC
        const offset    : number = ( tzDate.getTime() - utcDateObj.getTime()) / 60000;
        return offset;
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////
    function getTimezoneAbbrev( tz: string, format : "short" | "long", at: Date = new Date() ) : string
    {
        try
        {
            const dtf : Intl.DateTimeFormat = new Intl.DateTimeFormat( 'en-US', {
                timeZone: tz,
                timeZoneName: format
            } );

            const parts : Array<Intl.DateTimeFormatPart> = dtf.formatToParts( at );
            const tzName : string | undefined = parts.find( p => p.type === 'timeZoneName' )?.value;
            if( tzName === undefined || tzName.trim().length === 0 )return "";

            // Examples you might see:
            //  - "EST", "EDT"
            //  - "GMT-4", "GMT-04:00"
            let name : string = tzName.trim();

            // Normalize "GMT" -> "UTC" to match your UI
            name = name.replace( /^GMT/, 'UTC' );

            // Normalize offsets like "UTC-4" or "UTC-0400" to "UTC-04:00"
            const m : RegExpMatchArray | null = name.match( /^UTC([+-])(\d{1,2})(?::?(\d{2}))?$/ );
            if( m !== null )
            {
                const sign : string = m[1];
                const hh : string = String( m[2] ).padStart( 2, '0' );
                const mm : string = ( m[3] ?? '00' ).padStart( 2, '0' );
                return `UTC${sign}${hh}:${mm}`;
            }

            return name;
        }
        catch
        {
            // Fallback: compute offset ourselves if Intl fails for some reason.
            const offset : number = getTimezoneOffset( tz );
            return `UTC${offsetToString( offset, true )}`;
        }
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////
    function offsetToString( offset: number, include_colon : boolean ) : string
    { 
        const sign      : string = offset >= 0 ? "+" : "-";
        const absOffset : number = Math.abs( offset );
        const hours     : number = Math.floor(absOffset / 60);
        const minutes   : number = Math.floor(absOffset % 60);

        let reply : string = `${sign}${ String( hours ).padStart(2, "0")}`;
        if( include_colon )reply += ":";
        reply += `${ String( minutes ).padStart( 2, "0" ) }`;
        return reply;
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////
    function propsChanged() : void
    {
        //console.log('propsChanged', props.value );
        // need to deal with the possible different formats
        if( props.valueType === TimezoneInput.ValueType.UTC )
        {
            let new_value : Array<string> = props.value.map( ( tz : string ) =>
            {
                // Handle GMT format conversion to UTC
                if( tz !== null && tz.startsWith('GMT') )
                {
                    // Extract the offset part (e.g., "-0500" from "GMT-0500 EST")
                    const gmtMatch : RegExpMatchArray | null = tz.match(/GMT([+-]\d{4})/);
                    if( gmtMatch !== null )
                    {
                        return `UTC${gmtMatch[1]}`;
                    }
                }
                // If it's already in UTC format or other format, return as-is
                return tz;
            });
                
            if( !ArrayUtils.isSame( new_value, selected ) )setSelected( new_value );
        }
        else
        {
            if( !ArrayUtils.isSame( props.value, selected ) )setSelected( props.value );
        }
    }

    // ===============================================================================================
    return  <DropdownInput  id={ props.id }
                            label={ props.label }
                            sx={ { width : props.dense !== undefined && props.dense ? 265 : 400 } }
                            type={ props.multiple != undefined && props.multiple  ? "multi" : "combo" }
                            value = { selected }
                            choices={ timezones }
                            onChange={ props.onChange }
                />;
            
    

}

export namespace TimezoneInput
{
    export enum ValueType
    {
        CITY = "city",
        UTC = "utc",
        ABBREV = "abbrev"
    }

    export enum LabelType
    {
        CITY = "city",
        ABBREV = "abbrev"
    }

    export enum StdZone
    {
        NEW_YORK = "America/New_York",
        CHICAGO = "America/Chicago",
        DENVER = "America/Denver",
        LOS_ANGELES = "America/Los_Angeles",
        HONOLULU = "Pacific/Honolulu",
        ANCHORAGE = "America/Anchorage"
    }

    export interface Props
    {
        id          : string;
        label       : string;
        value       : Array<string>;
        disabled?   : boolean;
        multiple?   : boolean;
        dense?      : boolean;
        only?       : Array<TimezoneInput.StdZone>;
        valueType   : ValueType;
        labelType   : LabelType;
        onChange    : ( new_value : Array<string> ) => void;
    }
}



export default TimezoneInput;
// eof