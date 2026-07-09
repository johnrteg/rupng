//
import React from 'react';
import { JSX } from "react";

import { Box, Button, Chip, Divider, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography } from "@mui/material";
import PlayArrowOutlinedIcon from '@mui/icons-material/PlayArrowOutlined';
import LockOutlinedIcon      from '@mui/icons-material/LockOutlined';
import LockOpenOutlinedIcon  from '@mui/icons-material/LockOpenOutlined';

import TextInput from '@widgets/core/TextInput';
import CodeEditorInput from '@widgets/core/CodeEditorInput';
import SelectInput from '@widgets/core/SelectInput';
import OpenApiSchemaTable from './OpenApiSchemaTable';

//
// OpenApiOperation — the DETAIL pane for one selected endpoint: a colored method chip + path + summary
// header, then description, parameters, request/response schemas, and an inline "Try it" that calls the real
// edge using the SHARED dev key entered at the top of the reference (passed in as `apiKey`). Theme tokens
// only (on-brand); no third-party doc styling.
//
export function OpenApiOperation( props : OpenApiOperation.Props ) : JSX.Element
{
    const op : OpenApiOperation.Operation = props.operation;

    const [values,setValues]   = React.useState< Record<string, string> >( {} );
    const [bodyText,setBody]   = React.useState< string >( "" );
    const [sending,setSending] = React.useState< boolean >( false );
    const [result,setResult]   = React.useState< OpenApiOperation.Result | null >( null );

    // reset the try-it inputs whenever a different operation is selected — the body seeds with a schema
    // skeleton (dummy values) so the caller edits a real shape instead of an empty box
    React.useEffect( () => { setValues( {} ); setBody( initialBody() ); setResult( null ); }, [ props.method, props.path ] );

    const parameters : Array<OpenApiOperation.Parameter> = op.parameters ?? [];
    const bodySchema : OpenApiSchemaTable.JsonSchema | undefined = op.requestBody?.content?.[ "application/json" ]?.schema;
    const secured    : boolean = ( op.security?.length ?? 0 ) > 0;
    const minRole    : string | undefined = op[ "x-min-role" ];   // RBAC minimum role (vendor extension)

    ////////////////////////////////////////////////////////////////////////////////////////////
    // method → theme color for the chip (read-only mapping, no literal colors)
    function methodColor() : "primary" | "success" | "warning" | "error" | "default"
    {
        return OpenApiOperation.colorFor( props.method );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    function setValue( name : string, value : string ) : void
    {
        setValues( ( prev : Record<string, string> ) => ( { ...prev, [ name ]: value } ) );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // one Try-it input for a parameter: an enum schema renders as a SelectInput (choices from the enum),
    // otherwise a free-text field. An OPTIONAL enum gets a leading "(none)" choice so the caller can clear
    // it — an empty value is omitted from the query string (path builder skips blanks).
    function paramInput( parameter : OpenApiOperation.Parameter ) : JSX.Element
    {
        const label : string = `${ parameter.name } (${ parameter.in })`;
        const enumValues : Array<unknown> | undefined = parameter.schema?.enum;
        // free-text fallback — no enum on the parameter's schema. PATH params become URL segments, so disallow spaces.
        if( enumValues === undefined || enumValues.length === 0 )
            return  <TextInput key={ `in-${ parameter.in }-${ parameter.name }` }
                               id={ `tryit-${ parameter.name }` } label={ label }
                               value={ values[ parameter.name ] ?? "" }
                               onChange={ ( value : string ) : void => setValue( parameter.name, value ) }
                               noSpaces={ parameter.in === "path" }
                               fullWidth />;
        // enum → dropdown; prepend a "(none)" clear option only when the parameter is optional
        const options : Array<SelectInput.Choice> = enumValues.map( ( value : unknown ) : SelectInput.Choice => ( { value: String( value ), label: String( value ) } ) );
        const choices : Array<SelectInput.Choice> = parameter.required
            ? options
            : [ { value: "", label: "(none)" }, ...options ];
        return  <SelectInput key={ `in-${ parameter.in }-${ parameter.name }` }
                             id={ `tryit-${ parameter.name }` } label={ label }
                             value={ values[ parameter.name ] ?? "" }
                             choices={ choices } required={ parameter.required }
                             onChange={ ( value : string ) : void => setValue( parameter.name, value ) } />;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // substitute {path} params + append query params → the concrete request path
    function resolvePath() : string
    {
        let path : string = props.path;
        const query : Array<string> = [];
        for( const parameter of parameters )
        {
            const raw : string = values[ parameter.name ] ?? "";
            if( parameter.in === "path" ) path = path.replace( `{${ parameter.name }}`, encodeURIComponent( raw ) );
            else if( parameter.in === "query" && raw !== "" ) query.push( `${ encodeURIComponent( parameter.name ) }=${ encodeURIComponent( raw ) }` );
        }
        return query.length > 0 ? `${ path }?${ query.join( "&" ) }` : path;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // a dummy value for one schema node — a supplied example wins, then an enum's first value, then a
    // type-appropriate placeholder (recursing into objects/arrays). Drives the pre-filled request-body skeleton.
    function dummyValue( schema : OpenApiSchemaTable.JsonSchema ) : unknown
    {
        if( schema.examples && schema.examples.length > 0 ) return schema.examples[ 0 ];
        if( schema.enum && schema.enum.length > 0 )         return schema.enum[ 0 ];
        const type : string | undefined = Array.isArray( schema.type ) ? schema.type[ 0 ] : schema.type;
        if( type === "number" || type === "integer" ) return 0;
        if( type === "boolean" )                       return false;
        if( type === "array" )                         return schema.items ? [ dummyValue( schema.items ) ] : [];
        if( type === "object" || schema.properties )   return dummyObject( schema );
        // strings + unknowns: give format-shaped hints so the skeleton reads as a real example
        if( schema.format === "date-time" ) return "2026-01-01T00:00:00Z";
        if( schema.format === "uuid" )      return "00000000-0000-0000-0000-000000000000";
        if( schema.format === "email" )     return "user@example.com";
        if( schema.format === "uri" )       return "https://example.com";
        return "";
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // build a dummy object from a schema's properties (each property filled by dummyValue)
    function dummyObject( schema : OpenApiSchemaTable.JsonSchema ) : Record<string, unknown>
    {
        const out : Record<string, unknown> = {};
        const props : Record<string, OpenApiSchemaTable.JsonSchema> = schema.properties ?? {};
        for( const key of Object.keys( props ) )
            out[ key ] = dummyValue( props[ key ] );
        return out;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // the pre-filled request-body skeleton for this operation (empty when it takes no JSON body)
    function initialBody() : string
    {
        if( !bodySchema ) return "";
        return JSON.stringify( dummyObject( bodySchema ), null, 2 );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // run the request against the real edge with the shared key. NOTE: native window.fetch (unlike our
    // RestfulService) CAN reject on a network error, so it's wrapped — this is not the prohibited pattern.
    async function onSend() : Promise<void>
    {
        setSending( true );
        setResult( null );
        const headers : Record<string, string> = { "Content-Type": "application/json" };
        if( props.apiKey.trim() !== "" ) headers[ "Authorization" ] = `Bearer ${ props.apiKey.trim() }`;
        const hasBody : boolean = props.method.toUpperCase() !== "GET" && bodyText.trim() !== "";
        try
        {
            const response : Response = await fetch( `${ props.baseUrl }${ resolvePath() }`, {
                method:  props.method.toUpperCase(),
                headers,
                body:    hasBody ? bodyText : undefined,
            } );
            const text : string = await response.text();
            setResult( { status: response.status, ok: response.ok, body: prettyJson( text ) } );
        }
        catch( error : unknown )
        {
            setResult( { status: 0, ok: false, body: String( ( error as { message? : string } )?.message ?? error ) } );
        }
        finally
        {
            setSending( false );
        }
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // pretty-print a JSON string; fall back to the raw text if it isn't JSON
    function prettyJson( text : string ) : string
    {
        try { return JSON.stringify( JSON.parse( text ), null, 2 ); }
        catch { return text; }
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // response status → chip color by class (2xx success, 4xx warning, 5xx error)
    function statusColor( status : string ) : "success" | "warning" | "error" | "default"
    {
        if( status.startsWith( "2" ) ) return "success";
        if( status.startsWith( "4" ) ) return "warning";
        if( status.startsWith( "5" ) ) return "error";
        return "default";
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    function sectionTitle( label : string ) : JSX.Element
    {
        return <Typography variant="overline" sx={{ color: "text.secondary" }}>{ label }</Typography>;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    return  <Stack spacing={ 2 }>

                {/* header */}
                <Stack direction="row" spacing={ 1 } sx={{ alignItems: "center", flexWrap: "wrap" }}>
                    <Chip size="small" color={ methodColor() } label={ props.method.toUpperCase() } sx={{ fontWeight: 700, minWidth: 64 }} />
                    <Typography variant="h6" sx={{ fontFamily: "monospace" }}>{ props.path }</Typography>
                    { op.deprecated && <Chip size="small" color="warning" variant="outlined" label={"deprecated"} /> }
                </Stack>

                {/* live request URL — updates as path/query inputs are filled in below, so the caller sees
                    exactly what will be requested (grey, monospace, below the method) */}
                <Typography variant="body2" sx={{ fontFamily: "monospace", color: "text.secondary", wordBreak: "break-all" }}>
                    { `${ props.baseUrl }${ resolvePath() }` }
                </Typography>
                { op.summary && <Typography variant="subtitle1">{ op.summary }</Typography> }
                { op.description && <Typography variant="body2" sx={{ color: "text.secondary" }}>{ op.description }</Typography> }

                {/* auth + min-role chips (from security / x-min-role) */}
                <Stack direction="row" spacing={ 1 } sx={{ alignItems: "center", flexWrap: "wrap" }}>
                    { secured
                        ? <Chip size="small" color="warning" variant="outlined" icon={ <LockOutlinedIcon /> } label={"Auth required"} />
                        : <Chip size="small" color="success" variant="outlined" icon={ <LockOpenOutlinedIcon /> } label={"No auth"} /> }
                    { minRole && <Chip size="small" color="info" variant="outlined" label={ `Min role: ${ OpenApiOperation.roleLabel( minRole ) }` } /> }
                </Stack>

                {/* parameters */}
                { parameters.length > 0 &&
                    <Box>
                        { sectionTitle( "Parameters" ) }
                        <Table size="small" sx={{ "& td": { py: 0.5 } }}>
                            <TableBody>
                                { parameters.map( ( parameter : OpenApiOperation.Parameter ) => (
                                    <TableRow key={ `${ parameter.in }-${ parameter.name }` } sx={{ verticalAlign: "top" }}>
                                        <TableCell sx={{ borderBottom: "none", pl: 0 }}>
                                            <Stack direction="row" spacing={ 1 } sx={{ alignItems: "center" }}>
                                                <Typography variant="body2" sx={{ fontFamily: "monospace", fontWeight: 600 }}>{ parameter.name }</Typography>
                                                { parameter.required && <Typography variant="caption" sx={{ color: "error.main" }}>{"required"}</Typography> }
                                            </Stack>
                                        </TableCell>
                                        <TableCell sx={{ borderBottom: "none" }}><Typography variant="body2" sx={{ fontFamily: "monospace", color: "text.secondary" }}>{ parameter.in }</Typography></TableCell>
                                        <TableCell sx={{ borderBottom: "none" }}><Typography variant="body2" sx={{ color: "text.secondary" }}>{ parameter.description ?? "" }</Typography></TableCell>
                                    </TableRow>
                                ) ) }
                            </TableBody>
                        </Table>
                    </Box> }

                {/* request body */}
                { bodySchema &&
                    <Box>
                        { sectionTitle( "Request body" ) }
                        <OpenApiSchemaTable schema={ bodySchema } />
                    </Box> }

                {/* responses */}
                { op.responses &&
                    <Box>
                        { sectionTitle( "Responses" ) }
                        <Stack spacing={ 1 }>
                            { Object.entries( op.responses ).map( ( [ status, response ] : [ string, OpenApiOperation.ResponseObj ] ) => (
                                <Box key={ status }>
                                    <Stack direction="row" spacing={ 1 } sx={{ alignItems: "center", mb: 0.5 }}>
                                        <Chip size="small" variant="outlined" color={ statusColor( status ) } label={ status } />
                                        <Typography variant="body2" sx={{ color: "text.secondary" }}>{ response.description ?? "" }</Typography>
                                    </Stack>
                                    { response.content?.[ "application/json" ]?.schema &&
                                        <Box sx={{ pl: 1.5, borderLeft: "2px solid", borderColor: "divider" }}>
                                            <OpenApiSchemaTable schema={ response.content[ "application/json" ].schema as OpenApiSchemaTable.JsonSchema } />
                                        </Box> }
                                </Box>
                            ) ) }
                        </Stack>
                    </Box> }

                <Divider />

                {/* try it (uses the shared key from the top of the reference) */}
                <Box>
                    <Stack spacing={ 2 }>
                        { props.apiKey.trim() === "" && <Typography variant="caption" sx={{ color: "text.secondary" }}>{"Enter an API key at the top to authenticate the request."}</Typography> }
                        { parameters.map( ( parameter : OpenApiOperation.Parameter ) => paramInput( parameter ) ) }
                        { bodySchema &&
                            <CodeEditorInput id={ `tryit-body-${ props.path }` } label={"Request body (JSON)"} value={ bodyText } onChange={ setBody }
                                             format="json" jsonSchema={ bodySchema } height={ 240 } width="100%" /> }
                        <Button variant="contained" startIcon={ <PlayArrowOutlinedIcon /> } disabled={ sending } onClick={ () => void onSend() } sx={{ alignSelf: "flex-start" }}>
                            { sending ? "Trying…" : "Try It" }
                        </Button>
                        { result &&
                            <Box sx={{ p: 1.5, borderRadius: 1, bgcolor: "action.selected", border: 1, borderColor: "divider" }}>
                                <Chip size="small" color={ result.ok ? "success" : "error" } label={ result.status === 0 ? "Network error" : `HTTP ${ result.status }` } sx={{ mb: 1 }} />
                                <Box component="pre" sx={{ m: 0, overflow: "auto", maxHeight: 320, fontFamily: "monospace", fontSize: 12 }}>{ result.body }</Box>
                            </Box> }
                    </Stack>
                </Box>

            </Stack>;
}

export namespace OpenApiOperation
{
    export interface Parameter { name : string; in : string; required? : boolean; description? : string; schema? : OpenApiSchemaTable.JsonSchema; }
    export interface MediaType { schema? : OpenApiSchemaTable.JsonSchema; }
    export interface RequestBody { required? : boolean; content? : Record<string, MediaType>; }
    export interface ResponseObj { description? : string; content? : Record<string, MediaType>; }

    /** The subset of an OpenAPI operation object the renderer reads. */
    export interface Operation
    {
        operationId? : string;
        summary?     : string;
        description? : string;
        tags?        : Array<string>;
        deprecated?  : boolean;
        parameters?  : Array<Parameter>;
        requestBody? : RequestBody;
        responses?   : Record<string, ResponseObj>;
        security?    : Array<unknown>;
        "x-min-role"? : string;   // vendor extension: the RBAC minimum role a caller needs
    }

    /** A flattened operation entry (one row in the left tree / one detail pane). */
    export interface Entry { method : string; path : string; operation : Operation; }

    /** A Try-it result — status 0 marks a network failure. */
    export interface Result { status : number; ok : boolean; body : string; }

    /** Shared method → theme-color mapping (used by the detail header and the left tree). */
    export function colorFor( method : string ) : "primary" | "success" | "warning" | "error" | "default"
    {
        const upper : string = method.toUpperCase();
        if( upper === "GET" )    return "primary";
        if( upper === "POST" )   return "success";
        if( upper === "DELETE" ) return "error";
        if( upper === "PUT" || upper === "PATCH" ) return "warning";
        return "default";
    }

    /** Stable id for an entry (method + path). */
    export function keyFor( entry : Entry ) : string { return `${ entry.method }-${ entry.path }`; }

    /** Human label for an Access role value (e.g. "account" → "Account Admin"). Falls back to Title Case. */
    export function roleLabel( role : string ) : string
    {
        const labels : Record<string, string> =
        {
            minimum: "Minimum", sender: "Sender", user: "User", billing: "Billing", account: "Account Admin",
            support: "Support", application: "Application", root: "Root",
        };
        return labels[ role ] ?? ( role.charAt( 0 ).toUpperCase() + role.slice( 1 ) );
    }

    export interface Props
    {
        method  : string;
        path    : string;
        operation : Operation;
        baseUrl : string;
        apiKey  : string;
    }
}

export default OpenApiOperation;
// eof
