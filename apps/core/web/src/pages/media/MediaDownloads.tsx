import AppModel from "@model/AppModel";
//
import React from 'react';
import { JSX } from "react";

import { Box, Card, CardContent, CardHeader, CircularProgress, Divider, Stack, Typography } from "@mui/material";
import DownloadOutlinedIcon from '@mui/icons-material/DownloadOutlined';
import DeleteOutlineOutlinedIcon from '@mui/icons-material/DeleteOutlineOutlined';
import RefreshOutlinedIcon from '@mui/icons-material/RefreshOutlined';

import { Access } from '@repo/system';
import { Media, GetArchives, GetArchiveUrl, DeleteArchive } from '@repo/api';
import { RestfulService } from '@repo/endpoint';

import AuthPage   from '@widgets/app/AuthPage';
import SnackAlert from '@widgets/core/SnackAlert';
import ButtonIcon from '@widgets/core/ButtonIcon';
import ChipStatus from '@widgets/core/ChipStatus';
import ErrorChip  from '@widgets/core/ErrorChip';
import TableInput from '@widgets/core/TableInput';
import Colors     from '@utils/Colors';
import AccountChange from '@widgets/app/AccountChange';
import BrowserUtils from '@utils/BrowserUtils';
import HelpButton from "../../widgets/core/HelpButton";

// TableInput row-action ids
enum DownloadAction { DOWNLOAD = "download", DELETE = "delete" }

//
// Media : Downloads — the "Downloads" view (media-20): zip archives prepared by the media-archive Job. Each row
// shows its status (pending / processing / complete / error, with the error reason) and, when complete, a
// download action; expired archives are swept server-side (TTL). Polls while any archive is still working.
//
export function MediaDownloads( _props : MediaDownloads.Props ) : JSX.Element
{
    const appmodel : AppModel = AppModel.instance();

    const [archives,setArchives] = React.useState< Array<Media.Archive> >( [] );
    const [loading,setLoading]   = React.useState< boolean >( true );
    const [snack,setSnack]       = React.useState< { message : string; severity : SnackAlert.Severity } | null >( null );

    ////////////////////////////////////////////////////////////////////////////////////////////
    async function load() : Promise<void>
    {
        const reply : RestfulService.Reply<GetArchives.Response> = await appmodel.server.fetch( new GetArchives() );
        if( reply.ok && reply.data ) setArchives( reply.data.archives );
        setLoading( false );
    }
    React.useEffect( () => void load(), [] );

    ////////////////////////////////////////////////////////////////////////////////////////////
    // poll while any archive is still pending/processing so the row flips to downloadable when ready
    React.useEffect( () =>
    {
        const working : boolean = archives.some( ( archive : Media.Archive ) : boolean => archive.status === Media.ArchiveStatus.PENDING || archive.status === Media.ArchiveStatus.PROCESSING );
        if( !working ) return;
        const timer : ReturnType<typeof setTimeout> = setTimeout( () : void => void load(), 3000 );
        return () : void => clearTimeout( timer );
    }, [ archives ] );

    ////////////////////////////////////////////////////////////////////////////////////////////
    // resolve the presigned URL then trigger a real file download (blob-based; a cross-origin S3 URL ignores
    // the anchor `download` attribute)
    async function download( archive : Media.Archive ) : Promise<void>
    {
        const reply : RestfulService.Reply<GetArchiveUrl.Response> = await appmodel.server.fetch( new GetArchiveUrl( archive.archiveId ) );
        if( !reply.ok || !reply.data ) { setSnack( { message: "Download not ready", severity: "error" } ); return; }
        await BrowserUtils.download( reply.data.url, archive.name );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    async function remove( archive : Media.Archive ) : Promise<void>
    {
        const reply : RestfulService.Reply<DeleteArchive.Response> = await appmodel.server.fetch( new DeleteArchive( archive.archiveId ) );
        if( reply.ok )
            setArchives( ( prior : Array<Media.Archive> ) : Array<Media.Archive> => prior.filter( ( entry : Media.Archive ) : boolean => entry.archiveId !== archive.archiveId ) );
        else
            setSnack( { message: "Could not delete", severity: "error" } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // a row action → download (complete only) or delete
    function onAction( action : string, row : TableInput.Row ) : void
    {
        const archive : Media.Archive | undefined = archives.find( ( entry : Media.Archive ) : boolean => entry.archiveId === row.id );
        if( !archive ) return;
        if( action === DownloadAction.DOWNLOAD ) void download( archive );
        if( action === DownloadAction.DELETE )   void remove( archive );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // map an archive status to a central color status (error is rendered separately, with its reason)
    function statusColor( status : Media.ArchiveStatus ) : Colors.Status
    {
        if( status === Media.ArchiveStatus.COMPLETE )   return Colors.Status.ACTIVE;
        if( status === Media.ArchiveStatus.PROCESSING ) return Colors.Status.INWORK;
        return Colors.Status.PENDING;
    }

    // status cell — a status chip; on failure an ErrorChip carrying the reason
    function statusRenderer( _col : TableInput.Column, row : TableInput.Row ) : JSX.Element
    {
        const status : Media.ArchiveStatus = row.status as Media.ArchiveStatus;
        if( status === Media.ArchiveStatus.ERROR ) return <ErrorChip message={ ( row.error as string ) ?? "failed" } />;
        return <ChipStatus size="small" label={ String( status ) } status={ statusColor( status ) } />;
    }

    // ── TableInput config ──────────────────────────────────────────────────────────────────────
    const columns : Array<TableInput.Column> =
    [
        { field: "name",    label: "Name",    type: TableInput.ColumnType.STRING },
        { field: "size",    label: "Size",    type: TableInput.ColumnType.STRING },
        { field: "created", label: "Created", type: TableInput.ColumnType.DATETIME, options: { style: "short" } },
        { field: "expires", label: "Expires", type: TableInput.ColumnType.DATETIME, options: { style: "short" } },
        { field: "status",  label: "Status",  type: TableInput.ColumnType.CUSTOM, renderer: statusRenderer },
        { field: "actions", label: "",        type: TableInput.ColumnType.ACTION },
    ];

    const actions : Array<TableInput.Action> =
    [
        { id: DownloadAction.DOWNLOAD, label: "Download", icon: <DownloadOutlinedIcon fontSize="small" /> },
        { id: DownloadAction.DELETE,   label: "Delete",   icon: <DeleteOutlineOutlinedIcon fontSize="small" /> },
    ];

    const rows : Array<TableInput.Row> = archives.map( ( archive : Media.Archive ) => ( {
        id:      archive.archiveId,
        name:    archive.name,
        size:    archive.size !== undefined ? appmodel.ui.locale.bytes( archive.size ) : "—",
        created: archive.createdAt ? new Date( archive.createdAt ) : undefined,
        expires: archive.expiresAt ? new Date( archive.expiresAt ) : undefined,
        status:  archive.status,
        error:   archive.error,
        // download only when the zip is COMPLETE; delete always available
        actions: archive.status === Media.ArchiveStatus.COMPLETE ? [ DownloadAction.DOWNLOAD, DownloadAction.DELETE ] : [ DownloadAction.DELETE ],
    } ) );

    ////////////////////////////////////////////////////////////////////////////////////////////
    return  <AuthPage minAccess={ Access.AccountRole.USER } title={ "Media : Downloads" }>
                <Box sx={{ p: 2, mx: "auto" }}>
                    <Card variant="outlined">
                        <CardHeader title={"Downloads"}
                                    subheader={"Prepared zip archives of your media"}
                                    action={ <Stack direction="row">
                                        <ButtonIcon id="dl-refresh" icon={ <RefreshOutlinedIcon /> }
                                                    label={"Reload"} disabled={ loading } onClick={ () => void load() } />
                                        <HelpButton value={"5454594759475"} />
                                    </Stack> } />
                        <Divider />
                        <CardContent>
                            { loading &&
                                <Stack direction="row" spacing={ 1 } sx={{ alignItems: "center", p: 2 }}><CircularProgress size={ 18 } /><Typography variant="body2" sx={{ color: "text.secondary" }}>{"Loading…"}</Typography></Stack> }
                            { !loading && archives.length === 0 &&
                                <Typography variant="body2" sx={{ color: "text.secondary", p: 2 }}>{"No downloads yet. Use “Download all (zip)” on a library item to prepare one."}</Typography> }
                            { !loading && archives.length > 0 &&
                                <TableInput id="media-downloads" columns={ columns } data={ rows } actions={ actions } onAction={ onAction } selectable={ TableInput.Selectable.NONE } /> }
                        </CardContent>
                    </Card>
                </Box>

                <AccountChange onClear={ () => setArchives( [] ) } onRefresh={ () => void load() } />
                { snack && <SnackAlert message={ snack.message } severity={ snack.severity } onClose={ () => setSnack( null ) } /> }
            </AuthPage>;
}

export namespace MediaDownloads
{
    export interface Props {}
}

export default MediaDownloads;
// eof
