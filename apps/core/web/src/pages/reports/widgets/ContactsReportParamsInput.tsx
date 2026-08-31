//
import React from 'react';
import { JSX } from "react";

import { Stack } from "@mui/material";

import type { Type } from '@repo/common';
import { Contact } from '@repo/api';

import SelectInput from '@widgets/core/SelectInput';
import TextInput   from '@widgets/core/TextInput';
import DateInput   from '@widgets/core/DateInput';

const STATUS_CHOICES : Array<SelectInput.Choice> = SelectInput.enumToChoices( Contact.ContactStatus );

//
// ContactsReportParamsInput — the extra params `ContactsReport` (`reportId: "contact_lists"`) adds on top of
// the shared base `window`: an optional status filter, a modified-date range, a segment id, and free-form
// tags. Shared by both the submit and schedule dialogs (rather than duplicated), keyed off the report's own
// `paramsSchema.properties` at the call site — this component itself just renders/edits the fields.
//
export function ContactsReportParamsInput( props : ContactsReportParamsInput.Props ) : JSX.Element
{
    const value : ContactsReportParamsInput.Value = props.value;

    // free-form tags are edited as a comma-separated string, split/joined at the edges (MVP — no tag picker)
    const tagsText : string = ( value.tags ?? [] ).join( ", " );

    ////////////////////////////////////////////////////////////////////////////////////////////
    function onStatusChange( status : string ) : void
    {
        props.onChange( { ...value, status: status || undefined } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    function onModifiedStartChange( date : Date | null ) : void
    {
        props.onChange( { ...value, modifiedStart: date ? date.toISOString() : undefined } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    function onModifiedEndChange( date : Date | null ) : void
    {
        props.onChange( { ...value, modifiedEnd: date ? date.toISOString() : undefined } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    function onSegmentIdChange( segmentId : string ) : void
    {
        props.onChange( { ...value, segmentId: segmentId || undefined } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // split the comma list back into an Array<string>, trimming and dropping empties
    function onTagsTextChange( text : string ) : void
    {
        const tags : Array<string> = text.split( "," ).map( ( tag : string ) : string => tag.trim() ).filter( ( tag : string ) : boolean => tag.length > 0 );
        props.onChange( { ...value, tags: tags.length > 0 ? tags : undefined } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    return  <Stack spacing={ 2 }>
                <SelectInput id="contacts-report-status" label={"Status (optional)"} value={ value.status ?? "" }
                             choices={ STATUS_CHOICES } onChange={ onStatusChange } sx={{ width: 220 }} />

                <Stack direction="row" spacing={ 1 }>
                    <DateInput id="contacts-report-modified-start" label={"Modified after (optional)"}
                               value={ value.modifiedStart ? new Date( value.modifiedStart ) : null }
                               onChange={ onModifiedStartChange } />
                    <DateInput id="contacts-report-modified-end" label={"Modified before (optional)"}
                               value={ value.modifiedEnd ? new Date( value.modifiedEnd ) : null }
                               onChange={ onModifiedEndChange } />
                </Stack>

                <TextInput id="contacts-report-segment" label={"Segment id (optional)"} value={ value.segmentId ?? "" } onChange={ onSegmentIdChange } fullWidth />

                <TextInput id="contacts-report-tags" label={"Tags (optional, comma-separated)"} value={ tagsText } onChange={ onTagsTextChange } fullWidth />
            </Stack>;
}

export namespace ContactsReportParamsInput
{
    // the extra fields ContactsReport's paramsSchema declares beyond the shared base `window`
    export interface Value
    {
        status?        : string;
        modifiedStart? : Type.ISODateTime;
        modifiedEnd?   : Type.ISODateTime;
        segmentId?     : string;
        tags?          : Array<string>;
    }

    export interface Props
    {
        value    : Value;
        onChange : ( value : Value ) => void;
    }

    // true when a report's declared params schema includes these contacts-specific fields — the call site
    // checks this against `report.paramsSchema.properties` rather than hardcoding a reportId string.
    export function appliesTo( paramsSchema : Type.Json ) : boolean
    {
        const properties : Type.JsonObject | undefined = ( paramsSchema as { properties? : Type.JsonObject } )?.properties;
        return !!properties && ( "segmentId" in properties || "modifiedStart" in properties );
    }
}

export default ContactsReportParamsInput;
// eof
