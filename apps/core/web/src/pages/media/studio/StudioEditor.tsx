import AppModel from "@model/AppModel";
//
import React from 'react';
import { JSX } from "react";

import { Box, Button, Chip, CircularProgress, Divider, Stack, Typography } from "@mui/material";
import BrushOutlinedIcon      from '@mui/icons-material/BrushOutlined';
import SubtitlesOutlinedIcon  from '@mui/icons-material/SubtitlesOutlined';

import { Media, GetMediaUrl, PatchAsset } from '@repo/api';
import { RestfulService } from '@repo/endpoint';

import ImageInput from '@widgets/core/ImageInput';
import VideoInput from '@widgets/core/VideoInput';
import AudioInput from '@widgets/core/AudioInput';
import CampaignSelect from '@widgets/app/CampaignSelect';
import CaptionEditorDialog from '@pages/media/dialogs/CaptionEditorDialog';
import Pusher from "../../../widgets/core/Pusher";

//
// StudioEditor — the Studio's RIGHT editing surface for the selected asset. This is the FOUNDATION (more to
// come): it loads + previews the asset (image / video / audio) and lays out the per-kind tool bar. Editing
// tools land incrementally; the one live tool today is caption editing for video/audio (reuses the existing
// CaptionEditorDialog when the asset has a .srt/.vtt caption item). The parent owns which asset is open.
//
export function StudioEditor( props : StudioEditor.Props ) : JSX.Element
{
    const appmodel : AppModel = AppModel.instance();
    const asset : Media.Asset | null = props.asset;

    const [url,setUrl]         = React.useState< string >( "" );
    const [loading,setLoading] = React.useState< boolean >( false );
    const [captionsOpen,setCaptionsOpen] = React.useState< boolean >( false );
    const [campaignIds,setCampaignIds] = React.useState< Array<string> >( asset?.campaignIds ?? [] );

    ////////////////////////////////////////////////////////////////////////////////////////////
    // load a fresh delivery URL whenever the selected asset changes; re-sync the campaign selection too
    React.useEffect( () : void => { void loadUrl(); setCampaignIds( asset?.campaignIds ?? [] ); }, [ asset?.guid ] );

    async function loadUrl() : Promise<void>
    {
        setUrl( "" );
        if( !asset ) return;
        setLoading( true );
        const reply : RestfulService.Reply<GetMediaUrl.Response> = await appmodel.server.fetch( new GetMediaUrl( asset.guid ) );
        if( reply.ok && reply.data ) setUrl( reply.data.url );
        setLoading( false );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // assign the campaign(s) this asset belongs to — PatchAsset, then hand the updated asset up so the tree
    // re-groups the row under its campaign folder(s)
    async function onCampaigns( ids : Array<string> ) : Promise<void>
    {
        setCampaignIds( ids );
        if( !asset ) return;
        const reply : RestfulService.Reply<PatchAsset.Response> = await appmodel.server.fetch( new PatchAsset( asset.guid, { campaignIds: ids } ) );
        if( reply.ok && reply.data && props.onAssetUpdated ) props.onAssetUpdated( reply.data.asset );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // the asset's editable caption item (.srt/.vtt), if one exists — enables the caption editor
    const captionItem : Media.Item | undefined = asset?.items.find( ( item : Media.Item ) : boolean =>
        item.usage === Media.Usage.TRANSCRIPT && ( item.extension === "srt" || item.extension === "vtt" ) );

    // the per-kind tools shown in the toolbar (most are placeholders until built — "more to come")
    function toolsFor( kind : Media.Kind ) : Array<string>
    {
        if( kind === Media.Kind.IMAGE ) return [ "Crop", "Rotate", "Adjust", "Filters", "Annotate" ];
        if( kind === Media.Kind.VIDEO ) return [ "Trim", "Poster", "Overlay", "Compress" ];
        if( kind === Media.Kind.AUDIO ) return [ "Trim", "Fade", "Normalize" ];
        return [];
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // the media preview for the current kind (the canvas the tools will act on)
    function preview() : JSX.Element
    {
        if( !asset ) return <></>;
        if( loading ) return <Stack direction="row" spacing={ 1 } sx={{ alignItems: "center", p: 2 }}><CircularProgress size={ 18 } /><Typography variant="body2" sx={{ color: "text.secondary" }}>{"Loading…"}</Typography></Stack>;
        if( asset.kind === Media.Kind.IMAGE ) return <ImageInput id={ `studio-img-${ asset.guid }` } value={ url } maxWidth="100%" maxHeight={ 520 } />;
        if( asset.kind === Media.Kind.VIDEO ) return <VideoInput id={ `studio-vid-${ asset.guid }` } value={ url } maxWidth="100%" />;
        if( asset.kind === Media.Kind.AUDIO ) return <AudioInput id={ `studio-aud-${ asset.guid }` } value={ url } width="100%" />;
        return <Typography variant="body2" sx={{ color: "text.secondary" }}>{"This media type can't be edited in Studio yet."}</Typography>;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    if( !asset )
        return <Stack sx={{ alignItems: "center", justifyContent: "center", height: "100%", minHeight: 320, p: 4 }}>
                   <BrushOutlinedIcon sx={{ fontSize: 48, color: "text.disabled" }} />
                   <Typography variant="body2" sx={{ color: "text.secondary", mt: 1 }}>{"Pick an asset from the project tree to start editing."}</Typography>
               </Stack>;

    const captionable : boolean = asset.kind === Media.Kind.VIDEO || asset.kind === Media.Kind.AUDIO;

    return  <Stack spacing={ 2 } sx={{ p: 2, height: "100%", minHeight: 0 }}>

                {/* header: name + kind + the campaign(s) this asset belongs to */}
                <Stack direction="row" spacing={ 1 } sx={{ alignItems: "center" }}>
                    <Typography variant="h6" sx={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ asset.name }</Typography>
                    <Chip size="small" variant="outlined" label={ asset.kind } />
                    <Pusher />
                    <Box sx={{ width: 280 }}><CampaignSelect value={ campaignIds } onChange={ onCampaigns } label={"Campaigns"} /></Box>
                </Stack>

                {/* preview canvas */}
                <Box sx={{ display: "flex", justifyContent: "center", alignItems: "center", bgcolor: "action.hover", borderRadius: 1, p: 2, minHeight: 240 }}>
                    { preview() }
                </Box>

                <Divider />

                {/* toolbar — placeholder tools (coming soon) + the live caption editor for a/v */}
                <Box>
                    <Typography variant="overline" sx={{ color: "text.secondary" }}>{"Tools"}</Typography>
                    <Stack direction="row" spacing={ 1 } sx={{ flexWrap: "wrap", gap: 1, mt: 0.5 }}>
                        { toolsFor( asset.kind ).map( ( tool : string ) => (
                            <Chip key={ tool } size="small" variant="outlined" label={ tool } disabled />
                        ) ) }
                        { captionable &&
                            <Button size="small" variant="outlined" startIcon={ <SubtitlesOutlinedIcon /> } disabled={ !captionItem } onClick={ () : void => setCaptionsOpen( true ) }>
                                { captionItem ? "Edit captions" : "No captions yet" }
                            </Button> }
                    </Stack>
                    <Typography variant="caption" sx={{ color: "text.disabled", display: "block", mt: 1 }}>
                        { "Editing tools are being built — more to come. Caption editing is available for video/audio with a transcript." }
                    </Typography>
                </Box>

                { captionsOpen && captionItem &&
                    <CaptionEditorDialog asset={ asset } item={ captionItem }
                                         onSaved={ () : boolean => true }
                                         onClose={ () : void => setCaptionsOpen( false ) } /> }

            </Stack>;
}

export namespace StudioEditor
{
    export interface Props
    {
        asset : Media.Asset | null;
        onAssetUpdated? : ( asset : Media.Asset ) => void;   // the asset changed (e.g. its campaigns) — refresh the tree
    }
}

export default StudioEditor;
// eof
