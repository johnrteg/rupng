//
import { Workflow } from "@repo/api";

import {
    WorkflowEditorState, WorkflowEditorAction, WorkflowEditorActionType,
    HistoryStack, HISTORY_MAX_SIZE, makeId, nodeKindOf,
} from "./WorkflowEditorModel";

//
// workflowEditorReducer — the pure state transition for the workflow node-graph editor (no React).
// Every graph mutation flows through here so undo/redo can snapshot the definition. Snapshots are
// full-definition copies pushed onto a bounded ring (mirrors svgEditorReducer's pattern) — a node
// drag's LIVE position updates (`MOVE_NODE`) do NOT snapshot; only the drag's commit (`COMMIT_NODE_MOVE`)
// does, so dragging a node one pixel at a time doesn't flood undo with hundreds of steps.
//

/** Push the current definition onto the history `past` ring (trimmed to the max) and clear `future`. */
function pushHistory( history : HistoryStack, current : Workflow.Entity | null ) : HistoryStack
{
    if( current === null ) return { past: history.past, future: [], maxSize: HISTORY_MAX_SIZE };
    const past : Array<Workflow.Entity> = [ ...history.past, current ].slice( -HISTORY_MAX_SIZE );
    return { past, future: [], maxSize: HISTORY_MAX_SIZE };
}

/** Replace one node in the definition's node list, leaving everything else untouched. */
function mapNode( definition : Workflow.Entity, nodeId : string, map : ( node : Workflow.Node ) => Workflow.Node ) : Workflow.Entity
{
    const nodes : Array<Workflow.Node> = definition.nodes.map( ( node : Workflow.Node ) : Workflow.Node => node.id === nodeId ? map( node ) : node );
    return { ...definition, nodes };
}

/** The pure editor reducer — maps (state, action) -> next state. */
export function workflowEditorReducer( state : WorkflowEditorState, action : WorkflowEditorAction ) : WorkflowEditorState
{
    switch( action.type )
    {
        // load a freshly-fetched definition — reset history + selection, mark clean
        case WorkflowEditorActionType.SET_DEFINITION :
        {
            return {
                ...state, definition: action.definition,
                selectedNodeId: null, selectedEdgeId: null,
                history: { past: [], future: [], maxSize: HISTORY_MAX_SIZE }, dirtyFlag: false,
            };
        }

        // drop a new node from the palette — snapshot for undo, select it immediately
        case WorkflowEditorActionType.ADD_NODE :
        {
            if( state.definition === null ) return state;
            const history : HistoryStack = pushHistory( state.history, state.definition );
            const node : Workflow.Node = { id: makeId( "node" ), type: action.nodeType, position: action.position, config: { ...nodeKindOf( action.nodeType ).defaultConfig } };
            const definition : Workflow.Entity = { ...state.definition, nodes: [ ...state.definition.nodes, node ] };
            return { ...state, definition, history, dirtyFlag: true, selectedNodeId: node.id, selectedEdgeId: null };
        }

        // live drag position — NOT snapshotted (see header note); COMMIT_NODE_MOVE snapshots once at drag-end
        case WorkflowEditorActionType.MOVE_NODE :
        {
            if( state.definition === null ) return state;
            const definition : Workflow.Entity = mapNode( state.definition, action.nodeId, ( node : Workflow.Node ) : Workflow.Node => ( { ...node, position: action.position } ) );
            return { ...state, definition, dirtyFlag: true };
        }

        // drag-end — snapshot the CURRENT (post-drag) definition so undo goes back to the pre-drag position
        case WorkflowEditorActionType.COMMIT_NODE_MOVE :
        {
            const history : HistoryStack = pushHistory( state.history, state.definition );
            return { ...state, history };
        }

        case WorkflowEditorActionType.UPDATE_NODE_CONFIG :
        {
            if( state.definition === null ) return state;
            const history : HistoryStack = pushHistory( state.history, state.definition );
            const definition : Workflow.Entity = mapNode( state.definition, action.nodeId, ( node : Workflow.Node ) : Workflow.Node => ( { ...node, config: action.config } ) );
            return { ...state, definition, history, dirtyFlag: true };
        }

        // remove a node AND every edge touching it
        case WorkflowEditorActionType.DELETE_NODE :
        {
            if( state.definition === null ) return state;
            const history : HistoryStack = pushHistory( state.history, state.definition );
            const nodes : Array<Workflow.Node> = state.definition.nodes.filter( ( node : Workflow.Node ) : boolean => node.id !== action.nodeId );
            const edges : Array<Workflow.Edge> = state.definition.edges.filter( ( edge : Workflow.Edge ) : boolean => edge.source !== action.nodeId && edge.target !== action.nodeId );
            const definition : Workflow.Entity = { ...state.definition, nodes, edges };
            const selectedNodeId : string | null = state.selectedNodeId === action.nodeId ? null : state.selectedNodeId;
            return { ...state, definition, history, dirtyFlag: true, selectedNodeId };
        }

        // a path/edge drawn by connecting two handles on the canvas — this IS "path creation"
        case WorkflowEditorActionType.ADD_EDGE :
        {
            if( state.definition === null ) return state;
            // a source handle carries at most one outgoing edge (a node's "true" handle can't fan out twice) —
            // replace any prior edge from this exact (source, sourceHandle) rather than stacking duplicates
            const history : HistoryStack = pushHistory( state.history, state.definition );
            const edges : Array<Workflow.Edge> = state.definition.edges.filter(
                ( edge : Workflow.Edge ) : boolean => !( edge.source === action.source && edge.sourceHandle === action.sourceHandle ) );
            const edge : Workflow.Edge = { id: makeId( "edge" ), source: action.source, sourceHandle: action.sourceHandle, target: action.target };
            const definition : Workflow.Entity = { ...state.definition, edges: [ ...edges, edge ] };
            return { ...state, definition, history, dirtyFlag: true, selectedEdgeId: edge.id, selectedNodeId: null };
        }

        case WorkflowEditorActionType.DELETE_EDGE :
        {
            if( state.definition === null ) return state;
            const history : HistoryStack = pushHistory( state.history, state.definition );
            const edges : Array<Workflow.Edge> = state.definition.edges.filter( ( edge : Workflow.Edge ) : boolean => edge.id !== action.edgeId );
            const definition : Workflow.Entity = { ...state.definition, edges };
            const selectedEdgeId : string | null = state.selectedEdgeId === action.edgeId ? null : state.selectedEdgeId;
            return { ...state, definition, history, dirtyFlag: true, selectedEdgeId };
        }

        case WorkflowEditorActionType.SELECT_NODE :
            return { ...state, selectedNodeId: action.nodeId, selectedEdgeId: null };

        case WorkflowEditorActionType.SELECT_EDGE :
            return { ...state, selectedEdgeId: action.edgeId, selectedNodeId: null };

        case WorkflowEditorActionType.MARK_SAVED :
            return { ...state, dirtyFlag: false };

        // undo — restore the newest past snapshot, pushing the current definition onto the redo stack
        case WorkflowEditorActionType.UNDO :
        {
            if( state.definition === null || state.history.past.length === 0 ) return state;
            const previous : Workflow.Entity = state.history.past[ state.history.past.length - 1 ];
            const past : Array<Workflow.Entity> = state.history.past.slice( 0, -1 );
            const future : Array<Workflow.Entity> = [ ...state.history.future, state.definition ].slice( -HISTORY_MAX_SIZE );
            return { ...state, definition: previous, history: { past, future, maxSize: HISTORY_MAX_SIZE }, dirtyFlag: true, selectedNodeId: null, selectedEdgeId: null };
        }

        // redo — restore the newest future snapshot, pushing the current definition back onto past
        case WorkflowEditorActionType.REDO :
        {
            if( state.definition === null || state.history.future.length === 0 ) return state;
            const next : Workflow.Entity = state.history.future[ state.history.future.length - 1 ];
            const future : Array<Workflow.Entity> = state.history.future.slice( 0, -1 );
            const past : Array<Workflow.Entity> = [ ...state.history.past, state.definition ].slice( -HISTORY_MAX_SIZE );
            return { ...state, definition: next, history: { past, future, maxSize: HISTORY_MAX_SIZE }, dirtyFlag: true, selectedNodeId: null, selectedEdgeId: null };
        }

        default :
            return state;
    }
}

export default workflowEditorReducer;
