import AppModel from "@model/AppModel";
//
import React from 'react';
import { JSX } from "react";

import { Box, Button, Card, CardContent, CardHeader, Chip, CircularProgress, Divider, ImageList, Stack, ToggleButton, ToggleButtonGroup, Tooltip, Typography } from "@mui/material";
import RefreshOutlinedIcon        from '@mui/icons-material/RefreshOutlined';
import CloudUploadOutlinedIcon    from '@mui/icons-material/CloudUploadOutlined';
import VisibilityOutlinedIcon     from '@mui/icons-material/VisibilityOutlined';
import EditOutlinedIcon           from '@mui/icons-material/EditOutlined';
import AutoAwesomeOutlinedIcon    from '@mui/icons-material/AutoAwesomeOutlined';
import InfoOutlinedIcon           from '@mui/icons-material/InfoOutlined';
import OpenInNewOutlinedIcon      from '@mui/icons-material/OpenInNewOutlined';
import ReplayOutlinedIcon         from '@mui/icons-material/ReplayOutlined';
import PhotoCameraOutlinedIcon    from '@mui/icons-material/PhotoCameraOutlined';
import ContentCopyOutlinedIcon    from '@mui/icons-material/ContentCopyOutlined';
import DownloadOutlinedIcon       from '@mui/icons-material/DownloadOutlined';
import FolderZipOutlinedIcon      from '@mui/icons-material/FolderZipOutlined';
import CompressOutlinedIcon       from '@mui/icons-material/CompressOutlined';
import HighQualityOutlinedIcon    from '@mui/icons-material/HighQualityOutlined';
import SubtitlesOutlinedIcon      from '@mui/icons-material/SubtitlesOutlined';
import RecordVoiceOverOutlinedIcon from '@mui/icons-material/RecordVoiceOverOutlined';
import MoreVertIcon               from '@mui/icons-material/MoreVert';
import DeleteOutlineOutlinedIcon  from '@mui/icons-material/DeleteOutlineOutlined';
import ViewListOutlinedIcon       from '@mui/icons-material/ViewListOutlined';
import PhotoOutlinedIcon          from '@mui/icons-material/PhotoOutlined';
import ImageOutlinedIcon          from '@mui/icons-material/ImageOutlined';
import MovieOutlinedIcon          from '@mui/icons-material/MovieOutlined';
import AudiotrackOutlinedIcon     from '@mui/icons-material/AudiotrackOutlined';
import DescriptionOutlinedIcon    from '@mui/icons-material/DescriptionOutlined';
import InsertDriveFileOutlinedIcon from '@mui/icons-material/InsertDriveFileOutlined';

import HistoryOutlinedIcon      from '@mui/icons-material/HistoryOutlined';

import { Access } from '@repo/system';
import { Media, GetAssets, DeleteAsset, PostAssetRescan, PostAssetDuplicate, PostAssetPoster, PostAssetVariants, PostAssetTranscribe, GetMediaUrl, PostAssetArchive } from '@repo/api';
import { RestfulService } from '@repo/endpoint';
import BrowserUtils from '@utils/BrowserUtils';

import AuthPage       from '@widgets/app/AuthPage';
import TableInput     from '@widgets/core/TableInput';
import ButtonIcon     from '@widgets/core/ButtonIcon';
import SearchInput    from '@widgets/core/SearchInput';
import SelectInput    from '@widgets/core/SelectInput';
import DateInput      from '@widgets/core/DateInput';
import SnackAlert     from '@widgets/core/SnackAlert';
import AlertPrompt    from '@widgets/core/AlertPrompt';
import AccountChange  from '@widgets/app/AccountChange';
import MediaUploadDialog     from '@widgets/media/MediaUploadDialog';
import AssetEditDialog       from '@pages/media/dialogs/AssetEditDialog';
import AssetPreviewDialog    from '@pages/media/dialogs/AssetPreviewDialog';
import GenerateVariantsDialog from '@pages/media/dialogs/GenerateVariantsDialog';
import AssetInfoDialog        from '@pages/media/dialogs/AssetInfoDialog';
import PosterFrameDialog      from '@pages/media/dialogs/PosterFrameDialog';
import MediaCompressDialog     from '@pages/media/dialogs/MediaCompressDialog';
import VoiceCloneDialog        from '@pages/media/dialogs/VoiceCloneDialog';
import MediaGridItem          from '@pages/media/MediaGridItem';
import ItemVersionsDialog      from '@pages/media/dialogs/ItemVersionsDialog';
import ItemInfoDialog          from '@pages/media/dialogs/ItemInfoDialog';
import CopyAssetDialog         from '@pages/media/dialogs/CopyAssetDialog';
import CaptionEditorDialog     from '@pages/media/dialogs/CaptionEditorDialog';
import DensityDialog           from '@pages/media/dialogs/DensityDialog';

// row-action ids (referenced by symbol, not retyped literals)
enum AssetAction { PREVIEW = "preview", OPEN = "open", INFO = "info", EDIT = "edit", VARIANTS = "variants", REFRESH_VARIANTS = "refresh_variants", DENSITY = "density", POSTER = "poster", COMPRESS = "compress", TRANSCRIBE = "transcribe", RESCAN = "rescan", COPY = "copy", CLONE_VOICE = "clone_voice", DOWNLOAD = "download", DOWNLOAD_ZIP = "download_zip", DELETE = "delete", MORE = "more" }

// the four library view modes: the existing table + three image-grid sizes
type ViewMode = "table" | "small" | "medium" | "large";
// per-grid-size layout: columns across + thumbnail height (px)
const GRID_SIZE : Record<Exclude<ViewMode, "table">, { cols : number; img : number }> =
{
    small:  { cols: 6, img: 110 },
    medium: { cols: 4, img: 170 },
    large:  { cols: 3, img: 240 },
};
const GRID_BAR_HEIGHT : number = 54;   // room for the title bar below each image (name + "type · size · status")

const ALL_MEDIA : string = "all";

// media-type filter choices ("" = all)
const KIND_CHOICES : Array<SelectInput.Choice> =
[
    { value: ALL_MEDIA,        label: "(All)" },
    { value: Media.Kind.IMAGE,      label: "Images" },
    { value: Media.Kind.VIDEO,      label: "Videos" },
    { value: Media.Kind.AUDIO,      label: "Audio" },
    { value: Media.Kind.DOCUMENT,   label: "Documents" },
    { value: Media.Kind.OTHER,      label: "Other" },
];

const KIND_LABEL : Record<Media.Kind, string> =
{
    [ Media.Kind.IMAGE ]: "Image", [ Media.Kind.VIDEO ]: "Video", [ Media.Kind.AUDIO ]: "Audio",
    [ Media.Kind.DOCUMENT ]: "Document", [ Media.Kind.OTHER ]: "Other",
};

// status → chip color/label
const STATUS_STYLE : Record<string, { color : "default" | "info" | "success" | "warning" | "error"; label : string }> =
{
    [ Media.Status.UPLOADING ]:   { color: "info",    label: "Uploading" },
    [ Media.Status.SCANNING ]:    { color: "info",    label: "Scanning" },
    [ Media.Status.PROCESSING ]:  { color: "info",    label: "Processing" },
    [ Media.Status.OK ]:          { color: "success", label: "Ready" },
    [ Media.Status.FAILED ]:      { color: "error",   label: "Failed" },
    [ Media.Status.QUARANTINED ]: { color: "error",   label: "Quarantined" },
    [ Media.Status.DELETED ]:     { color: "default", label: "Deleted" },
};

//
// Tools : Media — the account media library. A filterable table of the account's assets (search by name/tag,
// filter by media type + created-date window; campaigns filter is reserved for later), with per-row preview,
// name/tag edit, on-demand variant generation, and delete. Rows expand to show their derived variants. New
// media is added through the shared MediaUploadDialog (the same uploader used elsewhere for avatars, etc.).
//
export function MediaLibrary( props : MediaLibrary.Props ) : JSX.Element
{
    const appmodel : AppModel = AppModel.instance();
    const meId : string = appmodel.auth.user?.id ?? "";

    const [assets,setAssets]   = React.useState< Array<Media.Asset> >( [] );
    const [loading,setLoading] = React.useState< boolean >( true );
    const [snack,setSnack]     = React.useState< { message : string; severity : SnackAlert.Severity } | null >( null );
    const [confirm,setConfirm] = React.useState< MediaLibrary.Confirm | null >( null );

    // filters
    const [search,setSearch]   = React.useState< string >( "" );
    const [kind,setKind]       = React.useState< string >( ALL_MEDIA );
    const [fromDate,setFrom]   = React.useState< Date | null >( null );
    const [toDate,setTo]       = React.useState< Date | null >( null );
    const [view,setView]       = React.useState< ViewMode >( "table" );

    // dialogs
    const [uploadOpen,setUploadOpen] = React.useState< boolean >( false );
    const [editAsset,setEditAsset]   = React.useState< Media.Asset | null >( null );
    const [previewAsset,setPreview]  = React.useState< Media.Asset | null >( null );
    const [variantsAsset,setVariants]= React.useState< Media.Asset | null >( null );
    const [infoAsset,setInfoAsset]   = React.useState< Media.Asset | null >( null );
    const [posterAsset,setPosterAsset] = React.useState< Media.Asset | null >( null );
    const [compressAsset,setCompressAsset] = React.useState< Media.Asset | null >( null );
    const [densityAsset,setDensityAsset]   = React.useState< Media.Asset | null >( null );
    const [voiceAsset,setVoiceAsset]       = React.useState< Media.Asset | null >( null );
    const [copyAsset,setCopyAsset]         = React.useState< Media.Asset | null >( null );
    const [versionsFor,setVersionsFor]     = React.useState< { asset : Media.Asset; item : Media.Item } | null >( null );
    const [previewItem,setPreviewItem]     = React.useState< { asset : Media.Asset; item : Media.Item } | null >( null );
    const [infoItem,setInfoItem]           = React.useState< { asset : Media.Asset; item : Media.Item } | null >( null );
    const [captionItem,setCaptionItem]     = React.useState< { asset : Media.Asset; item : Media.Item } | null >( null );

    ////////////////////////////////////////////////////////////////////////////////////////////
    React.useEffect( () => void load(), [] );

    ////////////////////////////////////////////////////////////////////////////////////////////
    async function load() : Promise<void>
    {
        setLoading( true );
        const reply : RestfulService.Reply<GetAssets.Response> = await appmodel.server.fetch( new GetAssets( { scope: Media.Scope.ACCOUNT } ) );
        if( reply.ok && reply.data ) setAssets( reply.data.assets.filter( ( asset ) => asset.status !== Media.Status.DELETED ) );
        setLoading( false );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // an envelope's ORIGINAL item (the source file) — the size/mime/meta surface for list + info
    function originalOf( asset : Media.Asset ) : Media.Item | undefined { return Media.originalItem( asset ); }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // a human label for an item — the ORIGINAL, else "usage · profile" (e.g. "Compressed · mms")
    function itemLabel( item : Media.Item ) : string
    {
        const usage : string = item.usage.charAt( 0 ).toUpperCase() + item.usage.slice( 1 );
        return item.profile ? `${ usage } · ${ item.profile }` : usage;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // pixel dimensions from an item's per-kind probed meta (image or video), else "—"
    function itemDimensions( item : Media.Item ) : string
    {
        const width  : number | undefined = item.meta?.image?.width  ?? item.meta?.video?.width;
        const height : number | undefined = item.meta?.image?.height ?? item.meta?.video?.height;
        if( !width ) return "—";
        return height ? `${ width }×${ height }` : `${ width }w`;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // client-side filtering: name/tag search, media type, and created-date window (to = end of day)
    function filtered() : Array<Media.Asset>
    {
        const term : string = search.trim().toLowerCase();
        const fromMs : number = fromDate ? new Date( fromDate.getFullYear(), fromDate.getMonth(), fromDate.getDate(), 0, 0, 0 ).getTime() : -Infinity;
        const toMs   : number = toDate   ? new Date( toDate.getFullYear(),   toDate.getMonth(),   toDate.getDate(),   23, 59, 59 ).getTime() : Infinity;
        return assets.filter( ( asset ) =>
        {
            if( kind !== ALL_MEDIA && asset.kind !== kind ) return false;
            const created : number = new Date( asset.createdAt ).getTime();
            if( created < fromMs || created > toMs ) return false;
            if( term )
            {
                const inName : boolean = asset.name.toLowerCase().includes( term );
                const inTags : boolean = ( asset.tags ?? [] ).some( ( tag ) => tag.toLowerCase().includes( term ) );
                if( !inName && !inTags ) return false;
            }
            return true;
        } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // TableInput custom renderers
    function nameRenderer( _col : TableInput.Column, row : TableInput.Row ) : JSX.Element
    {
        return  <Stack direction="row" spacing={ 1 } sx={{ alignItems: "center" }}>
                    { kindIcon( row.kind as Media.Kind ) }
                    <Typography variant="body2" noWrap>{ row.name }</Typography>
                </Stack>;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    function kindIcon( assetKind : Media.Kind ) : JSX.Element
    {
        if( assetKind === Media.Kind.IMAGE )    return <ImageOutlinedIcon fontSize="small" sx={{ color: "text.secondary" }} />;
        if( assetKind === Media.Kind.VIDEO )    return <MovieOutlinedIcon fontSize="small" sx={{ color: "text.secondary" }} />;
        if( assetKind === Media.Kind.AUDIO )    return <AudiotrackOutlinedIcon fontSize="small" sx={{ color: "text.secondary" }} />;
        //if( assetKind === Media.Kind.DOCUMENT ) return <DescriptionOutlinedIcon fontSize="small" sx={{ color: "text.secondary" }} />;
        return <InsertDriveFileOutlinedIcon fontSize="small" sx={{ color: "text.secondary" }} />;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    function statusRenderer( _col : TableInput.Column, row : TableInput.Row ) : JSX.Element
    {
        const style = STATUS_STYLE[ row.status as string ] ?? { color: "default" as const, label: String( row.status ) };
        return <Chip size="small" variant="outlined" color={ style.color } label={ style.label } />;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // expanded row → the envelope's ITEMS (media-1.2): the ORIGINAL plus every derived item, each with its
    // own metrics, per-item S3 version history/revert (media-1.4), open, and download.
    function itemsRenderer( row : TableInput.Row ) : JSX.Element
    {
        const asset : Media.Asset | undefined = assets.find( ( entry ) => entry.guid === row.id );
        const items : Array<Media.Item> = asset?.items ?? [];
        if( !asset || items.length === 0 )
            return <Typography variant="body2" sx={{ color: "text.secondary", p: 2 }}>{"No items yet."}</Typography>;
        // ORIGINAL first, then derived — the order the user reads the envelope
        const ordered : Array<Media.Item> = [ ...items ].sort( ( first, second ) =>
            ( first.usage === Media.Usage.ORIGINAL ? 0 : 1 ) - ( second.usage === Media.Usage.ORIGINAL ? 0 : 1 ) );
        return  <Box sx={{ p: 2 }}>
                    <Box sx={{ display: "grid", gridTemplateColumns: "minmax(140px,1fr) auto auto auto auto auto auto", columnGap: 2, rowGap: 0.5, alignItems: "center" }}>
                        {/* header */}
                        <Typography variant="caption" sx={{ color: "text.secondary" }}>{"Item"}</Typography>
                        <Typography variant="caption" sx={{ color: "text.secondary" }}>{"Dimensions"}</Typography>
                        <Typography variant="caption" sx={{ color: "text.secondary" }}>{"Size"}</Typography>
                        <Typography variant="caption" sx={{ color: "text.secondary" }}>{"Format"}</Typography>
                        <Typography variant="caption" sx={{ color: "text.secondary" }}>{"Version"}</Typography>
                        <Typography variant="caption" sx={{ color: "text.secondary" }}>{"State"}</Typography>
                        <Box />
                        {/* rows */}
                        { ordered.map( ( item ) =>
                        {
                            const key : string = Media.itemKey( item.usage, item.profile );
                            const ready : boolean = item.status === Media.Status.OK;
                            const previewable : boolean = item.kind === Media.Kind.IMAGE || item.kind === Media.Kind.VIDEO;
                            const editableCaption : boolean = item.usage === Media.Usage.TRANSCRIPT && ( item.profile === "srt" || item.profile === "vtt" );
                            return  <React.Fragment key={ item.id }>
                                        <Typography variant="body2" noWrap>{ itemLabel( item ) }</Typography>
                                        <Typography variant="body2">{ itemDimensions( item ) }</Typography>
                                        <Typography variant="body2">{ item.size ? appmodel.ui.locale.bytes( item.size ) : "—" }</Typography>
                                        <Typography variant="body2">{ item.extension || "—" }</Typography>
                                        <Typography variant="body2" sx={{ color: "text.secondary" }}>{ `v${ item.version }` }</Typography>
                                        <Chip size="small" variant="outlined" color={ ready ? "success" : "info" } label={ ready ? "Ready" : "Pending" } />
                                        <Stack direction="row" spacing={ 0.5 }>
                                            <ButtonIcon id={ `view-${ row.id }-${ key }` } icon={ <VisibilityOutlinedIcon fontSize="small" /> } label={"View item"} size="small" disabled={ !ready || !previewable } onClick={ () => setPreviewItem( { asset, item } ) } />
                                            <ButtonIcon id={ `info-${ row.id }-${ key }` } icon={ <InfoOutlinedIcon fontSize="small" /> } label={"Item info"} size="small" onClick={ () => setInfoItem( { asset, item } ) } />
                                            <ButtonIcon id={ `open-${ row.id }-${ key }` } icon={ <OpenInNewOutlinedIcon fontSize="small" /> } label={"Open in new tab"} size="small" disabled={ !ready } onClick={ () => void openItem( asset, key ) } />
                                            <ButtonIcon id={ `dl-${ row.id }-${ key }` } icon={ <DownloadOutlinedIcon fontSize="small" /> } label={"Download item"} size="small" disabled={ !ready } onClick={ () => void downloadItem( asset, item ) } />
                                            { editableCaption &&
                                                <ButtonIcon id={ `cap-${ row.id }-${ key }` } icon={ <SubtitlesOutlinedIcon fontSize="small" /> } label={"Edit captions"} size="small" onClick={ () => setCaptionItem( { asset, item } ) } /> }
                                            <ButtonIcon id={ `ver-${ row.id }-${ key }` } icon={ <HistoryOutlinedIcon fontSize="small" /> } label={"Version history"} size="small" onClick={ () => setVersionsFor( { asset, item } ) } />
                                        </Stack>
                                    </React.Fragment>;
                        } ) }
                    </Box>
                </Box>;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // dispatch a row action to its dialog / confirm. The table collapses everything but Preview into a
    // "more" (⋮) dropdown, so unwrap its selected `choice` into the real action id.
    function onAction( action : string, row : TableInput.Row, choice? : string ) : void
    {
        const act : string = action === AssetAction.MORE ? ( choice ?? "" ) : action;
        const asset : Media.Asset | undefined = assets.find( ( entry ) => entry.guid === row.id );
        if( !asset ) return;
        if( act === AssetAction.PREVIEW )  setPreview( asset );
        else if( act === AssetAction.OPEN )     void openLink( asset );
        else if( act === AssetAction.INFO )     setInfoAsset( asset );
        else if( act === AssetAction.EDIT )     setEditAsset( asset );
        else if( act === AssetAction.VARIANTS ) setVariants( asset );
        else if( act === AssetAction.REFRESH_VARIANTS ) void refreshVariants( asset );
        else if( act === AssetAction.POSTER )   setPosterAsset( asset );
        else if( act === AssetAction.COMPRESS ) setCompressAsset( asset );
        else if( act === AssetAction.DENSITY ) setDensityAsset( asset );
        else if( act === AssetAction.TRANSCRIBE ) void transcribe( asset );
        else if( act === AssetAction.CLONE_VOICE ) setVoiceAsset( asset );
        else if( act === AssetAction.RESCAN )   void rescan( asset );
        else if( act === AssetAction.COPY ) setCopyAsset( asset );
        else if( act === AssetAction.DOWNLOAD )     { const original : Media.Item | undefined = originalOf( asset ); if( original ) void downloadItem( asset, original ); }
        else if( act === AssetAction.DOWNLOAD_ZIP ) void requestArchive( asset );
        else if( act === AssetAction.DELETE )
            setConfirm( {
                title: "Delete media", yesLabel: "Delete", destructive: true,
                body: `Delete "${ asset.name }"? This can't be undone.`,
                run: async () : Promise<boolean> =>
                {
                    const reply : RestfulService.Reply<DeleteAsset.Response> = await appmodel.server.fetch( new DeleteAsset( asset.guid ) );
                    // media-1.5: an asset associated with a campaign can't be deleted (409)
                    if( !reply.ok && reply.status === 409 ) { setSnack( { message: "This asset is used by a campaign and can't be deleted.", severity: "warning" } ); return false; }
                    return reply.ok;
                },
            } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // the alert-prompt action: on YES run the mutation (snack + reload on success); any action dismisses
    async function onConfirmAction( action : AlertPrompt.Action ) : Promise<void>
    {
        if( !confirm ) return;
        if( action === AlertPrompt.Action.YES )
        {
            const ok : boolean = await confirm.run();
            if( ok ) { setSnack( { message: "Media deleted.", severity: "success" } ); void load(); }
        }
        setConfirm( null );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // upload finished → snack + reload (assets land as UPLOADING/SCANNING and settle to Ready)
    function onUploaded( uploaded : Array<Media.Asset> ) : void
    {
        setUploadOpen( false );
        setSnack( { message: `Uploaded ${ uploaded.length } file${ uploaded.length === 1 ? "" : "s" }.`, severity: "success" } );
        void load();
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // edit saved → report to dialog (true closes it) + snack + reload
    function onEdited( ok : boolean ) : boolean
    {
        if( ok ) { setSnack( { message: "Media updated.", severity: "success" } ); setEditAsset( null ); void load(); }
        else setSnack( { message: "Could not update the media. Please try again.", severity: "error" } );
        return ok;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // captions saved → report to the editor (true closes it) + snack + reload
    function onCaptionSaved( ok : boolean ) : boolean
    {
        if( ok ) { setSnack( { message: "Captions saved.", severity: "success" } ); setCaptionItem( null ); void load(); }
        else setSnack( { message: "Could not save the captions. Please try again.", severity: "error" } );
        return ok;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // density render done → report to the dialog (true closes it) + snack + reload
    function onDensityDone( ok : boolean ) : boolean
    {
        if( ok ) { setSnack( { message: "Density render added to the item's list.", severity: "success" } ); setDensityAsset( null ); void load(); }
        else setSnack( { message: "Could not render the density. Please try again.", severity: "error" } );
        return ok;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // variant generation started → report to dialog + snack + reload (variants fill in async)
    function onVariantsStarted( ok : boolean ) : boolean
    {
        if( ok ) { setSnack( { message: "Variant generation started.", severity: "success" } ); setVariants( null ); void load(); }
        else setSnack( { message: "Could not start variant generation. Please try again.", severity: "error" } );
        return ok;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // generate captions (transcribe) for an audio/video asset → JSON + .srt + .vtt items appear async
    async function transcribe( asset : Media.Asset ) : Promise<void>
    {
        const reply : RestfulService.Reply<PostAssetTranscribe.Response> = await appmodel.server.fetch( new PostAssetTranscribe( asset.guid ) );
        if( reply.ok ) setSnack( { message: "Generating captions — the .srt/.vtt items will appear when ready.", severity: "success" } );
        else setSnack( { message: "Could not start captioning. Please try again.", severity: "error" } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // rebuild EVERY system-configured variant profile for the asset (PostAssetVariants with no profile) →
    // snack + reload; the items refresh async as the pipeline re-derives + versions them
    async function refreshVariants( asset : Media.Asset ) : Promise<void>
    {
        const reply : RestfulService.Reply<PostAssetVariants.Response> = await appmodel.server.fetch( new PostAssetVariants( asset.guid, {} ) );
        if( reply.ok ) setSnack( { message: "Rebuilding all variants — they'll refresh when ready.", severity: "success" } );
        else setSnack( { message: "Could not rebuild the variants. Please try again.", severity: "error" } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // resolve the asset's time-limited delivery URL and open it in a new browser tab
    async function openLink( asset : Media.Asset ) : Promise<void>
    {
        const reply : RestfulService.Reply<GetMediaUrl.Response> = await appmodel.server.fetch( new GetMediaUrl( asset.guid ) );
        if( reply.ok && reply.data ) BrowserUtils.open( reply.data.url );
        else setSnack( { message: "Could not open the media link. Please try again.", severity: "error" } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // open ONE item (by its key `usage[.profile]`) in a new tab — the way to view a specific item's bytes
    async function openItem( asset : Media.Asset, itemKey : string ) : Promise<void>
    {
        const reply : RestfulService.Reply<GetMediaUrl.Response> = await appmodel.server.fetch( new GetMediaUrl( asset.guid, itemKey ) );
        if( reply.ok && reply.data ) BrowserUtils.open( reply.data.url );
        else setSnack( { message: "Could not open that item.", severity: "error" } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // re-probe an asset's content metadata (row action + the info dialog's primary) → snack + reload;
    // returns success so the info dialog can close on it. Stats fill in async once processing completes.
    async function rescan( asset : Media.Asset ) : Promise<boolean>
    {
        const reply : RestfulService.Reply<PostAssetRescan.Response> = await appmodel.server.fetch( new PostAssetRescan( asset.guid ) );
        if( reply.ok ) { setSnack( { message: "Rescanning content…", severity: "success" } ); setInfoAsset( null ); void load(); }
        else setSnack( { message: "Could not start the rescan. Please try again.", severity: "error" } );
        return reply.ok;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // regenerate a video's poster from a chosen frame → snack + reload; true closes the picker dialog
    async function setPoster( asset : Media.Asset, atSeconds : number ) : Promise<boolean>
    {
        const reply : RestfulService.Reply<PostAssetPoster.Response> = await appmodel.server.fetch( new PostAssetPoster( asset.guid, { atSeconds } ) );
        if( reply.ok ) { setSnack( { message: "Updating poster…", severity: "success" } ); setPosterAsset( null ); void load(); }
        else setSnack( { message: "Could not update the poster. Please try again.", severity: "error" } );
        return reply.ok;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // copy an envelope (renamed copy, optionally with its derived items) → report to dialog + snack + reload
    async function copy( asset : Media.Asset, name : string, includeDerived : boolean ) : Promise<boolean>
    {
        const reply : RestfulService.Reply<PostAssetDuplicate.Response> = await appmodel.server.fetch( new PostAssetDuplicate( asset.guid, { name: name.trim() || undefined, includeDerived } ) );
        if( reply.ok ) { setSnack( { message: includeDerived ? "Media copied with its derived items." : "Media copied.", severity: "success" } ); setCopyAsset( null ); void load(); }
        else setSnack( { message: "Could not copy the media. Please try again.", severity: "error" } );
        return reply.ok;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // resolve an item's signed URL and trigger a real file download. The `download` anchor attribute is
    // IGNORED for cross-origin URLs (the S3 presigned URL), which just opens the image in the tab — so fetch
    // the bytes to a blob and save that (BrowserUtils.download), which forces a genuine download.
    async function downloadItem( asset : Media.Asset, item : Media.Item ) : Promise<void>
    {
        const key : string = Media.itemKey( item.usage, item.profile );
        const reply : RestfulService.Reply<GetMediaUrl.Response> = await appmodel.server.fetch( new GetMediaUrl( asset.guid, key ) );
        if( !reply.ok || !reply.data ) { setSnack( { message: "Could not prepare the download.", severity: "error" } ); return; }
        const fileName : string = item.usage === Media.Usage.ORIGINAL ? `${ asset.name }.${ item.extension }` : `${ asset.name }.${ key }.${ item.extension }`;
        await BrowserUtils.download( reply.data.url, fileName );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // request a zip of the original + all variants (async media-archive Job) → appears in the Downloads view
    async function requestArchive( asset : Media.Asset ) : Promise<void>
    {
        const reply : RestfulService.Reply<PostAssetArchive.Response> = await appmodel.server.fetch( new PostAssetArchive( asset.guid ) );
        if( reply.ok ) setSnack( { message: "Preparing your download — find it in the Downloads view.", severity: "success" } );
        else setSnack( { message: "Could not start the download.", severity: "error" } );
    }

     ////////////////////////////////////////////////////////////////////////////////////////////
    // the action ids that apply to an asset (shared by the table rows and the grid tiles)
    function actionsFor( asset : Media.Asset ) : Array<string>
    {
        const servable  : boolean = asset.status === Media.Status.OK;
        const canVary   : boolean = servable && ( asset.kind === Media.Kind.IMAGE || asset.kind === Media.Kind.VIDEO );
        const canRescan : boolean = asset.status !== Media.Status.UPLOADING && ( asset.kind === Media.Kind.IMAGE || asset.kind === Media.Kind.VIDEO );
        const canPoster : boolean = servable && asset.kind === Media.Kind.VIDEO;   // video only
        const canClone  : boolean = servable && asset.kind === Media.Kind.AUDIO;   // audio → clone a voice
        const canCaption : boolean = servable && ( asset.kind === Media.Kind.AUDIO || asset.kind === Media.Kind.VIDEO );   // speech → captions
        const canDensity : boolean = servable && asset.kind === Media.Kind.IMAGE;   // image → DPI/density render
        return [
            ...( servable ? [ AssetAction.PREVIEW as string, AssetAction.OPEN as string ] : [] ),
            AssetAction.INFO,
            AssetAction.EDIT,
            ...( canVary ? [ AssetAction.VARIANTS as string, AssetAction.REFRESH_VARIANTS as string ] : [] ),
            ...( canDensity ? [ AssetAction.DENSITY as string ] : [] ),   // image only → DPI render
            ...( canPoster ? [ AssetAction.POSTER as string ] : [] ),
            ...( canPoster ? [ AssetAction.COMPRESS as string ] : [] ),   // video only (same gate as poster)
            ...( canCaption ? [ AssetAction.TRANSCRIBE as string ] : [] ),   // audio/video → generate captions
            ...( canClone ? [ AssetAction.CLONE_VOICE as string ] : [] ),   // audio only

            ...( canRescan ? [ AssetAction.RESCAN as string ] : [] ),
            AssetAction.COPY,
            ...( servable ? [ AssetAction.DOWNLOAD as string ] : [] ),
            ...( servable ? [ AssetAction.DOWNLOAD_ZIP as string ] : [] ),
            AssetAction.DELETE,
        ];
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // a short status label (reuses the chip style table)
    function statusLabelOf( status : string ) : string
    {
        return ( STATUS_STYLE[ status ]?.label ) ?? status;
    }


    ////////////////////////////////////////////////////////////////////////////////////////////
    // ── TableInput config ─────────────────────────────────────────────────────────────────────
    const columns : Array<TableInput.Column> =
    [
        { field: "name",      label: "Name",       type: TableInput.ColumnType.CUSTOM,   renderer: nameRenderer },
        { field: "tags",      label: "Tags",       type: TableInput.ColumnType.TAGS },
        { field: "typeLabel", label: "Type",       type: TableInput.ColumnType.STRING },
        { field: "size",      label: "Size",       type: TableInput.ColumnType.BYTES },
        { field: "createdAt", label: "Created",    type: TableInput.ColumnType.DATETIME, options: { style: "medium" } },
        { field: "createdBy", label: "Created by", type: TableInput.ColumnType.STRING },
        { field: "status",    label: "Status",     type: TableInput.ColumnType.CUSTOM,   renderer: statusRenderer },
        { field: "actions",   label: "",           type: TableInput.ColumnType.ACTION },
    ];

    // the individual action descriptors (used directly by the grid tiles' ⋮ menu)
    const actionDefs : Array<TableInput.Action> =
    [
        { id: AssetAction.PREVIEW,   label: "Preview",           icon: <VisibilityOutlinedIcon fontSize="small" /> },
        { id: AssetAction.OPEN,      label: "Open link in tab",  icon: <OpenInNewOutlinedIcon fontSize="small" /> },
        { id: AssetAction.INFO,      label: "Info",              icon: <InfoOutlinedIcon fontSize="small" /> },
        { id: AssetAction.EDIT,      label: "Edit name & tags",  icon: <EditOutlinedIcon fontSize="small" /> },
        { id: AssetAction.VARIANTS,  label: "Generate variants", icon: <AutoAwesomeOutlinedIcon fontSize="small" /> },
        { id: AssetAction.REFRESH_VARIANTS, label: "Rebuild all variants", icon: <ReplayOutlinedIcon fontSize="small" /> },
        { id: AssetAction.POSTER,    label: "Set poster frame",  icon: <PhotoCameraOutlinedIcon fontSize="small" /> },
        { id: AssetAction.COMPRESS,  label: "Compress video",    icon: <CompressOutlinedIcon fontSize="small" /> },
        { id: AssetAction.DENSITY,   label: "Change density (DPI)", icon: <HighQualityOutlinedIcon fontSize="small" /> },
        { id: AssetAction.TRANSCRIBE, label: "Generate captions", icon: <SubtitlesOutlinedIcon fontSize="small" /> },
        { id: AssetAction.CLONE_VOICE, label: "Clone voice",     icon: <RecordVoiceOverOutlinedIcon fontSize="small" /> },
        { id: AssetAction.RESCAN,    label: "Rescan content",    icon: <ReplayOutlinedIcon fontSize="small" /> },
        { id: AssetAction.COPY,      label: "Copy",              icon: <ContentCopyOutlinedIcon fontSize="small" /> },
        { id: AssetAction.DOWNLOAD,     label: "Download",          icon: <DownloadOutlinedIcon fontSize="small" /> },
        { id: AssetAction.DOWNLOAD_ZIP, label: "Download all (zip)", icon: <FolderZipOutlinedIcon fontSize="small" /> },
        { id: AssetAction.DELETE,    label: "Delete",            icon: <DeleteOutlineOutlinedIcon fontSize="small" /> },
    ];

    // the TABLE shows Preview as an icon and collapses the rest into a "more" (⋮) dropdown (choices). The
    // `filter` makes the menu ASSET-TYPE aware per row — reusing the same `actionsFor` gate the grid uses, so
    // (e.g.) "Set poster frame" only shows for a video and "Clone voice" only for audio.
    const tableActions : Array<TableInput.Action> =
    [
        { id: AssetAction.PREVIEW, label: "Preview", icon: <VisibilityOutlinedIcon fontSize="small" /> },
        { id: AssetAction.MORE,    label: "More",    icon: <MoreVertIcon fontSize="small" />,
          choices: actionDefs.filter( ( a ) => a.id !== AssetAction.PREVIEW ).map( ( a ) => ( { value: a.id, label: a.label, icon: a.icon } ) ),
          filter: ( value : string, row : TableInput.Row ) : boolean =>
          {
              const asset : Media.Asset | undefined = assets.find( ( entry ) => entry.guid === row.id );
              return asset ? actionsFor( asset ).includes( value ) : true;
          } },
    ];

   
    const rows : Array<TableInput.Row> = filtered().map( ( asset ) => ( {
        id:         asset.guid,
        kind:       asset.kind,
        name:       asset.name,
        tags:       asset.tags ?? [],
        typeLabel:  KIND_LABEL[ asset.kind ] ?? "Other",
        size:       originalOf( asset )?.size ?? 0,
        createdAt:  new Date( asset.createdAt ),
        createdBy:  asset.createdBy && asset.createdBy === meId ? "You" : "—",
        status:     asset.status,
        expandable: true,
        // table top-level actions: Preview (icon, when servable) + the ⋮ "more" dropdown
        actions:    [ ...( asset.status === Media.Status.OK ? [ AssetAction.PREVIEW as string ] : [] ), AssetAction.MORE as string ],
    } ) );

    ////////////////////////////////////////////////////////////////////////////////////////////
    return  <AuthPage minAccess={ Access.AccountRole.USER } title={"Media : Library"}>
                <Box sx={{ p: 2, mx: "auto" }}>
                    <Card variant="outlined">
                        <CardHeader title={"Media Library"} subheader={"Your account's media assets."}
                                    action={
                                        <Stack direction="row" spacing={ 1 } sx={{ alignItems: "center", mt: 1, mr: 1 }}>
                                            <Button variant="contained" startIcon={ <CloudUploadOutlinedIcon /> } onClick={ () => setUploadOpen( true ) }>{"Upload"}</Button>
                                            <ButtonIcon id="media-refresh" label={"Refresh"} icon={ <RefreshOutlinedIcon fontSize="small" /> } size="small" disabled={ loading } onClick={ () => void load() } />
                                        </Stack>
                                    } />
                        <Divider />
                        <CardContent>
                            <Stack spacing={ 2 }>

                                {/* ── filters (left, wrapping) + view toggle (pinned far right) ──────── */}
                                <Stack direction="row" spacing={ 2 } sx={{ alignItems: "flex-start" }}>
                                    <Stack direction="row" spacing={ 1 } sx={{ alignItems: "center", flexWrap: "wrap", gap: 1, flexGrow: 1 }}>
                                        <SearchInput id="media-search" label={"Search name or tags"} value={ search } onChange={ setSearch } sx={{ width: 280 }} />
                                        <SelectInput id="media-kind" label={"Type"} value={ kind } choices={ KIND_CHOICES } onChange={ setKind } sx={{ width: 160 }} />
                                        <DateInput id="media-from" label={"From"} value={ fromDate } clearable width={ 170 } onChange={ setFrom } />
                                        <Typography>{"-"}</Typography>
                                        <DateInput id="media-to"   label={"To"}   value={ toDate }   clearable width={ 170 } onChange={ setTo } />
                                        <Tooltip title={"Campaign filtering is coming soon"}>
                                            <span><SelectInput id="media-campaign" label={"Campaign"} value={""} choices={ [ { value: "", label: "All campaigns" } ] } disabled sx={{ width: 180 }} /></span>
                                        </Tooltip>
                                    </Stack>

                                    {/* view toggle: table list + small/medium/large image grids */}
                                    <ToggleButtonGroup exclusive size="small" value={ view } sx={{ flexShrink: 0 }}
                                                       onChange={ ( _e, next : ViewMode | null ) => { if( next ) setView( next ); } }>
                                        <ToggleButton value="table"  aria-label="table list"><Tooltip title={"List"}><ViewListOutlinedIcon fontSize="small" /></Tooltip></ToggleButton>
                                        <ToggleButton value="small"  aria-label="small grid"><Tooltip title={"Small grid"}><PhotoOutlinedIcon fontSize="small" /></Tooltip></ToggleButton>
                                        <ToggleButton value="medium" aria-label="medium grid"><Tooltip title={"Medium grid"}><PhotoOutlinedIcon fontSize="medium" /></Tooltip></ToggleButton>
                                        <ToggleButton value="large"  aria-label="large grid"><Tooltip title={"Large grid"}><PhotoOutlinedIcon fontSize="large" /></Tooltip></ToggleButton>
                                    </ToggleButtonGroup>
                                </Stack>

                                {/* ── table ───────────────────────────────────────────────────────── */}
                                { loading &&
                                    <Stack direction="row" spacing={ 1 } sx={{ alignItems: "center", p: 2 }}><CircularProgress size={ 18 } /><Typography variant="body2" sx={{ color: "text.secondary" }}>{"Loading…"}</Typography></Stack> }

                                { !loading && rows.length === 0 &&
                                    <Typography variant="body2" sx={{ color: "text.secondary", p: 2 }}>{ assets.length === 0 ? "No media yet — upload your first file." : "No media matches your filters." }</Typography> }

                                { !loading && rows.length > 0 && view === "table" &&
                                    <TableInput id="media-assets"
                                                columns={ columns }
                                                data={ rows }
                                                actions={ tableActions }
                                                onAction={ onAction }
                                                expandedRenderer={ itemsRenderer }
                                                selectable={ TableInput.Selectable.NONE } /> }

                                { !loading && rows.length > 0 && view !== "table" &&
                                    <ImageList cols={ GRID_SIZE[ view ].cols } gap={ 12 } rowHeight={ GRID_SIZE[ view ].img + GRID_BAR_HEIGHT } sx={{ m: 0 }}>
                                        { filtered().map( ( asset ) =>
                                            <MediaGridItem key={ asset.guid }
                                                           asset={ asset }
                                                           imgHeight={ GRID_SIZE[ view ].img }
                                                           typeLabel={ KIND_LABEL[ asset.kind ] ?? "Other" }
                                                           statusLabel={ statusLabelOf( asset.status ) }
                                                           actions={ actionsFor( asset ).map( ( id ) => actionDefs.find( ( a ) => a.id === id ) ).filter( ( a ) : a is TableInput.Action => a !== undefined ) }
                                                           onAction={ ( actionId : string ) => onAction( actionId, { id: asset.guid } as TableInput.Row ) } /> ) }
                                    </ImageList> }

                            </Stack>
                        </CardContent>
                    </Card>
                </Box>

                <AccountChange onClear={ () => setAssets( [] ) } onRefresh={ () => void load() } />

                { uploadOpen &&
                    <MediaUploadDialog scope={ Media.Scope.ACCOUNT } showTags onUploaded={ onUploaded } onClose={ () => setUploadOpen( false ) } /> }

                { editAsset &&
                    <AssetEditDialog asset={ editAsset } onSaved={ onEdited } onClose={ () => setEditAsset( null ) } /> }

                { previewAsset &&
                    <AssetPreviewDialog asset={ previewAsset } onClose={ () => setPreview( null ) } /> }

                { variantsAsset &&
                    <GenerateVariantsDialog asset={ variantsAsset } onStarted={ onVariantsStarted } onClose={ () => setVariants( null ) } /> }

                { infoAsset &&
                    <AssetInfoDialog asset={ infoAsset } onRescan={ () => rescan( infoAsset ) } onClose={ () => setInfoAsset( null ) } /> }

                { posterAsset &&
                    <PosterFrameDialog asset={ posterAsset } onSet={ ( atSeconds : number ) => setPoster( posterAsset, atSeconds ) } onClose={ () => setPosterAsset( null ) } /> }

                { compressAsset &&
                    <MediaCompressDialog asset={ compressAsset }
                                         onDone={ ( ok : boolean ) => { setSnack( ok ? { message: "Compressing — the variant will appear when it's ready.", severity: "success" } : { message: "Could not start compression.", severity: "error" } ); setCompressAsset( null ); return true; } }
                                         onClose={ () => setCompressAsset( null ) } /> }

                { densityAsset &&
                    <DensityDialog asset={ densityAsset } onDone={ onDensityDone } onClose={ () => setDensityAsset( null ) } /> }

                { voiceAsset &&
                    <VoiceCloneDialog asset={ voiceAsset }
                                      onDone={ ( ok : boolean ) => { setSnack( ok ? { message: "Voice cloned — find it in AI Gen → Voice.", severity: "success" } : { message: "Could not clone the voice.", severity: "error" } ); setVoiceAsset( null ); return true; } }
                                      onClose={ () => setVoiceAsset( null ) } /> }

                { copyAsset &&
                    <CopyAssetDialog asset={ copyAsset }
                                     onCopy={ ( name : string, includeDerived : boolean ) => copy( copyAsset, name, includeDerived ) }
                                     onClose={ () => setCopyAsset( null ) } /> }

                { previewItem &&
                    <AssetPreviewDialog asset={ previewItem.asset } item={ previewItem.item } onClose={ () => setPreviewItem( null ) } /> }

                { infoItem &&
                    <ItemInfoDialog asset={ infoItem.asset } item={ infoItem.item } onClose={ () => setInfoItem( null ) } /> }

                { captionItem &&
                    <CaptionEditorDialog asset={ captionItem.asset } item={ captionItem.item }
                                         onSaved={ onCaptionSaved }
                                         onClose={ () => setCaptionItem( null ) } /> }

                { versionsFor &&
                    <ItemVersionsDialog asset={ versionsFor.asset } item={ versionsFor.item }
                                        onReverted={ ( ok : boolean ) => { setSnack( ok ? { message: "Item reverted to the selected version.", severity: "success" } : { message: "Could not revert the item.", severity: "error" } ); setVersionsFor( null ); if( ok ) void load(); return true; } }
                                        onClose={ () => setVersionsFor( null ) } /> }

                { confirm &&
                    <AlertPrompt id="media-confirm"
                                 type={ AlertPrompt.Type.WARNING }
                                 title={ confirm.title }
                                 message={ confirm.body }
                                 yesText={ confirm.yesLabel }
                                 yesColor={ confirm.destructive ? "error" : "primary" }
                                 cancelText={"Cancel"}
                                 onAction={ onConfirmAction } /> }

                { snack && <SnackAlert message={ snack.message } severity={ snack.severity } onClose={ () => setSnack( null ) } /> }
            </AuthPage>;
}

export namespace MediaLibrary
{
    export interface Props {}

    /** A pending confirm-dialog for a state-changing action. `run` performs the mutation → success flag. */
    export interface Confirm
    {
        title        : string;
        body         : string;
        yesLabel     : string;
        destructive? : boolean;
        run          : () => Promise<boolean>;
    }
}

export default MediaLibrary;
// eof
