import AppModel from "@model/AppModel";
//
import React from 'react';
import { JSX } from "react";

import { Box, Button, Card, CardContent, CardHeader, Chip, CircularProgress, Divider, ImageList, Stack, Typography } from "@mui/material";
import SearchOutlinedIcon from '@mui/icons-material/SearchOutlined';

import { Access } from '@repo/system';
import { Browse, Media, GetBrowseProviders, PostBrowseSearch, PostBrowseImport } from '@repo/api';
import { RestfulService } from '@repo/endpoint';

import AuthPage       from '@widgets/app/AuthPage';
import SearchInput    from '@widgets/core/SearchInput';
import SelectInput    from '@widgets/core/SelectInput';
import SelectMultInput from '@widgets/core/SelectMultInput';
import SnackAlert     from '@widgets/core/SnackAlert';
import AccountChange  from '@widgets/app/AccountChange';
import BrowseResultCard from '@pages/media/BrowseResultCard';

// media-type filter ("all" = every kind the selected providers serve)
const KIND_ALL : string = "all";
const KIND_CHOICES : Array<SelectInput.Choice> =
[
    { value: KIND_ALL,            label: "All types" },
    { value: Media.Kind.IMAGE,    label: "Images" },
    { value: Media.Kind.VIDEO,    label: "Videos" },
    { value: Media.Kind.AUDIO,    label: "Audio" },
];

const COST_CHOICES : Array<SelectInput.Choice> =
[
    { value: "any",  label: "Any" },
    { value: "free", label: "Free" },
    { value: "paid", label: "Paid" },
];

//
// Media : Browse — search a normalized catalog of third-party assets across the enabled providers
// (media-12..15). Pick providers + kind + cost, search (synchronous fan-out — a slow/failed provider is
// reported, not fatal), preview results, and "Add to library" to import into the account library.
//
export function MediaBrowse( props : MediaBrowse.Props ) : JSX.Element
{
    const appmodel : AppModel = AppModel.instance();

    const [providers,setProviders]   = React.useState< Array<Browse.ProviderInfo> >( [] );
    const [selected,setSelected]     = React.useState< Array<string> >( [] );
    const [text,setText]             = React.useState< string >( "" );
    const [kind,setKind]             = React.useState< string >( KIND_ALL );
    const [cost,setCost]             = React.useState< string >( "any" );

    const [results,setResults]       = React.useState< Array<Browse.Result> >( [] );
    const [statuses,setStatuses]     = React.useState< Array<Browse.ProviderStatus> >( [] );
    const [searching,setSearching]   = React.useState< boolean >( false );
    const [searched,setSearched]     = React.useState< boolean >( false );
    const [loadingProviders,setLoadingProviders] = React.useState< boolean >( true );
    const [snack,setSnack]           = React.useState< { message : string; severity : SnackAlert.Severity } | null >( null );

    ////////////////////////////////////////////////////////////////////////////////////////////
    React.useEffect( () => void loadProviders(), [] );

    ////////////////////////////////////////////////////////////////////////////////////////////
    async function loadProviders() : Promise<void>
    {
        setLoadingProviders( true );
        const reply : RestfulService.Reply<GetBrowseProviders.Response> = await appmodel.server.fetch( new GetBrowseProviders() );
        if( reply.ok && reply.data )
        {
            setProviders( reply.data.providers );
            setSelected( reply.data.providers.map( ( p ) => p.provider ) );   // default: all enabled providers
        }
        setLoadingProviders( false );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // the union of media kinds the enabled providers can serve (drives which kinds are searchable)
    function availableKinds() : Array<Media.Kind>
    {
        const set : Set<Media.Kind> = new Set<Media.Kind>();
        for( const p of providers ) for( const k of p.kinds ) set.add( k );
        return [ ...set ];
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    async function search() : Promise<void>
    {
        if( text.trim() === "" || selected.length === 0 ) return;
        setSearching( true ); setSearched( true );
        const kinds : Array<Media.Kind> = kind === KIND_ALL ? availableKinds() : [ kind as Media.Kind ];
        const query : Browse.Query = {
            text: text.trim(),
            kinds,
            providers: selected as Array<Browse.Provider>,
            filters: { cost: cost as "free" | "paid" | "any" },
        };
        const reply : RestfulService.Reply<PostBrowseSearch.Response> = await appmodel.server.fetch( new PostBrowseSearch( query ) );
        if( reply.ok && reply.data ) { setResults( reply.data.results ); setStatuses( reply.data.providers ); }
        else { setResults( [] ); setStatuses( [] ); setSnack( { message: RestfulService.error( reply, "Search failed" ), severity: "error" } ); }
        setSearching( false );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // import (download-free / purchase) a result into the library → true on success (card flips to done)
    async function importResult( result : Browse.Result ) : Promise<boolean>
    {
        const reply : RestfulService.Reply<PostBrowseImport.Response> = await appmodel.server.fetch( new PostBrowseImport( { provider: result.provider, externalId: result.externalId, purchase: !result.cost.free } ) );
        if( reply.ok ) { setSnack( { message: "Added to your library.", severity: "success" } ); return true; }
        setSnack( { message: RestfulService.error( reply, "Could not add to library" ), severity: "error" } );
        return false;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    const providerChoices : Array<SelectMultInput.Choice> = providers.map( ( p ) => ( { value: p.provider, label: p.label } ) );

    ////////////////////////////////////////////////////////////////////////////////////////////
    return  <AuthPage minAccess={ Access.AccountRole.USER } title={"Media : Browse"}>
                <Box sx={{ p: 2, mx: "auto" }}>
                    <Card variant="outlined">
                        <CardHeader title={"Browse"} subheader={"Find stock images, video, and audio to add to your library."} />
                        <Divider />
                        <CardContent>
                            <Stack spacing={ 2 }>

                                {/* ── search toolbar ────────────────────────────────────────────── */}
                                <Stack direction="row" spacing={ 0.5 } sx={{ alignItems: "center", flexWrap: "wrap", gap: 1 }}>
                                    <SearchInput id="browse-search" label={"Search assets"} value={ text } onChange={ setText } onEnter={ () => void search() } sx={{ width: 300 }} />
                                    <SelectInput id="browse-kind" label={"Type"} value={ kind } choices={ KIND_CHOICES } onChange={ setKind } sx={{ width: 150 }} />
                                    <SelectInput id="browse-cost" label={"Cost"} value={ cost } choices={ COST_CHOICES } onChange={ setCost } sx={{ width: 120 }} />
                                    <SelectMultInput id="browse-providers" label={"Providers"} value={ selected } choices={ providerChoices } onChange={ setSelected } minWidth={ 220 } />
                                    <Button variant="contained" startIcon={ <SearchOutlinedIcon /> } disabled={ searching || text.trim() === "" || selected.length === 0 } onClick={ () => void search() }>{"Search"}</Button>
                                </Stack>

                                {/* ── provider availability / per-search status ─────────────────── */}
                                { !loadingProviders && providers.length === 0 &&
                                    <Typography variant="body2" sx={{ color: "text.secondary" }}>{"No providers are configured. An administrator needs to add provider API keys."}</Typography> }

                                { statuses.length > 0 &&
                                    <Stack direction="row" spacing={ 1 } sx={{ flexWrap: "wrap", gap: 1 }}>
                                        { statuses.map( ( s ) =>
                                            <Chip key={ s.provider } size="small" variant="outlined" color={ s.ok ? "success" : "error" }
                                                  label={ s.ok ? `${ s.provider }: ${ s.count }` : `${ s.provider }: failed` } /> ) }
                                    </Stack> }

                                {/* ── results ───────────────────────────────────────────────────── */}
                                { searching &&
                                    <Stack direction="row" spacing={ 1 } sx={{ alignItems: "center", p: 2 }}><CircularProgress size={ 18 } /><Typography variant="body2" sx={{ color: "text.secondary" }}>{"Searching…"}</Typography></Stack> }

                                { !searching && searched && results.length === 0 &&
                                    <Typography variant="body2" sx={{ color: "text.secondary", p: 2 }}>{"No results — try different terms or providers."}</Typography> }

                                { !searching && !searched &&
                                    <Typography variant="body2" sx={{ color: "text.secondary", p: 2 }}>{"Search to find assets across your providers."}</Typography> }

                                { !searching && results.length > 0 &&
                                    <ImageList cols={ 4 } gap={ 12 } rowHeight={ 230 } sx={{ m: 0 }}>
                                        { results.map( ( result ) =>
                                            <BrowseResultCard key={ `${ result.provider }:${ result.externalId }` } result={ result } imgHeight={ 170 } onImport={ () => importResult( result ) } /> ) }
                                    </ImageList> }

                            </Stack>
                        </CardContent>
                    </Card>
                </Box>

                <AccountChange onClear={ () => { setResults( [] ); setStatuses( [] ); setSearched( false ); } } onRefresh={ () => void loadProviders() } />

                { snack && <SnackAlert message={ snack.message } severity={ snack.severity } onClose={ () => setSnack( null ) } /> }
            </AuthPage>;
}

export namespace MediaBrowse
{
    export interface Props {}
}

export default MediaBrowse;
// eof
