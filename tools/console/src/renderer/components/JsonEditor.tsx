import { useMemo } from "react";
import Box from "@mui/material/Box";

import CodeMirror from "@uiw/react-codemirror";
import type { Extension } from "@uiw/react-codemirror";
import { EditorView } from "@uiw/react-codemirror";
import { json, jsonParseLinter } from "@codemirror/lang-json";
import { linter, lintGutter, type Diagnostic } from "@codemirror/lint";
import { vscodeDark } from "@uiw/codemirror-theme-vscode";

import Ajv, { type ErrorObject } from "ajv";
import addFormats from "ajv-formats";

//
// JsonEditor — the Console's JSON editing surface. CodeMirror (json syntax + gutter) with two linters:
// the built-in JSON parser, and — when a `schema` is supplied — an ajv schema linter that marks the
// offending property inline. The schema comes from @repo/api's ConfigSchema for the picked service, so
// the same contract that validates server-side lints here.
//

export function JsonEditor( props : JsonEditor.Props )
{
    const extensions : Array<Extension> = useMemo( () =>
    {
        const list : Array<Extension> =
        [
            json(),
            linter( jsonParseLinter() ),
            lintGutter(),
            EditorView.theme( { "&": { fontSize: "13px" }, ".cm-content": { fontSize: "13px" } } ),
        ];
        if ( props.schema ) list.push( schemaLinter( props.schema ) );
        if ( props.readOnly ) list.push( EditorView.editable.of( false ) );
        return list;
    }, [ props.schema, props.readOnly ] );

    return (
        <Box sx={{ height: "100%", minHeight: 0, "& .cm-editor": { height: "100%" }, "& .cm-scroller": { overflow: "auto" } }}>
            <CodeMirror
                value={props.value}
                height="100%"
                theme={vscodeDark}
                extensions={extensions}
                readOnly={props.readOnly}
                onChange={props.onChange}
                basicSetup={{ foldGutter: true, highlightActiveLine: !props.readOnly }}
            />
        </Box>
    );
}

// Build a CodeMirror linter from a JSON Schema: parse the buffer, ajv-validate, and surface each error
// at the position of the property it points to (falls back to the document head).
function schemaLinter( schema : object ) : Extension
{
    const ajv : Ajv = new Ajv( { allErrors: true, allowUnionTypes: true } );
    addFormats( ajv );
    const validate = ajv.compile( schema );

    return linter( ( view : EditorView ) : Array<Diagnostic> =>
    {
        const text : string = view.state.doc.toString();
        let parsed : unknown;
        try { parsed = JSON.parse( text ); }
        catch { return []; }   // a parse error — the JSON linter already reports it

        if ( validate( parsed ) ) return [];

        return ( validate.errors ?? [] ).map( ( error : ErrorObject ) : Diagnostic =>
        {
            const span : { from : number; to : number } = locate( text, error.instancePath );
            const where : string = error.instancePath || "(root)";
            return { from: span.from, to: span.to, severity: "error", message: `${where}: ${error.message ?? "invalid"}` };
        } );
    } );
}

// Find a span for an ajv instancePath (e.g. "/tokens/accessTtlSeconds") by locating its last property
// name in the source text. Coarse but good enough to put the marker on the right line.
function locate( text : string, instancePath : string ) : { from : number; to : number }
{
    if ( !instancePath ) return { from: 0, to: Math.min( text.length, 1 ) };

    const segments : Array<string> = instancePath.split( "/" ).filter( ( s ) => s !== "" );
    const last : string = segments[ segments.length - 1 ];
    if ( last === undefined || /^\d+$/.test( last ) ) return { from: 0, to: Math.min( text.length, 1 ) };

    const needle : string = `"${last}"`;
    const at : number = text.indexOf( needle );
    if ( at < 0 ) return { from: 0, to: Math.min( text.length, 1 ) };
    return { from: at, to: at + needle.length };
}

export namespace JsonEditor
{
    export interface Props
    {
        value      : string;
        onChange   : ( value : string ) => void;
        readOnly?  : boolean;
        schema?    : object;   // JSON Schema for live ajv linting (omit for plain JSON)
    }
}

export default JsonEditor;
