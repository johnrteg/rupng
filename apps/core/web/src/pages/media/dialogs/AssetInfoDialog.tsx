import AppModel from "@model/AppModel";
//
import React from 'react';
import { JSX } from "react";

import { Box, Chip, Divider, Stack, Typography } from "@mui/material";
import ContentCopyOutlinedIcon from '@mui/icons-material/ContentCopyOutlined';
import OpenInNewOutlinedIcon   from '@mui/icons-material/OpenInNewOutlined';

import { Media, GetMediaUrl } from '@repo/api';
import { RestfulService } from '@repo/endpoint';

import DialogWindow from '@widgets/core/DialogWindow';
import UrlInput     from '@widgets/core/UrlInput';
import ButtonIcon   from '@widgets/core/ButtonIcon';
import BrowserUtils from '@utils/BrowserUtils';

//
// AssetInfoDialog — a read-only inspector for a media asset's stored metadata (media-4): general facts plus
// the probed image (sharp) / video (ffprobe) stats and the derived variants. The primary action re-probes the
// content ("Rescan"); the parent performs the mutation and reloads. Parent owns open/close.
//
export function AssetInfoDialog( props : AssetInfoDialog.Props ) : JSX.Element
{
    const appmodel : AppModel = AppModel.instance();
    const asset : Media.Asset = props.asset;

    const [url,setUrl]       = React.useState< string >( "" );
    const [copied,setCopied] = React.useState< boolean >( false );

    ////////////////////////////////////////////////////////////////////////////////////////////
    // resolve the asset's delivery URL once (only for a servable asset — it needs bytes in S3)
    React.useEffect( () => { if( asset.status === Media.Status.OK ) void resolveUrl(); }, [] );

    ////////////////////////////////////////////////////////////////////////////////////////////
    async function resolveUrl() : Promise<void>
    {
        const reply : RestfulService.Reply<GetMediaUrl.Response> = await appmodel.server.fetch( new GetMediaUrl( asset.guid ) );
        if( reply.ok && reply.data ) setUrl( reply.data.url );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // copy the link to the clipboard (flash a "copied" tick)
    async function copyUrl() : Promise<void>
    {
        if( !url ) return;
        try { await navigator.clipboard.writeText( url ); setCopied( true ); setTimeout( () => setCopied( false ), 1500 ); }
        catch { /* clipboard blocked — the field is selectable as a fallback */ }
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // a labelled value row (skips empty/undefined values)
    function row( label : string, value : string | number | boolean | undefined ) : JSX.Element | null
    {
        if( value === undefined || value === "" ) return null;
        return  <Box key={ label } sx={{ display: "flex", gap: 2, py: 0.25 }}>
                    <Typography variant="caption" sx={{ color: "text.secondary", width: 130, flexShrink: 0 }}>{ label }</Typography>
                    <Typography variant="body2" sx={{ wordBreak: "break-word" }}>{ String( value ) }</Typography>
                </Box>;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // a locale-formatted date-time from an ISO string
    function when( iso? : string ) : string | undefined
    {
        return iso ? appmodel.ui.locale.date_time_normal.format( new Date( iso ) ) : undefined;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // the ORIGINAL item — the surface for mime/size/version + probed image/video meta (media-1.2)
    const original : Media.Item | undefined = Media.originalItem( asset );
    const image : Media.ImageMeta | undefined = original?.meta?.image;
    const video : Media.VideoMeta | undefined = original?.meta?.video;
    // the derived items (everything but the original) — shown as chips
    const derived : Array<Media.Item> = ( asset.items ?? [] ).filter( ( item ) => item.usage !== Media.Usage.ORIGINAL );

    return  <DialogWindow id="media-asset-info"
                          title={"Media info"}
                          yesLabel={"Rescan"}
                          cancelLabel={"Close"}
                          minWidth="sm"
                          onYes={ props.onRescan }
                          onClose={ props.onClose }>
                <Stack spacing={ 1.5 } sx={{ p: 2 }}>

                    {/* ── general ─────────────────────────────────────────────────────────── */}
                    <Box>
                        <Typography variant="subtitle2">{ asset.name }</Typography>
                        <Box sx={{ mt: 0.5 }}>
                            { row( "Type", asset.kind ) }
                            { row( "MIME", original?.mime ) }
                            { row( "Size", original ? appmodel.ui.locale.bytes( original.size ) : undefined ) }
                            { row( "Status", asset.status ) }
                            { row( "Scope", asset.scope ) }
                            { row( "Tier", asset.tier ) }
                            { row( "Version", original ? `v${ original.version }` : undefined ) }
                            { row( "Items", ( asset.items ?? [] ).length ) }
                            { row( "Campaigns", ( asset.campaignIds ?? [] ).length ) }
                            { row( "Tags", ( asset.tags ?? [] ).join( ", " ) ) }
                            { row( "Uploaded", when( asset.createdAt ) ) }
                            { row( "Modified", when( asset.modifiedAt ) ) }
                        </Box>
                    </Box>

                    {/* ── public link (copy / open) ───────────────────────────────────────── */}
                    { url &&
                        <Box>
                            <Stack direction="row" spacing={ 1 } sx={{ alignItems: "center" }}>
                                <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                                    <UrlInput id="media-link" label={"Media link"} value={ url } />
                                </Box>
                                <ButtonIcon id="media-link-copy" label={ copied ? "Copied" : "Copy link" } icon={ <ContentCopyOutlinedIcon fontSize="small" /> } size="small" onClick={ () => void copyUrl() } />
                                <ButtonIcon id="media-link-open" label={"Open in new tab"} icon={ <OpenInNewOutlinedIcon fontSize="small" /> } size="small" onClick={ () => BrowserUtils.open( url ) } />
                            </Stack>
                            <Typography variant="caption" sx={{ color: "text.secondary" }}>{"Time-limited signed URL."}</Typography>
                        </Box>
                    }

                    {/* ── image stats ─────────────────────────────────────────────────────── */}
                    { image &&
                        <>
                            <Divider textAlign="left"><Typography variant="caption" sx={{ color: "text.secondary" }}>{"Image"}</Typography></Divider>
                            <Box>
                                { row( "Dimensions", `${ image.width } × ${ image.height } px` ) }
                                { row( "Format", image.format ) }
                                { row( "Color space", image.space ) }
                                { row( "Channels", image.channels ) }
                                { row( "Bit depth", image.depth ) }
                                { row( "Density", image.density ? `${ image.density } dpi` : undefined ) }
                                { row( "Alpha", image.hasAlpha ) }
                                { row( "Orientation", image.orientation ) }
                                { row( "Pages", image.pages ) }
                            </Box>
                        </>
                    }

                    {/* ── video stats ─────────────────────────────────────────────────────── */}
                    { video &&
                        <>
                            <Divider textAlign="left"><Typography variant="caption" sx={{ color: "text.secondary" }}>{"Video"}</Typography></Divider>
                            <Box>
                                { row( "Dimensions", video.width && video.height ? `${ video.width } × ${ video.height } px` : undefined ) }
                                { row( "Duration", video.durationSec !== undefined ? `${ video.durationSec.toFixed( 1 ) } s` : undefined ) }
                                { row( "Frame rate", video.frameRate !== undefined ? `${ video.frameRate } fps` : undefined ) }
                                { row( "Video codec", video.videoCodec ) }
                                { row( "Audio codec", video.audioCodec ?? "none" ) }
                                { row( "Bitrate", video.bitrate !== undefined ? `${ Math.round( video.bitrate / 1000 ) } kbps` : undefined ) }
                                { row( "Pixel format", video.pixelFormat ) }
                                { row( "Rotation", video.rotation !== undefined ? `${ video.rotation }°` : undefined ) }
                                { row( "Container", video.container ) }
                            </Box>
                        </>
                    }

                    { !image && !video &&
                        <Typography variant="body2" sx={{ color: "text.secondary" }}>{"No content stats yet — rescan to probe this file."}</Typography> }

                    {/* ── derived items ───────────────────────────────────────────────────── */}
                    { derived.length > 0 &&
                        <>
                            <Divider textAlign="left"><Typography variant="caption" sx={{ color: "text.secondary" }}>{"Derived items"}</Typography></Divider>
                            <Stack direction="row" sx={{ flexWrap: "wrap", gap: 1 }}>
                                { derived.map( ( item ) =>
                                {
                                    const width  : number | undefined = item.meta?.image?.width  ?? item.meta?.video?.width;
                                    const height : number | undefined = item.meta?.image?.height ?? item.meta?.video?.height;
                                    const dims   : string = width ? ` · ${ width }${ height ? `×${ height }` : "w" }` : "";
                                    return <Chip key={ item.id } size="small" variant="outlined" label={ `${ Media.itemKey( item.usage, item.profile ) }${ dims }` } />;
                                } ) }
                            </Stack>
                        </>
                    }

                </Stack>
            </DialogWindow>;
}

export namespace AssetInfoDialog
{
    export interface Props
    {
        asset     : Media.Asset;
        onRescan  : () => Promise<boolean>;   // re-probe metadata; true closes the dialog
        onClose   : () => void;
    }
}

export default AssetInfoDialog;
// eof
