import AppModel from "@model/AppModel";
//
import React from "react";
import { JSX } from "react";

import { Box, Button, CircularProgress, Stack, Tab, Tabs, Typography } from "@mui/material";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import UploadFileOutlinedIcon from "@mui/icons-material/UploadFileOutlined";

import { Browse, SvgAsset, GetSvgAssets, GetSvgAsset, PostSvgAsset, PostBrowseSearch, GetAssets, GetMediaUrl, Media } from "@repo/api";
import { RestfulService } from "@repo/endpoint";

import TextInput from "@widgets/core/TextInput";
import DialogWindow from "@widgets/core/DialogWindow";

import BrowserUtils from "@utils/BrowserUtils";
import SvgSanitizer from "@utils/SvgSanitizer";

//
// SvgAssetPickerDialog — pick an SVG graphic for the SVG editor from three sources: the LIBRARY (system-wide +
// this account's own svg-assets), a provider BROWSE search (SVGL logos / Iconify icons — the only two SVG-
// capable Browse providers), or a direct FILE import (read + sanitized client-side, embedded straight into the
// doc — never persisted to any library). You SELECT a graphic (it highlights), then confirm with "Use" (or
// Cancel), mirroring EmailImagePickerDialog's deferred-pick pattern. Built on the house DialogWindow.
//
export function SvgAssetPickerDialog( props : SvgAssetPickerDialog.Props ) : JSX.Element
{
    const appmodel : AppModel = AppModel.instance();

    const [ tab, setTab ]   = React.useState<"library" | "browse" | "file">( "library" );
    const [ busy, setBusy ] = React.useState<boolean>( false );   // importing / resolving

    const [ librarySelected, setLibrarySelected ] = React.useState<SvgAssetPickerDialog.LibraryTile | null>( null );
    const [ browseSelected, setBrowseSelected ]   = React.useState<Browse.Result | null>( null );
    const [ fileSelected, setFileSelected ]       = React.useState<{ name : string; svg : string } | null>( null );

    // library — merges the dedicated svg-assets library (system-wide + this account's own) with any SVG-mime
    // file already sitting in the account's regular Media Library, so a normal upload is immediately usable
    // here too (a separate "SVG library" would otherwise silently orphan anything uploaded the normal way)
    const [ assets, setAssets ]         = React.useState<Array<SvgAssetPickerDialog.LibraryTile>>( [] );
    const [ loadingLib, setLoadingLib ] = React.useState<boolean>( false );

    // browse
    const [ query, setQuery ]         = React.useState<string>( "" );
    const [ results, setResults ]     = React.useState<Array<Browse.Result>>( [] );
    const [ searching, setSearching ] = React.useState<boolean>( false );

    const [ error, setError ] = React.useState<string>( "" );   // last "Use" failure — cleared on retry/close

    ////////////////////////////////////////////////////////////////////////////////////////////
    function libraryLoaded() : void
    {
        void loadLibrary();
    }
    React.useEffect( libraryLoaded, [] );

    ////////////////////////////////////////////////////////////////////////////////////////////
    // LIBRARY — the dedicated svg-assets library MERGED with any SVG-mime asset already in the regular Media
    // Library (a plain upload, not routed through this dialog). Each tile then resolves its own preview in
    // parallel — a library-backed asset's own storage already has bytes to show, so a tile isn't left blank.
    async function loadLibrary() : Promise<void>
    {
        setLoadingLib( true );
        const [ svgReply, mediaReply ] : [ RestfulService.Reply<GetSvgAssets.Response>, RestfulService.Reply<GetAssets.Response> ] = await Promise.all( [
            appmodel.server.fetch( new GetSvgAssets() ),
            appmodel.server.fetch( new GetAssets( { kind: Media.Kind.IMAGE } ) ),
        ] );

        const svgTiles : Array<SvgAssetPickerDialog.LibraryTile> = svgReply.ok && svgReply.data
            ? svgReply.data.assets.map( ( entry : SvgAsset.Summary ) : SvgAssetPickerDialog.LibraryTile => ( { key: `svg:${ entry.id }`, name: entry.name, svgAsset: entry } ) )
            : [];
        const mediaTiles : Array<SvgAssetPickerDialog.LibraryTile> = mediaReply.ok && mediaReply.data
            ? mediaReply.data.records
                .filter( ( asset : Media.Asset ) : boolean => Media.originalItem( asset )?.mime === "image/svg+xml" )
                .map( ( asset : Media.Asset ) : SvgAssetPickerDialog.LibraryTile => ( { key: `media:${ asset.guid }`, name: asset.name, mediaAsset: asset } ) )
            : [];

        const merged : Array<SvgAssetPickerDialog.LibraryTile> = [ ...svgTiles, ...mediaTiles ];
        setAssets( merged );
        setLoadingLib( false );

        // resolve previews AFTER the grid renders (name-only tiles first) so the dialog isn't blocked waiting
        // on N thumbnail fetches; each tile updates independently as its own resolve settles
        void resolvePreviews( merged );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // svg-asset tiles inline their own (small, already-sanitized) markup directly; media-asset tiles resolve
    // their generated "thumb" rendition (a real PNG now that the pipeline no longer mis-rasterizes SVGs) as
    // an <img> src. Each tile resolves independently — one slow/failed preview doesn't block the others.
    async function resolvePreviews( tiles : Array<SvgAssetPickerDialog.LibraryTile> ) : Promise<void>
    {
        await Promise.all( tiles.map( async ( entry : SvgAssetPickerDialog.LibraryTile ) : Promise<void> =>
        {
            if( entry.svgAsset !== undefined )
            {
                const reply : RestfulService.Reply<GetSvgAsset.Response> = await appmodel.server.fetch( new GetSvgAsset( entry.svgAsset.id, entry.svgAsset.scope ) );
                if( reply.ok && reply.data ) setAssets( ( current : Array<SvgAssetPickerDialog.LibraryTile> ) : Array<SvgAssetPickerDialog.LibraryTile> =>
                    current.map( ( item : SvgAssetPickerDialog.LibraryTile ) : SvgAssetPickerDialog.LibraryTile => item.key === entry.key ? { ...item, inlineMarkup: reply.data?.svg } : item ) );
            }
            else if( entry.mediaAsset !== undefined )
            {
                const reply : RestfulService.Reply<GetMediaUrl.Response> = await appmodel.server.fetch( new GetMediaUrl( entry.mediaAsset.guid, Media.itemKey( Media.Usage.DISPLAY, "thumb" ) ) );
                if( reply.ok && reply.data ) setAssets( ( current : Array<SvgAssetPickerDialog.LibraryTile> ) : Array<SvgAssetPickerDialog.LibraryTile> =>
                    current.map( ( item : SvgAssetPickerDialog.LibraryTile ) : SvgAssetPickerDialog.LibraryTile => item.key === entry.key ? { ...item, previewUrl: reply.data?.url } : item ) );
            }
        } ) );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // BROWSE — scoped to the two SVG-capable providers (SVGL logos, Iconify icons)
    async function runSearch() : Promise<void>
    {
        if( query.trim() === "" ) return;
        setSearching( true );
        const reply : RestfulService.Reply<PostBrowseSearch.Response> = await appmodel.server.fetch(
            new PostBrowseSearch( { text: query.trim(), kinds: [ Media.Kind.IMAGE ], providers: [ Browse.Provider.SVGL, Browse.Provider.ICONIFY ] } ) );
        if( reply.ok && reply.data ) setResults( reply.data.results );
        setSearching( false );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // FILE — read + sanitize client-side; nothing is uploaded until (unless) the user clicks Use, and even
    // then this path never persists — it hands the sanitized markup straight to the caller
    async function onFileChosen( event : React.ChangeEvent<HTMLInputElement> ) : Promise<void>
    {
        const file : File | undefined = event.target.files?.[ 0 ];
        if( !file ) return;
        const raw : string = await BrowserUtils.readFile( file );
        const sanitized : string = SvgSanitizer.sanitize( raw );
        setFileSelected( { name: file.name.replace( /\.svg$/i, "" ), svg: sanitized } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // confirm the current selection — a library pick fetches its markup; a browse pick imports it into the
    // account library first (so it's reusable later); a file pick is already resolved, no server round-trip.
    // Every path clears/sets `error` so a failure is visible instead of the dialog just quietly staying open.
    async function onUse() : Promise<boolean>
    {
        setError( "" );

        if( librarySelected?.svgAsset !== undefined )
        {
            const svgAsset : SvgAsset.Summary = librarySelected.svgAsset;
            setBusy( true );
            const reply : RestfulService.Reply<GetSvgAsset.Response> = await appmodel.server.fetch( new GetSvgAsset( svgAsset.id, svgAsset.scope ) );
            setBusy( false );
            if( !reply.ok || !reply.data ) { setError( RestfulService.error( reply, "Could not load that SVG" ) ); return false; }
            props.onPick( { name: reply.data.name, svg: reply.data.svg, assetId: svgAsset.id } );
            return true;
        }
        if( librarySelected?.mediaAsset !== undefined )
        {
            // a regular Media Library asset has no pre-sanitized markup on file — resolve its delivery URL,
            // then fetch the raw bytes through the same RestfulService (never throws, has its own request
            // timeout) rather than a raw fetch(), and sanitize client-side (same pass as Import file)
            const mediaAsset : Media.Asset = librarySelected.mediaAsset;
            setBusy( true );
            const urlReply : RestfulService.Reply<GetMediaUrl.Response> = await appmodel.server.fetch( new GetMediaUrl( mediaAsset.guid ) );
            if( !urlReply.ok || !urlReply.data ) { setBusy( false ); setError( RestfulService.error( urlReply, "Could not resolve that SVG's file" ) ); return false; }
            // withCredentials: false — a presigned S3 URL's wildcard CORS policy rejects a credentialed request
            const bytesReply : RestfulService.Reply<string> = await appmodel.server.get( urlReply.data.url, null, {}, null, { withCredentials: false } );
            setBusy( false );
            if( !bytesReply.ok || bytesReply.data === undefined ) { setError( RestfulService.error( bytesReply, "Could not download that SVG" ) ); return false; }
            props.onPick( { name: mediaAsset.name, svg: SvgSanitizer.sanitize( bytesReply.data ), assetId: mediaAsset.guid, mediaGuid: mediaAsset.guid } );
            return true;
        }
        if( browseSelected !== null )
        {
            setBusy( true );
            const reply : RestfulService.Reply<PostSvgAsset.Response> = await appmodel.server.fetch(
                new PostSvgAsset( { name: browseSelected.title, provider: browseSelected.provider, externalId: browseSelected.externalId } ) );
            setBusy( false );
            if( !reply.ok || !reply.data ) { setError( RestfulService.error( reply, "Could not import that graphic" ) ); return false; }
            props.onPick( { name: browseSelected.title, svg: reply.data.svg, assetId: reply.data.assetId } );
            return true;
        }
        if( fileSelected !== null )
        {
            props.onPick( { name: fileSelected.name, svg: fileSelected.svg } );
            return true;
        }
        return false;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // a clickable tile — heavier border + check-circle badge when selected; `preview` is either an <img> src
    // (browse thumbnails) or raw sanitized markup to inline (file import — nothing else has inline markup
    // cheaply available without a per-tile fetch)
    function tile( key : string, label : string, isSelected : boolean, onClick : () => void, imgSrc? : string, inlineMarkup? : string ) : JSX.Element
    {
        return (
            <Box key={ key } onClick={ onClick } title={ label }
                 sx={{ position: "relative", width: 120, height: 120, borderRadius: 1, overflow: "hidden",
                       cursor: "pointer", border: isSelected ? 3 : 2, borderColor: isSelected ? "primary.main" : "divider",
                       display: "flex", alignItems: "center", justifyContent: "center", bgcolor: "background.paper", p: 1,
                       "&:hover": { borderColor: "primary.main" } }}>
                { imgSrc !== undefined && <Box component="img" src={ imgSrc } sx={{ maxWidth: "100%", maxHeight: "100%" }} /> }
                { inlineMarkup !== undefined && <Box sx={{ width: "100%", height: "100%", "& svg": { width: "100%", height: "100%" } }} dangerouslySetInnerHTML={ { __html: inlineMarkup } } /> }
                { imgSrc === undefined && inlineMarkup === undefined &&
                    <Typography variant="caption" align="center" sx={{ color: "text.secondary", wordBreak: "break-word" }}>{ label }</Typography> }
                { isSelected &&
                    <Box sx={{ position: "absolute", top: 4, right: 4, bgcolor: "primary.main", borderRadius: "50%",
                               display: "flex", alignItems: "center", justifyContent: "center", width: 22, height: 22 }}>
                        <CheckCircleIcon sx={{ fontSize: 16, color: "primary.contrastText" }} />
                    </Box> }
            </Box>
        );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    if( !props.open ) return <></>;
    return <DialogWindow id="svg-asset-picker" title={"Choose SVG"} minWidth="md" yesLabel={"Use"} cancelLabel={"Cancel"}
                         ready={ librarySelected !== null || browseSelected !== null || fileSelected !== null } onYes={ onUse } onClose={ props.onClose }>
        <Box sx={{ p: 2 }}>
            <Tabs value={ tab } onChange={ ( _event : React.SyntheticEvent, value : "library" | "browse" | "file" ) : void => setTab( value ) } sx={{ mb: 2 }}>
                <Tab value="library" label="My Library" />
                <Tab value="browse" label="Browse" />
                <Tab value="file" label="Import file" />
            </Tabs>

            { busy && <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}><CircularProgress size={ 16 } /><Typography variant="caption">{"Preparing…"}</Typography></Box> }
            { error !== "" && <Typography variant="body2" sx={{ color: "error.main" }}>{ error }</Typography> }

            {/* My Library */}
            { tab === "library" && (
                loadingLib
                    ? <CircularProgress size={ 20 } />
                    : assets.length === 0
                        ? <Typography variant="body2" sx={{ color: "text.secondary" }}>{"No SVGs in the library yet — try Browse or Import file."}</Typography>
                        : <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
                              { assets.map( ( entry : SvgAssetPickerDialog.LibraryTile ) : JSX.Element =>
                                  tile( entry.key, entry.name, librarySelected?.key === entry.key, () : void => setLibrarySelected( entry ), entry.previewUrl, entry.inlineMarkup ) ) }
                          </Box> ) }

            {/* Browse */}
            { tab === "browse" && <Stack spacing={ 2 }>
                <Stack direction="row" spacing={ 1 } sx={{ alignItems: "flex-end" }}>
                    <Box sx={{ flexGrow: 1 }}><TextInput id="svg-browse-q" label={"Search icons & logos"} value={ query } onChange={ setQuery } fullWidth /></Box>
                    <Button variant="contained" disabled={ searching } onClick={ () : void => void runSearch() }>{ searching ? "Searching…" : "Search" }</Button>
                </Stack>
                <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
                    { results.map( ( result : Browse.Result ) : JSX.Element => tile( `${ result.provider }:${ result.externalId }`, result.title,
                          browseSelected !== null && browseSelected.provider === result.provider && browseSelected.externalId === result.externalId,
                          () : void => setBrowseSelected( result ), result.thumbnailUrl ) ) }
                </Box>
                { results.length > 0 && <Typography variant="caption" sx={{ color: "text.disabled" }}>{"Select a graphic, then click Use to import it into your library."}</Typography> }
            </Stack> }

            {/* Import file */}
            { tab === "file" && <Stack spacing={ 2 }>
                <Button component="label" variant="outlined" startIcon={ <UploadFileOutlinedIcon /> } sx={{ alignSelf: "flex-start" }}>
                    {"Choose an SVG file"}
                    <input type="file" accept=".svg,image/svg+xml" hidden onChange={ ( event : React.ChangeEvent<HTMLInputElement> ) : void => void onFileChosen( event ) } />
                </Button>
                { fileSelected !== null &&
                    <Stack direction="row" spacing={ 1 }>
                        { tile( "file-preview", fileSelected.name, true, () : void => {}, undefined, fileSelected.svg ) }
                    </Stack> }
                <Typography variant="caption" sx={{ color: "text.disabled" }}>{"Not added to any library — embedded directly into this design."}</Typography>
            </Stack> }
        </Box>
    </DialogWindow>;
}

export namespace SvgAssetPickerDialog
{
    /** A picked SVG — the sanitized markup + a display name.
     *  `assetId` is a general reuse/dedupe key, set for any library-backed pick (My Library / Browse import) —
     *  it may be an svg-assets row id OR a Media.Asset guid, so it must NEVER be treated as a Media.Asset guid
     *  on its own (e.g. fed into `GetAsset`/`GetMediaUrl`).
     *  `mediaGuid` is set ONLY when the pick genuinely IS backed by a Media.Asset (a regular Media Library
     *  pick) — this is the field anything needing a real media guid (the export dialog's DPI check, a future
     *  "replace" action, …) should read instead of `assetId`.
     *  A direct file import has neither — no library reference at all. */
    export interface Pick { name : string; svg : string; assetId? : string; mediaGuid? : string; }

    /** One "My Library" tile — either a dedicated svg-assets row or an SVG-mime asset from the regular Media
     *  Library (exactly one of the two is set). Merged into a single list so a plain upload doesn't get
     *  silently orphaned from the SVG editor's picker. `previewUrl`/`inlineMarkup` are resolved async, after
     *  the grid first renders name-only, so N thumbnail fetches don't block the dialog opening. */
    export interface LibraryTile
    {
        key          : string;
        name         : string;
        svgAsset?    : SvgAsset.Summary;
        mediaAsset?  : Media.Asset;
        previewUrl?  : string;
        inlineMarkup?: string;
    }

    export interface Props
    {
        open    : boolean;
        onPick  : ( pick : Pick ) => void;
        onClose : () => void;
    }
}

export default SvgAssetPickerDialog;
// eof
