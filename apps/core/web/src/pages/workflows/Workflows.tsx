import AppModel from "@model/AppModel";
//
import React from 'react';
import { JSX } from "react";

import { Box, Button, Card, CardContent, CardHeader, CircularProgress, Divider, Stack, Typography } from "@mui/material";
import RefreshOutlinedIcon from '@mui/icons-material/RefreshOutlined';
import AddOutlinedIcon     from '@mui/icons-material/AddOutlined';
import EditOutlinedIcon    from '@mui/icons-material/EditOutlined';
import ArchiveOutlinedIcon from '@mui/icons-material/ArchiveOutlined';
import PauseOutlinedIcon   from '@mui/icons-material/PauseOutlined';
import PlayArrowOutlinedIcon from '@mui/icons-material/PlayArrowOutlined';

import { Access } from '@repo/system';
import { Workflow, Paging } from '@repo/api';
import { RestfulService } from '@repo/endpoint';

import AuthPage      from '@widgets/app/AuthPage';
import TextInput     from '@widgets/core/TextInput';
import ButtonIcon     from '@widgets/core/ButtonIcon';
import ChipStatus     from '@widgets/core/ChipStatus';
import TableInput     from '@widgets/core/TableInput';
import Colors         from '@utils/Colors';
import SnackAlert     from '@widgets/core/SnackAlert';
import AlertPrompt    from '@widgets/core/AlertPrompt';
import DialogWindow   from '@widgets/core/DialogWindow';
import AccountChange  from '@widgets/app/AccountChange';

import WorkflowService from '@model/service/WorkflowService';
import { WorkflowEditor } from '@widgets/workflow/editor/WorkflowEditor';

// TableInput row-action ids
enum WorkflowAction { EDIT = "edit", ARCHIVE = "archive", PAUSE = "pause", RESUME = "resume" }

//
// Workflows — the account's automation list. Lists definitions (name + status + version), creates one
// via a small name dialog then jumps straight into the node-graph editor, and archives/pauses/resumes.
// Editing a definition swaps this page's body for the full-viewport WorkflowEditor — NOT a separate
// route (mirrors SvgProjectEditor's "hosted inline by the list page" convention) — since a node-graph
// canvas needs the whole viewport, not a dialog.
//
export function Workflows( _props : Workflows.Props ) : JSX.Element
{
    const appmodel : AppModel = AppModel.instance();
    const service : WorkflowService = React.useMemo( () : WorkflowService => new WorkflowService( appmodel ), [ appmodel ] );

    const [definitions,setDefinitions] = React.useState< Array<Workflow.Entity> >( [] );
    const [page,setPage]           = React.useState< Paging.Page | null >( null );
    const [loading,setLoading]     = React.useState< boolean >( true );
    const [search,setSearch]       = React.useState< string >( "" );
    const [createOpen,setCreateOpen] = React.useState< boolean >( false );
    const [createName,setCreateName] = React.useState< string >( "" );
    const [editingId,setEditingId] = React.useState< string | null >( null );
    const [archive,setArchive]     = React.useState< Workflow.Entity | null >( null );
    const [snack,setSnack]         = React.useState< { message : string; severity : SnackAlert.Severity } | null >( null );

    ////////////////////////////////////////////////////////////////////////////////////////////
    React.useEffect( () => { void load(); }, [] );

    ////////////////////////////////////////////////////////////////////////////////////////////
    async function load( token? : string ) : Promise<void>
    {
        setLoading( true );
        const reply : RestfulService.Reply<Paging.Result<Workflow.Entity>> = await service.list( { start: token } );
        if( reply.ok && reply.data ) { setDefinitions( reply.data.records ); setPage( reply.data.page ); }
        setLoading( false );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    function openCreate() : void { setCreateName( "" ); setCreateOpen( true ); }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // create the draft, then jump straight into its editor
    async function onCreate() : Promise<boolean>
    {
        if( !createName.trim() ) return false;
        const reply : RestfulService.Reply<Workflow.Entity> = await service.create( { name: createName.trim() } );
        if( !reply.ok || !reply.data ) { setSnack( { message: "Could not create the workflow. Please try again.", severity: "error" } ); return false; }
        void load();
        setEditingId( reply.data.id );
        return true;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    async function onArchiveAction( action : AlertPrompt.Action ) : Promise<void>
    {
        if( archive && action === AlertPrompt.Action.YES )
        {
            const reply : RestfulService.Reply<{ id : string; archived : boolean }> = await service.archive( archive.id );
            if( reply.ok ) { setSnack( { message: "Workflow archived.", severity: "success" } ); void load(); }
            else setSnack( { message: "Could not archive the workflow. Please try again.", severity: "error" } );
        }
        setArchive( null );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    async function onPauseResume( definition : Workflow.Entity ) : Promise<void>
    {
        const reply : RestfulService.Reply<Workflow.Entity> = definition.status === Workflow.Status.PUBLISHED
            ? await service.pause( definition.id )
            : await service.resume( definition.id );
        if( reply.ok ) { setSnack( { message: definition.status === Workflow.Status.PUBLISHED ? "Workflow paused." : "Workflow resumed.", severity: "success" } ); void load(); }
        else setSnack( { message: "Could not update the workflow. Please try again.", severity: "error" } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    function onWorkflowAction( action : string, row : TableInput.Row ) : void
    {
        const definition : Workflow.Entity | undefined = definitions.find( ( entry : Workflow.Entity ) => entry.id === row.id );
        if( !definition ) return;
        if( action === WorkflowAction.EDIT )    setEditingId( definition.id );
        if( action === WorkflowAction.ARCHIVE ) setArchive( definition );
        if( action === WorkflowAction.PAUSE || action === WorkflowAction.RESUME ) void onPauseResume( definition );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    function statusRenderer( _col : TableInput.Column, row : TableInput.Row ) : JSX.Element
    {
        return <ChipStatus size="small" label={ String( row.status ) } status={ statusColor( row.status as Workflow.Status ) } />;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    function statusColor( status : Workflow.Status ) : Colors.Status
    {
        switch( status )
        {
            case Workflow.Status.PUBLISHED: return Colors.Status.ACTIVE;
            case Workflow.Status.PAUSED:    return Colors.Status.PENDING;
            case Workflow.Status.ARCHIVED:  return Colors.Status.INACTIVE;
            default:                        return Colors.Status.INWORK;   // draft
        }
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    function actionsFor( definition : Workflow.Entity ) : Array<string>
    {
        if( definition.status === Workflow.Status.ARCHIVED ) return [];
        const toggle : string = definition.status === Workflow.Status.PUBLISHED ? WorkflowAction.PAUSE : WorkflowAction.RESUME;
        const canToggle : boolean = definition.status === Workflow.Status.PUBLISHED || definition.status === Workflow.Status.PAUSED;
        return canToggle ? [ WorkflowAction.EDIT, toggle, WorkflowAction.ARCHIVE ] : [ WorkflowAction.EDIT, WorkflowAction.ARCHIVE ];
    }

    // if a definition is being edited, the whole page becomes the full-viewport node-graph editor
    if( editingId )
        return <WorkflowEditor workflowId={ editingId } onBack={ () : void => { setEditingId( null ); void load(); } } />;

    // ── TableInput config ──────────────────────────────────────────────────────────────────────
    const workflowActions : Array<TableInput.Action> =
    [
        { id: WorkflowAction.EDIT,    label: "Edit",   icon: <EditOutlinedIcon fontSize="small" /> },
        { id: WorkflowAction.PAUSE,   label: "Pause",  icon: <PauseOutlinedIcon fontSize="small" /> },
        { id: WorkflowAction.RESUME,  label: "Resume", icon: <PlayArrowOutlinedIcon fontSize="small" /> },
        { id: WorkflowAction.ARCHIVE, label: "Archive", icon: <ArchiveOutlinedIcon fontSize="small" /> },
    ];

    const workflowColumns : Array<TableInput.Column> =
    [
        { field: "name",      label: "Name",      type: TableInput.ColumnType.STRING },
        { field: "status",    label: "Status",    type: TableInput.ColumnType.CUSTOM, renderer: statusRenderer },
        { field: "version",   label: "Version",   type: TableInput.ColumnType.NUMBER },
        { field: "updated",   label: "Updated",   type: TableInput.ColumnType.DATETIME, options: { style: "medium" } },
        { field: "actions",   label: "",          type: TableInput.ColumnType.ACTION },
    ];

    const visible : Array<Workflow.Entity> = definitions.filter( ( definition : Workflow.Entity ) : boolean =>
        definition.name.toLowerCase().includes( search.trim().toLowerCase() ) );

    const workflowRows : Array<TableInput.Row> = visible.map( ( definition : Workflow.Entity ) => ( {
        id:      definition.id,
        name:    definition.name,
        status:  definition.status,
        version: definition.version,
        updated: definition.updatedAt ? new Date( definition.updatedAt ) : undefined,
        actions: actionsFor( definition ),
    } ) );

    ////////////////////////////////////////////////////////////////////////////////////////////
    return  <AuthPage minAccess={ Access.AccountRole.USER } title={"Workflows"}>
                <Box sx={{ p: 2, mx: "auto" }}>
                    <Card variant="outlined">
                        <CardHeader title={"Workflows"}
                                    subheader={"Account-defined automation — branching, durable journeys triggered by events."}
                                    action={
                                        <Stack direction="row" spacing={ 1 } sx={{ mt: 1, mr: 1, alignItems: "center" }}>
                                            <TextInput id="workflows-search" label={"Search"} value={ search } onChange={ setSearch } sx={{ width: 220 }} placeHolder={"name"} />
                                            <ButtonIcon id="workflows-refresh" label={"Refresh"} size="small" disabled={ loading } icon={ <RefreshOutlinedIcon fontSize="small" /> } onClick={ () => void load() } />
                                            <Button variant="contained" size="small" startIcon={ <AddOutlinedIcon /> } onClick={ openCreate }>{"New workflow"}</Button>
                                        </Stack>
                                    } />
                        <Divider />
                        <CardContent>
                            { loading &&
                                <Stack direction="row" spacing={ 1 } sx={{ alignItems: "center", p: 1 }}><CircularProgress size={ 18 } /><Typography variant="body2" sx={{ color: "text.secondary" }}>{"Loading…"}</Typography></Stack> }
                            { !loading && definitions.length === 0 &&
                                <Typography variant="body2" sx={{ color: "text.secondary", textAlign: "center", pt: 3, pb: 1 }}>{"No workflows yet. Create one to start automating a journey."}</Typography> }
                            { !loading && definitions.length > 0 && visible.length === 0 &&
                                <Typography variant="body2" sx={{ color: "text.secondary", textAlign: "center", pt: 3, pb: 1 }}>{"No workflows match your search."}</Typography> }
                            { !loading && visible.length > 0 &&
                                <TableInput id="workflows-list"
                                            columns={ workflowColumns }
                                            data={ workflowRows }
                                            actions={ workflowActions }
                                            onAction={ onWorkflowAction }
                                            selectable={ TableInput.Selectable.NONE }
                                            paging={ TableInput.Paging.TOKEN }
                                            total={ page?.total }
                                            next={ page?.next }
                                            onNext={ ( token : string ) : void => void load( token ) } /> }
                        </CardContent>
                    </Card>
                </Box>

                <AccountChange onClear={ () => setDefinitions( [] ) } onRefresh={ () => void load() } />

                { createOpen &&
                    <DialogWindow id="workflows-create" title={"New workflow"} yesLabel={"Create"} cancelLabel={"Cancel"}
                                  ready={ createName.trim() !== "" } onYes={ onCreate } onClose={ () => setCreateOpen( false ) }>
                        <Stack spacing={ 2 } sx={{ p: 2 }}>
                            <TextInput id="workflows-create-name" label={"Name"} value={ createName } onChange={ setCreateName } fullWidth focus />
                        </Stack>
                    </DialogWindow> }

                { archive &&
                    <AlertPrompt id="workflows-archive"
                                 type={ AlertPrompt.Type.WARNING }
                                 title={"Archive workflow"}
                                 message={ `Archive "${ archive.name }"? It becomes read-only; in-flight instances keep running, and it can't be reactivated.` }
                                 yesText={"Archive"}
                                 cancelText={"Cancel"}
                                 onAction={ onArchiveAction } /> }

                { snack && <SnackAlert message={ snack.message } severity={ snack.severity } onClose={ () => setSnack( null ) } /> }
            </AuthPage>;
}

export namespace Workflows
{
    export interface Props
    {
    }
}

export default Workflows;
