//
import React from 'react';
import { JSX } from "react";

//
import { Box, useTheme, Theme } from '@mui/material';

//
import CodeMirror, { EditorView, Extension }    from '@uiw/react-codemirror';
import { javascript }                           from '@codemirror/lang-javascript';
import { json, jsonParseLinter }                from '@codemirror/lang-json';
import { html }                                 from '@codemirror/lang-html';
import { css }                                  from '@codemirror/lang-css';
import { linter, lintGutter }                   from '@codemirror/lint';

// Theme imports
import { vscodeDark, vscodeLight } from '@uiw/codemirror-theme-vscode';
//import { githubDark, githubLight } from '@uiw/codemirror-theme-github';

// JSON Schema validation
import Ajv from 'ajv';
import addFormats from 'ajv-formats';



export function CodeEditorInput( props : CodeEditorInput.Props ) : JSX.Element
{
    const theme : Theme = useTheme();

    // state
    const [value, setValue]             = React.useState< string >( props.value );
    const [extensions, setExtensions]   = React.useState< Array<Extension> >( [] );

    // Determine theme based on Material-UI theme mode
    const isDarkMode : boolean   = theme.palette.mode === 'dark';
    const baseTheme  : Extension = isDarkMode ? vscodeDark : vscodeLight;
    
    // Create font size extension with proper memoization
    const fontSizeExtension = React.useMemo(() => EditorView.theme({
        '&': {
            fontSize: `${props.fontSize || 14}px`
        },
        '.cm-content': {
            fontSize: `${props.fontSize || 14}px`
        },
        '.cm-editor': {
            fontSize: `${props.fontSize || 14}px`
        }
    }), [props.fontSize]);

    // Create schema validator if JSON schema is provided
    const createSchemaLinter = React.useCallback( lintSchema, [props.format, props.jsonSchema]);

    //
    React.useEffect( valueChanged, [props.value] );
    React.useEffect( formatChanged, [props.format, props.jsonSchema, fontSizeExtension ] );

    ///////////////////////////////////////////////////////////////////////////////////////////////////
    function lintSchema() : Extension | null
    {
        if (props.format === 'json' && props.jsonSchema)
        {
            const ajv : Ajv = new Ajv({ allErrors: true, allowUnionTypes: true });
            addFormats(ajv); // Add format validators (email, uri, date-time, etc.)
            const validate = ajv.compile( props.jsonSchema );
            
            return linter((view : EditorView ) =>
            {
                const doc : any = view.state.doc;
                const text : string = doc.toString();
                
                try
                {
                    const parsed : any = JSON.parse( text );
                    const valid  : boolean = validate( parsed );
                    
                    if( !valid && validate.errors )
                    {
                        return validate.errors.map( error => {
                            const position = findErrorPosition(text, error.instancePath || '');
                            return {
                                from: position.from,
                                to: position.to-1,
                                severity: 'error' as const,
                                message: `${error.instancePath || 'Root'}: ${error.message}`
                            };
                        });
                    }
                }
                catch ( parseError )
                {
                    // JSON parse error - let the built-in parser handle it
                }
                
                return [];
            });
        }
        return null;
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////
    function findErrorPosition(text: string, instancePath: string): { from: number; to: number }
    {
        if (!instancePath || instancePath === '')
        {
            // Root level error - highlight the first meaningful content
            return { from: 0, to: Math.min( text.length, 100) };
        }

        // Parse the instance path (e.g., "/users/0/name" or "/config/timeout")
        const pathParts = instancePath.split('/').filter(part => part !== '');
        
        try
        {
            // Find the position by walking through the JSON structure
            const lines : Array<string> = text.split('\n');
            let currentPath:  Array<string> = [];
            let targetFound : boolean = false;
            let errorLine : number = 0;
            let errorCol : number = 0;
            let i : number;

            for ( i = 0; i < lines.length && !targetFound; i++)
            {
                const line : string = lines[i];
                const trimmedLine : string = line.trim();
                
                // Look for property names in quotes
                const propertyMatch : RegExpMatchArray | null = trimmedLine.match(/^"([^"]+)"\s*:/);
                if (propertyMatch)
                {
                    const propertyName : string = propertyMatch[1];
                    
                    // Check if we're entering the target path
                    if (pathParts.length > currentPath.length && 
                        pathParts[currentPath.length] === propertyName)
                    {
                        currentPath.push(propertyName);
                        
                        // If we've reached the target property
                        if (currentPath.length === pathParts.length)
                        {
                            errorLine = i;
                            errorCol = line.indexOf(`"${propertyName}"`);
                            targetFound = true;
                            break;
                        }
                    }
                }
                
                // Handle array indices
                const arrayMatch : RegExpMatchArray | null = trimmedLine.match(/^\[/);
                if (arrayMatch && pathParts.length > currentPath.length)
                {
                    const expectedIndex : string = pathParts[currentPath.length];
                    if (!isNaN(Number(expectedIndex)))
                    {
                        // This is a simplified approach - in a real implementation
                        // you'd want to count array elements more precisely
                        currentPath.push(expectedIndex);
                    }
                }
                
                // Reset path on closing braces/brackets at appropriate levels
                if (trimmedLine.includes('}') || trimmedLine.includes(']'))
                {
                    // Simplified path tracking - could be more sophisticated
                    if (currentPath.length > 0)
                    {
                        currentPath.pop();
                    }
                }
            }

            if (targetFound)
            {
                // Calculate absolute position from line/column
                let absolutePos : number = 0;
                let i : number;

                for ( i = 0; i < errorLine; i++)
                {
                    absolutePos += lines[i].length + 1; // +1 for newline
                }
                absolutePos += errorCol;
                
                // Highlight the property name and its value
                const propertyLength : number = pathParts[pathParts.length - 1].length + 2; // +2 for quotes
                return {
                    from: absolutePos,
                    to: Math.min(absolutePos + propertyLength + 0, text.length) // Include some of the value
                };
            }
        }
        catch (error)
        {
            // Fallback to highlighting a reasonable portion
            console.warn('Error calculating position for instancePath:', instancePath, error);
        }

        // Fallback: highlight first part of document
        return { from: 0, to: Math.min(text.length, 200) };
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////
    function formatChanged() : void
    {
        const baseExtensions: Array<Extension> = [];
        const schemaLinter : Extension | null = createSchemaLinter();
        
        // Add font size extension
        baseExtensions.push(fontSizeExtension);
        
        switch( props.format )
        {
            case "javascript" : 
                baseExtensions.push(javascript({ jsx: true }));
                break;

            case "json":
                baseExtensions.push( json() );
                baseExtensions.push( linter( jsonParseLinter() ) );     // Wrap jsonParseLinter with linter()
                baseExtensions.push( lintGutter() );                    // Show lint markers in gutter
                if( schemaLinter )baseExtensions.push(schemaLinter);    // Add schema validation
                break;

            case "html":
                baseExtensions.push(html());
                break;

            case "css":
                baseExtensions.push(css());
                break;
        }
        
        setExtensions(baseExtensions);
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////
    function valueChanged() : void
    {
        if( value !== props.value )setValue( props.value );
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////
    function onChange( value : string ) : void
    {
        setValue( value );
        if( props.onChange )props.onChange( value );
    }

    // ============================================================================================
    const resolvedWidth : string = props.width === undefined
        ? "300px"
        : typeof props.width === "number" ? `${props.width}px` : props.width;

    return <Box sx={{ position: 'relative', mt: 0, width: resolvedWidth }}>
            <Box
                sx={{
                position: 'absolute',
                top: -8,
                left: 12,
                px: 0.5,
                //bgcolor: 'inherit',
                bgcolor: 'background.paper',   // key: opaque background
                color: 'text.secondary',
                fontSize: 13,
                zIndex: 1,
                pointerEvents: 'none',
                }}
            >
                { props.label }
            </Box>
            <Box
                sx={{
                border: 1,
                borderColor: 'divider',
                borderRadius: 1,
                px: 1, pt:1.5, pb: 1,
                backgroundColor: 'inherit',
                // scroll still works (wheel/trackpad) — just hide the vertical scrollbar chrome
                "& .cm-scroller": { scrollbarWidth: "none" },
                "& .cm-scroller::-webkit-scrollbar": { width: 0, height: 0, display: "none" },
                }}
            >
                <CodeMirror
                    value={value}
                    height={ props.height ? props.height + "px" : "200px" }
                    width={ resolvedWidth }
                    extensions={ extensions }
                    editable={ props.editable ?? props.editable }
                    onChange={ onChange }
                    theme={ baseTheme }
                />
            </Box>
        </Box>;


}

export namespace CodeEditorInput
{
    export interface Props
    {
        id          : string;
        label       : string;
        value       : string;
        height?     : number;
        editable?   : boolean;
        width?      : number | string;
        fontSize?   : number;        // Font size in pixels (default: 14)
        // other choices that can be added: cpp, java, lezer, markdown, php, python, rust, sql, xml, less, sass, csharp
        format      : "javascript" | "json" | "html" | "css";
        jsonSchema? : object; // JSON schema for validation (only applies when format is "json")
        onChange?   : ( ids: string ) => void;
    }
}



export default CodeEditorInput;

// eof