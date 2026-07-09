import AppModel from "@model/AppModel";
//
import React from 'react';
import { JSX } from "react";

import { Box, Button, CircularProgress, Slider, Stack, Typography } from "@mui/material";
import PhotoCameraOutlinedIcon from '@mui/icons-material/PhotoCameraOutlined';

import { Media, GetMediaUrl, PostAvatar } from '@repo/api';
import { RestfulService } from '@repo/endpoint';

import DialogWindow      from '@widgets/core/DialogWindow';
import SnackAlert        from '@widgets/core/SnackAlert';
import MediaUploadDialog from '@widgets/media/MediaUploadDialog';

//
// AvatarCropDialog — PAN/ZOOM a photo under a circular overlay to frame the profile avatar. It works on an
// already-uploaded USER-scope asset (the ORIGINAL is kept); the "Replace…" additional action opens the shared
// MediaUploadDialog to swap in a NEW photo (jpg/jpeg). On Save it posts the normalized crop rect to
// POST /media/avatar (which regenerates the square AVATAR variants; the media→auth event links the guid).
// Starting with no `assetId` (no avatar yet) simply prompts the user to choose one first.
//
export function AvatarCropDialog( props : AvatarCropDialog.Props ) : JSX.Element
{
    const appmodel : AppModel = AppModel.instance();
    const drag = React.useRef< { x : number; y : number; ox : number; oy : number } | null >( null );

    const [assetId,setAssetId] = React.useState< string | null >( props.assetId ?? null );
    const [uploadOpen,setUploadOpen] = React.useState< boolean >( false );
    const [url,setUrl]         = React.useState< string | null >( null );
    const [natural,setNatural] = React.useState< { w : number; h : number } | null >( null );
    const [scale,setScale]     = React.useState< number >( 1 );
    const [offset,setOffset]   = React.useState< { x : number; y : number } >( { x: 0, y: 0 } );
    const [busy,setBusy]       = React.useState< boolean >( false );
    const [snack,setSnack]     = React.useState< { message : string; severity : SnackAlert.Severity } | null >( null );

    const coverScale : number = natural ? Math.max( AvatarCropDialog.VIEWPORT / natural.w, AvatarCropDialog.VIEWPORT / natural.h ) : 1;

    ////////////////////////////////////////////////////////////////////////////////////////////
    React.useEffect( () : void => { void prepare(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [ assetId ] );

    // resolve the asset's image URL (retry while it finishes scanning), then frame it cover + centered
    async function prepare() : Promise<void>
    {
        setUrl( null ); setNatural( null );
        if( assetId === null ) return;
        let resolved : string | null = null;
        for( let attempt : number = 0; attempt < AvatarCropDialog.URL_RETRIES; attempt++ )
        {
            const reply : RestfulService.Reply<GetMediaUrl.Response> = await appmodel.server.fetch( new GetMediaUrl( assetId ) );
            if( reply.ok && reply.data ) { resolved = reply.data.url; break; }
            await new Promise<void>( ( done : () => void ) : void => { setTimeout( done, AvatarCropDialog.URL_RETRY_MS ); } );
        }
        if( resolved === null ) { setSnack( { message: "Could not load the photo — try again in a moment.", severity: "error" } ); return; }

        const image : HTMLImageElement = new Image();
        const src : string = resolved;
        image.onload = () : void =>
        {
            const cover : number = Math.max( AvatarCropDialog.VIEWPORT / image.naturalWidth, AvatarCropDialog.VIEWPORT / image.naturalHeight );
            setNatural( { w: image.naturalWidth, h: image.naturalHeight } );
            setScale( cover );
            setOffset( { x: ( AvatarCropDialog.VIEWPORT - image.naturalWidth * cover ) / 2, y: ( AvatarCropDialog.VIEWPORT - image.naturalHeight * cover ) / 2 } );
            setUrl( src );
        };
        image.onerror = () : void => setSnack( { message: "Could not load the photo.", severity: "error" } );
        image.src = src;
    }

    // a replacement photo was uploaded → swap to it (re-frames on the assetId effect)
    function onUploaded( assets : Array<Media.Asset> ) : void { setUploadOpen( false ); if( assets[ 0 ] ) setAssetId( assets[ 0 ].guid ); }

    // keep the image covering the viewport (no gaps) for a given scale
    function clamp( ox : number, oy : number, atScale : number ) : { x : number; y : number }
    {
        if( natural === null ) return { x: 0, y: 0 };
        const minX : number = AvatarCropDialog.VIEWPORT - natural.w * atScale;
        const minY : number = AvatarCropDialog.VIEWPORT - natural.h * atScale;
        return { x: Math.min( 0, Math.max( minX, ox ) ), y: Math.min( 0, Math.max( minY, oy ) ) };
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // pan (pointer drag within the viewport)
    function onPointerDown( event : React.PointerEvent<HTMLDivElement> ) : void
    {
        if( natural === null ) return;
        ( event.currentTarget as HTMLDivElement ).setPointerCapture( event.pointerId );
        drag.current = { x: event.clientX, y: event.clientY, ox: offset.x, oy: offset.y };
    }
    function onPointerMove( event : React.PointerEvent<HTMLDivElement> ) : void
    {
        if( drag.current === null ) return;
        setOffset( clamp( drag.current.ox + ( event.clientX - drag.current.x ), drag.current.oy + ( event.clientY - drag.current.y ), scale ) );
    }
    function onPointerUp() : void { drag.current = null; }

    // zoom (slider) — scale about the viewport center, then re-clamp
    function onZoom( _event : Event, value : number | Array<number> ) : void
    {
        const nextScale : number = Array.isArray( value ) ? value[ 0 ] : value;
        const center : number = AvatarCropDialog.VIEWPORT / 2;
        const ratio : number = nextScale / scale;
        setScale( nextScale );
        setOffset( clamp( center - ( center - offset.x ) * ratio, center - ( center - offset.y ) * ratio, nextScale ) );
    }

    // the normalized crop rect (fractions of the source) the current framing represents
    function cropRect() : Media.CropRect
    {
        if( natural === null ) return { x: 0, y: 0, w: 1, h: 1 };
        const side : number = AvatarCropDialog.VIEWPORT / scale;   // square region in source pixels
        return {
            x: Math.max( 0, Math.min( 1, ( 0 - offset.x ) / scale / natural.w ) ),
            y: Math.max( 0, Math.min( 1, ( 0 - offset.y ) / scale / natural.h ) ),
            w: Math.max( 0, Math.min( 1, side / natural.w ) ),
            h: Math.max( 0, Math.min( 1, side / natural.h ) ),
        };
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // Save — post the framing; the pipeline crops + resizes to the avatar variants, the event links it
    async function onSave() : Promise<boolean>
    {
        if( assetId === null || natural === null ) return false;
        setBusy( true );
        const set : RestfulService.Reply<PostAvatar.Response> = await appmodel.server.fetch( new PostAvatar( { guid: assetId, crop: cropRect() } ) );
        setBusy( false );
        if( !set.ok ) { setSnack( { message: RestfulService.error( set, "Could not set the avatar" ), severity: "error" } ); return false; }
        props.onSaved( assetId );
        return true;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    return  <DialogWindow id="avatar-crop"
                          title={"Frame your photo"}
                          minWidth="sm"
                          ready={ natural !== null && !busy }
                          yesLabel={ busy ? "Saving…" : "Save" }
                          cancelLabel={"Cancel"}
                          onYes={ onSave }
                          moreAction={ <Button size="small" startIcon={ <PhotoCameraOutlinedIcon /> } onClick={ () : void => setUploadOpen( true ) }>{"Replace…"}</Button> }
                          onClose={ props.onClose }>
                <Stack spacing={ 2 } sx={{ p: 2, alignItems: "center" }}>
                    { assetId === null
                        ? <Stack spacing={ 2 } sx={{ alignItems: "center", py: 5 }}>
                              <Typography variant="body2" sx={{ color: "text.secondary" }}>{"Choose a photo, then drag and zoom to frame it."}</Typography>
                              <Button variant="contained" startIcon={ <PhotoCameraOutlinedIcon /> } onClick={ () : void => setUploadOpen( true ) }>{"Choose photo"}</Button>
                          </Stack>
                        : url === null
                            ? <Stack sx={{ alignItems: "center", justifyContent: "center", height: AvatarCropDialog.VIEWPORT }}>
                                  <CircularProgress /><Typography variant="caption" sx={{ color: "text.secondary", mt: 1 }}>{"Preparing photo…"}</Typography>
                              </Stack>
                            : <>
                                  {/* the pan/zoom viewport with a circular overlay (mask is a big ring shadow) */}
                                  <Box onPointerDown={ onPointerDown } onPointerMove={ onPointerMove } onPointerUp={ onPointerUp }
                                       sx={{ position: "relative", width: AvatarCropDialog.VIEWPORT, height: AvatarCropDialog.VIEWPORT, overflow: "hidden", borderRadius: 1, bgcolor: "action.hover", cursor: "grab", touchAction: "none" }}>
                                      <Box component="img" src={ url } alt={ props.name } draggable={ false }
                                           sx={{ position: "absolute", left: offset.x, top: offset.y, width: natural ? natural.w * scale : "auto", height: natural ? natural.h * scale : "auto", maxWidth: "none", userSelect: "none" }} />
                                      <Box sx={{ position: "absolute", top: "50%", left: "50%", width: AvatarCropDialog.VIEWPORT, height: AvatarCropDialog.VIEWPORT, transform: "translate(-50%,-50%)", borderRadius: "50%", boxShadow: "0 0 0 9999px rgba(0,0,0,0.5)", pointerEvents: "none" }} />
                                  </Box>
                                  <Box sx={{ width: AvatarCropDialog.VIEWPORT }}>
                                      <Slider size="small" min={ coverScale } max={ coverScale * 4 } step={ 0.001 } value={ scale } onChange={ onZoom } aria-label={"Zoom"} />
                                  </Box>
                              </> }

                    { uploadOpen &&
                        <MediaUploadDialog title={"Upload photo"} scope={ Media.Scope.USER } scopeId={ props.userId } kind={ Media.Kind.IMAGE }
                                           accept={ [ "jpg", "jpeg" ] } maxFiles={ 1 } onUploaded={ onUploaded } onClose={ () : void => setUploadOpen( false ) } /> }
                    { snack && <SnackAlert message={ snack.message } severity={ snack.severity } onClose={ () : void => setSnack( null ) } /> }
                </Stack>
            </DialogWindow>;
}

export namespace AvatarCropDialog
{
    export const VIEWPORT : number = 320;   // the square crop viewport (px)
    export const URL_RETRIES : number = 8;  // resolve a just-uploaded image while it finishes scanning
    export const URL_RETRY_MS : number = 900;

    export interface Props
    {
        userId   : string;                    // avatar owner (USER-scope) — for the Replace upload
        assetId? : string;                    // an existing avatar to re-frame (omit to start by choosing a photo)
        name?    : string;
        onSaved  : ( assetGuid : string ) => void;
        onClose  : () => void;
    }
}

export default AvatarCropDialog;
// eof
