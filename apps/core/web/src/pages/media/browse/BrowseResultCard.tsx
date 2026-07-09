import AppModel from "@model/AppModel";
//
import React from 'react';
import { JSX } from "react";

import { Box, Chip, CircularProgress, ImageListItem, ImageListItemBar } from "@mui/material";
import AddPhotoAlternateOutlinedIcon from '@mui/icons-material/AddPhotoAlternateOutlined';
import CheckCircleOutlineOutlinedIcon from '@mui/icons-material/CheckCircleOutlineOutlined';
import OpenInNewOutlinedIcon         from '@mui/icons-material/OpenInNewOutlined';
import MovieOutlinedIcon             from '@mui/icons-material/MovieOutlined';
import AudiotrackOutlinedIcon        from '@mui/icons-material/AudiotrackOutlined';

import { Browse, Media } from '@repo/api';

import ButtonIcon   from '@widgets/core/ButtonIcon';
import BrowserUtils from '@utils/BrowserUtils';

//
// BrowseResultCard — one normalized Browse.Result tile: the provider thumbnail (from the provider URL, no
// signing needed), a license badge, "<provider> · <cost>" subtitle, and an "Add to library" (import) action +
// open-on-provider link. Owns its own import busy/done state, so it lives in its own file.
//
export function BrowseResultCard( props : BrowseResultCard.Props ) : JSX.Element
{
    const appmodel : AppModel = AppModel.instance();

    const result : Browse.Result = props.result;
    const [importing,setImporting] = React.useState< boolean >( false );
    const [imported,setImported]   = React.useState< boolean >( false );

    ////////////////////////////////////////////////////////////////////////////////////////////
    // add to library → parent performs the import; on success flip to a done state
    async function onImport() : Promise<void>
    {
        if( importing || imported ) return;
        setImporting( true );
        const ok : boolean = await props.onImport();
        setImporting( false );
        if( ok ) setImported( true );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // a media-kind glyph shown over non-image results (video/audio have no still thumbnail sometimes)
    function kindBadge() : JSX.Element | null
    {
        if( result.kind === Media.Kind.VIDEO ) return <MovieOutlinedIcon fontSize="small" sx={{ color: "common.white" }} />;
        if( result.kind === Media.Kind.AUDIO ) return <AudiotrackOutlinedIcon fontSize="small" sx={{ color: "common.white" }} />;
        return null;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    const priceLabel : string = result.cost.free
        ? "Free"
        : result.cost.amount !== undefined ? appmodel.ui.locale.currency( result.cost.amount / 100, 2 ) : "Paid";
    const subtitle : string = `${ result.provider } · ${ priceLabel }`;

    return  <ImageListItem sx={{ border: "1px solid", borderColor: "divider", borderRadius: 1, overflow: "hidden" }}>

                {/* thumbnail (click → open the larger preview / provider asset) */}
                <Box onClick={ () => BrowserUtils.open( result.previewUrl || result.sourceUrl || result.thumbnailUrl || "" ) }
                     sx={{ position: "relative", height: props.imgHeight, display: "flex", alignItems: "center", justifyContent: "center",
                           bgcolor: "background.default", cursor: "pointer", overflow: "hidden" }}>
                    { result.thumbnailUrl
                        ? <Box component="img" src={ result.thumbnailUrl } alt={ result.title } loading="lazy" sx={{ width: "100%", height: "100%", objectFit: "cover" }} />
                        : <MovieOutlinedIcon sx={{ fontSize: 48, color: "text.disabled" }} /> }

                    {/* license badge (top-left) */}
                    <Chip size="small" label={ result.license.type } sx={{ position: "absolute", top: 6, left: 6, bgcolor: "rgba(0,0,0,0.6)", color: "common.white" }} />
                    {/* kind glyph (top-right) for video/audio */}
                    <Box sx={{ position: "absolute", top: 6, right: 6 }}>{ kindBadge() }</Box>
                </Box>

                {/* title bar below with the add + open actions */}
                <ImageListItemBar
                    position="below"
                    title={ result.title }
                    subtitle={ subtitle }
                    actionIcon={
                        <Box sx={{ display: "flex", pr: 0.5 }}>
                            <ButtonIcon id={ `browse-import-${ result.externalId }` }
                                        label={ imported ? "In your library" : result.cost.free ? "Add to library" : "Purchase & add" }
                                        icon={ importing ? <CircularProgress size={ 16 } />
                                            : imported ? <CheckCircleOutlineOutlinedIcon fontSize="small" color="success" />
                                            : <AddPhotoAlternateOutlinedIcon fontSize="small" /> }
                                        size="small" disabled={ importing || imported } onClick={ () => void onImport() } />
                            <ButtonIcon id={ `browse-open-${ result.externalId }` }
                                        label={"Open on provider"}
                                        icon={ <OpenInNewOutlinedIcon fontSize="small" /> }
                                        size="small" disabled={ !result.sourceUrl } onClick={ () => BrowserUtils.open( result.sourceUrl ?? "" ) } />
                        </Box>
                    }
                    actionPosition="right"
                    sx={{ ".MuiImageListItemBar-titleWrap": { pl: 1.5, pr: 0 } }}
                />
            </ImageListItem>;
}

export namespace BrowseResultCard
{
    export interface Props
    {
        result    : Browse.Result;
        imgHeight : number;
        onImport  : () => Promise<boolean>;   // true = imported (flip to done)
    }
}

export default BrowseResultCard;
// eof
