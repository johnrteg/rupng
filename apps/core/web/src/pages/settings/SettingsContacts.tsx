import AppModel from "@model/AppModel";
//
import React from 'react';
import { JSX } from "react";

import { Box, Button, Card, CardContent, CardHeader, Chip, CircularProgress, Divider, IconButton, Stack, Tooltip, Typography } from "@mui/material";
import RefreshOutlinedIcon from '@mui/icons-material/RefreshOutlined';
import AddOutlinedIcon     from '@mui/icons-material/AddOutlined';
import EditOutlinedIcon    from '@mui/icons-material/EditOutlined';
import ArchiveOutlinedIcon from '@mui/icons-material/ArchiveOutlined';
import DeleteOutlineOutlinedIcon from '@mui/icons-material/DeleteOutlineOutlined';
import ContentCopyOutlinedIcon from '@mui/icons-material/ContentCopyOutlined';

import { Access } from '@repo/system';
import { Contact, GetContactFields, PostContactField, PatchContactField, DeleteContactField, ImportMap, GetImportMaps, PostImportMapCopy, DeleteImportMap } from '@repo/api';
import { RestfulService } from '@repo/endpoint';

import AuthPage     from '@widgets/app/AuthPage';
import ButtonIcon   from '@widgets/core/ButtonIcon';
import TableInput   from '@widgets/core/TableInput';
import SnackAlert   from '@widgets/core/SnackAlert';
import AlertPrompt  from '@widgets/core/AlertPrompt';
import AccountChange from '@widgets/app/AccountChange';
import CustomFieldDialog from '@pages/settings/contacts/CustomFieldDialog';
import ImportMapDialog from '@pages/settings/contacts/ImportMapDialog';

// TableInput row-action ids
enum FieldAction { EDIT = "edit", ARCHIVE = "archive", DELETE = "delete" }
enum MapAction { EDIT = "edit", COPY = "copy", DELETE = "delete" }

//
// Settings : Contacts — manage the account's custom contact-field definitions (label · type · group · order).
// Create / edit / archive (never removed). ACCOUNT-gated. This is the "defined in settings" home for custom
// fields; the contact profile renders values against these defs. (Import data maps also live here — later.)
//
export function SettingsContacts( _props : SettingsContacts.Props ) : JSX.Element
{
    const appmodel : AppModel = AppModel.instance();
    const editable : boolean = Access.isAllowed( appmodel.auth.role(), Access.AccountRole.ACCOUNT );

    const [fields,setFields]     = React.useState< Array<Contact.CustomFieldDef> >( [] );
    const [loading,setLoading]   = React.useState< boolean >( true );
    const [editOpen,setEditOpen] = React.useState< boolean >( false );
    const [editTarget,setEditTarget] = React.useState< Contact.CustomFieldDef | null >( null );
    const [archive,setArchive]   = React.useState< Contact.CustomFieldDef | null >( null );
    const [remove,setRemove]     = React.useState< Contact.CustomFieldDef | null >( null );   // pending hard-delete → confirm
    const [snack,setSnack]       = React.useState< { message : string; severity : SnackAlert.Severity } | null >( null );

    // import maps — the account's own maps + platform SYSTEM maps (read-only, copyable)
    const [maps,setMaps]         = React.useState< Array<ImportMap.Entity> >( [] );
    const [mapsLoading,setMapsLoading] = React.useState< boolean >( true );
    const [removeMap,setRemoveMap] = React.useState< ImportMap.Entity | null >( null );
    const [mapEditOpen,setMapEditOpen] = React.useState< boolean >( false );
    const [mapEditTarget,setMapEditTarget] = React.useState< ImportMap.Entity | null >( null );   // null while open = create

    ////////////////////////////////////////////////////////////////////////////////////////////
    React.useEffect( () => { if( editable ) { void load(); void loadMaps(); } else { setLoading( false ); setMapsLoading( false ); } }, [] );

    // load the account's + platform SYSTEM import maps (one call; both scopes)
    async function loadMaps() : Promise<void>
    {
        setMapsLoading( true );
        const reply : RestfulService.Reply<GetImportMaps.Response> = await appmodel.server.fetch( new GetImportMaps() );
        if( reply.ok && reply.data ) setMaps( reply.data.records );
        setMapsLoading( false );
    }

    // COPY a SYSTEM (or any) map into the account (editable clone) · DELETE an account map
    function onMapAction( action : string, row : TableInput.Row ) : void
    {
        const map : ImportMap.Entity | undefined = maps.find( ( entry : ImportMap.Entity ) : boolean => entry.id === row.id );
        if( map === undefined ) return;
        if( action === MapAction.EDIT ) { setMapEditTarget( map ); setMapEditOpen( true ); }
        else if( action === MapAction.COPY ) void copyMap( map );
        else if( action === MapAction.DELETE ) setRemoveMap( map );
    }
    // create a new account map (the editor: name + source columns → contact fields + converters)
    function openCreateMap() : void { setMapEditTarget( null ); setMapEditOpen( true ); }
    function onMapSaved() : void { setMapEditOpen( false ); setSnack( { message: "Import map saved.", severity: "success" } ); void loadMaps(); }
    async function copyMap( map : ImportMap.Entity ) : Promise<void>
    {
        const reply : RestfulService.Reply<PostImportMapCopy.Response> = await appmodel.server.fetch( new PostImportMapCopy( map.id ) );
        if( reply.ok ) { setSnack( { message: `Copied "${ map.name }" to your account.`, severity: "success" } ); void loadMaps(); }
        else setSnack( { message: "Could not copy the map.", severity: "error" } );
    }
    async function onRemoveMapAction( action : AlertPrompt.Action ) : Promise<void>
    {
        const map : ImportMap.Entity | null = removeMap;
        setRemoveMap( null );
        if( action !== AlertPrompt.Action.YES || map === null ) return;
        const reply : RestfulService.Reply<DeleteImportMap.Response> = await appmodel.server.fetch( new DeleteImportMap( map.id ) );
        if( reply.ok ) { setSnack( { message: `Deleted "${ map.name }".`, severity: "success" } ); void loadMaps(); }
        else setSnack( { message: "Could not delete the map.", severity: "error" } );
    }

    // the Scope cell — a chip distinguishing platform SYSTEM maps from the account's own
    function mapScopeRenderer( _col : TableInput.Column, row : TableInput.Row ) : JSX.Element
    { return <Chip size="small" variant="outlined" color={ row.scope === ImportMap.Scope.SYSTEM ? "info" : "default" } label={ row.scope === ImportMap.Scope.SYSTEM ? "System" : "Account" } />; }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // load the account's custom-field definitions
    async function load() : Promise<void>
    {
        setLoading( true );
        const reply : RestfulService.Reply<GetContactFields.Response> = await appmodel.server.fetch( new GetContactFields() );
        if( reply.ok && reply.data ) setFields( reply.data.records );
        setLoading( false );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    function openCreate() : void { setEditTarget( null ); setEditOpen( true ); }
    function openEdit( field : Contact.CustomFieldDef ) : void { setEditTarget( field ); setEditOpen( true ); }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // save the dialog — PATCH when editing, else POST; reload + snack on success
    async function onSave( draft : CustomFieldDialog.Draft ) : Promise<boolean>
    {
        const reply : RestfulService.Reply<PostContactField.Response> = editTarget
            ? await appmodel.server.fetch( new PatchContactField( editTarget.uid, draft ) )
            : await appmodel.server.fetch( new PostContactField( draft ) );
        if( reply.ok && reply.data )
        {
            setEditOpen( false );
            setSnack( { message: editTarget ? "Field saved." : "Field added.", severity: "success" } );
            void load();
            return true;
        }
        setSnack( { message: "Could not save the field. Please try again.", severity: "error" } );
        return false;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // the archive confirm's action — soft archive via a status PATCH (always allowed; values retained)
    async function onArchiveAction( action : AlertPrompt.Action ) : Promise<void>
    {
        if( archive && action === AlertPrompt.Action.YES )
        {
            const reply : RestfulService.Reply<PatchContactField.Response> = await appmodel.server.fetch( new PatchContactField( archive.uid, { status: Contact.CustomFieldStatus.ARCHIVED } ) );
            if( reply.ok ) { setSnack( { message: "Field archived.", severity: "success" } ); void load(); }
            else setSnack( { message: "Could not archive the field. Please try again.", severity: "error" } );
        }
        setArchive( null );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // the delete confirm's action — HARD delete, only if unused; a 409 means it's in use (archive instead)
    async function onDeleteAction( action : AlertPrompt.Action ) : Promise<void>
    {
        if( remove && action === AlertPrompt.Action.YES )
        {
            const reply : RestfulService.Reply<DeleteContactField.Response> = await appmodel.server.fetch( new DeleteContactField( remove.uid ) );
            if( reply.ok ) setSnack( { message: "Field deleted.", severity: "success" } );
            else setSnack( { message: RestfulService.error( reply, "Could not delete the field." ), severity: "warning" } );   // surfaces the "in use — archive instead" 409
            void load();
        }
        setRemove( null );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    function onFieldAction( action : string, row : TableInput.Row ) : void
    {
        const field : Contact.CustomFieldDef | undefined = fields.find( ( def : Contact.CustomFieldDef ) => def.uid === row.id );
        if( !field ) return;
        if( action === FieldAction.EDIT )    openEdit( field );
        if( action === FieldAction.ARCHIVE ) setArchive( field );
        if( action === FieldAction.DELETE )  setRemove( field );
    }

    // ── TableInput config ──────────────────────────────────────────────────────────────────────
    const fieldActions : Array<TableInput.Action> =
    [
        { id: FieldAction.EDIT,    label: "Edit",    icon: <EditOutlinedIcon fontSize="small" /> },
        { id: FieldAction.ARCHIVE, label: "Archive", icon: <ArchiveOutlinedIcon fontSize="small" /> },
        { id: FieldAction.DELETE,  label: "Delete",  icon: <DeleteOutlineOutlinedIcon fontSize="small" /> },
    ];

    const fieldColumns : Array<TableInput.Column> =
    [
        { field: "label",  label: "Label",  type: TableInput.ColumnType.STRING },
        { field: "type",   label: "Type",   type: TableInput.ColumnType.STRING },
        { field: "group",  label: "Group",  type: TableInput.ColumnType.STRING },
        { field: "order",  label: "Order",  type: TableInput.ColumnType.NUMBER },
        { field: "req",    label: "Required", type: TableInput.ColumnType.BOOLEAN },
        { field: "actions", label: "",      type: TableInput.ColumnType.ACTION },
    ];

    const fieldRows : Array<TableInput.Row> = fields.map( ( field : Contact.CustomFieldDef ) => ( {
        id:      field.uid,
        label:   field.label,
        type:    field.type,
        group:   field.group ?? "—",
        order:   field.order ?? 0,
        req:     field.required === true,
        actions: [ FieldAction.EDIT, FieldAction.ARCHIVE, FieldAction.DELETE ],
    } ) );

    // ── import-map table config ─────────────────────────────────────────────────────────────────
    const mapActions : Array<TableInput.Action> =
    [
        { id: MapAction.EDIT,   label: "Edit",            icon: <EditOutlinedIcon fontSize="small" /> },
        { id: MapAction.COPY,   label: "Copy to account", icon: <ContentCopyOutlinedIcon fontSize="small" /> },
        { id: MapAction.DELETE, label: "Delete",          icon: <DeleteOutlineOutlinedIcon fontSize="small" /> },
    ];
    const mapColumns : Array<TableInput.Column> =
    [
        { field: "name",   label: "Name",   type: TableInput.ColumnType.STRING },
        { field: "scope",  label: "Scope",  type: TableInput.ColumnType.CUSTOM, renderer: mapScopeRenderer },
        { field: "format", label: "Format", type: TableInput.ColumnType.STRING },
        { field: "fields", label: "Fields", type: TableInput.ColumnType.NUMBER },
        { field: "actions", label: "",      type: TableInput.ColumnType.ACTION },
    ];
    const mapRows : Array<TableInput.Row> = maps.map( ( map : ImportMap.Entity ) => ( {
        id:      map.id,
        name:    map.name,
        scope:   String( map.scope ),
        format:  String( map.sourceFormat ).toUpperCase(),
        fields:  map.mappings?.length ?? 0,
        // SYSTEM maps are read-only to the account (copy only); the account's own maps can be edited + deleted
        actions: map.scope === ImportMap.Scope.SYSTEM ? [ MapAction.COPY ] : [ MapAction.EDIT, MapAction.COPY, MapAction.DELETE ],
    } ) );

    ////////////////////////////////////////////////////////////////////////////////////////////
    return  <AuthPage minAccess={ Access.AccountRole.ACCOUNT } title={"Settings : Contacts"}>
                <Box sx={{ p: 2, mx: "auto" }}>
                    <Card variant="outlined">
                        <CardHeader title={"Custom contact fields"}
                                    subheader={"Extra fields on every contact — grouped + ordered in the profile. Fields can't be removed, only archived."}
                                    action={
                                        <Stack direction="row" spacing={ 1 } sx={{ mt: 1, mr: 1 }}>
                                            <ButtonIcon id="fields-refresh" label={"Refresh"} size="small" disabled={ loading } icon={ <RefreshOutlinedIcon fontSize="small" /> } onClick={ () => void load() } />
                                            <Button variant="contained" size="small" startIcon={ <AddOutlinedIcon /> } onClick={ openCreate }>{"Add field"}</Button>
                                        </Stack>
                                    } />
                        <Divider />
                        <CardContent>
                            { !editable &&
                                <Typography variant="body2" sx={{ color: "text.secondary" }}>{"Only account admins can manage custom fields."}</Typography> }
                            { editable && loading &&
                                <Stack direction="row" spacing={ 1 } sx={{ alignItems: "center", p: 1 }}><CircularProgress size={ 18 } /><Typography variant="body2" sx={{ color: "text.secondary" }}>{"Loading…"}</Typography></Stack> }
                            { editable && !loading && fields.length === 0 &&
                                <Typography variant="body2" sx={{ color: "text.secondary", textAlign: "center", pt: 3, pb: 1 }}>{"No custom fields yet. Add one to capture account-specific data on contacts."}</Typography> }
                            { editable && !loading && fields.length > 0 &&
                                <TableInput id="custom-fields" columns={ fieldColumns } data={ fieldRows } actions={ fieldActions } onAction={ onFieldAction } selectable={ TableInput.Selectable.NONE } /> }
                        </CardContent>
                    </Card>

                    {/* ── Import maps — reusable column→field mappings; SYSTEM maps are platform-provided (copyable) ── */}
                    <Card variant="outlined" sx={{ mt: 2 }}>
                        <CardHeader title={"Import maps"}
                                    subheader={"Reusable column→field mappings for imports. Platform System maps are read-only — copy one to your account to customize it."}
                                    action={
                                        <Stack direction="row" spacing={ 1 } sx={{ mt: 1, mr: 1 }}>
                                            <ButtonIcon id="maps-refresh" label={"Refresh"} size="small" disabled={ mapsLoading } icon={ <RefreshOutlinedIcon fontSize="small" /> } onClick={ () => void loadMaps() } />
                                            <Button variant="contained" size="small" startIcon={ <AddOutlinedIcon /> } onClick={ openCreateMap }>{"New map"}</Button>
                                        </Stack>
                                    } />
                        <Divider />
                        <CardContent>
                            { !editable &&
                                <Typography variant="body2" sx={{ color: "text.secondary" }}>{"Only account admins can manage import maps."}</Typography> }
                            { editable && mapsLoading &&
                                <Stack direction="row" spacing={ 1 } sx={{ alignItems: "center", p: 1 }}><CircularProgress size={ 18 } /><Typography variant="body2" sx={{ color: "text.secondary" }}>{"Loading…"}</Typography></Stack> }
                            { editable && !mapsLoading && maps.length === 0 &&
                                <Typography variant="body2" sx={{ color: "text.secondary", textAlign: "center", pt: 3, pb: 1 }}>{"No import maps yet."}</Typography> }
                            { editable && !mapsLoading && maps.length > 0 &&
                                <TableInput id="import-maps" columns={ mapColumns } data={ mapRows } actions={ mapActions } onAction={ onMapAction } selectable={ TableInput.Selectable.NONE } /> }
                        </CardContent>
                    </Card>
                </Box>

                <AccountChange onClear={ () => { setFields( [] ); setMaps( [] ); } } onRefresh={ () => { if( Access.isAllowed( appmodel.auth.role(), Access.AccountRole.ACCOUNT ) ) { void load(); void loadMaps(); } } } />

                { editOpen &&
                    <CustomFieldDialog field={ editTarget ?? undefined }
                                       groups={ Array.from( new Set( fields.map( ( def : Contact.CustomFieldDef ) : string => def.group ?? "" ).filter( ( group : string ) : boolean => group !== "" ) ) ) }
                                       onSave={ onSave } onClose={ () => setEditOpen( false ) } /> }

                { archive &&
                    <AlertPrompt id="custom-field-archive"
                                 type={ AlertPrompt.Type.WARNING }
                                 title={"Archive field"}
                                 message={ `Archive "${ archive.label }"? It's hidden from the editor but existing values are kept and can be restored.` }
                                 yesText={"Archive"}
                                 cancelText={"Cancel"}
                                 onAction={ onArchiveAction } /> }

                { remove &&
                    <AlertPrompt id="custom-field-delete"
                                 type={ AlertPrompt.Type.WARNING }
                                 title={"Delete field"}
                                 message={ `Delete "${ remove.label }"? Only allowed if no contact uses it (otherwise archive it). It's recoverable by an admin until it's purged.` }
                                 yesText={"Delete"}
                                 yesColor={"error"}
                                 cancelText={"Cancel"}
                                 onAction={ onDeleteAction } /> }

                { mapEditOpen &&
                    <ImportMapDialog map={ mapEditTarget ?? undefined } customFields={ fields } onSaved={ onMapSaved } onClose={ () => setMapEditOpen( false ) } /> }

                { removeMap &&
                    <AlertPrompt id="import-map-delete"
                                 type={ AlertPrompt.Type.WARNING }
                                 title={"Delete import map"}
                                 message={ `Delete "${ removeMap.name }"? It's soft-deleted (recoverable until purged); past import jobs that referenced it keep working.` }
                                 yesText={"Delete"}
                                 yesColor={"error"}
                                 cancelText={"Cancel"}
                                 onAction={ onRemoveMapAction } /> }

                { snack && <SnackAlert message={ snack.message } severity={ snack.severity } onClose={ () => setSnack( null ) } /> }
            </AuthPage>;
}

export namespace SettingsContacts
{
    export interface Props
    {
    }
}

export default SettingsContacts;
