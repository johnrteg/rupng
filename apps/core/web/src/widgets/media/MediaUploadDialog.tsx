import AppModel from "@model/AppModel";
//
import React from 'react';
import { JSX } from "react";

import { Box, Chip, CircularProgress, LinearProgress, Stack, Typography } from "@mui/material";
import CheckCircleOutlineOutlinedIcon from '@mui/icons-material/CheckCircleOutlineOutlined';
import ErrorOutlineOutlinedIcon       from '@mui/icons-material/ErrorOutlineOutlined';

import { Media, PostUpload, PostUploadComplete, PatchAsset } from '@repo/api';
import { RestfulService } from '@repo/endpoint';

import DialogWindow  from '@widgets/core/DialogWindow';
import FileDropZone  from '@widgets/core/FileDropZone';
import TagInput      from '@widgets/core/TagInput';

// per-kind default accepted extensions (no dot) — used when the caller doesn't pass an explicit `accept` list
const ACCEPT_BY_KIND : Record<Media.Kind, Array<string>> =
{
    [ Media.Kind.IMAGE ]:    [ "png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "heic" ],
    [ Media.Kind.VIDEO ]:    [ "mp4", "mov", "webm", "m4v", "avi" ],
    [ Media.Kind.AUDIO ]:    [ "mp3", "wav", "m4a", "aac", "ogg" ],
    [ Media.Kind.DOCUMENT ]: [ "pdf" ],   // PDFs only
    [ Media.Kind.OTHER ]:    [],
};

// minimal extension → mime fallback for when the browser doesn't set File.type
const MIME_BY_EXT : Record<string, string> =
{
    png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp",
    svg: "image/svg+xml", bmp: "image/bmp", heic: "image/heic",
    mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm", m4v: "video/x-m4v", avi: "video/x-msvideo",
    mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4", aac: "audio/aac", ogg: "audio/ogg",
    pdf: "application/pdf", txt: "text/plain", csv: "text/csv",
};

////////////////////////////////////////////////////////////////////////////////////////////
//
// MediaUploadDialog — the ONE reusable media-upload flow, used from anywhere we accept media (the media
// library, an avatar picker, campaign asset pickers, …). It owns the whole handshake so callers never repeat
// it: PostUpload (presign) → direct-to-S3 PUT of the bytes → PostUploadComplete (kick off scan → process),
// with an optional pre-tag (PatchAsset) when the caller supplies `tags`. The caller only says WHAT it's
// uploading (scope/kind/accept) and gets back the completed Media.Asset(s) via `onUploaded`.
//
export function MediaUploadDialog( props : MediaUploadDialog.Props ) : JSX.Element
{
    const appmodel : AppModel = AppModel.instance();

    const [items,setItems] = React.useState< Array<MediaUploadDialog.Item> >( [] );
    const [tags,setTags]   = React.useState< Array<string> >( props.tags ?? [] );
    const [busy,setBusy]   = React.useState< boolean >( false );

    const accept   : Array<string> = props.accept ?? ( props.kind ? ACCEPT_BY_KIND[ props.kind ] : [] );
    const maxFiles : number        = props.maxFiles ?? 10;
    // max upload size: the caller's override, else the platform limit from the bootstrap config
    // (appmodel.config.uploadLimits.maxFileBytes) so every uploader honors the same server-driven cap.
    const maxSize  : number        = props.maxSize ?? appmodel.config.uploadLimits.maxFileBytes;

    ////////////////////////////////////////////////////////////////////////////////////////////
    // the drop-zone selection → seed the pending list (dropping the previous, un-uploaded selection)
    function onFiles( files : Array<File> ) : void
    {
        setItems( files.map( ( file : File ) : MediaUploadDialog.Item => ( { file, status: "pending" } ) ) );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // the mime for a file — the browser's type, else guessed from the extension, else a safe generic
    function mimeOf( file : File ) : string
    {
        if( file.type ) return file.type;
        const ext : string = ( file.name.split( "." ).pop() ?? "" ).toLowerCase();
        return MIME_BY_EXT[ ext ] ?? "application/octet-stream";
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // update one pending item's status in place (by its index in the list)
    function mark( index : number, patch : Partial<MediaUploadDialog.Item> ) : void
    {
        setItems( ( prev : Array<MediaUploadDialog.Item> ) => prev.map( ( item, i ) => i === index ? { ...item, ...patch } : item ) );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // the full per-file handshake: presign → PUT bytes to S3 → complete → (optional) pre-tag
    async function uploadOne( file : File, index : number ) : Promise<Media.Asset | null>
    {
        mark( index, { status: "uploading", error: undefined } );

        const begin : RestfulService.Reply<PostUpload.Response> = await appmodel.server.fetch( new PostUpload( { filename: file.name, mime: mimeOf( file ), size: file.size, scope: props.scope, scopeId: props.scopeId, kind: props.kind, tier: props.tier } ) );
        if( !begin.ok || !begin.data ) { mark( index, { status: "error", error: RestfulService.error( begin, "Could not start the upload" ) } ); return null; }

        // bytes go DIRECT to S3 (never through the API) via the pre-signed URL (presigned uploads are always PUT)
        const put : RestfulService.Reply = await appmodel.server.put( begin.data.upload.url, null, file, { "Content-Type": mimeOf( file ) } );
        if( !put.ok ) { mark( index, { status: "error", error: RestfulService.error( put, "Upload failed" ) } ); return null; }

        const done : RestfulService.Reply<PostUploadComplete.Response> = await appmodel.server.fetch( new PostUploadComplete( begin.data.asset.guid ) );
        if( !done.ok || !done.data ) { mark( index, { status: "error", error: RestfulService.error( done, "Could not finalize the upload" ) } ); return null; }

        // optional pre-tag (PostUpload can't carry tags) — best-effort, doesn't fail the upload
        let asset : Media.Asset = done.data.asset;
        if( tags.length > 0 )
        {
            const tagged : RestfulService.Reply<PatchAsset.Response> = await appmodel.server.fetch( new PatchAsset( asset.guid, { tags } ) );
            if( tagged.ok && tagged.data ) asset = tagged.data.asset;
        }

        mark( index, { status: "done" } );
        return asset;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // the dialog's Upload action — run every not-yet-done file, hand back the successes, close only when
    // they all succeeded (so the user can retry the failures without losing the succeeded ones).
    async function onUpload() : Promise<boolean>
    {
        if( items.length === 0 ) return false;
        setBusy( true );
        const uploaded : Array<Media.Asset> = [];
        for( let index = 0; index < items.length; index++ )
        {
            if( items[ index ].status === "done" ) continue;
            const asset : Media.Asset | null = await uploadOne( items[ index ].file, index );
            if( asset ) uploaded.push( asset );
        }
        setBusy( false );
        if( uploaded.length > 0 ) props.onUploaded( uploaded );
        return uploaded.length === items.length;   // all succeeded → close
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // a status chip for one file row
    function statusChip( item : MediaUploadDialog.Item ) : JSX.Element
    {
        if( item.status === "uploading" ) return <CircularProgress size={ 16 } />;
        if( item.status === "done" )      return <CheckCircleOutlineOutlinedIcon color="success" fontSize="small" />;
        if( item.status === "error" )     return <Chip size="small" color="error" variant="outlined" icon={ <ErrorOutlineOutlinedIcon /> } label={ item.error ?? "Failed" } />;
        return <Chip size="small" variant="outlined" label={"Ready"} />;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    const anyPending : boolean = items.some( ( item ) => item.status === "pending" || item.status === "error" );

    return  <DialogWindow id="media-upload"
                          title={ props.title ?? "Upload media" }
                          yesLabel={"Upload"}
                          cancelLabel={"Close"}
                          minWidth="sm"
                          ready={ items.length > 0 && anyPending && !busy }
                          onYes={ onUpload }
                          onClose={ props.onClose }>
                <Stack spacing={ 2 } sx={{ p: 2 }}>

                    <FileDropZone title={"Upload"}
                                  maxFiles={ maxFiles }
                                  allowedExtensions={ accept }
                                  maxSize={ maxSize }
                                  disabled={ busy }
                                  onChange={ onFiles } />

                    { props.showTags &&
                        <TagInput id="media-upload-tags" label={"Tags (applied to all)"} value={ tags } choices={ [] } disabled={ busy } onChange={ setTags } /> }

                    { items.length > 0 &&
                        <Stack spacing={ 1 }>
                            { busy && <LinearProgress /> }
                            { items.map( ( item, index ) =>
                                <Box key={ `${ item.file.name }-${ index }` } sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                                    <Typography variant="body2" sx={{ flexGrow: 1 }} noWrap>{ item.file.name }</Typography>
                                    <Typography variant="caption" sx={{ color: "text.secondary" }}>{ appmodel.ui.locale.bytes( item.file.size ) }</Typography>
                                    { statusChip( item ) }
                                </Box>
                            ) }
                        </Stack>
                    }

                </Stack>
            </DialogWindow>;
}

export namespace MediaUploadDialog
{
    /** One selected file and its progress through the upload handshake. */
    export interface Item
    {
        file    : File;
        status  : "pending" | "uploading" | "done" | "error";
        error?  : string;
    }

    export interface Props
    {
        title?      : string;                                   // dialog title (default "Upload media")
        scope       : Media.Scope;                              // ACCOUNT (library) | USER (avatar)
        scopeId?    : string;                                   // userId for a USER/avatar upload
        kind?       : Media.Kind;                               // hint/restrict; also narrows the default accept list
        tier?       : Media.Tier;                               // default tier for the uploads
        accept?     : Array<string>;                            // allowed extensions (no dot); default derived from `kind`
        maxFiles?   : number;                                   // default 10
        maxSize?    : number;                                   // bytes; defaults to bootstrap uploadLimits.maxFileBytes (service also enforces)
        showTags?   : boolean;                                  // show a tag editor applied to every upload
        tags?       : Array<string>;                            // initial / pre-applied tags
        onUploaded  : ( assets : Array<Media.Asset> ) => void;  // the completed asset(s)
        onClose     : () => void;
    }
}

export default MediaUploadDialog;
// eof
