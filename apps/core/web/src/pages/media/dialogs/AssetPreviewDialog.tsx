import AppModel from "@model/AppModel";
//
import React from 'react';
import { JSX } from "react";

import { Box, CircularProgress, Stack, Typography } from "@mui/material";

import { Media, GetMediaUrl } from '@repo/api';
import { RestfulService } from '@repo/endpoint';

import DialogWindow from '@widgets/core/DialogWindow';
import ImageInput   from '@widgets/core/ImageInput';
import VideoInput   from '@widgets/core/VideoInput';
import AudioInput   from '@widgets/core/AudioInput';
import BrowserUtils from '@utils/BrowserUtils';

//
// AssetPreviewDialog — preview a media asset in a dialog (media-2.4). Resolves a time-limited delivery URL
// (GetMediaUrl) then renders it: images via ImageInput, videos via VideoInput, everything else offers an
// "Open original" hand-off (the service never streams bytes — it issues a signed URL). Parent owns open/close.
//
export function AssetPreviewDialog( props : AssetPreviewDialog.Props ) : JSX.Element
{
    const appmodel : AppModel = AppModel.instance();

    const [url,setUrl]         = React.useState< string >( "" );
    const [loading,setLoading] = React.useState< boolean >( true );
    const [error,setError]     = React.useState< string >( "" );

    ////////////////////////////////////////////////////////////////////////////////////////////
    React.useEffect( () => void resolve(), [] );

    // the item being previewed — the passed item, else the envelope's ORIGINAL
    const item : Media.Item | undefined = props.item ?? Media.originalItem( props.asset );
    const kind : Media.Kind = item?.kind ?? props.asset.kind;

    ////////////////////////////////////////////////////////////////////////////////////////////
    // fetch the signed delivery URL for the previewed item's bytes (its key, else the original)
    async function resolve() : Promise<void>
    {
        setLoading( true );
        const itemKey : string = item ? Media.itemKey( item.usage, item.profile ) : "original";
        const reply : RestfulService.Reply<GetMediaUrl.Response> = await appmodel.server.fetch( new GetMediaUrl( props.asset.guid, itemKey ) );
        if( reply.ok && reply.data ) setUrl( reply.data.url );
        else setError( RestfulService.error( reply, "Could not load a preview" ) );
        setLoading( false );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // "Open original" → new tab; keep the dialog open (return false)
    async function onOpen() : Promise<boolean>
    {
        if( url ) BrowserUtils.open( url );
        return false;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    function body() : JSX.Element
    {
        if( loading ) return <Stack direction="row" spacing={ 1 } sx={{ alignItems: "center", justifyContent: "center", p: 4 }}><CircularProgress size={ 20 } /><Typography variant="body2" sx={{ color: "text.secondary" }}>{"Loading preview…"}</Typography></Stack>;
        if( error )   return <Typography variant="body2" sx={{ color: "error.main", p: 3 }}>{ error }</Typography>;
        // natural size when the image is smaller than the dialog; scale DOWN (never up) when larger —
        // width/height auto beats CardMedia's default width:100%, and the max caps bound the large case.
        if( kind === Media.Kind.IMAGE ) return <Box sx={{ display: "flex", justifyContent: "center", p: 2 }}><ImageInput id="media-preview-image" value={ url } alt={ props.asset.name } maxWidth="100%" maxHeight={ 520 } sx={{ width: "auto", height: "auto", objectFit: "contain" }} /></Box>;
        if( kind === Media.Kind.VIDEO ) return <Box sx={{ display: "flex", justifyContent: "center", p: 2 }}><VideoInput id="media-preview-video" value={ url } maxWidth="100%" /></Box>;
        if( kind === Media.Kind.AUDIO ) return <Box sx={{ display: "flex", justifyContent: "center", p: 3 }}><AudioInput id="media-preview-audio" value={ url } width={ 460 } /></Box>;
        return <Typography variant="body2" sx={{ color: "text.secondary", p: 3 }}>{"No inline preview for this file type — open the original to view or download it."}</Typography>;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    return  <DialogWindow id="media-asset-preview"
                          title={ props.asset.name }
                          yesLabel={"Open original"}
                          cancelLabel={"Close"}
                          minWidth="md"
                          ready={ !loading && url !== "" }
                          onYes={ onOpen }
                          onClose={ props.onClose }>
                { body() }
            </DialogWindow>;
}

export namespace AssetPreviewDialog
{
    export interface Props
    {
        asset   : Media.Asset;
        item?   : Media.Item;   // a specific item to preview; omit for the envelope's ORIGINAL
        onClose : () => void;
    }
}

export default AssetPreviewDialog;
// eof
