//
import React from 'react';
import { JSX } from "react";

import { Stack, Typography } from "@mui/material";

import type { Type } from '@repo/common';
import { Report } from '@repo/api';

import DialogWindow from '@widgets/core/DialogWindow';
import SelectInput  from '@widgets/core/SelectInput';

import DateWindowInput  from '../widgets/DateWindowInput';
import DestinationListInput from '../widgets/DestinationListInput';
import ContactsReportParamsInput from '../widgets/ContactsReportParamsInput';

// the default window every submission starts from — last 30 days (report's most common ask); the user picks
// a different preset/rolling/fixed window before submitting.
const DEFAULT_WINDOW : Report.DateWindow = { kind: "relative", preset: Report.RelativePreset.LAST_30_DAYS };
// no destinations picked yet — the server defaults an empty/omitted list to a single DOWNLOAD destination.
const DEFAULT_DESTINATIONS : Array<Report.Destination> = [];

//
// ReportSubmitDialog — run one report ad-hoc (report-2.1). The parent owns open/close + which `report` is
// being run; this dialog only composes the request (window + format + destinations[, extra params]) and
// hands it to `onSubmit`, which does the actual POST (mirrors ContactEditDialog's onSave — the parent
// fetches + snacks). No `schedule` field — this dialog is strictly the one-time path.
//
export function ReportSubmitDialog( props : ReportSubmitDialog.Props ) : JSX.Element | null
{
    const [window,setWindow]             = React.useState< Report.DateWindow >( DEFAULT_WINDOW );
    const [format,setFormat]             = React.useState< Report.Format | "" >( props.report?.formats[ 0 ] ?? "" );
    const [destinations,setDestinations] = React.useState< Array<Report.Destination> >( DEFAULT_DESTINATIONS );
    const [contactsParams,setContactsParams] = React.useState< ContactsReportParamsInput.Value >( {} );

    const report : Report.Definition | null = props.report;
    // whether the selected report declares the ContactsReport-specific extra params — checked against the
    // report's own declarative schema rather than hardcoding its reportId
    const showContactsParams : boolean = report !== null && ContactsReportParamsInput.appliesTo( report.paramsSchema );

    ////////////////////////////////////////////////////////////////////////////////////////////
    // a format is chosen, and (for every destination that needs one) its config field is filled in
    function isReady() : boolean
    {
        if( report === null || format === "" ) return false;
        return destinations.every( isDestinationFilled );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // one destination row is complete enough to submit (EMAIL needs `to`, WEBHOOK needs `url`)
    function isDestinationFilled( destination : Report.Destination ) : boolean
    {
        if( destination.kind === Report.DestinationKind.EMAIL )   return !!( destination.config as Type.JsonObject ).to;
        if( destination.kind === Report.DestinationKind.WEBHOOK ) return !!( destination.config as Type.JsonObject ).url;
        return true;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // hand the assembled request to the parent, which submits it (POST) and reports success/failure
    function onYes() : Promise<boolean>
    {
        if( report === null || format === "" ) return Promise.resolve( false );
        return props.onSubmit( {
            reportId: report.reportId,
            params:   showContactsParams ? { window, ...contactsParams } : { window },
            format:   format as Report.Format,
            destinations,
        } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    const formatChoices : Array<SelectInput.Choice> = ( report?.formats ?? [] ).map( ( value : Report.Format ) : SelectInput.Choice => ( { value, label: value.toUpperCase() } ) );

    if( !props.open || report === null ) return null;

    ////////////////////////////////////////////////////////////////////////////////////////////
    return  <DialogWindow id="report-submit"
                          title={ `Run report — ${ report.name }` }
                          yesLabel={"Submit"}
                          cancelLabel={"Cancel"}
                          minWidth="sm"
                          ready={ isReady() }
                          onYes={ onYes }
                          onClose={ props.onClose }>
                <Stack spacing={ 2 } sx={{ p: 2 }}>
                    { report.description && <Typography variant="body2" sx={{ color: "text.secondary" }}>{ report.description }</Typography> }

                    <DateWindowInput value={ window } onChange={ setWindow } allowFixed />

                    <SelectInput id="report-submit-format" label={"Format"} value={ format } choices={ formatChoices } onChange={ ( value : string ) : void => setFormat( value as Report.Format ) } sx={{ width: 160 }} />

                    { showContactsParams && <ContactsReportParamsInput value={ contactsParams } onChange={ setContactsParams } /> }

                    <DestinationListInput value={ destinations } onChange={ setDestinations } />
                </Stack>
            </DialogWindow>;
}

export namespace ReportSubmitDialog
{
    export interface Props
    {
        open     : boolean;
        onClose  : () => void;
        report   : Report.Definition | null;                                    // the report being run
        onSubmit : ( request : Report.CreateRun ) => Promise<boolean>;          // parent does the POST + snack
    }
}

export default ReportSubmitDialog;
// eof
