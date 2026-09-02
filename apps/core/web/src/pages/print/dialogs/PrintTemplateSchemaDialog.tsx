//
import React from 'react';
import { JSX } from "react";

import { Stack, Typography } from "@mui/material";

import { Print } from '@repo/api';

import DialogWindow from '@widgets/core/DialogWindow';
import TextInput    from '@widgets/core/TextInput';

//
// PrintTemplateSchemaDialog — edit a template's name + merge-field schema as raw JSON. A stand-in for the
// full SVG-canvas designer print-2/3.3 calls for (that's a Studio-scale editor of its own — see
// apps/core/print/SPECS.md "Rendering the artifact"); this gets a template's fields authorable today, with the
// designer as a documented follow-up. `schema` here is just `{ field: sampleValue, ... }` — the keys
// `ProofRenderer` renders as a label/value block on the proof.
//
export function PrintTemplateSchemaDialog( props : PrintTemplateSchemaDialog.Props ) : JSX.Element
{
    const [name,setName] = React.useState< string >( props.template.name );
    const [schemaText,setSchemaText] = React.useState< string >( JSON.stringify( props.template.schema, null, 2 ) );
    const [error,setError] = React.useState< string | null >( null );

    ////////////////////////////////////////////////////////////////////////////////////////////
    async function onYes() : Promise<boolean>
    {
        let schema : Record<string, unknown>;
        try { schema = JSON.parse( schemaText || "{}" ) as Record<string, unknown>; }
        catch { setError( "Invalid JSON" ); return false; }
        setError( null );
        return props.onSave( name.trim(), schema );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    return  <DialogWindow id="print-template-schema" title={`Edit — ${ props.template.name }`} yesLabel={"Save"} cancelLabel={"Cancel"}
                          minWidth="md" ready={ name.trim() !== "" } onYes={ onYes } onClose={ props.onClose }>
                <Stack spacing={ 2 } sx={{ p: 2 }}>
                    <TextInput id="print-tpl-schema-name" label={"Name"} value={ name } onChange={ setName } maxLength={ 120 } fullWidth />
                    <Typography variant="body2" sx={{ color: "text.secondary" }}>
                        {"Merge fields, as JSON (key: sample value). The proof renders each as a label/value line, plus the recipient address block."}
                    </Typography>
                    <TextInput id="print-tpl-schema-json" label={"Merge fields (JSON)"} value={ schemaText } onChange={ setSchemaText } multiline maxRows={ 10 } fullWidth />
                    { error && <Typography variant="body2" color="error">{ error }</Typography> }
                </Stack>
            </DialogWindow>;
}

export namespace PrintTemplateSchemaDialog
{
    export interface Props
    {
        template : Print.Template;
        onSave   : ( name : string, schema : Record<string, unknown> ) => Promise<boolean>;
        onClose  : () => void;
    }
}

export default PrintTemplateSchemaDialog;
// eof
