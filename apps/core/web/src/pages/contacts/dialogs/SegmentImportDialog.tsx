//
import React from 'react';
import { JSX } from "react";

import { Box, Stack, Step, StepLabel, Stepper, Typography } from "@mui/material";

import DialogWindow from '@widgets/core/DialogWindow';

//
// SegmentImportDialog — a wizard to build a segment by IMPORTING a list (CSV / external system) rather than
// defining rules in the editor. SKELETON: the step shell + navigation (via the dialog's action bar) are here;
// each step's real work (file upload + parse, mapping columns to contact fields via an import MAP, previewing
// matches/creates, and running the import job) lands next. Parent owns open/close; `onImported` fires on finish.
//
export function SegmentImportDialog( props : SegmentImportDialog.Props ) : JSX.Element
{
    const [step,setStep] = React.useState< number >( 0 );
    const isLast : boolean = step === SegmentImportDialog.STEPS.length - 1;

    ////////////////////////////////////////////////////////////////////////////////////////////
    // primary action: advance a step, or (on the last step) run the import. Returning FALSE keeps the dialog open.
    async function onYes() : Promise<boolean>
    {
        if( !isLast ) { setStep( ( prev : number ) : number => prev + 1 ); return false; }
        // TODO(import): kick off the import Job (parse → map → match/create contacts → build the segment)
        props.onImported?.();
        return true;
    }

    // tertiary action: step back
    async function onBack() : Promise<boolean> { setStep( ( prev : number ) : number => Math.max( 0, prev - 1 ) ); return false; }

    // the placeholder body for the active step (each becomes a real panel next)
    function stepBody() : JSX.Element
    {
        if( step === 0 ) return <Typography variant="body2" sx={{ color: "text.secondary" }}>{"Choose a source — upload a CSV or pick an external system. (Coming next.)"}</Typography>;
        if( step === 1 ) return <Typography variant="body2" sx={{ color: "text.secondary" }}>{"Map the source columns to contact fields using an import map. (Coming next.)"}</Typography>;
        return <Typography variant="body2" sx={{ color: "text.secondary" }}>{"Preview matches vs. new contacts and name the segment. (Coming next.)"}</Typography>;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    return  <DialogWindow id="segment-import"
                          title={"Import segment"}
                          minWidth="md"
                          ready
                          yesLabel={ isLast ? "Import" : "Next" }
                          tertiaryLabel={ step > 0 ? "Back" : undefined }
                          cancelLabel={"Cancel"}
                          onYes={ onYes }
                          onTertiary={ onBack }
                          onClose={ props.onClose }>
                <Stack spacing={ 2 } sx={{ p: 2, minHeight: 240 }}>
                    <Stepper activeStep={ step }>
                        { SegmentImportDialog.STEPS.map( ( label : string ) : JSX.Element => (
                            <Step key={ label }><StepLabel>{ label }</StepLabel></Step>
                        ) ) }
                    </Stepper>
                    <Box sx={{ flexGrow: 1, py: 2 }}>{ stepBody() }</Box>
                </Stack>
            </DialogWindow>;
}

export namespace SegmentImportDialog
{
    /** The wizard steps (skeleton). */
    export const STEPS : Array<string> = [ "Source", "Map fields", "Preview" ];

    export interface Props
    {
        onImported? : () => void;   // an import completed → parent refreshes the list
        onClose     : () => void;
    }
}

export default SegmentImportDialog;
// eof
