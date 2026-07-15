import AppModel from "@model/AppModel";
//
import React from 'react';
import { JSX } from "react";

import { Box, CircularProgress, ImageList, ImageListItem, ImageListItemBar, Stack, Typography } from "@mui/material";
import CheckCircleIcon from '@mui/icons-material/CheckCircle';

import { Media, Browse, PostBrowseSearch, PostBrowseImport } from '@repo/api';
import { RestfulService } from '@repo/endpoint';

import DialogWindow from '@widgets/core/DialogWindow';
import SearchInput  from '@widgets/core/SearchInput';

//
// StudioProvidersDialog — search the media PROVIDER marketplace (stock catalogs / AI, the same fan-out as
// MediaBrowse) restricted to IMAGES, pick one or more, and IMPORT them into the library. The parent gets the
// imported Media.Assets via `onImported` (the editor then drops them on the canvas). Dialog owns its own
// search + selection state.
//
export function StudioProvidersDialog( props : StudioProvidersDialog.Props ) : JSX.Element
{
    const appmodel : AppModel = AppModel.instance();

    const [text,setText]         = React.useState< string >( "" );
    const [loading,setLoading]   = React.useState< boolean >( false );
    const [importing,setImporting] = React.useState< boolean >( false );
    const [results,setResults]   = React.useState< Array<Browse.Result> >( [] );
    const [selected,setSelected] = React.useState< Set<string> >( new Set<string>() );

    // a stable per-result key (a provider's ids are only unique within that provider)
    function keyFor( result : Browse.Result ) : string { return `${ result.provider }:${ result.externalId }`; }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // run an images-only search across the configured providers
    async function search() : Promise<void>
    {
        if( text.trim() === "" ) { setResults( [] ); return; }
        setLoading( true );
        const reply : RestfulService.Reply<PostBrowseSearch.Response> = await appmodel.server.fetch( new PostBrowseSearch( { text: text.trim(), kinds: [ Media.Kind.IMAGE ] } ) );
        setResults( reply.ok && reply.data ? reply.data.results : [] );
        setLoading( false );
    }

    // toggle a result in/out of the selection
    function toggle( key : string ) : void
    {
        setSelected( ( prev : Set<string> ) : Set<string> =>
        {
            const next : Set<string> = new Set<string>( prev );
            if( next.has( key ) ) next.delete( key ); else next.add( key );
            return next;
        } );
    }

    // import each selected result into the library, then hand the created assets to the parent
    async function onYes() : Promise<boolean>
    {
        const chosen : Array<Browse.Result> = results.filter( ( result : Browse.Result ) : boolean => selected.has( keyFor( result ) ) );
        if( chosen.length === 0 ) return false;
        setImporting( true );
        const assets : Array<Media.Asset> = [];
        for( const result of chosen )
        {
            const reply : RestfulService.Reply<PostBrowseImport.Response> = await appmodel.server.fetch( new PostBrowseImport( { provider: result.provider, externalId: result.externalId } ) );
            if( reply.ok && reply.data ) assets.push( reply.data.asset );
        }
        setImporting( false );
        props.onImported( assets );
        return true;
    }

    // the tile info line — provider + pixel dimensions when known
    function subtitleFor( result : Browse.Result ) : string
    {
        const parts : Array<string> = [ result.provider ];
        if( result.width && result.height ) parts.push( `${ result.width } × ${ result.height }` );
        return parts.join( " · " );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    return  <DialogWindow id="studio-providers"
                          title={"Add from Providers"}
                          yesLabel={ importing ? "Importing…" : ( selected.size > 0 ? `Import ${ selected.size }` : "Import" ) }
                          cancelLabel={"Cancel"}
                          minWidth="md"
                          ready={ selected.size > 0 && !importing }
                          onYes={ onYes }
                          onClose={ props.onClose }>
                <Stack spacing={ 2 } sx={{ p: 2, minHeight: 300 }}>
                    <SearchInput id="providers-search" label={"Search stock & AI image providers"} value={ text } onChange={ setText } onEnter={ () : void => void search() } sx={{ width: "100%" }} />
                    { loading
                        ? <Stack sx={{ alignItems: "center", justifyContent: "center", minHeight: 200 }}><CircularProgress /></Stack>
                        : results.length === 0
                            ? <Stack sx={{ alignItems: "center", justifyContent: "center", minHeight: 200 }}>
                                  <Typography variant="body2" sx={{ color: "text.secondary" }}>{ text.trim() === "" ? "Search for images to add." : "No results — try another search." }</Typography>
                              </Stack>
                            : <ImageList cols={ 4 } gap={ 8 } sx={{ m: 0 }}>
                                  { results.map( ( result : Browse.Result ) : JSX.Element => (
                                      <ImageListItem key={ keyFor( result ) }
                                                     onClick={ () : void => toggle( keyFor( result ) ) }
                                                     sx={{ cursor: "pointer", position: "relative", borderRadius: 1, overflow: "hidden",
                                                           outline: selected.has( keyFor( result ) ) ? 2 : 0, outlineColor: "primary.main", outlineStyle: "solid" }}>
                                          <Box component="img" src={ result.thumbnailUrl } alt={ result.title } loading="lazy" sx={{ width: "100%", height: 110, objectFit: "cover", display: "block", bgcolor: "action.hover" }} />
                                          { selected.has( keyFor( result ) ) &&
                                              <CheckCircleIcon sx={{ position: "absolute", top: 4, right: 4, color: "primary.main", bgcolor: "background.paper", borderRadius: "50%" }} /> }
                                          <ImageListItemBar title={ result.title } subtitle={ subtitleFor( result ) }
                                                            sx={{ "& .MuiImageListItemBar-title": { fontSize: 12 }, "& .MuiImageListItemBar-subtitle": { fontSize: 11 } }} />
                                      </ImageListItem>
                                  ) ) }
                              </ImageList> }
                </Stack>
            </DialogWindow>;
}

export namespace StudioProvidersDialog
{
    export interface Props
    {
        onImported : ( assets : Array<Media.Asset> ) => void;   // the imported library assets (may be empty)
        onClose    : () => void;
    }
}

export default StudioProvidersDialog;
// eof
