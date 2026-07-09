import AppModel from "@model/AppModel";
//
import React from 'react';
import { JSX } from "react";

import { CircularProgress, Stack, Typography } from "@mui/material";

import { GetOpenApi } from '@repo/api';
import { RestfulService } from '@repo/endpoint';

import OpenApiReference from '@pages/settings/openapi/OpenApiReference';

//
// ApiDocsViewer — the interactive published-API reference, rendered by our native MUI renderer
// (OpenApiReference) from the live OpenAPI 3.1 document. We fetch the spec through the app's own request layer
// (GetOpenApi) and pass it in; the per-operation "Try it" calls the real edge with a pasted dev key. MUI +
// theme tokens throughout (on-brand) — no embedded third-party doc portal.
//
export function ApiDocsViewer( props : ApiDocsViewer.Props ) : JSX.Element
{
    const appmodel : AppModel = AppModel.instance();

    const [spec,setSpec]       = React.useState< GetOpenApi.Response | null >( null );
    const [loading,setLoading] = React.useState< boolean >( true );

    ////////////////////////////////////////////////////////////////////////////////////////////
    React.useEffect( () => { void load(); }, [] );

    ////////////////////////////////////////////////////////////////////////////////////////////
    // fetch the live OpenAPI document (unauthenticated, generated from the PUBLIC contracts)
    async function load() : Promise<void>
    {
        setLoading( true );
        const reply : RestfulService.Reply<GetOpenApi.Response> = await appmodel.server.fetch( new GetOpenApi() );
        if( reply.ok && reply.data ) setSpec( reply.data );
        setLoading( false );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    if( loading )
        return <Stack direction="row" spacing={ 1 } sx={{ alignItems: "center", p: 2 }}><CircularProgress size={ 18 } /><Typography variant="body2" sx={{ color: "text.secondary" }}>{"Loading API reference…"}</Typography></Stack>;

    if( !spec )
        return <Typography variant="body2" sx={{ color: "text.secondary", p: 2 }}>{"Could not load the API reference."}</Typography>;

    return <OpenApiReference spec={ spec } baseUrl={ appmodel.server.baseUrl } />;
}

export namespace ApiDocsViewer
{
    export interface Props
    {
    }
}

export default ApiDocsViewer;
// eof
