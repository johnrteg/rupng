import AppModel from "@model/AppModel";
//
import React from 'react';
import { JSX } from "react";

import { Box, Card, CardContent, CardHeader, Chip, CircularProgress, Divider, Stack, Typography } from "@mui/material";
import DownloadOutlinedIcon from '@mui/icons-material/DownloadOutlined';
import DeleteOutlineOutlinedIcon from '@mui/icons-material/DeleteOutlineOutlined';
import RefreshOutlinedIcon from '@mui/icons-material/RefreshOutlined';

import { Access } from '@repo/system';
import { Media, GetArchives, GetArchiveUrl, DeleteArchive } from '@repo/api';
import { RestfulService } from '@repo/endpoint';

import AuthPage   from '@widgets/app/AuthPage';
import SnackAlert from '@widgets/core/SnackAlert';
import ButtonIcon from '@widgets/core/ButtonIcon';
import ErrorChip  from '@widgets/core/ErrorChip';
import AccountChange from '@widgets/app/AccountChange';
import LocaleService from '@model/service/LocaleService';
import BrowserUtils from '@utils/BrowserUtils';

//
// Media : Downloads — the "Downloads" view (media-20): zip archives prepared by the media-archive Job. Each
// shows its status (pending / processing / complete / error, with the error reason) and, when complete, a
// download link; expired archives are swept server-side (TTL). Poll while any archive is still working.
//
export function MediaDownloads( props : MediaDownloads.Props ) : JSX.Element
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
    // status chip (spinner while working, error reason in a tooltip on failure)
    function statusChip( archive : Media.Archive ) : JSX.Element
    {
        if( archive.status === Media.ArchiveStatus.COMPLETE )
            return <Chip size="small" color="success" variant="outlined" label={"Complete"} />;

        if( archive.status === Media.ArchiveStatus.ERROR )
            return <ErrorChip message={ archive.error ?? "failed" } />;

        return <Stack direction="row" spacing={ 1 } sx={{ alignItems: "center" }}><CircularProgress size={ 14 } /><Typography variant="caption" sx={{ color: "text.secondary" }}>{ archive.status === Media.ArchiveStatus.PENDING ? "Pending" : "Processing" }</Typography></Stack>;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    function row( archive : Media.Archive ) : JSX.Element
    {
        const complete : boolean = archive.status === Media.ArchiveStatus.COMPLETE;
        return  <Stack key={ archive.archiveId } direction="row" spacing={ 2 } sx={{ alignItems: "center", py: 1, borderBottom: "1px solid", borderColor: "divider" }}>
                    <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                        <Typography variant="body2" noWrap>{ archive.name }</Typography>
                        <Typography variant="caption" sx={{ color: "text.secondary" }}>
                            { appmodel.ui.locale.dateTime( new Date( archive.createdAt ), LocaleService.Format.SHORT ) }{ archive.size ? ` · ${ appmodel.ui.locale.bytes( archive.size ) }` : "" }{ archive.expiresAt ? ` · expires ${ appmodel.ui.locale.date( new Date( archive.expiresAt ), LocaleService.Format.SHORT ) }` : "" }
                        </Typography>
                    </Box>
                    { statusChip( archive ) }
                    <ButtonIcon id={ `dl-${ archive.archiveId }` } icon={ <DownloadOutlinedIcon fontSize="small" /> } label={"Download"} size="small" disabled={ !complete } onClick={ () => void download( archive ) } />
                    <ButtonIcon id={ `rm-${ archive.archiveId }` } icon={ <DeleteOutlineOutlinedIcon fontSize="small" /> } label={"Delete"} size="small" onClick={ () => void remove( archive ) } />
                </Stack>;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    return  <AuthPage minAccess={ Access.AccountRole.USER } title={ "Media : Downloads" }>
                <Box sx={{ p: 2, mx: "auto" }}>
                    <Card variant="outlined">
                        <CardHeader title={"Downloads"}
                                    subheader={"Prepared zip archives of your media — ready to download."}
                                    action={ <ButtonIcon id="dl-refresh"
                                    icon={ <RefreshOutlinedIcon /> }
                                    label={"Reload"}
                                    onClick={ () => void load() } /> } />
                        <Divider />
                        <CardContent>
                            { loading && <Stack direction="row" spacing={ 1 } sx={{ alignItems: "center", p: 2 }}><CircularProgress size={ 18 } /></Stack> }
                            { !loading && archives.length === 0 &&
                                <Typography variant="body2" sx={{ color: "text.secondary", p: 2 }}>{"No downloads yet. Use “Download all (zip)” on a library item to prepare one."}</Typography> }
                            { !loading && archives.map( row ) }
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
