//
import React from 'react';
import { JSX } from "react";

import { Stack, Typography } from "@mui/material";

import { Segment } from '@repo/api';

import DialogWindow  from '@widgets/core/DialogWindow';
import TextInput     from '@widgets/core/TextInput';
import CheckboxInput from '@widgets/core/CheckboxInput';

//
// SegmentCopyDialog — copy a segment's filter/sort/limit into a new one, choosing which manual overrides to
// carry: the pinned-IN (add) pins and/or the pinned-OUT (remove) pins. Copying WITHOUT either is the clean
// "unpin" path — a pure query segment. The parent owns open/close + does the copy fetch.
//
export function SegmentCopyDialog( props : SegmentCopyDialog.Props ) : JSX.Element
{
    const [name,setName]               = React.useState< string >( `${ props.segment.name } (copy)` );
    const [copyPins,setCopyPins]       = React.useState< boolean >( false );
    const [copyExclusions,setCopyExcl] = React.useState< boolean >( false );

    ////////////////////////////////////////////////////////////////////////////////////////////
    function onYes() : Promise<boolean>
    {
        return props.onCopy( { name: name.trim(), copyPins, copyExclusions } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    return  <DialogWindow id="segment-copy"
                          title={"Copy segment"}
                          yesLabel={"Copy"}
                          cancelLabel={"Cancel"}
                          minWidth="sm"
                          ready={ name.trim() !== "" }
                          onYes={ onYes }
                          onClose={ props.onClose }>
                <Stack spacing={ 2 } sx={{ p: 2 }}>
                    <TextInput id="copy-name" label={"New segment name"} value={ name } onChange={ setName } maxLength={ 120 } fullWidth />
                    <Typography variant="overline" sx={{ color: "text.secondary" }}>{"Manual overrides to carry over"}</Typography>
                    <CheckboxInput id="copy-pins" label={"Keep manually-added contacts (add pins)"} value={ copyPins } onChange={ setCopyPins } />
                    <CheckboxInput id="copy-exclusions" label={"Keep manually-removed contacts (remove pins)"} value={ copyExclusions } onChange={ setCopyExcl } />
                    <Typography variant="caption" sx={{ color: "text.secondary" }}>{"Leave both off to copy a clean, query-only segment (drops all manual pins). The copy re-runs its filter."}</Typography>
                </Stack>
            </DialogWindow>;
}

export namespace SegmentCopyDialog
{
    export interface Props
    {
        segment : Segment.Entity;
        onCopy  : ( options : { name : string; copyPins : boolean; copyExclusions : boolean } ) => Promise<boolean>;
        onClose : () => void;
    }
}

export default SegmentCopyDialog;
