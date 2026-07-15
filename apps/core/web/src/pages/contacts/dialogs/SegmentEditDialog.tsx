import AppModel from "@model/AppModel";
//
import React from 'react';
import { JSX } from "react";

import { Box, Button, Divider, Stack, Typography } from "@mui/material";
import ArrowUpwardOutlinedIcon   from '@mui/icons-material/ArrowUpwardOutlined';
import ArrowDownwardOutlinedIcon from '@mui/icons-material/ArrowDownwardOutlined';

import { Segment, Contact, GetContactFields, GetSegments, PostSegmentPreview } from '@repo/api';
import { DateUtils } from '@repo/common';
import { RestfulService } from '@repo/endpoint';

import DialogWindow  from '@widgets/core/DialogWindow';
import TextInput     from '@widgets/core/TextInput';
import NumericInput  from '@widgets/core/NumericInput';
import SelectInput   from '@widgets/core/SelectInput';
import CheckboxInput from '@widgets/core/CheckboxInput';
import TagInput      from '@widgets/core/TagInput';
import TableInput    from '@widgets/core/TableInput';
import ButtonIcon    from '@widgets/core/ButtonIcon';
import LocaleService from '@model/service/LocaleService';
import SegmentGroupEditor from '@pages/contacts/dialogs/SegmentGroupEditor';

// preview results table columns (pure constant → module scope)
const PREVIEW_COLUMNS : Array<TableInput.Column> =
[
    { field: "name",    label: "Name",    type: TableInput.ColumnType.STRING },
    { field: "phone",   label: "Phone",   type: TableInput.ColumnType.STRING },
    { field: "created", label: "Created", type: TableInput.ColumnType.STRING },
    { field: "tags",    label: "Tags",    type: TableInput.ColumnType.STRING },
];

//
// SegmentEditDialog — create OR edit a segment (a "group"). Hosts the visual query builder: a root boolean
// group (all/any/none) of rules, each a field + comparison + operand, with nestable sub-groups. On CREATE a
// "type" dropdown picks how members are sourced (Custom = the builder; Import kinds need the CSV import —
// coming). Result ordering (Sort by + direction) is captured too. The parent owns open/close + the POST/PATCH.
//
export function SegmentEditDialog( props : SegmentEditDialog.Props ) : JSX.Element
{
    const appmodel : AppModel = AppModel.instance();
    const editing : boolean = props.segment !== undefined;

    const [name,setName]           = React.useState< string >( props.segment?.name ?? "" );
    const [kind,setKind]           = React.useState< string >( SegmentEditDialog.Kind.CUSTOM );
    const [isExclusion,setExclude] = React.useState< boolean >( props.segment?.isExclusion ?? false );
    const [tags,setTags]           = React.useState< Array<string> >( props.segment?.tags ?? [] );
    const [root,setRoot]           = React.useState< Segment.Group >( props.segment?.query ?? { op: Segment.GroupOp.ALL, conditions: [] } );
    const [sortField,setSortField] = React.useState< string >( props.segment?.sort?.field ?? Segment.FieldId.CREATED_DATE );
    const [sortDir,setSortDir]     = React.useState< Segment.SortDir >( props.segment?.sort?.direction ?? Segment.SortDir.DESC );
    const [limit,setLimit]         = React.useState< number >( props.segment?.limit ?? 0 );
    const [limitOn,setLimitOn]     = React.useState< boolean >( ( props.segment?.limit ?? 0 ) > 0 );
    const [fieldDefs,setFieldDefs] = React.useState< Array<Contact.CustomFieldDef> >( [] );
    const [segments,setSegments]   = React.useState< Array<Segment.Entity> >( [] );
    const [preview,setPreview]     = React.useState< PostSegmentPreview.Response | null >( null );
    const [previewBusy,setBusy]    = React.useState< boolean >( false );

    const importKind : boolean = kind !== SegmentEditDialog.Kind.CUSTOM;
    // the account's other segments — the operand choices for a "belongs to segment" rule (exclude self)
    const segmentChoices : Array<SelectInput.Choice> = segments
        .filter( ( entry : Segment.Entity ) : boolean => entry.id !== props.segment?.id )
        .map( ( entry : Segment.Entity ) : SelectInput.Choice => ( { value: entry.id, label: entry.name } ) );
    // the filter catalog = built-in fields + this account's custom fields. Hide "belongs to segment" until there
    // is at least one OTHER segment to reference (nothing to pick otherwise).
    const builtIns : Array<Segment.FilterField> = segmentChoices.length > 0 ? Segment.FIELDS : Segment.FIELDS.filter( ( field : Segment.FilterField ) : boolean => field.id !== Segment.FieldId.SEGMENT );
    const fields : Array<Segment.FilterField> = [ ...builtIns, ...fieldDefs.map( ( def : Contact.CustomFieldDef ) : Segment.FilterField => Segment.customField( def ) ) ];

    const kindChoices : Array<SelectInput.Choice> =
    [
        { value: SegmentEditDialog.Kind.CUSTOM,        label: "Custom (filter / search)" },
        { value: SegmentEditDialog.Kind.IMPORT,        label: "Import (from a CSV)" },
        { value: SegmentEditDialog.Kind.IMPORT_OPT_IN, label: "Import opt-in (CSV + consent)" },
    ];
    // sort is optional — a "(no sorting)" choice clears it (and disables the limit, which needs an order)
    const sortChoices : Array<SelectInput.Choice> = [ { value: "", label: "(no sorting)" }, ...fields.map( ( field : Segment.FilterField ) : SelectInput.Choice => ( { value: field.id, label: field.label } ) ) ];
    const sorted : boolean = sortField !== "";

    ////////////////////////////////////////////////////////////////////////////////////////////
    React.useEffect( () => { void loadFields(); void loadSegments(); }, [] );

    // load the account's active custom-field defs so they appear as filterable fields in the builder
    async function loadFields() : Promise<void>
    {
        const reply : RestfulService.Reply<GetContactFields.Response> = await appmodel.server.fetch( new GetContactFields() );
        if( reply.ok && reply.data ) setFieldDefs( reply.data.records );
    }

    // load the account's segments so a "belongs to segment" rule can pick them by name (e.g. exclude segment Y)
    async function loadSegments() : Promise<void>
    {
        const reply : RestfulService.Reply<GetSegments.Response> = await appmodel.server.fetch( new GetSegments() );
        if( reply.ok && reply.data ) setSegments( reply.data.records );
    }

    // runtime operand choices — the account's segments back a "belongs to segment" rule; a custom CHOICE /
    // MULTI_CHOICE field offers its defined options
    function choicesFor( field : Segment.FilterField ) : Array<SelectInput.Choice> | undefined
    {
        if( field.id === Segment.FieldId.SEGMENT ) return segmentChoices;
        if( field.isCustom )
        {
            const def : Contact.CustomFieldDef | undefined = fieldDefs.find( ( entry : Contact.CustomFieldDef ) : boolean => entry.uid === field.id );
            if( def?.choices && def.choices.length > 0 )
                return def.choices.map( ( option : Contact.ChoiceOption ) : SelectInput.Choice => ( { value: option.key, label: option.label } ) );
        }
        return undefined;
    }

    // the effective top-N limit — only when sorted AND the limit toggle is on with a positive value
    function effectiveLimit() : number | undefined
    {
        return sorted && limitOn && limit > 0 ? limit : undefined;
    }
    // toggling the limit off clears it (0 = no cap)
    function onLimitToggle( on : boolean ) : void
    {
        setLimitOn( on );
        if( !on ) setLimit( 0 );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    function onYes() : Promise<boolean>
    {
        // Custom segments carry the built query; import-sourced kinds seed an empty "all" group (members arrive
        // from the CSV import). Sort + limit are optional (limit only meaningful with a sort).
        const query : Segment.Query = importKind ? { op: Segment.GroupOp.ALL, conditions: [] } : root;
        const sort : Segment.Sort | undefined = sorted ? { field: sortField, direction: sortDir } : undefined;
        return props.onSave( { name: name.trim(), query, isExclusion, tags, sort, limit: effectiveLimit() } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // preview the current filter against the account's contacts (count + a sample), honoring sort + limit
    async function runPreview() : Promise<void>
    {
        setBusy( true );
        const sort : Segment.Sort | undefined = sorted ? { field: sortField, direction: sortDir } : undefined;
        const reply : RestfulService.Reply<PostSegmentPreview.Response> = await appmodel.server.fetch( new PostSegmentPreview( { query: root, sort, limit: effectiveLimit(), sample: 12 } ) );
        setBusy( false );
        setPreview( reply.ok && reply.data ? reply.data : null );
    }

    // a display row for one previewed contact
    function previewRow( contact : Contact.Entity ) : TableInput.Row
    {
        const fullName : string = `${ contact.firstName ?? "" } ${ contact.lastName ?? "" }`.trim();
        const phone : string = contact.phones[ 0 ]?.value ?? "";
        const created : string = appmodel.ui.locale.dateTime( DateUtils.parse( contact.audit.createdAt ), LocaleService.Format.MEDIUM );
        const tagList : string = ( contact.tags ?? [] ).map( ( tag : Contact.Tag ) : string => tag.value ).join( ", " );
        return { id: contact.id, name: fullName || "—", phone: phone || "—", created, tags: tagList };
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    return  <DialogWindow id="segment-edit"
                          title={ editing ? "Edit group" : "Create group" }
                          yesLabel={ editing ? "Save" : "Create group" }
                          cancelLabel={"Cancel"}
                          minWidth="lg"
                          ready={ name.trim() !== "" && !( !editing && importKind ) }
                          onYes={ onYes }
                          onClose={ props.onClose }>
                <Stack spacing={ 2 } sx={{ p: 2 }}>
                    <Stack direction="row" spacing={ 1 }>
                        <TextInput id="segment-name" label={"Group name"} value={ name } onChange={ setName } maxLength={ 120 } fullWidth
                                   placeHolder={"e.g. Spanish-speaking VIPs"} />
                        { !editing &&
                            <Box sx={{ width: 260 }}><SelectInput id="segment-kind" label={"How are members chosen?"} value={ kind } choices={ kindChoices } onChange={ setKind } sx={{ width: "100%" }} /></Box> }
                    </Stack>

                    { !editing && importKind &&
                        <Typography variant="caption" sx={{ color: "warning.main" }}>{"Importing members needs the contact CSV import — coming soon. Create a Custom group for now."}</Typography> }

                    {/* the visual query builder (custom kind only) */}
                    { !importKind &&
                        <SegmentGroupEditor group={ root } fields={ fields } choicesFor={ choicesFor } isRoot onChange={ setRoot } /> }

                    {/* result ordering — its own section (not a filter rule): sort (optional) + top-N limit */}
                    { !importKind && <Divider /> }
                    { !importKind &&
                        <Stack direction="row" spacing={ 1 } sx={{ alignItems: "center", flexWrap: "wrap", rowGap: 1 }}>
                            <Typography variant="overline" sx={{ color: "text.secondary", whiteSpace: "nowrap" }}>{"Order & limit"}</Typography>
                            <Box sx={{ width: 240 }}><SelectInput id="segment-sort" label={"Sort by"} value={ sortField } choices={ sortChoices } onChange={ setSortField } sx={{ width: "100%" }} /></Box>
                            {/* one toggle: arrow up = ascending, arrow down = descending (click flips it) */}
                            { sorted &&
                                <ButtonIcon id="segment-sort-dir"
                                            label={ sortDir === Segment.SortDir.ASC ? "Ascending (click for descending)" : "Descending (click for ascending)" }
                                            size="small"
                                            icon={ sortDir === Segment.SortDir.ASC ? <ArrowUpwardOutlinedIcon fontSize="small" /> : <ArrowDownwardOutlinedIcon fontSize="small" /> }
                                            onClick={ () => setSortDir( sortDir === Segment.SortDir.ASC ? Segment.SortDir.DESC : Segment.SortDir.ASC ) } /> }
                            { sorted &&
                                <CheckboxInput id="segment-limit-on" label={"Limit results"} value={ limitOn } onChange={ onLimitToggle } /> }
                            { sorted && limitOn &&
                                <Box sx={{ width: 160 }}><NumericInput id="segment-limit" label={"Top N"} value={ limit } onChange={ setLimit } /></Box> }
                        </Stack> }

                    <Divider />
                    <Stack direction="row" spacing={ 1 } sx={{ alignItems: "center" }}>
                        <CheckboxInput id="segment-exclusion" label={"Exclusion group (contacts to leave OUT)"} value={ isExclusion } onChange={ setExclude } />
                        <Box sx={{ flexGrow: 1 }} />
                        <Box sx={{ width: 320 }}><TagInput id="segment-tags" label={"Tags"} value={ tags } choices={ [] } onChange={ setTags } /></Box>
                    </Stack>

                    {/* preview — evaluate the filter against the account's contacts (count + sample) */}
                    { !importKind &&
                        <Stack spacing={ 1 }>
                            <Button variant="outlined" onClick={ () => void runPreview() } disabled={ previewBusy }>{ previewBusy ? "Previewing…" : "Preview" }</Button>
                            { preview &&
                                <Typography variant="h6" sx={{ color: "text.primary" }}>
                                    { preview.count !== preview.total ? `${ appmodel.ui.locale.number( preview.total, 0 ) } match — sending to ${ appmodel.ui.locale.number( preview.count, 0 ) } (limit)` : `${ appmodel.ui.locale.number( preview.total, 0 ) } contacts match` }
                                </Typography> }
                            { preview &&
                                <Typography variant="caption" sx={{ color: "text.secondary" }}>{ `Showing the first ${ preview.records.length }.` }</Typography> }
                            { preview && preview.unsupportedFields &&
                                <Typography variant="caption" sx={{ color: "warning.main" }}>{ `Not evaluated in preview yet: ${ preview.unsupportedFields.join( ", " ) }.` }</Typography> }
                            { preview && preview.records.length > 0 &&
                                <TableInput id="segment-preview" columns={ PREVIEW_COLUMNS } data={ preview.records.map( previewRow ) } selectable={ TableInput.Selectable.NONE } /> }
                            { preview && preview.records.length === 0 &&
                                <Typography variant="caption" sx={{ color: "text.secondary", textAlign: "center", py: 2 }}>{"No contacts match these rules."}</Typography> }
                        </Stack> }
                </Stack>
            </DialogWindow>;
}

export namespace SegmentEditDialog
{
    /** How a new segment sources its members. */
    export enum Kind { CUSTOM = "custom", IMPORT = "import", IMPORT_OPT_IN = "import_opt_in" }

    /** The editable subset the dialog collects. Sort + limit are optional (limit only applies with a sort). */
    export interface Draft { name : string; query : Segment.Query; isExclusion : boolean; tags : Array<string>; sort? : Segment.Sort; limit? : number; }

    export interface Props
    {
        segment? : Segment.Entity;                    // present → edit; absent → create
        onSave   : ( draft : Draft ) => Promise<boolean>;
        onClose  : () => void;
    }
}

export default SegmentEditDialog;
