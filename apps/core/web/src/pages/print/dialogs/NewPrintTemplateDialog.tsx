//
import React from 'react';
import { JSX } from "react";

import { Stack, Typography } from "@mui/material";

import { Print } from '@repo/api';

import DialogWindow from '@widgets/core/DialogWindow';
import TextInput    from '@widgets/core/TextInput';
import SelectInput  from '@widgets/core/SelectInput';

//
// NewPrintTemplateDialog — name a new print template + pick its physical mailpiece type. The parent creates it
// (`onCreate`); this component owns the form state.
//
export function NewPrintTemplateDialog( props : NewPrintTemplateDialog.Props ) : JSX.Element
{
    const [name,setName] = React.useState< string >( "" );
    const [type,setType] = React.useState< string >( Print.MailpieceType.POSTCARD );

    const typeChoices : Array<SelectInput.Choice> = Object.values( Print.MailpieceType ).map( ( value : Print.MailpieceType ) : SelectInput.Choice => ( { value, label: value } ) );
    const ready : boolean = name.trim() !== "";

    ////////////////////////////////////////////////////////////////////////////////////////////
    async function onYes() : Promise<boolean>
    {
        const trimmed : string = name.trim();
        if( !ready ) return false;
        return props.onCreate( trimmed, type as Print.MailpieceType );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    return  <DialogWindow id="new-print-template" title={"New print template"} yesLabel={"Create"} cancelLabel={"Cancel"}
                          minWidth="sm" ready={ ready } onYes={ onYes } onClose={ props.onClose }>
                <Stack spacing={ 2 } sx={{ p: 2 }}>
                    <Typography variant="body2" sx={{ color: "text.secondary" }}>
                        {"Name the template and pick the physical form it renders to. You'll edit its merge fields next."}
                    </Typography>
                    <TextInput id="print-tpl-name" label={"Name"} value={ name } onChange={ setName } maxLength={ 120 } fullWidth placeHolder={"e.g. Spring postcard"} />
                    <SelectInput id="print-tpl-type" label={"Type"} value={ type } choices={ typeChoices } onChange={ setType } sx={{ width: "100%" }} />
                </Stack>
            </DialogWindow>;
}

export namespace NewPrintTemplateDialog
{
    export interface Props
    {
        onCreate : ( name : string, type : Print.MailpieceType ) => Promise<boolean>;
        onClose  : () => void;
    }
}

export default NewPrintTemplateDialog;
// eof
