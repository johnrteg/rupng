import AppModel from "@model/AppModel";
//
import React from 'react';
import { JSX } from "react";

import { Box, CircularProgress, ImageList, ImageListItem, ImageListItemBar, Stack, ToggleButton, ToggleButtonGroup, Typography } from "@mui/material";
import CheckCircleIcon        from '@mui/icons-material/CheckCircle';
import ImageOutlinedIcon      from '@mui/icons-material/ImageOutlined';
import MovieOutlinedIcon      from '@mui/icons-material/MovieOutlined';
import AudiotrackOutlinedIcon from '@mui/icons-material/AudiotrackOutlined';

import { Media, GetAssets, GetMediaUrl } from '@repo/api';
import { RestfulService } from '@repo/endpoint';

import DialogWindow from '@widgets/core/DialogWindow';

//
// StudioLibraryPickerDialog — pick one or more assets from the account library to drop onto a Studio canvas /
// timeline. `kinds` controls which media kinds are pickable and shows a filter bar (Images / Videos / Audio)
// along the top when more than one is allowed (image editor → images only; video editor → all three). Scoped
// to the project's campaign when set. `onPick` hands back the chosen assets (guid + kind + resolved delivery
// URL + metrics) so the editor inserts them without re-resolving. Selection persists across filter switches.
//
export function StudioLibraryPickerDialog( props : StudioLibraryPickerDialog.Props ) : JSX.Element
{
    const appmodel : AppModel = AppModel.instance();
    const allowedKinds : Array<Media.Kind> = props.kinds && props.kinds.length > 0 ? props.kinds : [ Media.Kind.IMAGE ];

    const [loading,setLoading]   = React.useState< boolean >( true );
    const [filter,setFilter]     = React.useState< Media.Kind >( allowedKinds[ 0 ] );
    const [campaignOnly,setCampaignOnly] = React.useState< boolean >( props.campaignId !== undefined && props.campaignId !== "" );
    const [items,setItems]       = React.useState< Array<StudioLibraryPickerDialog.Pick> >( [] );
    const [selected,setSelected] = React.useState< Set<string> >( new Set<string>() );

    // whether a campaign scope toggle is offered (only when the project belongs to a campaign)
    const hasCampaign : boolean = props.campaignId !== undefined && props.campaignId !== "";

    // every resolved pick we've seen (across filters), so a cross-filter selection still resolves on confirm
    const registry = React.useRef< Map<string, StudioLibraryPickerDialog.Pick> >( new Map<string, StudioLibraryPickerDialog.Pick>() );

    ////////////////////////////////////////////////////////////////////////////////////////////
    React.useEffect( () => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [ filter, campaignOnly ] );

    // load the active-kind assets and resolve each to a delivery URL for the grid — scoped to this campaign
    // or the whole account library per the campaign toggle
    async function load() : Promise<void>
    {
        setLoading( true );
        const scopeCampaign : string | undefined = campaignOnly && hasCampaign ? props.campaignId : undefined;
        const reply : RestfulService.Reply<GetAssets.Response> = await appmodel.server.fetch( new GetAssets( { scope: Media.Scope.ACCOUNT, kind: filter, campaignId: scopeCampaign } ) );
        if( !reply.ok || !reply.data ) { setItems( [] ); setLoading( false ); return; }

        const resolved : Array<StudioLibraryPickerDialog.Pick | null> = await Promise.all( reply.data.records.map( ( asset : Media.Asset ) => resolvePick( asset ) ) );
        const picks : Array<StudioLibraryPickerDialog.Pick> = resolved.filter( ( pick : StudioLibraryPickerDialog.Pick | null ) : pick is StudioLibraryPickerDialog.Pick => pick !== null );
        picks.forEach( ( pick : StudioLibraryPickerDialog.Pick ) : void => { registry.current.set( pick.guid, pick ); } );
        setItems( picks );
        setLoading( false );
    }

    // resolve one asset to a delivery URL + display metrics (null when the URL can't be resolved). For a video
    // with a POSTER item we also resolve the poster's URL to use as the tile thumbnail.
    async function resolvePick( asset : Media.Asset ) : Promise<StudioLibraryPickerDialog.Pick | null>
    {
        const reply : RestfulService.Reply<GetMediaUrl.Response> = await appmodel.server.fetch( new GetMediaUrl( asset.guid ) );
        if( !reply.ok || !reply.data ) return null;
        const original : Media.Item | undefined = Media.originalItem( asset );
        const image : Media.ImageMeta | undefined = original?.meta?.image;
        const video : Media.VideoMeta | undefined = original?.meta?.video;
        const audio : Media.AudioMeta | undefined = original?.meta?.audio;

        // resolve a video's poster (when present) for the thumbnail — keep `url` as the playable video URL
        let posterUrl : string | undefined = undefined;
        const hasPoster : boolean = asset.kind === Media.Kind.VIDEO && ( asset.items ?? [] ).some( ( item : Media.Item ) : boolean => item.usage === Media.Usage.POSTER );
        if( hasPoster )
        {
            const posterReply : RestfulService.Reply<GetMediaUrl.Response> = await appmodel.server.fetch( new GetMediaUrl( asset.guid, "poster" ) );
            if( posterReply.ok && posterReply.data ) posterUrl = posterReply.data.url;
        }
        return { guid: asset.guid, name: asset.name, url: reply.data.url, posterUrl, kind: asset.kind, size: original?.size ?? 0,
                 width: image?.width ?? video?.width, height: image?.height ?? video?.height, durationSec: video?.durationSec ?? audio?.durationSec,
                 campaignIds: asset.campaignIds ?? [] };
    }

    // toggle an asset in/out of the selection
    function toggle( guid : string ) : void
    {
        setSelected( ( prev : Set<string> ) : Set<string> =>
        {
            const next : Set<string> = new Set<string>( prev );
            if( next.has( guid ) ) next.delete( guid ); else next.add( guid );
            return next;
        } );
    }

    // switch the kind filter (ignore a null value = clicking the active button)
    function onFilter( _event : React.MouseEvent<HTMLElement>, value : Media.Kind | null ) : void
    { if( value !== null ) setFilter( value ); }

    // switch the campaign scope (this campaign vs the whole account library)
    function onScope( _event : React.MouseEvent<HTMLElement>, value : string | null ) : void
    { if( value !== null ) setCampaignOnly( value === "campaign" ); }

    // the display label + icon for a kind (filter buttons + audio/video tiles)
    function kindLabel( kind : Media.Kind ) : string
    { return kind === Media.Kind.VIDEO ? "Videos" : kind === Media.Kind.AUDIO ? "Audio" : "Images"; }
    function kindIcon( kind : Media.Kind ) : JSX.Element
    {
        if( kind === Media.Kind.VIDEO ) return <MovieOutlinedIcon fontSize="small" />;
        if( kind === Media.Kind.AUDIO ) return <AudiotrackOutlinedIcon fontSize="small" />;
        return <ImageOutlinedIcon fontSize="small" />;
    }

    // the tile info line — size + (image/video dimensions | media duration)
    function subtitleFor( pick : StudioLibraryPickerDialog.Pick ) : string
    {
        const parts : Array<string> = [];
        if( pick.size ) parts.push( appmodel.ui.locale.bytes( pick.size ) );
        if( pick.width && pick.height ) parts.push( `${ pick.width } × ${ pick.height }` );
        if( pick.durationSec ) parts.push( `${ Math.floor( pick.durationSec / 60 ) }:${ String( Math.floor( pick.durationSec % 60 ) ).padStart( 2, "0" ) }` );
        return parts.join( " · " );
    }

    // the tile visual — image thumbnail (or a video's poster) when available, else a kind icon
    function tileVisual( pick : StudioLibraryPickerDialog.Pick ) : JSX.Element
    {
        const thumb : string | undefined = pick.kind === Media.Kind.IMAGE ? pick.url : pick.posterUrl;
        if( thumb !== undefined )
            return <Box component="img" src={ thumb } alt={ pick.name } loading="lazy" sx={{ width: "100%", height: 120, objectFit: "cover", display: "block", bgcolor: "action.hover" }} />;
        return  <Stack sx={{ width: "100%", height: 120, alignItems: "center", justifyContent: "center", bgcolor: "action.hover", color: "text.secondary" }}>
                    { pick.kind === Media.Kind.VIDEO ? <MovieOutlinedIcon sx={{ fontSize: 40 }} /> : <AudiotrackOutlinedIcon sx={{ fontSize: 40 }} /> }
                </Stack>;
    }

    // confirm — hand the parent every selected pick (resolved from the registry so cross-filter picks survive)
    async function onYes() : Promise<boolean>
    {
        const picks : Array<StudioLibraryPickerDialog.Pick> = Array.from( selected )
            .map( ( guid : string ) : StudioLibraryPickerDialog.Pick | undefined => registry.current.get( guid ) )
            .filter( ( pick? : StudioLibraryPickerDialog.Pick ) : pick is StudioLibraryPickerDialog.Pick => pick !== undefined );
        props.onPick( picks );
        return true;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    return  <DialogWindow id="studio-library-picker"
                          title={"Add from Library"}
                          yesLabel={ selected.size > 0 ? `Add ${ selected.size }` : "Add" }
                          cancelLabel={"Cancel"}
                          minWidth="sm"
                          ready={ selected.size > 0 }
                          onYes={ onYes }
                          onClose={ props.onClose }>
                <Box sx={{ p: 2, minHeight: 240 }}>
                    {/* filter bar — kind tabs (when >1 kind) + campaign scope (when the project has a campaign) */}
                    { ( allowedKinds.length > 1 || hasCampaign ) &&
                        <Stack direction="row" spacing={ 1 } sx={{ mb: 1.5, flexWrap: "wrap", rowGap: 1, alignItems: "center" }}>
                            { allowedKinds.length > 1 &&
                                <ToggleButtonGroup size="small" exclusive value={ filter } onChange={ onFilter }>
                                    { allowedKinds.map( ( kind : Media.Kind ) : JSX.Element => (
                                        <ToggleButton key={ kind } value={ kind }>
                                            { kindIcon( kind ) }
                                            <Box component="span" sx={{ ml: 0.5 }}>{ kindLabel( kind ) }</Box>
                                        </ToggleButton> ) ) }
                                </ToggleButtonGroup> }
                            { hasCampaign &&
                                <ToggleButtonGroup size="small" exclusive value={ campaignOnly ? "campaign" : "all" } onChange={ onScope }>
                                    <ToggleButton value="campaign">{"This campaign"}</ToggleButton>
                                    <ToggleButton value="all">{"All campaigns"}</ToggleButton>
                                </ToggleButtonGroup> }
                        </Stack> }

                    { loading
                        ? <Stack sx={{ alignItems: "center", justifyContent: "center", minHeight: 200 }}><CircularProgress /></Stack>
                        : items.length === 0
                            ? <Stack sx={{ alignItems: "center", justifyContent: "center", minHeight: 200 }}>
                                  <Typography variant="body2" sx={{ color: "text.secondary" }}>{ `No ${ kindLabel( filter ).toLowerCase() } in the library yet — import one instead.` }</Typography>
                              </Stack>
                            : <ImageList cols={ 3 } gap={ 8 } sx={{ m: 0 }}>
                                  { items.map( ( pick : StudioLibraryPickerDialog.Pick ) : JSX.Element => (
                                      <ImageListItem key={ pick.guid }
                                                     onClick={ () : void => toggle( pick.guid ) }
                                                     sx={{ cursor: "pointer", position: "relative", borderRadius: 1, overflow: "hidden",
                                                           outline: selected.has( pick.guid ) ? 2 : 0, outlineColor: "primary.main", outlineStyle: "solid" }}>
                                          { tileVisual( pick ) }
                                          { selected.has( pick.guid ) &&
                                              <CheckCircleIcon sx={{ position: "absolute", top: 4, right: 4, color: "primary.main", bgcolor: "background.paper", borderRadius: "50%" }} /> }
                                          {/* bottom bar — name + size + dimensions / duration */}
                                          <ImageListItemBar title={ pick.name } subtitle={ subtitleFor( pick ) }
                                                            sx={{ "& .MuiImageListItemBar-title": { fontSize: 12 }, "& .MuiImageListItemBar-subtitle": { fontSize: 11 } }} />
                                      </ImageListItem>
                                  ) ) }
                              </ImageList> }
                </Box>
            </DialogWindow>;
}

export namespace StudioLibraryPickerDialog
{
    /** A chosen library asset — enough for the editor to insert it without another round-trip. */
    export interface Pick
    {
        guid         : string;
        name         : string;
        url          : string;      // time-limited delivery URL (the playable media)
        posterUrl?   : string;      // a video's poster image URL (tile thumbnail)
        kind         : Media.Kind;  // image | video | audio (drives which clip the editor creates)
        size?        : number;      // original byte size
        width?       : number;      // original pixel width (image/video)
        height?      : number;      // original pixel height (image/video)
        durationSec? : number;      // media duration (video/audio)
        campaignIds? : Array<string>;   // campaigns the asset already belongs to (for non-destructive re-tagging)
    }

    export interface Props
    {
        campaignId? : string;                              // scope the picker to this campaign's assets
        kinds?      : Array<Media.Kind>;                   // pickable kinds + filter tabs (default [IMAGE])
        onPick      : ( picks : Array<Pick> ) => void;     // the chosen assets (may be empty)
        onClose     : () => void;
    }
}

export default StudioLibraryPickerDialog;
// eof
