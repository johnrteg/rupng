//
import React from 'react';
import { JSX } from "react";

import { Stack, Typography } from "@mui/material";

import type { Type } from '@repo/common';
import { Report } from '@repo/api';

import DialogWindow from '@widgets/core/DialogWindow';
import SelectInput  from '@widgets/core/SelectInput';

import DateWindowInput  from '../widgets/DateWindowInput';
import DestinationInput from '../widgets/DestinationInput';

// the default window every submission starts from — last 30 days (report's most common ask); the user picks
// a different preset/rolling/fixed window before submitting.
const DEFAULT_WINDOW : Report.DateWindow = { kind: "relative", preset: Report.RelativePreset.LAST_30_DAYS };
// the default destination — DOWNLOAD needs no config, matching the server's own default when omitted.
const DEFAULT_DESTINATION : Report.Destination = { kind: Report.DestinationKind.DOWNLOAD, config: {} };

//
// ReportSubmitDialog — run one report ad-hoc (report-2.1). The parent owns open/close + which `report` is
// being run; this dialog only composes the request (window + format + destination) and hands it to
// `onSubmit`, which does the actual POST (mirrors ContactEditDialog's onSave — the parent fetches + snacks).
//
export function ReportSubmitDialog( props : ReportSubmitDialog.Props ) : JSX.Element | null
{
    const [window,setWindow]           = React.useState< Report.DateWindow >( DEFAULT_WINDOW );
    const [format,setFormat]           = React.useState< Report.Format | "" >( props.report?.formats[ 0 ] ?? "" );
    const [destination,setDestination] = React.useState< Report.Destination >( DEFAULT_DESTINATION );

    const report : Report.Definition | null = props.report;

    ////////////////////////////////////////////////////////////////////////////////////////////
    // a format is chosen, and (when the destination isn't DOWNLOAD) its config field is filled in
    function isReady() : boolean
    {
        if( report === null || format === "" ) return false;
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
            params:   { window },
            format:   format as Report.Format,
            destination,
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

                    <DestinationInput value={ destination } onChange={ setDestination } />
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
        onSubmit : ( request : Report.SubmitRequest ) => Promise<boolean>;      // parent does the POST + snack
    }
}

export default ReportSubmitDialog;
// eof
