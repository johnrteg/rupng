//
import { JSX } from "react";
import { SvgDocument } from "@repo/api";

//
// ShapeObject — placeholder React renderer for a shape node. The canvas renders via the compiled SVG string
// (SvgCompiler), so this component renders nothing in the MVP; it is reserved for future direct-DOM editing.
//
export function ShapeObject( props : ShapeObject.Props ) : JSX.Element | null
{
    void props.node;
    return null;
}

export namespace ShapeObject
{
    export interface Props { node : SvgDocument.ShapeNode; }
}

export default ShapeObject;
