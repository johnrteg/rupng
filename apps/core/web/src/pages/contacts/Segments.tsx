import AppModel from "@model/AppModel";
//
import React from 'react';
import { JSX } from "react";

import { Box, Card, CardContent, CardHeader, CircularProgress, Divider, Stack, Typography } from "@mui/material";
import RefreshOutlinedIcon from '@mui/icons-material/RefreshOutlined';
import AddOutlinedIcon     from '@mui/icons-material/AddOutlined';
import EditOutlinedIcon    from '@mui/icons-material/EditOutlined';
import GroupAddOutlinedIcon from '@mui/icons-material/GroupAddOutlined';
import ArchiveOutlinedIcon from '@mui/icons-material/ArchiveOutlined';
import AutorenewOutlinedIcon from '@mui/icons-material/AutorenewOutlined';
import HistoryOutlinedIcon from '@mui/icons-material/HistoryOutlined';
import ContentCopyOutlinedIcon from '@mui/icons-material/ContentCopyOutlined';
import RestartAltOutlinedIcon from '@mui/icons-material/RestartAltOutlined';

import { Access } from '@repo/system';
import { Segment, Contact, GetSegments, PostSegment, PatchSegment, DeleteSegment, PostSegmentMembers, PostSegmentRefresh, PostSegmentReset, PostSegmentCopy, Paging } from '@repo/api';
import { RestfulService } from '@repo/endpoint';

import AuthPage     from '@widgets/app/AuthPage';
import SearchInput  from '@widgets/core/SearchInput';
import ButtonIcon   from '@widgets/core/ButtonIcon';
import ChipStatus   from '@widgets/core/ChipStatus';
import TableInput   from '@widgets/core/TableInput';
import Colors       from '@utils/Colors';
import SnackAlert   from '@widgets/core/SnackAlert';
import AlertPrompt  from '@widgets/core/AlertPrompt';
import AccountChange from '@widgets/app/AccountChange';
import ButtonIconDropdown from '@widgets/core/ButtonIconDropdown';
import SegmentEditDialog from '@pages/contacts/dialogs/SegmentEditDialog';
import SegmentImportDialog from '@pages/contacts/dialogs/SegmentImportDialog';
import AddSegmentMembersDialog from '@pages/contacts/dialogs/AddSegmentMembersDialog';
import SegmentHistoryDialog from '@pages/contacts/dialogs/SegmentHistoryDialog';
import SegmentCopyDialog from '@pages/contacts/dialogs/SegmentCopyDialog';
import HelpButton from "../../widgets/core/HelpButton";

// TableInput row-action ids
enum SegmentAction { EDIT = "edit", MEMBERS = "members", REFRESH = "refresh", HISTORY = "history", COPY = "copy", RESET = "reset", ARCHIVE = "archive" }

//
// Segments — saved queries over the account's contacts (the primary targeting tool a campaign points at).
// Lists segments (name + size + kind + status) and creates one via a dialog. Reads/writes go through the
// contact service's /segments endpoints (USER-gated). First cut: no visual query builder yet.
//
export function Segments( _props : Segments.Props ) : JSX.Element
{
    const appmodel : AppModel = AppModel.instance();

    const [segments,setSegments] = React.useState< Array<Segment.Entity> >( [] );
    const [page,setPage]         = React.useState< Paging.Page | null >( null );
    const [loading,setLoading]   = React.useState< boolean >( true );
    const [search,setSearch]     = React.useState< string >( "" );
    const [editOpen,setEditOpen] = React.useState< boolean >( false );
    const [importOpen,setImportOpen] = React.useState< boolean >( false );
    const [editTarget,setEditTarget] = React.useState< Segment.Entity | null >( null );   // null while open = create
    const [membersTarget,setMembersTarget] = React.useState< Segment.Entity | null >( null );  // add-members dialog
    const [historyTarget,setHistoryTarget] = React.useState< Segment.Entity | null >( null );  // history dialog
    const [copyTarget,setCopyTarget] = React.useState< Segment.Entity | null >( null );    // copy dialog
    const [refreshTarget,setRefreshTarget] = React.useState< Segment.Entity | null >( null );  // pending refresh → confirm
    const [resetTarget,setResetTarget] = React.useState< Segment.Entity | null >( null );  // pending reset overrides → confirm
    const [archive,setArchive]   = React.useState< Segment.Entity | null >( null );        // pending archive → confirm
    const [snack,setSnack]       = React.useState< { message : string; severity : SnackAlert.Severity } | null >( null );

    ////////////////////////////////////////////////////////////////////////////////////////////
    React.useEffect( () => { void load(); }, [] );

    ////////////////////////////////////////////////////////////////////////////////////////////
    // load a page of the acting account's segments (token paging — TableInput drives next via onNext)
    async function load( token? : string ) : Promise<void>
    {
        setLoading( true );
        const reply : RestfulService.Reply<GetSegments.Response> = await appmodel.server.fetch( new GetSegments( { start: token } ) );
        if( reply.ok && reply.data ) { setSegments( reply.data.records ); setPage( reply.data.page ); }
        setLoading( false );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    function openCreate() : void { setEditTarget( null ); setEditOpen( true ); }
    function openEdit( segment : Segment.Entity ) : void { setEditTarget( segment ); setEditOpen( true ); }
    // the Create dropdown: Custom → the rule editor · Import → the import wizard
    function onCreateChoice( value : string ) : void { if( value === "import" ) setImportOpen( true ); else openCreate(); }
    function onImported() : void { setImportOpen( false ); void load(); }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // save the editor — PATCH when editing, else POST; reload + snack on success
    async function onSave( draft : SegmentEditDialog.Draft ) : Promise<boolean>
    {
        const reply : RestfulService.Reply<PostSegment.Response> = editTarget
            ? await appmodel.server.fetch( new PatchSegment( editTarget.id, { name: draft.name, query: draft.query, isExclusion: draft.isExclusion, tags: draft.tags, sort: draft.sort, limit: draft.limit } ) )
            : await appmodel.server.fetch( new PostSegment( { name: draft.name, query: draft.query, isExclusion: draft.isExclusion, tags: draft.tags, sort: draft.sort, limit: draft.limit } ) );
        if( reply.ok && reply.data )
        {
            setEditOpen( false );
            setSnack( { message: editTarget ? "Segment saved." : "Segment created.", severity: "success" } );
            void load();
            return true;
        }
        setSnack( { message: "Could not save the segment. Please try again.", severity: "error" } );
        return false;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // add contacts to a segment (from the add-members dialog); idempotent server-side (no dups)
    async function onAddMembers( contactIds : Array<string> ) : Promise<boolean>
    {
        if( !membersTarget ) return false;
        const reply : RestfulService.Reply<PostSegmentMembers.Response> = await appmodel.server.fetch( new PostSegmentMembers( membersTarget.id, { contactIds } ) );
        if( reply.ok && reply.data )
        {
            setMembersTarget( null );
            setSnack( { message: `Added ${ reply.data.added } (${ reply.data.skipped } already in the segment).`, severity: "success" } );
            void load();
            return true;
        }
        setSnack( { message: "Could not add contacts. Please try again.", severity: "error" } );
        return false;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // archive confirm action
    async function onArchiveAction( action : AlertPrompt.Action ) : Promise<void>
    {
        if( archive && action === AlertPrompt.Action.YES )
        {
            const reply : RestfulService.Reply<DeleteSegment.Response> = await appmodel.server.fetch( new DeleteSegment( archive.id ) );
            if( reply.ok ) { setSnack( { message: "Segment archived.", severity: "success" } ); void load(); }
            else setSnack( { message: "Could not archive the segment. Please try again.", severity: "error" } );
        }
        setArchive( null );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // the refresh confirm's action — re-run the materialize job (recompute QUERY membership, honoring pins)
    async function onRefreshAction( action : AlertPrompt.Action ) : Promise<void>
    {
        if( refreshTarget && action === AlertPrompt.Action.YES )
        {
            const reply : RestfulService.Reply<PostSegmentRefresh.Response> = await appmodel.server.fetch( new PostSegmentRefresh( refreshTarget.id ) );
            if( reply.ok ) { setSnack( { message: "Refresh started — membership is updating.", severity: "success" } ); void load(); }
            else setSnack( { message: "Could not start the refresh. Please try again.", severity: "error" } );
        }
        setRefreshTarget( null );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // the reset-overrides confirm's action — clear ALL manual pins (add + remove) then re-materialize
    async function onResetAction( action : AlertPrompt.Action ) : Promise<void>
    {
        if( resetTarget && action === AlertPrompt.Action.YES )
        {
            const reply : RestfulService.Reply<PostSegmentReset.Response> = await appmodel.server.fetch( new PostSegmentReset( resetTarget.id, { clearPins: true, clearExclusions: true } ) );
            if( reply.ok && reply.data ) { setSnack( { message: `Cleared ${ reply.data.cleared } manual override(s) — re-running the filter.`, severity: "success" } ); void load(); }
            else setSnack( { message: "Could not reset the overrides. Please try again.", severity: "error" } );
        }
        setResetTarget( null );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // copy a segment (from the copy dialog) with the chosen pin options
    async function onCopy( options : { name : string; copyPins : boolean; copyExclusions : boolean } ) : Promise<boolean>
    {
        if( !copyTarget ) return false;
        const reply : RestfulService.Reply<PostSegmentCopy.Response> = await appmodel.server.fetch( new PostSegmentCopy( copyTarget.id, options ) );
        if( reply.ok && reply.data )
        {
            setCopyTarget( null );
            setSnack( { message: "Segment copied.", severity: "success" } );
            void load();
            return true;
        }
        setSnack( { message: "Could not copy the segment. Please try again.", severity: "error" } );
        return false;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // a row action → edit / add-members / refresh / history / copy / reset / archive
    function onSegmentAction( action : string, row : TableInput.Row ) : void
    {
        const segment : Segment.Entity | undefined = segments.find( ( entry : Segment.Entity ) => entry.id === row.id );
        if( !segment ) return;
        if( action === SegmentAction.EDIT )    openEdit( segment );
        if( action === SegmentAction.MEMBERS ) setMembersTarget( segment );
        if( action === SegmentAction.REFRESH ) setRefreshTarget( segment );
        if( action === SegmentAction.HISTORY ) setHistoryTarget( segment );
        if( action === SegmentAction.COPY )    setCopyTarget( segment );
        if( action === SegmentAction.RESET )   setResetTarget( segment );
        if( action === SegmentAction.ARCHIVE ) setArchive( segment );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // kind cell — an exclusion segment (leaves contacts OUT) vs a normal inclusion segment
    function kindRenderer( _col : TableInput.Column, row : TableInput.Row ) : JSX.Element
    {
        const exclusion : boolean = row.isExclusion === true;
        return <ChipStatus size="small" label={ exclusion ? "Exclusion" : "Inclusion" } status={ exclusion ? Colors.Status.PENDING : Colors.Status.PRIMARY } />;
    }

    // a segment's sendable-reach count for a channel (from channelCounts; "—" until computed)
    function channelCount( segment : Segment.Entity, channel : Contact.Channel ) : string
    {
        const count : number | undefined = segment.channelCounts?.[ channel ];
        return count !== undefined ? appmodel.ui.locale.number( count, 0 ) : "—";
    }

    // map a segment's lifecycle status to a central color status
    function statusColor( status : Segment.Status ) : Colors.Status
    {
        if( status === Segment.Status.ACTIVE )     return Colors.Status.ACTIVE;
        if( status === Segment.Status.PROCESSING ) return Colors.Status.INWORK;
        if( status === Segment.Status.PENDING )    return Colors.Status.PENDING;
        if( status === Segment.Status.FAILED )     return Colors.Status.ERROR;
        return Colors.Status.INACTIVE;   // inactive | archived | deleted
    }

    // status cell — the materialization lifecycle (pending / processing / active / failed / …)
    function statusRenderer( _col : TableInput.Column, row : TableInput.Row ) : JSX.Element
    {
        const status : Segment.Status = row.status as Segment.Status;
        return <ChipStatus size="small" label={ String( status ) } status={ statusColor( status ) } />;
    }

    // ── TableInput config ──────────────────────────────────────────────────────────────────────
    const segmentColumns : Array<TableInput.Column> =
    [
        { field: "name",    label: "Name",    type: TableInput.ColumnType.STRING },
        { field: "kind",    label: "Kind",    type: TableInput.ColumnType.CUSTOM, renderer: kindRenderer },
        { field: "size",    label: "Members", type: TableInput.ColumnType.STRING },
        { field: "email",   label: "Email",   type: TableInput.ColumnType.STRING },
        { field: "sms",     label: "SMS",     type: TableInput.ColumnType.STRING },
        { field: "voice",   label: "Voice",   type: TableInput.ColumnType.STRING },
        { field: "print",   label: "Print",   type: TableInput.ColumnType.STRING },
        { field: "status",  label: "Status",  type: TableInput.ColumnType.CUSTOM, renderer: statusRenderer },
        { field: "created", label: "Created", type: TableInput.ColumnType.DATETIME, options: { style: "medium" } },
        { field: "actions", label: "",        type: TableInput.ColumnType.ACTION },
    ];

    const segmentActions : Array<TableInput.Action> =
    [
        { id: SegmentAction.EDIT,    label: "Edit",              icon: <EditOutlinedIcon fontSize="small" /> },
        { id: SegmentAction.MEMBERS, label: "Add contacts",      icon: <GroupAddOutlinedIcon fontSize="small" /> },
        { id: SegmentAction.REFRESH, label: "Refresh",           icon: <AutorenewOutlinedIcon fontSize="small" /> },
        { id: SegmentAction.HISTORY, label: "History",           icon: <HistoryOutlinedIcon fontSize="small" /> },
        { id: SegmentAction.COPY,    label: "Copy",              icon: <ContentCopyOutlinedIcon fontSize="small" /> },
        { id: SegmentAction.RESET,   label: "Reset overrides",   icon: <RestartAltOutlinedIcon fontSize="small" /> },
        { id: SegmentAction.ARCHIVE, label: "Archive",           icon: <ArchiveOutlinedIcon fontSize="small" /> },
    ];

    // rows filtered by the search box (by name, case-insensitive)
    const visible : Array<Segment.Entity> = segments.filter( ( segment : Segment.Entity ) : boolean => segment.name.toLowerCase().includes( search.trim().toLowerCase() ) );

    const segmentRows : Array<TableInput.Row> = visible.map( ( segment : Segment.Entity ) => ( {
        id:          segment.id,
        name:        segment.name,
        isExclusion: segment.isExclusion === true,
        kind:        segment.isExclusion === true,   // the CUSTOM cell renders when its field is defined
        size:        segment.size !== undefined ? appmodel.ui.locale.number( segment.size, 0 ) : "—",
        email:       channelCount( segment, Contact.Channel.EMAIL ),
        sms:         channelCount( segment, Contact.Channel.SMS ),
        voice:       channelCount( segment, Contact.Channel.VOICE ),
        print:       channelCount( segment, Contact.Channel.PRINT ),
        status:      segment.status,
        created:     segment.audit?.createdAt ? new Date( segment.audit.createdAt ) : undefined,
        actions:     [ SegmentAction.EDIT, SegmentAction.MEMBERS, SegmentAction.REFRESH, SegmentAction.HISTORY, SegmentAction.COPY, SegmentAction.RESET, SegmentAction.ARCHIVE ],
    } ) );

    ////////////////////////////////////////////////////////////////////////////////////////////
    return  <AuthPage minAccess={ Access.AccountRole.USER } title={"Contacts : Segments"}>
                <Box sx={{ p: 2, mx: "auto" }}>
                    <Card variant="outlined">
                        <CardHeader title={"Segments"}
                                    subheader={"Saved queries over your contacts — the audiences you point campaigns at."}
                                    action={
                                        <Stack direction="row" spacing={ 1 } sx={{ mt: 1, mr: 1, alignItems: "center" }}>
                                            <SearchInput id="segments-search" label={"Search name"} value={ search } onChange={ setSearch } sx={{ width: 200 }} />
                                            <ButtonIcon id="segments-refresh" label={"Refresh"} size="small" disabled={ loading } icon={ <RefreshOutlinedIcon fontSize="small" /> } onClick={ () => void load() } />
                                            <ButtonIconDropdown id="segments-create" label={"Create segment"} size="small" icon={ <AddOutlinedIcon /> }
                                                                choices={ [ { value: "custom", label: "Custom…" }, { value: "import", label: "Import…" } ] }
                                                                onChange={ onCreateChoice } />
                                            <HelpButton value={"5454594759475"} />
                                        </Stack>
                                    } />
                        <Divider />
                        <CardContent>
                            { loading &&
                                <Stack direction="row" spacing={ 1 } sx={{ alignItems: "center", p: 1 }}><CircularProgress size={ 18 } /><Typography variant="body2" sx={{ color: "text.secondary" }}>{"Loading…"}</Typography></Stack> }
                            { !loading && segments.length === 0 &&
                                <Typography variant="body2" sx={{ color: "text.secondary", textAlign: "center", pt: 3, pb: 1 }}>{"No segments yet. Create one to define a target audience."}</Typography> }
                            { !loading && segments.length > 0 && visible.length === 0 &&
                                <Typography variant="body2" sx={{ color: "text.secondary", textAlign: "center", pt: 3, pb: 1 }}>{"No segments match your search."}</Typography> }
                            { !loading && visible.length > 0 &&
                                <TableInput id="segments-list" columns={ segmentColumns } data={ segmentRows } actions={ segmentActions } onAction={ onSegmentAction } selectable={ TableInput.Selectable.NONE }
                                            paging={ TableInput.Paging.TOKEN } total={ page?.total } next={ page?.next } onNext={ ( token : string ) : void => void load( token ) } /> }
                        </CardContent>
                    </Card>
                </Box>

                <AccountChange onClear={ () => setSegments( [] ) } onRefresh={ () => void load() } />

                { editOpen &&
                    <SegmentEditDialog segment={ editTarget ?? undefined } onSave={ onSave } onClose={ () => setEditOpen( false ) } /> }

                { importOpen &&
                    <SegmentImportDialog onImported={ onImported } onClose={ () => setImportOpen( false ) } /> }

                { membersTarget &&
                    <AddSegmentMembersDialog onAdd={ onAddMembers } onClose={ () => setMembersTarget( null ) } /> }

                { historyTarget &&
                    <SegmentHistoryDialog segment={ historyTarget } onClose={ () => setHistoryTarget( null ) } /> }

                { copyTarget &&
                    <SegmentCopyDialog segment={ copyTarget } onCopy={ onCopy } onClose={ () => setCopyTarget( null ) } /> }

                { refreshTarget &&
                    <AlertPrompt id="segment-refresh-confirm"
                                 type={ AlertPrompt.Type.INFO }
                                 title={"Refresh segment"}
                                 message={ `Re-run "${ refreshTarget.name }" from its filter? Membership recomputes; your manual add/remove pins are kept.` }
                                 yesText={"Refresh"}
                                 cancelText={"Cancel"}
                                 onAction={ onRefreshAction } /> }

                { resetTarget &&
                    <AlertPrompt id="segment-reset-confirm"
                                 type={ AlertPrompt.Type.WARNING }
                                 title={"Reset manual overrides"}
                                 message={ `Clear ALL manual pins on "${ resetTarget.name }" (both added and removed contacts) and re-run the filter? This can't be undone.` }
                                 yesText={"Reset"}
                                 yesColor={"error"}
                                 cancelText={"Cancel"}
                                 onAction={ onResetAction } /> }

                { archive &&
                    <AlertPrompt id="segment-archive"
                                 type={ AlertPrompt.Type.WARNING }
                                 title={"Archive segment"}
                                 message={ `Archive "${ archive.name }"? It's hidden from active use but kept (with its membership) for audit.` }
                                 yesText={"Archive"}
                                 cancelText={"Cancel"}
                                 onAction={ onArchiveAction } /> }

                { snack && <SnackAlert message={ snack.message } severity={ snack.severity } onClose={ () => setSnack( null ) } /> }
            </AuthPage>;
}

export namespace Segments
{
    export interface Props
    {
    }
}

export default Segments;
