//
import React from 'react';
import { JSX } from "react";

import { Box, Chip, Divider, Stack, Typography } from "@mui/material";
import ClearOutlinedIcon from '@mui/icons-material/ClearOutlined';

import AppModel from '@model/AppModel';
import PasswordInput from '@widgets/core/PasswordInput';
import ButtonIcon from '@widgets/core/ButtonIcon';
import OpenApiNav from './OpenApiNav';
import OpenApiOperation from './OpenApiOperation';

//
// OpenApiReference — a native MUI, readme.io-style renderer for an OpenAPI 3.1 document: a shared dev-key +
// title bar across the top, endpoints grouped in a tree on the LEFT, and the selected endpoint's details on
// the RIGHT. The one key entered up top authenticates every "Try it". On-brand (theme tokens, house widgets).
//
export function OpenApiReference( props : OpenApiReference.Props ) : JSX.Element
{
    const appmodel : AppModel = AppModel.instance();
    const document : OpenApiReference.Document = props.spec;

    // the Try-it key persists in browser storage so it survives navigation + reloads (dev convenience)
    const [apiKey,setApiKey]     = React.useState< string >( appmodel.localStorage.get( OpenApiReference.STORAGE_KEY ) ?? "" );
    const [selectedKey,setKey]   = React.useState< string | null >( null );

    ////////////////////////////////////////////////////////////////////////////////////////////
    // update + persist the key on every edit
    function onKeyChange( value : string ) : void
    {
        setApiKey( value );
        appmodel.localStorage.set( OpenApiReference.STORAGE_KEY, value );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // clear the key from state + storage
    function onClearKey() : void
    {
        setApiKey( "" );
        appmodel.localStorage.set( OpenApiReference.STORAGE_KEY, "" );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // flatten paths → operations grouped by first tag (fallback "General")
    function grouped() : Record<string, Array<OpenApiOperation.Entry>>
    {
        const groups : Record<string, Array<OpenApiOperation.Entry>> = {};
        for( const [ path, methods ] of Object.entries( document.paths ?? {} ) )
            for( const [ method, raw ] of Object.entries( methods ) )
            {
                const operation : OpenApiOperation.Operation = raw as OpenApiOperation.Operation;
                const tag : string = operation.tags?.[ 0 ] ?? "General";
                ( groups[ tag ] ??= [] ).push( { method, path, operation } );
            }
        return groups;
    }

    const groups : Record<string, Array<OpenApiOperation.Entry>> = grouped();
    const tags : Array<string> = Object.keys( groups ).sort();
    const entries : Array<OpenApiOperation.Entry> = tags.flatMap( ( tag : string ) => groups[ tag ] );

    // default the selection to the first endpoint once the spec is available
    React.useEffect( () => { if( !selectedKey && entries.length > 0 ) setKey( OpenApiOperation.keyFor( entries[ 0 ] ) ); }, [ entries.length ] );

    const selected : OpenApiOperation.Entry | undefined = entries.find( ( entry : OpenApiOperation.Entry ) => OpenApiOperation.keyFor( entry ) === selectedKey );

    ////////////////////////////////////////////////////////////////////////////////////////////
    return  <Stack spacing={ 2 } sx={{ height: "100%", minHeight: 0 }}>

                {/* top bar — title/version · host, and the dev key (to the right of the host, same line) */}
                <Stack direction="row" spacing={ 1 } sx={{ alignItems: "center" }}>
                    <Typography variant="h6">{ document.info?.title }</Typography>
                    { document.info?.version && <Chip size="small" variant="outlined" label={ `v${ document.info.version }` } /> }
                    <Box sx={{ flexGrow: 1 }} />
                    <Typography variant="caption" sx={{ fontFamily: "monospace", color: "text.disabled", whiteSpace: "nowrap" }}>{ props.baseUrl }</Typography>
                    <Box sx={{ width: 260 }}>
                        <PasswordInput id="apidocs-key" label={"API Key"} value={ apiKey } onChange={ onKeyChange } />
                    </Box>
                    <ButtonIcon id="apidocs-key-clear" label={"Clear key"} icon={ <ClearOutlinedIcon fontSize="small" /> } disabled={ apiKey === "" } onClick={ onClearKey } />
                </Stack>

                {/* two-pane: tree (left) + detail (right) */}
                <Box sx={{ flexGrow: 1, minHeight: 480, display: "flex", flexDirection: "row", border: 1, borderColor: "divider", borderRadius: 1, overflow: "hidden" }}>

                    <Box sx={{ width: 300, flexShrink: 0, overflowY: "auto", p: 1 }}>
                        { tags.length === 0
                            ? <Typography variant="body2" sx={{ color: "text.secondary", p: 1 }}>{"No published endpoints yet."}</Typography>
                            : <OpenApiNav groups={ groups } tags={ tags } selectedKey={ selectedKey } onSelect={ ( entry : OpenApiOperation.Entry ) => setKey( OpenApiOperation.keyFor( entry ) ) } /> }
                    </Box>

                    <Divider orientation="vertical" flexItem />

                    <Box sx={{ flexGrow: 1, minWidth: 0, overflowY: "auto", p: 2 }}>
                        { selected
                            ? <OpenApiOperation method={ selected.method } path={ selected.path } operation={ selected.operation } baseUrl={ props.baseUrl } apiKey={ apiKey } />
                            : <Typography variant="body2" sx={{ color: "text.secondary" }}>{"Select an endpoint to see its details."}</Typography> }
                    </Box>

                </Box>

            </Stack>;
}

export namespace OpenApiReference
{
    export const STORAGE_KEY : string = "apidocs.key";   // persisted Try-it dev key

    export interface Document
    {
        openapi?    : string;
        info?       : { title? : string; version? : string; description? : string };
        paths?      : Record<string, Record<string, unknown>>;   // operation values are cast in grouped()
        components? : Record<string, unknown>;
    }

    export interface Props
    {
        spec    : Document;
        baseUrl : string;
    }
}

export default OpenApiReference;
// eof
