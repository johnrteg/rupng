//
import { JSX } from "react";
import { SvgDocument } from "@repo/api";

//
// TextObject — placeholder React renderer for a text node. The canvas renders via the compiled SVG string
// (SvgCompiler), so this component renders nothing in the MVP; it is reserved for future direct-DOM editing.
//
export function TextObject( props : TextObject.Props ) : JSX.Element | null
{
    void props.node;
    return null;
}

export namespace TextObject
{
    export interface Props { node : SvgDocument.TextNode; }
}

export default TextObject;
