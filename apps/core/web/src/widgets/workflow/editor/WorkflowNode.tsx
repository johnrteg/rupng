//
import React from "react";
import { JSX } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Box, Stack, Typography } from "@mui/material";
import { styled } from "@mui/material/styles";

import { Workflow } from "@repo/api";
import { nodeKindOf } from "./WorkflowEditorModel";

//
// WorkflowNode — the custom React Flow node renderer for every node kind (registered once as
// `nodeTypes={ { workflowNode: WorkflowNode } }` in WorkflowCanvas). One component handles all 6 kinds,
// parameterized by `data.nodeType` — it renders a labeled target handle (unless the kind has no input,
// i.e. `start`) on the left, and one labeled SOURCE handle per `NODE_KINDS[...].handles` entry (or a
// single unlabeled one) stacked down the right edge — this IS the "node creation" surface: each handle
// is a drag-to-connect anchor for path/edge creation.
//

// `Handle` renders a plain DOM element, so a THEME color needs `styled()` (an inline style can't read
// theme tokens) — never a hex/rgb literal (CLAUDE.md "no hardcoded colors").
const ThemedHandle = styled( Handle )( ( { theme } ) => ( {
    background: theme.palette.text.secondary,
    width: 10, height: 10,
} ) );

export interface WorkflowNodeData
{
    [ key : string ] : unknown;
    nodeType: Workflow.NodeType;
    label:    string;
}

export function WorkflowNode( props : NodeProps & { data : WorkflowNodeData } ) : JSX.Element
{
    const kind : ReturnType<typeof nodeKindOf> = nodeKindOf( props.data.nodeType );
    const handles : Array<string> = kind.handles.length > 0 ? kind.handles : [ Workflow.DEFAULT_HANDLE ];

    return (
        <Box
            sx={ {
                position: "relative", minWidth: 180, borderRadius: 1.5, bgcolor: "background.paper",
                border: "1px solid", borderColor: props.selected ? "primary.main" : "divider",
                borderLeft: "4px solid", borderLeftColor: kind.accent,
                boxShadow: props.selected ? 4 : 1, px: 1.5, py: 1,
            } }
        >
            { kind.hasInput && <ThemedHandle type="target" position={ Position.Left } /> }

            <Stack spacing={ 0.25 }>
                <Typography variant="caption" color="text.secondary">{ kind.label }</Typography>
                <Typography variant="body2" sx={ { fontWeight: 600 } }>{ props.data.label || kind.label }</Typography>
            </Stack>

            { handles.map( ( handle : string, index : number ) : JSX.Element =>
            {
                const topPercent : string = handles.length === 1 ? "50%" : `${ ( ( index + 1 ) / ( handles.length + 1 ) ) * 100 }%`;
                return (
                    <React.Fragment key={ handle }>
                        <ThemedHandle type="source" id={ handle } position={ Position.Right } style={ { top: topPercent } } />
                        { handle !== Workflow.DEFAULT_HANDLE &&
                            <Typography variant="caption" color="text.secondary" sx={ {
                                position: "absolute", right: 14, top: topPercent, transform: "translate(0, -50%)", whiteSpace: "nowrap",
                            } }>{ handle }</Typography> }
                    </React.Fragment>
                );
            } ) }
        </Box>
    );
}

export default WorkflowNode;
