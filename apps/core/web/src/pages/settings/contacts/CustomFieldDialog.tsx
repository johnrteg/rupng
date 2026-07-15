//
import React from 'react';
import { JSX } from "react";

import { Stack, Typography } from "@mui/material";

import { Contact } from '@repo/api';

import DialogWindow   from '@widgets/core/DialogWindow';
import TextInput      from '@widgets/core/TextInput';
import SelectInput    from '@widgets/core/SelectInput';
import ComboInput     from '@widgets/core/ComboInput';
import NumericInput   from '@widgets/core/NumericInput';
import CheckboxInput  from '@widgets/core/CheckboxInput';
import ChoiceListInput from '@pages/settings/contacts/ChoiceListInput';

//
// CustomFieldDialog — create OR edit a contact custom-field definition. Pass `field` to edit (type is then
// locked — immutable), omit to create. Parent owns open/close + does the POST/PATCH via onSave. Choices are
// edited as labels (a stable key is derived from the label on create). Currency is per-field.
//
export function CustomFieldDialog( props : CustomFieldDialog.Props ) : JSX.Element
{
    const editing : boolean = props.field !== undefined;

    const [label,setLabel]       = React.useState< string >( props.field?.label ?? "" );
    const [type,setType]         = React.useState< string >( props.field?.type ?? Contact.CustomFieldType.TEXT );
    const [group,setGroup]       = React.useState< string >( props.field?.group ?? "" );
    const [order,setOrder]       = React.useState< number >( props.field?.order ?? 0 );
    const [currency,setCurrency] = React.useState< string >( props.field?.currency ?? "USD" );
    const [required,setRequired] = React.useState< boolean >( props.field?.required ?? false );
    const [choices,setChoices]   = React.useState< Array<string> >( ( props.field?.choices ?? [] ).map( ( choice : Contact.ChoiceOption ) : string => choice.label ) );

    const typeChoices : Array<SelectInput.Choice> = SelectInput.enumToChoices( Contact.CustomFieldType );
    const needsChoices : boolean = type === Contact.CustomFieldType.CHOICE || type === Contact.CustomFieldType.MULTI_CHOICE;
    const isCurrency : boolean = type === Contact.CustomFieldType.CURRENCY;

    ////////////////////////////////////////////////////////////////////////////////////////////
    // a stable key from a label (lowercase, non-alnum → "_") — used when creating choice options
    function keyOf( text : string ) : string
    {
        return text.trim().toLowerCase().replace( /[^a-z0-9]+/g, "_" ).replace( /^_+|_+$/g, "" );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // assemble the choice options ({ key, label }) from the edited labels
    function choiceOptions() : Array<Contact.ChoiceOption>
    {
        return choices.map( ( choiceLabel : string ) : Contact.ChoiceOption => ( { key: keyOf( choiceLabel ), label: choiceLabel } ) );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    function onYes() : Promise<boolean>
    {
        return props.onSave( {
            label:    label.trim(),
            type:     type as Contact.CustomFieldType,
            group:    group.trim() || undefined,
            order,
            required,
            choices:  needsChoices ? choiceOptions() : undefined,
            currency: isCurrency ? currency.trim().toUpperCase() : undefined,
        } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    return  <DialogWindow id="custom-field-edit"
                          title={ editing ? "Edit field" : "Add field" }
                          yesLabel={ editing ? "Save" : "Add field" }
                          cancelLabel={"Cancel"}
                          minWidth="sm"
                          ready={ label.trim() !== "" }
                          onYes={ onYes }
                          onClose={ props.onClose }>
                <Stack spacing={ 2 } sx={{ p: 2 }}>
                    <TextInput id="field-label" label={"Label"} value={ label } onChange={ setLabel } maxLength={ 100 } fullWidth />
                    <SelectInput id="field-type" label={"Type"} value={ type } choices={ typeChoices } onChange={ setType } sx={{ width: "100%" }} disabled={ editing } />
                    { editing && <Typography variant="caption" sx={{ color: "text.secondary" }}>{"Type is immutable once a field is created."}</Typography> }
                    { needsChoices &&
                        <ChoiceListInput label={"Choices"} value={ choices } onChange={ setChoices } /> }
                    { isCurrency &&
                        <TextInput id="field-currency" label={"Currency (ISO code)"} value={ currency } onChange={ setCurrency } maxLength={ 3 } sx={{ width: 160 }} /> }
                    <Stack direction="row" spacing={ 1 }>
                        <ComboInput id="field-group" label={"Group"} value={ group } allowAdd fullWidth
                                    choices={ ( props.groups ?? [] ).map( ( name : string ) : ComboInput.Choice => ( { value: name, label: name } ) ) }
                                    onChange={ ( value : string | null ) : void => setGroup( value ?? "" ) } />
                        <NumericInput id="field-order" label={"Order"} value={ order } onChange={ ( value : number ) : void => setOrder( value ) } sx={{ width: 120 }} />
                    </Stack>
                    <CheckboxInput id="field-required" label={"Required"} value={ required } onChange={ setRequired } />
                </Stack>
            </DialogWindow>;
}

export namespace CustomFieldDialog
{
    /** The editable subset the dialog collects (server owns uid/status/audit; type locked on edit). */
    export interface Draft
    {
        label:     string;
        type:      Contact.CustomFieldType;
        group?:    string;
        order?:    number;
        required?: boolean;
        choices?:  Array<Contact.ChoiceOption>;
        currency?: string;
    }

    export interface Props
    {
        field?  : Contact.CustomFieldDef;                        // present → edit (type locked); absent → create
        groups? : Array<string>;                                 // existing group labels (combo suggestions; a new one can be typed)
        onSave  : ( draft : Draft ) => Promise<boolean>;
        onClose : () => void;
    }
}

export default CustomFieldDialog;
