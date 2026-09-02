//
import React from 'react';
import { JSX } from "react";

import { Box, Card, CardContent, CardHeader, CircularProgress, Divider, Stack, Typography } from "@mui/material";

import { Access } from '@repo/system';
import { GetSearch, Search } from '@repo/api';
import { RestfulService } from '@repo/endpoint';

import AppModel        from "@model/AppModel";
import AuthPage         from '@widgets/app/AuthPage';
import SearchInput      from '@widgets/core/SearchInput';
import SelectInput      from '@widgets/core/SelectInput';
import SearchResultsList from '@pages/search/SearchResultsList';

//
// SearchPage — v1 global content search (search-2.1). A single query box (the shared, debounced SearchInput
// widget) plus an optional type filter, calling GetSearch on change/enter and rendering the ranked hits.
// Deliberately minimal: no paging UI beyond the server's first page (GetSearch already caps `pageSize`) and
// no faceting beyond the one type dropdown — a "load more" / real pager is a follow-up once the search
// service's ranking + facets are proven out.
//
export function SearchPage( _props : SearchPage.Props ) : JSX.Element
{
    const appmodel : AppModel = AppModel.instance();

    const [query,setQuery]         = React.useState< string >( "" );
    const [typeFilter,setType]     = React.useState< Search.DocType | "" >( "" );
    const [hits,setHits]           = React.useState< Array<Search.Hit> >( [] );
    const [total,setTotal]         = React.useState< number >( 0 );
    const [loading,setLoading]     = React.useState< boolean >( false );
    const [searched,setSearched]   = React.useState< boolean >( false );

    ////////////////////////////////////////////////////////////////////////////////////////////
    // run (or clear) a search for the given query text + type filter — called from both the query box
    // and the type dropdown so each always searches with the OTHER field's latest value, not a stale one
    async function runSearch( text : string, type : Search.DocType | "" ) : Promise<void>
    {
        const trimmed : string = text.trim();
        if( trimmed === "" )
        {
            setHits( [] );
            setTotal( 0 );
            setSearched( false );
            return;
        }

        setLoading( true );
        setSearched( true );
        const search_query : GetSearch.Query =
        {
            q:    trimmed,
            type: type === "" ? undefined : type,
        };
        const reply : RestfulService.Reply<GetSearch.Response> = await appmodel.server.fetch( new GetSearch( search_query ) );
        if( reply.ok && reply.data )
        {
            setHits( reply.data.hits );
            setTotal( reply.data.total );
        }
        setLoading( false );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // SearchInput's debounced/enter onChange — text changed, keep the current type filter
    function onQueryChanged( value : string ) : void
    {
        setQuery( value );
        void runSearch( value, typeFilter );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // type filter changed — keep the current query text
    function onTypeChanged( value : string ) : void
    {
        const next : Search.DocType | "" = value as Search.DocType | "";
        setType( next );
        void runSearch( query, next );
    }

    // "Any type" plus one choice per Search.DocType
    const typeChoices : Array<SelectInput.Choice> =
    [
        { value: "", label: "Any type" },
        ...SelectInput.enumToChoices( Search.DocType ),
    ];

    ////////////////////////////////////////////////////////////////////////////////////////////
    return  <AuthPage minAccess={ Access.AccountRole.USER } title={ "Search" }>
                <Box sx={{ p: 2, mx: "auto" }}>
                    <Card variant="outlined">
                        <CardHeader title={ "Search" }
                                    subheader={ "Find campaigns, contacts, segments, and email across the account." } />
                        <Divider />
                        <CardContent>
                            <Stack direction="row" spacing={ 1 } sx={{ mb: 2, flexWrap: "wrap" }}>
                                <SearchInput id="search-query" label={ "Search" } value={ query }
                                             allowWildcard sx={{ width: 320 }}
                                             onChange={ onQueryChanged } />
                                <SelectInput id="search-type" label={ "Type" } value={ typeFilter }
                                             choices={ typeChoices } onChange={ onTypeChanged } sx={{ width: 160 }} />
                            </Stack>

                            { loading &&
                                <Stack direction="row" spacing={ 1 } sx={{ alignItems: "center", p: 1 }}>
                                    <CircularProgress size={ 18 } />
                                    <Typography variant="body2" sx={{ color: "text.secondary" }}>{ "Searching…" }</Typography>
                                </Stack> }

                            { !loading && !searched &&
                                <Typography variant="body2" sx={{ color: "text.secondary", textAlign: "center", pt: 3, pb: 1 }}>
                                    { "Start typing to search." }
                                </Typography> }

                            { !loading && searched &&
                                <>
                                    <Typography variant="caption" sx={{ color: "text.secondary" }}>
                                        { total === 1 ? "1 result" : `${ appmodel.ui.locale.number( total, 0 ) } results` }
                                    </Typography>
                                    <Box sx={{ mt: 1 }}>
                                        <SearchResultsList hits={ hits } emptyLabel={ "No results match this search." } />
                                    </Box>
                                </> }
                        </CardContent>
                    </Card>
                </Box>
            </AuthPage>;
}

export namespace SearchPage
{
    export interface Props
    {
    }
}

export default SearchPage;
// eof
