//
import React from 'react';
import { JSX } from "react";

import { FormControlLabel, Checkbox, Stack, Typography } from "@mui/material";

import { Media } from '@repo/api';

import DialogWindow from '@widgets/core/DialogWindow';
import TextInput    from '@widgets/core/TextInput';

//
// CopyAssetDialog — copy a media envelope: name the copy and choose whether to include its DERIVED items.
// Unchecked (default) copies just the ORIGINAL file and lets the pipeline re-derive the rest; checked copies
// the derived items verbatim. The parent owns open/close + performs the copy (returns success to close).
//
export function CopyAssetDialog( props : CopyAssetDialog.Props ) : JSX.Element
{
    const [name,setName]                   = React.useState< string >( `Copy of ${ props.asset.name }` );
    const [includeDerived,setIncludeDerived] = React.useState< boolean >( false );

    // whether this envelope actually has derived items to offer copying
    const hasDerived : boolean = ( props.asset.items ?? [] ).some( ( item ) => item.usage !== Media.Usage.ORIGINAL );

    ////////////////////////////////////////////////////////////////////////////////////////////
    // run the copy → true on success (dialog closes)
    async function onCopy() : Promise<boolean>
    {
        if( name.trim() === "" ) return false;
        return props.onCopy( name.trim(), includeDerived && hasDerived );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    return  <DialogWindow id="media-copy"
                          title={"Copy media"}
                          yesLabel={"Copy"}
                          cancelLabel={"Cancel"}
                          minWidth="sm"
                          ready={ name.trim() !== "" }
                          onYes={ onCopy }
                          onClose={ props.onClose }>
                <Stack spacing={ 2 } sx={{ p: 2 }}>
                    <TextInput id="media-copy-name" label={"Copy name"} value={ name } maxLength={ 300 } onChange={ setName } sx={{ width: "100%" }} />
                    <FormControlLabel
                        control={ <Checkbox checked={ includeDerived } disabled={ !hasDerived } onChange={ ( event ) => setIncludeDerived( event.target.checked ) } /> }
                        label={"Include all derived items (renditions, compressions, transcripts…)"} />
                    <Typography variant="caption" sx={{ color: "text.secondary" }}>
                        { hasDerived
                            ? "Unchecked copies only the original file; the copy re-derives the rest."
                            : "This item has no derived items yet — only the original file is copied." }
                    </Typography>
                </Stack>
            </DialogWindow>;
}

export namespace CopyAssetDialog
{
    export interface Props
    {
        asset   : Media.Asset;
        onCopy  : ( name : string, includeDerived : boolean ) => Promise<boolean>;   // perform the copy; resolve true to close
        onClose : () => void;
    }
}

export default CopyAssetDialog;
// eof
