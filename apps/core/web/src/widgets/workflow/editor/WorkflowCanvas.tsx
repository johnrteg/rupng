//
import React from "react";
import { JSX } from "react";
import {
    ReactFlow, Background, Controls, MiniMap, useReactFlow,
    type Node, type Edge, type NodeChange, type EdgeChange, type Connection, type XYPosition,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Box } from "@mui/material";

import { Workflow } from "@repo/api";
import { WorkflowEditorContext, type WorkflowEditorContextValue } from "./WorkflowEditorContext";
import { WorkflowEditorActionType } from "./WorkflowEditorModel";
import { WorkflowNode, type WorkflowNodeData } from "./WorkflowNode";
import { WorkflowEdge, type WorkflowEdgeData } from "./WorkflowEdge";

const NODE_TYPES = { workflowNode: WorkflowNode };
const EDGE_TYPES = { workflowEdge: WorkflowEdge };

//
// WorkflowCanvas — the React Flow surface. Node/edge CREATION happens two ways here:
//   * a NODE drops from the palette via native HTML5 drag/drop (`onDrop`/`onDragOver`) — see
//     WorkflowNodePalette.tsx for the drag source;
//   * a PATH (edge) is drawn by dragging from one node's source handle to another's target handle —
//     React Flow calls `onConnect`, which dispatches `ADD_EDGE`.
// The reducer (`workflowEditorReducer`) is the single source of truth — this component is a thin
// controlled wrapper translating React Flow's change events into reducer actions, never holding its
// own copy of the graph.
//
export function WorkflowCanvas() : JSX.Element
{
    const editor : WorkflowEditorContextValue = React.useContext( WorkflowEditorContext );
    const flow = useReactFlow();

    const nodes : Array<Node<WorkflowNodeData>> = React.useMemo( () : Array<Node<WorkflowNodeData>> =>
        ( editor.state.definition?.nodes ?? [] ).map( ( node : Workflow.Node ) : Node<WorkflowNodeData> => ( {
            id:       node.id,
            type:     "workflowNode",
            position: node.position,
            selected: editor.state.selectedNodeId === node.id,
            data:     { nodeType: node.type, label: String( node.config.label ?? "" ) },
        } ) ), [ editor.state.definition?.nodes, editor.state.selectedNodeId ] );

    const edges : Array<Edge<WorkflowEdgeData>> = React.useMemo( () : Array<Edge<WorkflowEdgeData>> =>
        ( editor.state.definition?.edges ?? [] ).map( ( edge : Workflow.Edge ) : Edge<WorkflowEdgeData> => ( {
            id:           edge.id,
            type:         "workflowEdge",
            source:       edge.source,
            sourceHandle: edge.sourceHandle,
            target:       edge.target,
            selected:     editor.state.selectedEdgeId === edge.id,
            data:         { sourceHandle: edge.sourceHandle },
        } ) ), [ editor.state.definition?.edges, editor.state.selectedEdgeId ] );

    ////////////////////////////////////////////////////////////////////////////////////////////
    function onNodesChange( changes : Array<NodeChange> ) : void
    {
        for( const change of changes )
        {
            if( change.type === "position" && change.position )
                editor.dispatch( { type: WorkflowEditorActionType.MOVE_NODE, nodeId: change.id, position: change.position } );
            if( change.type === "position" && change.dragging === false )
                editor.dispatch( { type: WorkflowEditorActionType.COMMIT_NODE_MOVE } );
            if( change.type === "remove" )
                editor.dispatch( { type: WorkflowEditorActionType.DELETE_NODE, nodeId: change.id } );
        }
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    function onEdgesChange( changes : Array<EdgeChange> ) : void
    {
        for( const change of changes )
            if( change.type === "remove" )
                editor.dispatch( { type: WorkflowEditorActionType.DELETE_EDGE, edgeId: change.id } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    function onConnect( connection : Connection ) : void
    {
        if( !connection.source || !connection.target ) return;
        editor.dispatch( {
            type: WorkflowEditorActionType.ADD_EDGE,
            source: connection.source, sourceHandle: connection.sourceHandle ?? Workflow.DEFAULT_HANDLE, target: connection.target,
        } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    function onNodeClick( _event : React.MouseEvent, node : Node ) : void
    {
        editor.dispatch( { type: WorkflowEditorActionType.SELECT_NODE, nodeId: node.id } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    function onEdgeClick( _event : React.MouseEvent, edge : Edge ) : void
    {
        editor.dispatch( { type: WorkflowEditorActionType.SELECT_EDGE, edgeId: edge.id } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    function onPaneClick() : void
    {
        editor.dispatch( { type: WorkflowEditorActionType.SELECT_NODE, nodeId: null } );
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    function onDragOver( event : React.DragEvent ) : void
    {
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
    }

    ////////////////////////////////////////////////////////////////////////////////////////////
    function onDrop( event : React.DragEvent ) : void
    {
        event.preventDefault();
        const nodeType : string = event.dataTransfer.getData( "application/workflow-node-type" );
        if( !nodeType || !Object.values( Workflow.NodeType ).includes( nodeType as Workflow.NodeType ) ) return;

        const position : XYPosition = flow.screenToFlowPosition( { x: event.clientX, y: event.clientY } );
        editor.dispatch( { type: WorkflowEditorActionType.ADD_NODE, nodeType: nodeType as Workflow.NodeType, position } );
    }

    return (
        <Box sx={ { flexGrow: 1, minWidth: 0, height: "100%" } } onDrop={ onDrop } onDragOver={ onDragOver }>
            <ReactFlow
                nodes={ nodes }
                edges={ edges }
                nodeTypes={ NODE_TYPES }
                edgeTypes={ EDGE_TYPES }
                onNodesChange={ onNodesChange }
                onEdgesChange={ onEdgesChange }
                onConnect={ onConnect }
                onNodeClick={ onNodeClick }
                onEdgeClick={ onEdgeClick }
                onPaneClick={ onPaneClick }
                deleteKeyCode={ [ "Backspace", "Delete" ] }
                fitView
            >
                <Background />
                <Controls />
                <MiniMap />
            </ReactFlow>
        </Box>
    );
}

export default WorkflowCanvas;
