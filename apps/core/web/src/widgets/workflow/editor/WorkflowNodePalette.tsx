//
import React from "react";
import { JSX } from "react";
import { Box, Stack, Typography } from "@mui/material";

import { NODE_KINDS, type NodeKindDef } from "./WorkflowEditorModel";

//
// WorkflowNodePalette — the sidebar list of insertable node kinds. Native HTML5 drag-and-drop (not
// dnd-kit) — this codebase's existing drag-onto-a-surface precedent (SvgLayersPanel.tsx) uses native
// DnD, and it's React Flow's own documented recipe for "drag a node in from a palette". Dropping is
// handled by WorkflowCanvas's `onDrop`; this component only sets the `dataTransfer` payload.
//
export function WorkflowNodePalette() : JSX.Element
{
    function onDragStart( event : React.DragEvent, kind : NodeKindDef ) : void
    {
        event.dataTransfer.setData( "application/workflow-node-type", kind.type );
        event.dataTransfer.effectAllowed = "copy";
    }

    return (
        <Box sx={ { width: 220, flexShrink: 0, borderRight: "1px solid", borderColor: "divider", overflowY: "auto", p: 1.5 } }>
            <Typography variant="subtitle2" sx={ { mb: 1 } }>Nodes</Typography>
            <Stack spacing={ 1 }>
                { NODE_KINDS.map( ( kind : NodeKindDef ) : JSX.Element => (
                    <Box
                        key={ kind.type }
                        draggable
                        onDragStart={ ( event : React.DragEvent ) : void => onDragStart( event, kind ) }
                        sx={ {
                            cursor: "grab", borderRadius: 1, border: "1px solid", borderColor: "divider",
                            borderLeft: "4px solid", borderLeftColor: kind.accent,
                            bgcolor: "background.paper", px: 1.25, py: 1,
                            "&:hover": { bgcolor: "action.hover" },
                        } }
                    >
                        <Typography variant="body2" sx={ { fontWeight: 600 } }>{ kind.label }</Typography>
                        <Typography variant="caption" color="text.secondary">{ kind.description }</Typography>
                    </Box>
                ) ) }
            </Stack>
        </Box>
    );
}

export default WorkflowNodePalette;
