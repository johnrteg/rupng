//
import React from "react";
import { JSX } from "react";
import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps } from "@xyflow/react";
import { Chip } from "@mui/material";
import { useTheme, type Theme } from "@mui/material/styles";

import { Workflow } from "@repo/api";

//
// WorkflowEdge — the custom React Flow edge renderer (registered as `edgeTypes={ { workflowEdge:
// WorkflowEdge } }`). Draws the bezier path plus, for a LABELED handle ("true"/"false"/"resume"/
// "timeout"), a small chip at the path's midpoint — the labeled path IS the branch the engine takes
// (Engine.ts's `takeHandleEdge`), so seeing "true"/"false" on the two edges leaving an `if` node is the
// point of the whole exercise ("special attention to path creation").
//
export interface WorkflowEdgeData
{
    [ key : string ] : unknown;
    sourceHandle : string;
}

export function WorkflowEdge( props : EdgeProps & { data? : WorkflowEdgeData } ) : JSX.Element
{
    const theme : Theme = useTheme();
    const [ path, labelX, labelY ] = getBezierPath( {
        sourceX: props.sourceX, sourceY: props.sourceY, sourcePosition: props.sourcePosition,
        targetX: props.targetX, targetY: props.targetY, targetPosition: props.targetPosition,
    } );

    const handle : string = props.data?.sourceHandle ?? Workflow.DEFAULT_HANDLE;
    const strokeColor : string = props.selected ? theme.palette.primary.main : theme.palette.text.secondary;

    return (
        <>
            <BaseEdge id={ props.id } path={ path } markerEnd={ props.markerEnd } style={ { stroke: strokeColor, strokeWidth: props.selected ? 2 : 1.5 } } />
            { handle !== Workflow.DEFAULT_HANDLE &&
                <EdgeLabelRenderer>
                    <Chip
                        size="small"
                        label={ handle }
                        color={ handle === "false" || handle === "timeout" ? "default" : "primary" }
                        sx={ { position: "absolute", transform: `translate(-50%, -50%) translate(${ labelX }px,${ labelY }px)`, pointerEvents: "none" } }
                    />
                </EdgeLabelRenderer> }
        </>
    );
}

export default WorkflowEdge;
