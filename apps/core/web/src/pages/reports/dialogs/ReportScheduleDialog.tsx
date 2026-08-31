//
import React from 'react';
import { JSX } from "react";

import { Stack, Typography } from "@mui/material";
import { RRule, Weekday } from 'rrule';

import type { Type } from '@repo/common';
import { Report } from '@repo/api';

import DialogWindow  from '@widgets/core/DialogWindow';
import SelectInput   from '@widgets/core/SelectInput';
import SelectMultInput from '@widgets/core/SelectMultInput';
import TimeInput     from '@widgets/core/TimeInput';
import TimezoneInput from '@widgets/core/TimezoneInput';

import DateWindowInput  from '../widgets/DateWindowInput';
import DestinationListInput from '../widgets/DestinationListInput';
import ContactsReportParamsInput from '../widgets/ContactsReportParamsInput';

// the recurrence's cadence — the three the builder supports (report-4.x doesn't require anything finer).
enum Frequency
{
    DAILY   = "DAILY",
    WEEKLY  = "WEEKLY",
    MONTHLY = "MONTHLY",
}

const FREQUENCY_CHOICES : Array<SelectInput.Choice> =
[
    { value: Frequency.DAILY,   label: "Daily" },
    { value: Frequency.WEEKLY,  label: "Weekly" },
    { value: Frequency.MONTHLY, label: "Monthly" },
];

// the 7 RFC-5545 weekday codes, Monday-first (matches rrule's own MO..SU constants)
const WEEKDAY_CODES : Array<string> = [ "MO", "TU", "WE", "TH", "FR", "SA", "SU" ];
const WEEKDAY_CHOICES : Array<SelectMultInput.Choice> =
[
    { value: "MO", label: "Mon" }, { value: "TU", label: "Tue" }, { value: "WE", label: "Wed" }, { value: "TH", label: "Thu" },
    { value: "FR", label: "Fri" }, { value: "SA", label: "Sat" }, { value: "SU", label: "Sun" },
];

// the schedule's default window — rolling last 7 days (a Schedule can't carry a fixed window, report-3.3).
const DEFAULT_WINDOW : Report.DateWindow = { kind: "relative", rolling: { amount: 7, unit: "day" } };
// no destinations picked yet — the server defaults an empty/omitted list to a single DOWNLOAD destination.
const DEFAULT_DESTINATIONS : Array<Report.Destination> = [];
// 9:00 AM local — a sane default fire time when creating a new schedule.
const DEFAULT_TIME : Date = ( () => { const time : Date = new Date(); time.setHours( 9, 0, 0, 0 ); return time; } )();

//
// ReportScheduleDialog — create OR edit a recurring report schedule (report-4.1/4.2). One dialog for both:
// pass `schedule` to edit (PATCH), omit to create (POST) — the parent picks the endpoint in `onSave`, mirrors
// ContactEditDialog. Builds the RFC-5545 `ical` string client-side from a frequency + weekday(s) + a
// time-of-day, via the `rrule` package, rather than asking the user to hand-write RRULE syntax.
//
export function ReportScheduleDialog( props : ReportScheduleDialog.Props ) : JSX.Element | null
{
    const editing : boolean = props.schedule !== undefined;
    const seeded : ReportScheduleDialog.Seed = seedFromSchedule( props.schedule );

    const [frequency,setFrequency] = React.useState< Frequency >( seeded.frequency );
    const [weekdays,setWeekdays]   = React.useState< Array<string> >( seeded.weekdays );
    const [time,setTime]           = React.useState< Date >( seeded.time );
    const [timezone,setTimezone]   = React.useState< string >( props.schedule?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone );
    const [window,setWindow]       = React.useState< Report.DateWindow >( seeded.window );
    const [format,setFormat]       = React.useState< Report.Format | "" >( props.schedule?.format ?? props.report?.formats[ 0 ] ?? "" );
    const [destinations,setDestinations] = React.useState< Array<Report.Destination> >( props.schedule?.destinations ?? DEFAULT_DESTINATIONS );
    const [contactsParams,setContactsParams] = React.useState< ContactsReportParamsInput.Value >( seeded.contactsParams );

    const report : Report.Definition | null = props.report;
    // whether the selected report declares the ContactsReport-specific extra params — checked against the
    // report's own declarative schema rather than hardcoding its reportId
    const showContactsParams : boolean = report !== null && ContactsReportParamsInput.appliesTo( report.paramsSchema );

    ////////////////////////////////////////////////////////////////////////////////////////////
    // seed the builder's controls from an existing schedule's `ical` (edit mode) — best-effort; falls back
    // to the daily/9am default when the RRULE doesn't parse into one of the 3 supported cadences
    function seedFromSchedule( schedule? : Report.Schedule ) : ReportScheduleDialog.Seed
    {
        const scheduleParams : { window? : Report.DateWindow } & ContactsReportParamsInput.Value = ( schedule?.params as { window? : Report.DateWindow } & ContactsReportParamsInput.Value | undefined ) ?? {};
        const scheduleWindow : Report.DateWindow = scheduleParams.window ?? DEFAULT_WINDOW;
        const contactsParams : ContactsReportParamsInput.Value =
        {
            status:        scheduleParams.status,
            modifiedStart: scheduleParams.modifiedStart,
            modifiedEnd:   scheduleParams.modifiedEnd,
            segmentId:     scheduleParams.segmentId,
            tags:          scheduleParams.tags,
        };
        if( !schedule ) return { frequency: Frequency.DAILY, weekdays: [], time: DEFAULT_TIME, window: scheduleWindow, contactsParams };
        try
        {
            const rule : RRule = RRule.fromString( schedule.ical );
            const frequencyFromRule : Frequency = rule.options.freq === RRule.WEEKLY ? Frequency.WEEKLY
                : rule.options.freq === RRule.MONTHLY ? Frequency.MONTHLY : Frequency.DAILY;
            const weekdaysFromRule : Array<string> = ( rule.options.byweekday ?? [] ).map( ( day : number ) : string => WEEKDAY_CODES[ day ] );
            const time : Date = new Date();
            time.setHours( rule.options.byhour?.[ 0 ] ?? 9, rule.options.byminute?.[ 0 ] ?? 0, 0, 0 );
            return { frequency: frequencyFromRule, weekdays: weekdaysFromRule, time, window: scheduleWindow, contactsParams };
        }
        catch
        {
            return { frequency: Frequency.DAILY, weekdays: [], time: DEFAULT_TIME, window: scheduleWindow, contactsParams };
        }
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // the RFC-5545 code -> the rrule library's Weekday constant
    function toRRuleWeekday( code : string ) : Weekday
    {
        switch( code )
        {
            case "MO": return RRule.MO;
            case "TU": return RRule.TU;
            case "WE": return RRule.WE;
            case "TH": return RRule.TH;
            case "FR": return RRule.FR;
            case "SA": return RRule.SA;
            default:   return RRule.SU;
        }
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // compose the RRULE string from the builder's current controls
    function composeIcal() : string
    {
        const freq : number = frequency === Frequency.WEEKLY ? RRule.WEEKLY : frequency === Frequency.MONTHLY ? RRule.MONTHLY : RRule.DAILY;
        const byweekday : Array<Weekday> | undefined = frequency === Frequency.WEEKLY && weekdays.length > 0
            ? weekdays.map( toRRuleWeekday ) : undefined;
        const rule : RRule = new RRule( { freq, byweekday, byhour: [ time.getHours() ], byminute: [ time.getMinutes() ] } );
        return rule.toString();
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // a schedule needs a report, a format, a timezone, and (for Weekly) at least one weekday
    function isReady() : boolean
    {
        if( report === null || format === "" || timezone === "" ) return false;
        if( frequency === Frequency.WEEKLY && weekdays.length === 0 ) return false;
        return destinations.every( isDestinationFilled );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // one destination row is complete enough to save (EMAIL needs `to`, WEBHOOK needs `url`)
    function isDestinationFilled( destination : Report.Destination ) : boolean
    {
        if( destination.kind === Report.DestinationKind.EMAIL )   return !!( destination.config as Type.JsonObject ).to;
        if( destination.kind === Report.DestinationKind.WEBHOOK ) return !!( destination.config as Type.JsonObject ).url;
        return true;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // hand the assembled request to the parent, which POSTs (create, via PostReportRuns+schedule) or
    // PATCHes (edit, via PatchReportSchedule) depending on whether `props.schedule` was supplied
    function onYes() : Promise<boolean>
    {
        if( report === null || format === "" ) return Promise.resolve( false );
        return props.onSave( {
            reportId: report.reportId,
            ical:     composeIcal(),
            timezone,
            params:   showContactsParams ? { window, ...contactsParams } : { window },
            format:   format as Report.Format,
            destinations,
        } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    const formatChoices : Array<SelectInput.Choice> = ( report?.formats ?? [] ).map( ( value : Report.Format ) : SelectInput.Choice => ( { value, label: value.toUpperCase() } ) );

    if( !props.open || report === null ) return null;

    ////////////////////////////////////////////////////////////////////////////////////////////
    return  <DialogWindow id="report-schedule"
                          title={ `${ editing ? "Edit" : "Create" } schedule — ${ report.name }` }
                          yesLabel={ editing ? "Save" : "Create schedule" }
                          cancelLabel={"Cancel"}
                          minWidth="sm"
                          ready={ isReady() }
                          onYes={ onYes }
                          onClose={ props.onClose }>
                <Stack spacing={ 2 } sx={{ p: 2 }}>
                    { report.description && <Typography variant="body2" sx={{ color: "text.secondary" }}>{ report.description }</Typography> }

                    <Stack direction="row" spacing={ 1 }>
                        <SelectInput id="schedule-frequency" label={"Repeats"} value={ frequency } choices={ FREQUENCY_CHOICES } onChange={ ( value : string ) : void => setFrequency( value as Frequency ) } sx={{ width: 160 }} />
                        <TimeInput id="schedule-time" label={"At"} value={ time } onChange={ ( value : Date | null ) : void => setTime( value ?? DEFAULT_TIME ) } />
                    </Stack>

                    { frequency === Frequency.WEEKLY &&
                        <SelectMultInput id="schedule-weekdays" label={"On"} value={ weekdays } choices={ WEEKDAY_CHOICES } onChange={ setWeekdays } minWidth="100%" /> }

                    <TimezoneInput id="schedule-timezone" label={"Timezone"} value={ timezone ? [ timezone ] : [] }
                                   valueType={ TimezoneInput.ValueType.CITY } labelType={ TimezoneInput.LabelType.CITY }
                                   onChange={ ( values : Array<string> ) : void => setTimezone( values[ 0 ] ?? "" ) } />

                    <DateWindowInput value={ window } onChange={ setWindow } allowFixed={ false } />

                    <SelectInput id="schedule-format" label={"Format"} value={ format } choices={ formatChoices } onChange={ ( value : string ) : void => setFormat( value as Report.Format ) } sx={{ width: 160 }} />

                    { showContactsParams && <ContactsReportParamsInput value={ contactsParams } onChange={ setContactsParams } /> }

                    <DestinationListInput value={ destinations } onChange={ setDestinations } />
                </Stack>
            </DialogWindow>;
}

export namespace ReportScheduleDialog
{
    export interface Seed
    {
        frequency      : Frequency;
        weekdays       : Array<string>;
        time           : Date;
        window         : Report.DateWindow;
        contactsParams : ContactsReportParamsInput.Value;
    }

    // the assembled builder output — the parent (`ReportsPage.onSaveSchedule`) turns this into a
    // `PostReportRuns` call (create, nesting `ical`/`timezone` under `schedule`) or a `PatchReportSchedule`
    // call (edit, flat fields) depending on whether it's editing an existing schedule.
    export interface Request
    {
        reportId     : Type.ID;
        ical         : string;
        timezone     : string;
        params       : Type.Json;
        format       : Report.Format;
        destinations : Array<Report.Destination>;
    }

    export interface Props
    {
        open     : boolean;
        onClose  : () => void;
        report   : Report.Definition | null;              // the report being scheduled
        schedule? : Report.Schedule;                      // present -> edit (PATCH); absent -> create (POST)
        onSave   : ( request : Request ) => Promise<boolean>;   // parent POSTs or PATCHes + snacks
    }
}

export default ReportScheduleDialog;
// eof
