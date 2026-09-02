//
import React from 'react';
import { JSX } from "react";

import { Box, Card, CardContent, Chip, Divider, Stack, Typography } from "@mui/material";

import { Search } from "@repo/api";
import { StringUtils } from "@repo/common";

import AppModel      from "@model/AppModel";
import LocaleService from "@model/service/LocaleService";
import Pusher        from "@widgets/core/Pusher";

//
// SearchResultsList — renders one row per ranked hit (title, type chip, highlighted/plain snippet,
// last-updated). Presentation-only: SearchPage owns the query state + fetch, this just lays the hits out.
// Kept as its own file per CLAUDE.md's "every distinct panel/row is its own component" rule.
//
export function SearchResultsList( props : SearchResultsList.Props ) : JSX.Element
{
    const appmodel : AppModel = AppModel.instance();

    ////////////////////////////////////////////////////////////////////////////////////////////
    // a stable, human label for the doc's type chip (CAMPAIGN -> "Campaign", …)
    function typeLabel( type : Search.DocType ) : string
    {
        return StringUtils.enumToString( type );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // the row's snippet: prefer the server-highlighted fragment, fall back to the raw indexed text
    function snippetFor( hit : Search.Hit ) : string
    {
        return hit.highlight ?? hit.doc.text;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // last-updated, locale-formatted (never a hand-built date string)
    function updatedLabel( hit : Search.Hit ) : string
    {
        return appmodel.ui.locale.dateTime( new Date( hit.doc.updatedAt ), LocaleService.Format.MEDIUM ) || "—";
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // one result row — title + type chip on top, snippet below, updated-at trailing
    function resultRow( hit : Search.Hit ) : JSX.Element
    {
        return  <Box key={ hit.doc.id } sx={{ py: 1.5 }}>
                    <Stack direction="row" spacing={ 1 } sx={{ alignItems: "center" }}>
                        <Typography variant="subtitle2">{ hit.doc.title }</Typography>
                        <Chip size="small" variant="outlined" label={ typeLabel( hit.doc.type ) } />
                        <Pusher />
                        <Typography variant="caption" sx={{ color: "text.secondary" }}>{ updatedLabel( hit ) }</Typography>
                    </Stack>
                    <Typography variant="body2"
                                sx={{ color: "text.secondary", mt: 0.5, overflow: "hidden", textOverflow: "ellipsis", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>
                        { snippetFor( hit ) }
                    </Typography>
                </Box>;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    if( props.hits.length === 0 )
    {
        return  <Typography variant="body2" sx={{ color: "text.secondary", textAlign: "center", pt: 3, pb: 1 }}>
                    { props.emptyLabel }
                </Typography>;
    }

    return  <Card variant="outlined">
                <CardContent>
                    <Stack spacing={ 0 } divider={ <Divider /> }>
                        { props.hits.map( ( hit : Search.Hit ) => resultRow( hit ) ) }
                    </Stack>
                </CardContent>
            </Card>;
}

export namespace SearchResultsList
{
    export interface Props
    {
        hits       : Array<Search.Hit>;
        emptyLabel : string;
    }
}

export default SearchResultsList;
// eof
