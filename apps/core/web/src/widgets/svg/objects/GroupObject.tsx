//
import { JSX } from "react";
import { SvgDocument } from "@repo/api";

//
// GroupObject — placeholder React renderer for a group node. The canvas renders via the compiled SVG string
// (SvgCompiler), so this component renders nothing in the MVP; it is reserved for future direct-DOM editing.
//
export function GroupObject( props : GroupObject.Props ) : JSX.Element | null
{
    void props.node;
    return null;
}

export namespace GroupObject
{
    export interface Props { node : SvgDocument.GroupNode; }
}

export default GroupObject;
