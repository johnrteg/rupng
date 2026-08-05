import AppModel from "@model/AppModel";
//
import React from 'react';
import { JSX } from "react";

import { Box, Card, CardContent, CardHeader, CircularProgress, Divider, Link, Stack, Typography } from "@mui/material";
import DownloadOutlinedIcon from '@mui/icons-material/DownloadOutlined';
import DeleteOutlineOutlinedIcon from '@mui/icons-material/DeleteOutlineOutlined';
import RefreshOutlinedIcon from '@mui/icons-material/RefreshOutlined';
import OpenInNewOutlinedIcon from '@mui/icons-material/OpenInNewOutlined';

import { Access } from '@repo/system';
import { Media, GetArchives, GetArchiveUrl, DeleteArchive, GetSvgRenderJob } from '@repo/api';
import { RestfulService } from '@repo/endpoint';

import AuthPage    from '@widgets/app/AuthPage';
import SnackAlert  from '@widgets/core/SnackAlert';
import AlertPrompt from '@widgets/core/AlertPrompt';
import ButtonIcon  from '@widgets/core/ButtonIcon';
import ChipStatus  from '@widgets/core/ChipStatus';
import ErrorChip   from '@widgets/core/ErrorChip';
import TableInput  from '@widgets/core/TableInput';
import Colors     from '@utils/Colors';
import AccountChange from '@widgets/app/AccountChange';
import BrowserUtils from '@utils/BrowserUtils';
import HelpButton from "../../widgets/core/HelpButton";

// LocalStorage key for SVG render jobs started in the design editor (shared with SvgDesignEditor)
const RENDER_JOBS_KEY : string = "svg-render-jobs";

// TableInput row-action ids
enum DownloadAction { DOWNLOAD = "download", DELETE = "delete" }

/** A render job record stored in localStorage by the design editor. */
interface StoredRenderJob
{
    readonly jobId       : string;
    readonly projectId  ?: string;   // optional — absent in jobs stored before this field was added
    readonly projectName?: string;   // optional — absent in jobs stored before this field was added
    readonly format      : string;
    readonly startedAt   : string;   // ISO date string
}

/** A design export job with its polled status — lives in component state. */
interface DesignExport
{
    readonly jobId       : string;
    readonly projectId  ?: string;
    readonly projectName : string;   // display name; falls back to "Design" for old stored jobs
    readonly format      : string;
    readonly startedAt   : string;
    readonly status      : GetSvgRenderJob.RenderStatus;
    readonly url         : string | null;
    readonly error       : string | null;
}

//
// Media : Downloads — the "Downloads" view (media-20): zip archives prepared by the media-archive Job. Each row
// shows its status (pending / processing / complete / error, with the error reason) and, when complete, a
// download action; expired archives are swept server-side (TTL). Polls while any archive is still working.
//
export function MediaDownloads( _props : MediaDownloads.Props ) : JSX.Element
{
    const appmodel : AppModel = AppModel.instance();

    const [ archives, setArchives ]             = React.useState<Array<Media.Archive>>( [] );
    const [ loading, setLoading ]               = React.useState<boolean>( true );
    const [ snack, setSnack ]                   = React.useState<{ message : string; severity : SnackAlert.Severity } | null>( null );
    const [ designExports, setDesignExports ]   = React.useState<Array<DesignExport>>( [] );
    const [ dismissTarget, setDismissTarget ]   = React.useState<DesignExport | null>( null );   // pending "Dismiss" → confirm

    ////////////////////////////////////////////////////////////////////////////////////////////
    async function load() : Promise<void>
    {
        const reply : RestfulService.Reply<GetArchives.Response> = await appmodel.server.fetch( new GetArchives() );
        if( reply.ok && reply.data ) setArchives( reply.data.archives );
        setLoading( false );
    }

    // load design exports from localStorage and immediately poll their current status
    async function loadDesignExports() : Promise<void>
    {
        const stored : Array<StoredRenderJob> = JSON.parse( localStorage.getItem( RENDER_JOBS_KEY ) ?? "[]" );
        if( stored.length === 0 ) return;
        const polled : Array<DesignExport> = await Promise.all(
            stored.map( async ( job : StoredRenderJob ) : Promise<DesignExport> =>
            {
                const projectName : string = job.projectName ?? "Design";
                const reply : RestfulService.Reply<GetSvgRenderJob.Response> = await appmodel.server.fetch( new GetSvgRenderJob( job.jobId ) );
                if( !reply.ok || !reply.data )
                {
                    return { jobId: job.jobId, projectId: job.projectId, projectName, format: job.format, startedAt: job.startedAt, status: GetSvgRenderJob.RenderStatus.PENDING, url: null, error: null };
                }
                return { jobId: job.jobId, projectId: job.projectId, projectName, format: job.format, startedAt: job.startedAt, status: reply.data.status, url: reply.data.outputUrl, error: reply.data.error };
            } )
        );
        setDesignExports( polled );
    }

    function componentLoaded() : void
    {
        void load();
        void loadDesignExports();
    }
    React.useEffect( componentLoaded, [] );

    ////////////////////////////////////////////////////////////////////////////////////////////
    // poll while any archive is still pending/processing so the row flips to downloadable when ready
    React.useEffect( () =>
    {
        const working : boolean = archives.some( ( archive : Media.Archive ) : boolean => archive.status === Media.ArchiveStatus.PENDING || archive.status === Media.ArchiveStatus.PROCESSING );
        if( !working ) return;
        const timer : ReturnType<typeof setTimeout> = setTimeout( () : void => void load(), 3000 );
        return () : void => clearTimeout( timer );
    }, [ archives ] );

    // poll while any design export is still in-flight — re-fetch status for all stored jobs
    function onDesignExportsChanged() : ( () => void ) | void
    {
        const working : boolean = designExports.some(
            ( job : DesignExport ) : boolean =>
                job.status === GetSvgRenderJob.RenderStatus.PENDING || job.status === GetSvgRenderJob.RenderStatus.PROCESSING
        );
        if( !working ) return undefined;
        const timer : ReturnType<typeof setTimeout> = setTimeout( () : void => void loadDesignExports(), 3000 );
        return () : void => clearTimeout( timer );
    }
    React.useEffect( onDesignExportsChanged, [ designExports ] );

    ////////////////////////////////////////////////////////////////////////////////////////////
    // re-fetch the presigned URL for a completed design export and trigger a browser download
    async function downloadDesignExport( jobId : string, projectName : string, format : string ) : Promise<void>
    {
        const reply : RestfulService.Reply<GetSvgRenderJob.Response> = await appmodel.server.fetch( new GetSvgRenderJob( jobId ) );
        if( !reply.ok || !reply.data || !reply.data.outputUrl )
        {
            setSnack( { message: "Export file is not ready.", severity: "error" } );
            return;
        }
        const filename : string = `${ projectName }.${ format }`;
        await BrowserUtils.download( reply.data.outputUrl, filename );
    }

    // remove a design export from localStorage and state
    function dismissDesignExport( jobId : string ) : void
    {
        const stored : Array<StoredRenderJob> = JSON.parse( localStorage.getItem( RENDER_JOBS_KEY ) ?? "[]" );
        const remaining : Array<StoredRenderJob> = stored.filter( ( job : StoredRenderJob ) : boolean => job.jobId !== jobId );
        localStorage.setItem( RENDER_JOBS_KEY, JSON.stringify( remaining ) );
        setDesignExports( ( current : Array<DesignExport> ) : Array<DesignExport> => current.filter( ( job : DesignExport ) : boolean => job.jobId !== jobId ) );
    }

    // the "Dismiss" confirm's action
    async function onDismissAction( action : AlertPrompt.Action ) : Promise<void>
    {
        const target : DesignExport | null = dismissTarget;
        setDismissTarget( null );
        if( action === AlertPrompt.Action.YES && target !== null ) dismissDesignExport( target.jobId );
    }

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
    // map a render job status to a central color status
    function renderJobStatusColor( status : GetSvgRenderJob.RenderStatus ) : Colors.Status
    {
        if( status === GetSvgRenderJob.RenderStatus.DONE       ) return Colors.Status.ACTIVE;
        if( status === GetSvgRenderJob.RenderStatus.PROCESSING ) return Colors.Status.INWORK;
        if( status === GetSvgRenderJob.RenderStatus.FAILED     ) return Colors.Status.ERROR;
        return Colors.Status.PENDING;
    }

    // one row in the design exports list
    function designExportRow( job : DesignExport ) : JSX.Element
    {
        const isDone   : boolean = job.status === GetSvgRenderJob.RenderStatus.DONE;
        const isFailed : boolean = job.status === GetSvgRenderJob.RenderStatus.FAILED;
        return  <Stack key={ job.jobId } direction="row" spacing={ 1 } sx={{ alignItems: "center", py: 0.75 }}>
                    <Typography variant="body2" sx={{ textTransform: "uppercase", fontWeight: 500, minWidth: 48 }}>
                        { job.format }
                    </Typography>
                    <Stack sx={{ flexGrow: 1, minWidth: 0 }}>
                        <Link href="/media/studio" underline="hover" variant="body2" sx={{ fontWeight: 500, display: "flex", alignItems: "center", gap: 0.5, width: "fit-content" }}>
                            { job.projectName }
                            <OpenInNewOutlinedIcon sx={{ fontSize: 12 }} />
                        </Link>
                        <Typography variant="caption" sx={{ color: "text.secondary" }}>
                            { new Date( job.startedAt ).toLocaleString() }
                        </Typography>
                    </Stack>
                    { isFailed
                        ? <ErrorChip message={ job.error ?? "failed" } />
                        : <ChipStatus size="small" label={ job.status } status={ renderJobStatusColor( job.status ) } /> }
                    { isDone &&
                        <ButtonIcon id={ `design-dl-${ job.jobId }` } label={"Download"} size="small"
                                    icon={ <DownloadOutlinedIcon fontSize="small" /> }
                                    onClick={ () : void => void downloadDesignExport( job.jobId, job.projectName, job.format ) } /> }
                    <ButtonIcon id={ `design-dismiss-${ job.jobId }` } label={"Delete"} size="small"
                                icon={ <DeleteOutlineOutlinedIcon fontSize="small" /> }
                                onClick={ () : void => setDismissTarget( job ) } />
                </Stack>;
    }

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
                <Box sx={{ p: 2, mx: "auto", display: "flex", flexDirection: "column", gap: 2 }}>

                    { /* ── Design Exports ──────────────────────────────────────────────────────── */ }
                    { designExports.length > 0 &&
                        <Card variant="outlined">
                            <CardHeader title={"Design Exports"} subheader={"PDF / PNG renders started from the design editor"} />
                            <Divider />
                            <CardContent>
                                { designExports.map( ( job : DesignExport ) : JSX.Element => designExportRow( job ) ) }
                            </CardContent>
                        </Card> }

                    { /* ── Zip Archives ─────────────────────────────────────────────────────────── */ }
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

                { dismissTarget &&
                    <AlertPrompt id="design-export-dismiss"
                                 type={ AlertPrompt.Type.WARNING }
                                 title={"Delete export"}
                                 message={ `Delete "${ dismissTarget.projectName }" from this list? This only clears it here — it doesn't delete the exported file.` }
                                 yesText={"Delete"}
                                 yesColor={"error"}
                                 cancelText={"Cancel"}
                                 onAction={ onDismissAction } /> }

                { snack && <SnackAlert message={ snack.message } severity={ snack.severity } onClose={ () => setSnack( null ) } /> }
            </AuthPage>;
}

export namespace MediaDownloads
{
    export interface Props {}
}

export default MediaDownloads;
// eof
