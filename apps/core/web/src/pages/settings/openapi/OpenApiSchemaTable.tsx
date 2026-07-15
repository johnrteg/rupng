//
import React from 'react';
import { JSX } from "react";

import { Box, Stack, Table, TableBody, TableCell, TableRow, Typography } from "@mui/material";

//
// OpenApiSchemaTable — render a JSON Schema (object / array-of-object) as a compact MUI table: one row per
// field with its type, a required flag, and description + example. Nested object/array-of-object fields
// recurse into an indented sub-table. Non-object schemas render as a single type line. Presentation-only.
//
export function OpenApiSchemaTable( props : OpenApiSchemaTable.Props ) : JSX.Element
{
    const schema : OpenApiSchemaTable.JsonSchema = props.schema ?? {};

    ////////////////////////////////////////////////////////////////////////////////////////////
    // a human type label for a schema node (array<...>, enum, format-qualified scalar, …)
    function typeLabel( node : OpenApiSchemaTable.JsonSchema ) : string
    {
        if( !node ) return "any";
        if( node.enum ) return "enum";
        const kind : string | undefined = Array.isArray( node.type ) ? node.type.join( " | " ) : node.type;
        if( kind === "array" ) return `array<${ typeLabel( node.items ?? {} ) }>`;
        return ( kind ?? "object" ) + ( node.format ? ` (${ node.format })` : "" );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // the object node whose properties we tabulate (unwrap an array to its item schema)
    function objectNode( node : OpenApiSchemaTable.JsonSchema ) : OpenApiSchemaTable.JsonSchema
    {
        return node.type === "array" && node.items ? node.items : node;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // a field with its own object/array-of-object shape gets a nested table
    function hasNested( node : OpenApiSchemaTable.JsonSchema ) : boolean
    {
        const inner : OpenApiSchemaTable.JsonSchema = objectNode( node );
        return !!inner.properties && Object.keys( inner.properties ).length > 0;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // an "e.g." example string for a field: explicit examples → enum → date-time format → array hint
    function exampleText( field : OpenApiSchemaTable.JsonSchema ) : string | undefined
    {
        if( field.examples && field.examples.length > 0 ) return JSON.stringify( field.examples[ 0 ] );
        if( field.enum && field.enum.length > 0 ) return field.enum.map( ( value : unknown ) => String( value ) ).join( " | " );
        if( field.format === "date-time" ) return "\"2026-03-01T10:00:00Z\"";   // ISO 8601 (UTC)
        const kind : string | undefined = Array.isArray( field.type ) ? field.type[ 0 ] : field.type;
        if( kind === "array" && !objectNode( field ).properties ) return "[ … ]";   // scalar/opaque array
        return undefined;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    // one field row: name (+required), type, and description / example / nested shape
    function fieldRow( name : string, field : OpenApiSchemaTable.JsonSchema, required : boolean ) : JSX.Element
    {
        const example : string | undefined = exampleText( field );
        return  <TableRow key={ name } sx={{ verticalAlign: "top" }}>
                    <TableCell sx={{ borderBottom: "none", pl: 0 }}>
                        <Stack direction="row" spacing={ 1 } sx={{ alignItems: "center" }}>
                            <Typography variant="body2" sx={{ fontFamily: "monospace", fontWeight: 600 }}>{ name }</Typography>
                            { required && <Typography variant="caption" sx={{ color: "error.main" }}>{"required"}</Typography> }
                        </Stack>
                    </TableCell>
                    <TableCell sx={{ borderBottom: "none" }}>
                        <Typography variant="body2" sx={{ fontFamily: "monospace", color: "text.secondary" }}>{ typeLabel( field ) }</Typography>
                    </TableCell>
                    <TableCell sx={{ borderBottom: "none" }}>
                        { field.description && <Typography variant="body2" sx={{ color: "text.secondary" }}>{ field.description }</Typography> }
                        { example !== undefined && <Typography variant="caption" sx={{ fontFamily: "monospace", color: "text.disabled", display: "block" }}>{ `e.g. ${ example }` }</Typography> }
                        { hasNested( field ) &&
                            <Box sx={{ mt: 1, pl: 1.5, borderLeft: "2px solid", borderColor: "divider" }}>
                                <OpenApiSchemaTable schema={ field } />
                            </Box> }
                    </TableCell>
                </TableRow>;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    const node : OpenApiSchemaTable.JsonSchema = objectNode( schema );
    const properties : Record<string, OpenApiSchemaTable.JsonSchema> = node.properties ?? {};
    const names : Array<string> = Object.keys( properties );
    const required : Set<string> = new Set( node.required ?? [] );

    if( names.length === 0 )
        return <Typography variant="body2" sx={{ fontFamily: "monospace", color: "text.secondary" }}>{ typeLabel( schema ) }</Typography>;

    return  <Table size="small" sx={{ "& td": { py: 0.5 } }}>
                <TableBody>
                    { names.map( ( name : string ) => fieldRow( name, properties[ name ], required.has( name ) ) ) }
                </TableBody>
            </Table>;
}

export namespace OpenApiSchemaTable
{
    /** The subset of JSON Schema the renderer reads. */
    export interface JsonSchema
    {
        type?        : string | Array<string>;
        format?      : string;
        description? : string;
        properties?  : Record<string, JsonSchema>;
        required?    : Array<string>;
        items?       : JsonSchema;
        enum?        : Array<unknown>;
        examples?    : Array<unknown>;
    }

    export interface Props
    {
        schema : JsonSchema;
    }
}

export default OpenApiSchemaTable;
// eof
