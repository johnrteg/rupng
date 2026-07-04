import AppModel from "@model/AppModel";
//
import React from 'react';
import { JSX } from "react";

import { Box, ImageListItem, ImageListItemBar } from "@mui/material";
import ImageOutlinedIcon          from '@mui/icons-material/ImageOutlined';
import MovieOutlinedIcon          from '@mui/icons-material/MovieOutlined';
import AudiotrackOutlinedIcon     from '@mui/icons-material/AudiotrackOutlined';
import DescriptionOutlinedIcon    from '@mui/icons-material/DescriptionOutlined';
import InsertDriveFileOutlinedIcon from '@mui/icons-material/InsertDriveFileOutlined';
import MoreVertIcon               from '@mui/icons-material/MoreVert';

import { Media, GetMediaUrl } from '@repo/api';
import { RestfulService } from '@repo/endpoint';

import ButtonIconDropdown from '@widgets/core/ButtonIconDropdown';

//
// MediaGridItem — one tile in the media grid (the small/medium/large ImageList views). Renders the asset's
// thumbnail (fetches its own signed URL for a ready image; a kind icon otherwise) and a title bar BELOW it
// with the filename + "type · size · status" and the applicable action buttons. Fetches its own URL, so it
// lives in its own file (per the one-component / self-fetching-gets-its-own-file rule).
//
export function MediaGridItem( props : MediaGridItem.Props ) : JSX.Element
{
    const appmodel : AppModel = AppModel.instance();
    const asset : Media.Asset = props.asset;

    const [url,setUrl]       = React.useState< string >( "" );
    const [failed,setFailed] = React.useState< boolean >( false );
    const triedOriginal      = React.useRef< boolean >( false );

    ////////////////////////////////////////////////////////////////////////////////////////////
    // an image → its "thumb" rendition; a video → its "poster" first-frame. Load as soon as bytes exist (any
    // status but UPLOADING) — GetMediaUrl falls back to the ORIGINAL when the derived item isn't ready yet, so
    // an image shows immediately even while its renditions are still processing. RESET first so a reused tile
    // never shows a previous asset's image, and ignore a late response for a stale asset.
    React.useEffect( () =>
    {
        setUrl( "" ); setFailed( false ); triedOriginal.current = false;
        const previewable : boolean = asset.kind === Media.Kind.IMAGE || asset.kind === Media.Kind.VIDEO;
        if( previewable && asset.status !== Media.Status.UPLOADING ) void loadThumb( asset.guid );
    }, [ asset.guid, asset.status ] );

    ////////////////////////////////////////////////////////////////////////////////////////////
    async function loadThumb( forGuid : string ) : Promise<void>
    {
        // a video → its POSTER item; an image → its DISPLAY "thumb" item (item keys, media-1.3). The endpoint
        // falls back to the ORIGINAL when that derived item isn't present yet.
        const itemKey : string = asset.kind === Media.Kind.VIDEO
            ? Media.itemKey( Media.Usage.POSTER )
            : Media.itemKey( Media.Usage.DISPLAY, "thumb" );
        const reply : RestfulService.Reply<GetMediaUrl.Response> = await appmodel.server.fetch( new GetMediaUrl( forGuid, itemKey ) );
        if( reply.ok && reply.data && forGuid === asset.guid ) setUrl( reply.data.url );   // guard: still the same asset
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // the rendition URL 404'd (e.g. a legacy variant marked ready with no bytes) — for an IMAGE fall back to
    // the original once; otherwise show the kind placeholder.
    async function onImgError() : Promise<void>
    {
        if( asset.kind === Media.Kind.IMAGE && !triedOriginal.current )
        {
            triedOriginal.current = true;
            const reply : RestfulService.Reply<GetMediaUrl.Response> = await appmodel.server.fetch( new GetMediaUrl( asset.guid ) );
            if( reply.ok && reply.data ) { setUrl( reply.data.url ); return; }
        }
        setFailed( true );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // kind placeholder icon (non-image, or an image that isn't ready yet)
    function placeholder() : JSX.Element
    {
        const sx = { fontSize: Math.round( props.imgHeight * 0.4 ), color: "text.disabled" } as const;
        if( asset.kind === Media.Kind.VIDEO )    return <MovieOutlinedIcon sx={ sx } />;
        if( asset.kind === Media.Kind.AUDIO )    return <AudiotrackOutlinedIcon sx={ sx } />;
        if( asset.kind === Media.Kind.DOCUMENT ) return <DescriptionOutlinedIcon sx={ sx } />;
        if( asset.kind === Media.Kind.IMAGE )    return <ImageOutlinedIcon sx={ sx } />;
        return <InsertDriveFileOutlinedIcon sx={ sx } />;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    const statusLabel : string = props.statusLabel;
    const originalSize : number = Media.originalItem( asset )?.size ?? 0;
    const subtitle : string = `${ props.typeLabel } · ${ appmodel.ui.locale.bytes( originalSize ) } · ${ statusLabel }`;

    return  <ImageListItem sx={{ border: "1px solid", borderColor: "divider", borderRadius: 1, overflow: "hidden" }}>

                {/* thumbnail (click → preview) */}
                <Box onClick={ () => props.onAction( "preview" ) }
                     sx={{ height: props.imgHeight, display: "flex", alignItems: "center", justifyContent: "center",
                           bgcolor: "background.default", cursor: "pointer", overflow: "hidden" }}>
                    { url && !failed
                        ? <Box component="img" key={ url } src={ url } alt={ asset.name } loading="lazy" onError={ () => void onImgError() } sx={{ width: "100%", height: "100%", objectFit: "cover" }} />
                        : placeholder() }
                </Box>

                {/* title bar below the image — actions collapse into a vertical-ellipsis dropdown */}
                <ImageListItemBar
                    position="below"
                    title={ asset.name }
                    subtitle={ subtitle }
                    actionIcon={
                        <Box sx={{ pr: 0.5 }}>
                            <ButtonIconDropdown
                                id={ `media-tile-${ asset.guid }` }
                                icon={ <MoreVertIcon fontSize="small" /> }
                                label={"Actions"}
                                size="small"
                                choices={ props.actions.map( ( action ) => ( { value: action.id, label: action.label, icon: action.icon } ) ) }
                                onChange={ ( value : string ) => props.onAction( value ) } />
                        </Box>
                    }
                    actionPosition="right"
                    sx={{ ".MuiImageListItemBar-titleWrap": { pl: 1.5, pr: 0 } }}
                />
            </ImageListItem>;
}

export namespace MediaGridItem
{
    /** An action available on this tile — the same id/label/icon used by the table's action menu. */
    export interface Action { id : string; label : string; icon : JSX.Element; }

    export interface Props
    {
        asset       : Media.Asset;
        imgHeight   : number;                       // the thumbnail height for the current grid size
        typeLabel   : string;                       // e.g. "Image"
        statusLabel : string;                       // e.g. "Ready"
        actions     : Array<Action>;                // already filtered to what applies to this asset
        onAction    : ( actionId : string ) => void;
    }
}

export default MediaGridItem;
// eof
