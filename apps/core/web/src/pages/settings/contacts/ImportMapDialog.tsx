import AppModel from "@model/AppModel";
//
import React from 'react';
import { JSX } from "react";

import { Box, Divider, Stack, Typography } from "@mui/material";
import AddOutlinedIcon           from '@mui/icons-material/AddOutlined';
import DeleteOutlineOutlinedIcon from '@mui/icons-material/DeleteOutlineOutlined';
import DragIndicatorOutlinedIcon from '@mui/icons-material/DragIndicatorOutlined';

import { Contact, ImportMap, PostImportMap, PatchImportMap } from '@repo/api';
import { RestfulService } from '@repo/endpoint';

import DialogWindow from '@widgets/core/DialogWindow';
import TextInput    from '@widgets/core/TextInput';
import SelectInput  from '@widgets/core/SelectInput';
import ButtonIcon   from '@widgets/core/ButtonIcon';
import Button       from '@mui/material/Button';
import CountryCodeInput from '@widgets/core/CountryCodeInput';
import SnackAlert   from '@widgets/core/SnackAlert';

//
// ImportMapDialog — author a reusable IMPORT MAP (media/contact-6): name it, pick the source file format, then
// list the SOURCE column names and map each to a destination Contact field (built-in OR custom), with an
// optional mini-ETL TRANSFORM (trim / case / split-name / phone→E.164 / date parse / lookup / …). A source
// column can be left "— Don't import —" (skipped). Create → POST, edit → PATCH. The parent reloads on save.
//
export function ImportMapDialog( props : ImportMapDialog.Props ) : JSX.Element
{
    const appmodel : AppModel = AppModel.instance();

    const [name,setName]               = React.useState< string >( props.map?.name ?? "" );
    const [description,setDescription] = React.useState< string >( props.map?.description ?? "" );
    const [format,setFormat]           = React.useState< string >( props.map?.sourceFormat ?? ImportMap.SourceFormat.CSV );
    const [rows,setRows]               = React.useState< Array<ImportMapDialog.Row> >( () => initialRows( props.map ) );
    const [dragIndex,setDragIndex]     = React.useState< number | null >( null );   // row being dragged (reorder)
    const [snack,setSnack]             = React.useState< { message : string; severity : SnackAlert.Severity } | null >( null );

    // destination choices — a "don't import" sentinel + built-in contact fields + this account's CUSTOM fields
    const destChoices : Array<SelectInput.Choice> =
    [
        { value: ImportMapDialog.SKIP, label: "— Don't import —" },
        ...ImportMapDialog.STANDARD_FIELDS,
        ...props.customFields.map( ( field : Contact.CustomFieldDef ) : SelectInput.Choice => ( { value: field.uid, label: `${ field.label } (custom)` } ) ),
    ];
    // LOOKUP is intentionally not offered (deferred — see below)
    const transformChoices : Array<SelectInput.Choice> = Object.values( ImportMap.Transform )
        .filter( ( value : ImportMap.Transform ) : boolean => value !== ImportMap.Transform.LOOKUP )
        .map( ( value : ImportMap.Transform ) : SelectInput.Choice => ( { value, label: ImportMapDialog.TRANSFORM_LABELS[ value ] ?? value } ) );
    const formatChoices : Array<SelectInput.Choice> = Object.values( ImportMap.SourceFormat ).map( ( value : ImportMap.SourceFormat ) : SelectInput.Choice => ( { value, label: value.toUpperCase() } ) );

    ////////////////////////////////////////////////////////////////////////////////////////////
    // row edits
    function addRow() : void { setRows( ( prev : Array<ImportMapDialog.Row> ) : Array<ImportMapDialog.Row> => [ ...prev, { externalField: "", internalField: ImportMapDialog.SKIP, transform: ImportMap.Transform.NONE, isKey: false } ] ); }

    // reorder rows via drag-and-drop
    function moveRow( from : number, to : number ) : void
    {
        if( from === to ) return;
        setRows( ( prev : Array<ImportMapDialog.Row> ) : Array<ImportMapDialog.Row> =>
        {
            const next : Array<ImportMapDialog.Row> = [ ...prev ];
            const [ moved ] : Array<ImportMapDialog.Row> = next.splice( from, 1 );
            next.splice( to, 0, moved );
            return next;
        } );
    }
    function updateRow( index : number, patch : Partial<ImportMapDialog.Row> ) : void
    { setRows( ( prev : Array<ImportMapDialog.Row> ) : Array<ImportMapDialog.Row> => prev.map( ( row : ImportMapDialog.Row, i : number ) : ImportMapDialog.Row => i === index ? { ...row, ...patch } : row ) ); }
    function removeRow( index : number ) : void
    { setRows( ( prev : Array<ImportMapDialog.Row> ) : Array<ImportMapDialog.Row> => prev.filter( ( _row : ImportMapDialog.Row, i : number ) : boolean => i !== index ) ); }

    // the mapped rows (a source column with a chosen destination) — "don't import" / blank rows are dropped
    function mapped() : Array<ImportMap.FieldMapping> { return rows
        .filter( ( row : ImportMapDialog.Row ) : boolean => row.internalField !== ImportMapDialog.SKIP && row.internalField !== "" && row.externalField.trim() !== "" )
        .map( ( row : ImportMapDialog.Row ) : ImportMap.FieldMapping => ( { externalField: row.externalField.trim(), internalField: row.internalField, transform: row.transform !== ImportMap.Transform.NONE ? row.transform : undefined, options: optionsFrom( row ), isKey: row.isKey || undefined } ) ); }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // Save — create (POST) or update (PATCH) the map
    async function onSave() : Promise<boolean>
    {
        const mappings : Array<ImportMap.FieldMapping> = mapped();
        if( name.trim() === "" ) { setSnack( { message: "Name the map.", severity: "info" } ); return false; }
        if( mappings.length === 0 ) { setSnack( { message: "Map at least one source column to a field.", severity: "info" } ); return false; }
        const body : ImportMap.Create = { name: name.trim(), description: description.trim() || undefined, target: ImportMap.Target.CONTACT, sourceFormat: format as ImportMap.SourceFormat, mappings };
        const reply : RestfulService.Reply<PostImportMap.Response | PatchImportMap.Response> = props.map
            ? await appmodel.server.fetch( new PatchImportMap( props.map.id, body ) )
            : await appmodel.server.fetch( new PostImportMap( body ) );
        if( !reply.ok ) { setSnack( { message: RestfulService.error( reply, "Could not save the map." ), severity: "error" } ); return false; }
        props.onSaved();
        return true;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // one mapping row: source column → destination field + transform, plus the transform's contextual options
    function mappingRow( row : ImportMapDialog.Row, index : number ) : JSX.Element
    {
        return  <Box key={ index }
                     onDragOver={ ( event : React.DragEvent ) : void => event.preventDefault() }
                     onDrop={ () : void => { if( dragIndex !== null ) moveRow( dragIndex, index ); setDragIndex( null ); } }
                     sx={{ borderRadius: 1, ...( dragIndex === index ? { opacity: 0.5 } : {} ) }}>
                    <Stack direction="row" spacing={ 1 } sx={{ alignItems: "center" }}>
                        {/* drag handle — reorder the mappings */}
                        <Box draggable onDragStart={ () : void => setDragIndex( index ) } onDragEnd={ () : void => setDragIndex( null ) }
                             sx={{ display: "flex", alignItems: "center", cursor: "grab", color: "text.disabled" }}>
                            <DragIndicatorOutlinedIcon fontSize="small" />
                        </Box>
                        <Box sx={{ width: "28%" }}><TextInput id={ `map-src-${ index }` } label={"Source column"} value={ row.externalField } onChange={ ( value : string ) : void => updateRow( index, { externalField: value } ) } fullWidth /></Box>
                        <Box sx={{ width: "32%" }}><SelectInput id={ `map-dest-${ index }` } label={"Destination field"} value={ row.internalField } choices={ destChoices } onChange={ ( value : string ) : void => updateRow( index, { internalField: value } ) } sx={{ width: "100%" }} /></Box>
                        <Box sx={{ width: "26%" }}><SelectInput id={ `map-xf-${ index }` } label={"Convert"} value={ row.transform } choices={ transformChoices } onChange={ ( value : string ) : void => updateRow( index, { transform: value as ImportMap.Transform } ) } sx={{ width: "100%" }} /></Box>
                        <ButtonIcon id={ `map-rm-${ index }` } label={"Remove"} size="small" icon={ <DeleteOutlineOutlinedIcon fontSize="small" /> } onClick={ () : void => removeRow( index ) } />
                    </Stack>
                    { transformOptions( row, index ) }
                </Box>;
    }

    // the transform-specific options for a row (nothing for NONE/simple transforms; LOOKUP deferred)
    function transformOptions( row : ImportMapDialog.Row, index : number ) : JSX.Element | null
    {
        const transform : ImportMap.Transform = row.transform;
        const inputs : Array<JSX.Element> = [];
        if( transform === ImportMap.Transform.DATE || transform === ImportMap.Transform.DATETIME )
            inputs.push( <TextInput key="fmt" id={ `map-fmt-${ index }` } label={"Date format (e.g. MM/DD/YYYY)"} value={ row.format ?? "" } onChange={ ( value : string ) : void => updateRow( index, { format: value } ) } fullWidth /> );
        if( transform === ImportMap.Transform.DATETIME )
            inputs.push( <TextInput key="tz" id={ `map-tz-${ index }` } label={"Time zone (IANA, e.g. America/New_York)"} value={ row.timeZone ?? "" } onChange={ ( value : string ) : void => updateRow( index, { timeZone: value } ) } fullWidth /> );
        if( transform === ImportMap.Transform.SPLIT || transform === ImportMap.Transform.JOIN )
            inputs.push( <TextInput key="delim" id={ `map-delim-${ index }` } label={"Delimiter"} value={ row.delimiter ?? "" } onChange={ ( value : string ) : void => updateRow( index, { delimiter: value } ) } fullWidth /> );
        if( transform === ImportMap.Transform.SPLIT || transform === ImportMap.Transform.SPLIT_NAME )
            inputs.push( <TextInput key="tgt" id={ `map-tgt-${ index }` } label={"Target fields (comma-separated, e.g. firstName, lastName)"} value={ row.targetFields ?? "" } onChange={ ( value : string ) : void => updateRow( index, { targetFields: value } ) } fullWidth /> );
        if( transform === ImportMap.Transform.JOIN )
            inputs.push( <TextInput key="src" id={ `map-srcs-${ index }` } label={"Source columns to join (comma-separated)"} value={ row.sources ?? "" } onChange={ ( value : string ) : void => updateRow( index, { sources: value } ) } fullWidth /> );
        if( transform === ImportMap.Transform.PHONE_E164 || transform === ImportMap.Transform.COUNTRY_CODE )
            inputs.push( <Box key="cc" sx={{ minWidth: 160 }}><CountryCodeInput id={ `map-cc-${ index }` } label={"Default country"} value={ row.defaultCountry } onChange={ ( value : string ) : void => updateRow( index, { defaultCountry: value } ) } sx={{ width: "100%" }} /></Box> );
        if( transform === ImportMap.Transform.CONSTANT || transform === ImportMap.Transform.DEFAULT_IF_EMPTY )
            inputs.push( <TextInput key="const" id={ `map-const-${ index }` } label={ transform === ImportMap.Transform.CONSTANT ? "Constant value" : "Value when empty" } value={ row.constant ?? "" } onChange={ ( value : string ) : void => updateRow( index, { constant: value } ) } fullWidth /> );
        if( transform === ImportMap.Transform.BOOLEAN )
            inputs.push( <TextInput key="true" id={ `map-true-${ index }` } label={"True values (comma-separated, e.g. yes, y, 1, true)"} value={ row.trueValues ?? "" } onChange={ ( value : string ) : void => updateRow( index, { trueValues: value } ) } fullWidth /> );

        if( inputs.length === 0 ) return null;
        // indent the converter's options so they nest clearly under their mapping row
        return <Stack direction="row" spacing={ 1 } sx={{ pl: 6, pt: 1.5, pb: 0.5 }}>{ inputs }</Stack>;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    return  <DialogWindow id="import-map"
                          title={ props.map ? "Edit import map" : "New import map" }
                          minWidth="md"
                          ready={ name.trim() !== "" }
                          yesLabel={"Save"}
                          cancelLabel={"Cancel"}
                          onYes={ onSave }
                          onClose={ props.onClose }>
                <Stack spacing={ 2 } sx={{ p: 2 }}>
                    <Stack direction="row" spacing={ 1 }>
                        <Box sx={{ flexGrow: 1 }}><TextInput id="map-name" label={"Map name"} value={ name } onChange={ setName } maxLength={ 120 } fullWidth /></Box>
                        <Box sx={{ width: 140 }}><SelectInput id="map-format" label={"Source format"} value={ format } choices={ formatChoices } onChange={ setFormat } sx={{ width: "100%" }} /></Box>
                    </Stack>
                    <TextInput id="map-desc" label={"Description"} value={ description } onChange={ setDescription } maxLength={ 300 } fullWidth />

                    <Divider />
                    <Stack direction="row" spacing={ 1 } sx={{ alignItems: "center" }}>
                        <Typography variant="overline" sx={{ color: "text.secondary", flexGrow: 1 }}>{"Field mappings"}</Typography>
                        <Button size="small" startIcon={ <AddOutlinedIcon /> } onClick={ addRow }>{"Add mapping"}</Button>
                    </Stack>
                    <Typography variant="caption" sx={{ color: "text.secondary" }}>{"Enter each source column and the contact field it maps to. Leave the destination on “Don’t import” to skip a column. Add a converter to reshape the value on the way in."}</Typography>
                    { rows.map( ( row : ImportMapDialog.Row, index : number ) : JSX.Element => mappingRow( row, index ) ) }
                    { rows.length === 0 &&
                        <Typography variant="body2" sx={{ color: "text.secondary", textAlign: "center", py: 2 }}>{"No mappings yet — add one."}</Typography> }
                </Stack>
                { snack && <SnackAlert message={ snack.message } severity={ snack.severity } onClose={ () : void => setSnack( null ) } /> }
            </DialogWindow>;
}

// seed editor rows from an existing map (or one blank row for a new map)
function initialRows( map? : ImportMap.Entity ) : Array<ImportMapDialog.Row>
{
    if( map === undefined || ( map.mappings ?? [] ).length === 0 ) return [ { externalField: "", internalField: ImportMapDialog.SKIP, transform: ImportMap.Transform.NONE, isKey: false } ];
    return map.mappings.map( ( mapping : ImportMap.FieldMapping ) : ImportMapDialog.Row =>
    {
        const options : ImportMap.TransformOptions = mapping.options ?? {};
        return { externalField: mapping.externalField, internalField: mapping.internalField, transform: mapping.transform ?? ImportMap.Transform.NONE, isKey: mapping.isKey === true,
                 format: options.format, timeZone: options.timeZone, delimiter: options.delimiter, defaultCountry: options.defaultCountry, constant: options.constant,
                 targetFields: ( options.targetFields ?? [] ).join( ", " ) || undefined, sources: ( options.sources ?? [] ).join( ", " ) || undefined, trueValues: ( options.trueValues ?? [] ).join( ", " ) || undefined };
    } );
}

// split a comma-separated editor field into a trimmed list (empty → undefined)
function csvList( value? : string ) : Array<string> | undefined
{
    const parts : Array<string> = ( value ?? "" ).split( "," ).map( ( part : string ) : string => part.trim() ).filter( ( part : string ) : boolean => part !== "" );
    return parts.length > 0 ? parts : undefined;
}

// build the TransformOptions for a row from its (transform-specific) option fields — omit when none apply.
// NOTE: LOOKUP is intentionally NOT configurable here yet (deferred).
function optionsFrom( row : ImportMapDialog.Row ) : ImportMap.TransformOptions | undefined
{
    const transform : ImportMap.Transform = row.transform;
    const options : ImportMap.TransformOptions = {};
    if( ( transform === ImportMap.Transform.DATE || transform === ImportMap.Transform.DATETIME ) && row.format ) options.format = row.format;
    if( transform === ImportMap.Transform.DATETIME && row.timeZone ) options.timeZone = row.timeZone as ImportMap.TransformOptions[ "timeZone" ];
    if( ( transform === ImportMap.Transform.SPLIT || transform === ImportMap.Transform.JOIN ) && row.delimiter ) options.delimiter = row.delimiter;
    if( transform === ImportMap.Transform.SPLIT || transform === ImportMap.Transform.SPLIT_NAME ) { const list : Array<string> | undefined = csvList( row.targetFields ); if( list ) options.targetFields = list; }
    if( transform === ImportMap.Transform.JOIN ) { const list : Array<string> | undefined = csvList( row.sources ); if( list ) options.sources = list; }
    if( ( transform === ImportMap.Transform.PHONE_E164 || transform === ImportMap.Transform.COUNTRY_CODE ) && row.defaultCountry ) options.defaultCountry = row.defaultCountry.toUpperCase();
    if( ( transform === ImportMap.Transform.CONSTANT || transform === ImportMap.Transform.DEFAULT_IF_EMPTY ) && row.constant !== undefined && row.constant !== "" ) options.constant = row.constant;
    if( transform === ImportMap.Transform.BOOLEAN ) { const list : Array<string> | undefined = csvList( row.trueValues ); if( list ) options.trueValues = list; }
    return Object.keys( options ).length > 0 ? options : undefined;
}

export namespace ImportMapDialog
{
    /** One editable mapping row (option fields are edited as strings; CSV lists are split on save). */
    export interface Row
    {
        externalField  : string;
        internalField  : string;
        transform      : ImportMap.Transform;
        isKey          : boolean;
        format?        : string;   // DATE/DATETIME parse format
        timeZone?      : string;   // DATETIME source zone
        delimiter?     : string;   // SPLIT/JOIN delimiter
        targetFields?  : string;   // SPLIT/SPLIT_NAME → destination fields (CSV)
        sources?       : string;   // JOIN ← source columns (CSV)
        defaultCountry? : string;  // PHONE_E164/COUNTRY_CODE fallback region (ISO alpha-2)
        constant?      : string;   // CONSTANT/DEFAULT_IF_EMPTY value
        trueValues?    : string;   // BOOLEAN truthy tokens (CSV)
    }

    /** Sentinel destination for a source column that is NOT imported (a real value so it shows in the picker). */
    export const SKIP : string = "__skip__";

    /** Built-in Contact destination fields offered in the picker (custom fields are appended at runtime). */
    export const STANDARD_FIELDS : Array<SelectInput.Choice> =
    [
        { value: "firstName",          label: "First name" },
        { value: "lastName",           label: "Last name" },
        { value: "email",              label: "Email" },
        { value: "phone",              label: "Phone" },
        { value: "sex",                label: "Sex" },
        { value: "politicalParty",     label: "Political party" },
        { value: "estimatedBirthdate", label: "Birthdate" },
        { value: "preferredLanguage",  label: "Preferred language" },
        { value: "timezone",           label: "Timezone" },
        { value: "notes",              label: "Notes" },
        // address (maps to the contact's primary address)
        { value: "address.line1",      label: "Address — Street 1" },
        { value: "address.line2",      label: "Address — Street 2" },
        { value: "address.city",       label: "Address — City" },
        { value: "address.county",     label: "Address — County" },
        { value: "address.region",     label: "Address — State / Region" },
        { value: "address.postalCode", label: "Address — Postal Code" },
        { value: "address.country",    label: "Address — Country" },
    ];

    /** Human labels for the mini-ETL transforms. */
    export const TRANSFORM_LABELS : Record<string, string> =
    {
        [ ImportMap.Transform.NONE ]:            "None (copy)",
        [ ImportMap.Transform.TRIM ]:            "Trim spaces",
        [ ImportMap.Transform.LOWERCASE ]:       "lowercase",
        [ ImportMap.Transform.UPPERCASE ]:       "UPPERCASE",
        [ ImportMap.Transform.TITLE_CASE ]:      "Title Case",
        [ ImportMap.Transform.SPLIT_NAME ]:      "Split full name",
        [ ImportMap.Transform.JOIN ]:            "Join columns",
        [ ImportMap.Transform.SPLIT ]:           "Split column",
        [ ImportMap.Transform.PHONE_E164 ]:      "Phone → E.164",
        [ ImportMap.Transform.EMAIL_NORMALIZE ]: "Normalize email",
        [ ImportMap.Transform.DATE ]:            "Parse date",
        [ ImportMap.Transform.DATETIME ]:        "Parse date-time",
        [ ImportMap.Transform.BOOLEAN ]:         "Boolean",
        [ ImportMap.Transform.NUMBER ]:          "Number",
        [ ImportMap.Transform.COUNTRY_CODE ]:    "Country code",
        [ ImportMap.Transform.CONSTANT ]:        "Constant value",
        [ ImportMap.Transform.LOOKUP ]:          "Lookup table",
        [ ImportMap.Transform.DEFAULT_IF_EMPTY ]: "Default if empty",
    };

    export interface Props
    {
        map?         : ImportMap.Entity;              // editing an existing map (omit to create)
        customFields : Array<Contact.CustomFieldDef>; // the account's custom fields (destination options)
        onSaved      : () => void;
        onClose      : () => void;
    }
}

export default ImportMapDialog;
// eof
