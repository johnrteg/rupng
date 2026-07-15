import { useMemo, useRef, useState, useLayoutEffect } from "react";
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

/** CodeMirror-based JSON editor: assembles the editor extensions (JSON syntax, parse + optional schema linting, gutter, read-only) and renders the editing surface. */
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

    // MEASURE the container and hand CodeMirror an explicit PIXEL height. Relying on `height:100%` cascading
    // through react-codemirror's `.cm-theme` wrapper + the flex chain never bounded the editor (it grew to fit
    // all content, so only horizontal scroll worked). A concrete px height makes `.cm-scroller` scroll. The box
    // fills its (position:relative) parent via inset:0, so its height is the parent's — measured by a
    // ResizeObserver; the observed height is independent of content, so there's no measure↔grow feedback loop.
    const boxRef : React.RefObject<HTMLDivElement | null> = useRef<HTMLDivElement>( null );
    const [ pixelHeight, setPixelHeight ] = useState< number >( 0 );
    useLayoutEffect( () : ( () => void ) =>
    {
        const element : HTMLDivElement | null = boxRef.current;
        if ( !element ) return () : void => { /* nothing to observe */ };
        const observer : ResizeObserver = new ResizeObserver( ( entries : Array<ResizeObserverEntry> ) : void =>
        {
            const height : number = entries[ 0 ]?.contentRect.height ?? 0;
            if ( height > 0 ) setPixelHeight( height );
        } );
        observer.observe( element );
        return () : void => observer.disconnect();
    }, [] );

    return (
        <Box ref={ boxRef } sx={{
                position: "absolute", inset: 0, overflow: "hidden",
                // a visible, thin scrollbar so long items scroll vertically (and the affordance is obvious)
                "& .cm-scroller": { overflow: "auto", scrollbarWidth: "thin" },
                "& .cm-scroller::-webkit-scrollbar": { width: 10, height: 10 },
                "& .cm-scroller::-webkit-scrollbar-thumb": { background: "#30363d", borderRadius: 5 },
            }}>
            <CodeMirror
                value={props.value}
                height={ pixelHeight > 0 ? `${ pixelHeight }px` : "100%" }
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
    const validate : ReturnType<typeof ajv.compile> = ajv.compile( schema );

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

    // Split the JSON-pointer path into its property names, dropping the empty leading segment.
    const segments : Array<string> = instancePath.split( "/" ).filter( ( segment ) => segment !== "" );
    const last : string = segments[ segments.length - 1 ];
    // Array-index segments (purely numeric) have no quoted name to search for — point at the head instead.
    if ( last === undefined || /^\d+$/.test( last ) ) return { from: 0, to: Math.min( text.length, 1 ) };

    // Locate the first occurrence of the quoted property name and span the marker over it.
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
