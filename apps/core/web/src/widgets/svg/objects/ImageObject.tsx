//
import { JSX } from "react";
import { SvgDocument } from "@repo/api";

//
// ImageObject — placeholder React renderer for an image node. The canvas renders via the compiled SVG string
// (SvgCompiler), so this component renders nothing in the MVP; it is reserved for future direct-DOM editing.
//
export function ImageObject( props : ImageObject.Props ) : JSX.Element | null
{
    void props.node;
    return null;
}

export namespace ImageObject
{
    export interface Props { node : SvgDocument.ImageNode; }
}

export default ImageObject;
